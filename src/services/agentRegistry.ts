// mcp-agent-manager/src/services/agentRegistry.ts
// Manages agent configurations and runtime instances

import * as fs from 'fs';
import * as path from 'path';
import { AgentConfig, AgentInstance, AgentState, AgentHealth } from '../types/index.js';
import { logger } from './logger.js';
import { eventBus } from './events.js';
import { getAgentsDir } from './dataDir.js';
import { watchConfigFile, ConfigWatcher } from './configWatcher.js';

const AGENTS_DIR = getAgentsDir();
const AGENTS_FILE = path.join(AGENTS_DIR, 'agents.json');

/** In-memory registry of all known agents and their runtime state */
class AgentRegistry {
  private agents: Map<string, AgentInstance> = new Map();
  private loaded = false;
  private configWatcher: ConfigWatcher | null = null;

  /** Load persisted agent configs from disk */
  load(): void {
    if (!fs.existsSync(AGENTS_DIR)) {
      fs.mkdirSync(AGENTS_DIR, { recursive: true });
    }

    const backupFile = AGENTS_FILE + '.bak';

    if (!fs.existsSync(AGENTS_FILE)) {
      // Check for backup if primary is missing
      if (fs.existsSync(backupFile)) {
        logger.warn(`[AgentRegistry] ${AGENTS_FILE} missing but backup exists — restoring`);
        fs.copyFileSync(backupFile, AGENTS_FILE);
      }
    }

    if (fs.existsSync(AGENTS_FILE)) {
      try {
        const raw = fs.readFileSync(AGENTS_FILE, 'utf-8');
        const configs: AgentConfig[] = JSON.parse(raw);

        // If file is empty but backup has data, recover
        if (configs.length === 0 && fs.existsSync(backupFile)) {
          try {
            const bakConfigs: AgentConfig[] = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));
            if (bakConfigs.length > 0) {
              logger.warn(`[AgentRegistry] agents.json is empty but backup has ${bakConfigs.length} agents — restoring`);
              fs.copyFileSync(backupFile, AGENTS_FILE);
              for (const config of bakConfigs) {
                this.agents.set(config.id, this._createInstance(config));
              }
              logger.info(`Recovered ${this.agents.size} agent(s) from backup`);
              this.loaded = true;
              if (!this.configWatcher) {
                this.configWatcher = watchConfigFile(AGENTS_FILE, () => this.reload(), 'agents');
              }
              return;
            }
          } catch { /* backup corrupt */ }
        }

        for (const config of configs) {
          this.agents.set(config.id, this._createInstance(config));
        }
        logger.info(`Loaded ${this.agents.size} agent(s) from disk`);
      } catch (err: any) {
        logger.error(`Failed to load agents: ${err.message}`);
      }
    }
    this.loaded = true;

    // Watch for external file changes (other instances, manual edits)
    if (!this.configWatcher) {
      this.configWatcher = watchConfigFile(AGENTS_FILE, () => this.reload(), 'agents');
    }
  }

  /** Create an AgentInstance from config */
  private _createInstance(config: AgentConfig): AgentInstance {
    return {
      config,
      state: 'idle',
      tasksCompleted: 0,
      tasksFailed: 0,
      activeTasks: 0,
      totalTokensUsed: 0,
      tokensEstimated: config.provider === 'copilot',
      costAccumulated: 0,
      premiumRequests: 0,
      startedAt: new Date(),
    };
  }

  /** Reload agent configs from disk when the file changes externally, preserving runtime state */
  private reload(): void {
    if (!fs.existsSync(AGENTS_FILE)) return;
    try {
      const raw = fs.readFileSync(AGENTS_FILE, 'utf-8');
      const configs: AgentConfig[] = JSON.parse(raw);

      // If external change wiped to empty and we have agents in memory, don't wipe
      if (configs.length === 0 && this.agents.size > 0) {
        logger.warn(`[AgentRegistry] External change wiped agents.json to empty — ignoring (have ${this.agents.size} agents in memory)`);
        return;
      }

      const newIds = new Set(configs.map(c => c.id));

      for (const config of configs) {
        const existing = this.agents.get(config.id);
        if (existing) {
          // Preserve runtime state, update config only
          existing.config = config;
        } else {
          this.agents.set(config.id, this._createInstance(config));
        }
      }

      // Remove agents no longer in file (only if idle)
      for (const [id, instance] of this.agents) {
        if (!newIds.has(id) && instance.activeTasks === 0) {
          this.agents.delete(id);
        }
      }

      logger.info(`Reloaded ${this.agents.size} agent(s) from disk (external change)`);
    } catch (err: any) {
      logger.error(`Failed to reload agents: ${err.message}`);
    }
  }

  /** Persist agent configs to disk */
  private save(): void {
    try {
      if (!fs.existsSync(AGENTS_DIR)) {
        fs.mkdirSync(AGENTS_DIR, { recursive: true });
      }
      this.configWatcher?.markSelfWrite();
      const configs = this.getAll().map(i => i.config);

      // Safety: backup before overwriting non-empty file with empty array
      if (configs.length === 0 && fs.existsSync(AGENTS_FILE)) {
        try {
          const existing = fs.readFileSync(AGENTS_FILE, 'utf-8').trim();
          if (existing !== '[]' && existing !== '') {
            const backupFile = AGENTS_FILE + '.bak';
            fs.copyFileSync(AGENTS_FILE, backupFile);
            logger.warn(
              `[AgentRegistry] Writing empty agents array — backed up ${AGENTS_FILE} → ${backupFile}`,
            );
          }
        } catch { /* file unreadable, skip backup */ }
      }

      fs.writeFileSync(AGENTS_FILE, JSON.stringify(configs, null, 2));
    } catch (err: any) {
      logger.error(`Failed to save agents: ${err.message}`);
    }
  }

  /** Stop watching config file */
  close(): void {
    this.configWatcher?.close();
    this.configWatcher = null;
  }

  /** Register a new agent configuration */
  register(config: AgentConfig): AgentInstance {
    if (this.agents.has(config.id)) {
      logger.warn(`Agent ${config.id} already registered, updating config`);
    }

    const instance: AgentInstance = {
      config,
      state: 'idle',
      tasksCompleted: 0,
      tasksFailed: 0,
      activeTasks: 0,
      totalTokensUsed: 0,
      tokensEstimated: config.provider === 'copilot',
      costAccumulated: 0,
      premiumRequests: 0,
      startedAt: new Date(),
    };

    this.agents.set(config.id, instance);
    this.save();
    logger.info(`Registered agent: ${config.id} (${config.provider}/${config.model}) [state=idle]`);
    eventBus.emitEvent('agent:registered', {
      agentId: config.id,
      provider: config.provider,
      model: config.model,
      tags: config.tags,
    });
    return instance;
  }

  /** Partially update an existing agent's config (preserves runtime state) */
  update(agentId: string, partial: Partial<Omit<AgentConfig, 'id'>>): AgentInstance | undefined {
    const instance = this.agents.get(agentId);
    if (!instance) return undefined;

    const prev = { ...instance.config };
    Object.assign(instance.config, partial, { id: agentId }); // id is immutable
    this.save();
    logger.info(`Updated agent config: ${agentId}`);
    eventBus.emitEvent('agent:state-changed', {
      agentId,
      previousState: instance.state,
      newState: instance.state,
      configUpdated: true,
    });
    return instance;
  }

  /** Unregister an agent */
  unregister(agentId: string): boolean {
    const instance = this.agents.get(agentId);
    if (!instance) return false;

    if (instance.state === 'idle' || instance.state === 'running' || instance.state === 'busy') {
      logger.warn(`Unregistering active agent ${agentId} - force stopping`);
      instance.state = 'stopped';
    }

    this.agents.delete(agentId);
    this.save();
    logger.info(`Unregistered agent: ${agentId}`);
    eventBus.emitEvent('agent:unregistered', { agentId });
    return true;
  }

  /** Get agent instance by ID */
  get(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId);
  }

  /** Get all registered agents */
  getAll(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  /** Find agents matching tags */
  findByTags(tags: string[]): AgentInstance[] {
    return this.getAll().filter(a =>
      tags.some(t => a.config.tags.includes(t))
    );
  }

  /** Find agents by provider */
  findByProvider(provider: string): AgentInstance[] {
    return this.getAll().filter(a => a.config.provider === provider);
  }

  /** Find agents available for work (not stopped/error, below concurrency limit) */
  findAvailable(tags?: string[]): AgentInstance[] {
    return this.getAll().filter(a => {
      const available = (a.state === 'idle' || a.state === 'running') &&
        a.activeTasks < a.config.maxConcurrency;
      if (!available) return false;
      if (tags && tags.length > 0) {
        return tags.some(t => a.config.tags.includes(t));
      }
      return true;
    });
  }

  /** Update agent state */
  setState(agentId: string, state: AgentState, error?: string): void {
    const instance = this.agents.get(agentId);
    if (!instance) return;
    const previousState = instance.state;
    instance.state = state;
    instance.lastActivityAt = new Date();
    if (error) instance.error = error;
    if (state === 'running' && !instance.startedAt) {
      instance.startedAt = new Date();
    }
    if (previousState !== state) {
      eventBus.emitEvent('agent:state-changed', { agentId, previousState, newState: state, error });
    }
  }

  /** Record task completion for an agent */
  recordTaskComplete(agentId: string, tokens: number, cost: number, success: boolean, premiumRequests = 0): void {
    const instance = this.agents.get(agentId);
    if (!instance) return;

    instance.lastActivityAt = new Date();
    instance.activeTasks = Math.max(0, instance.activeTasks - 1);
    instance.totalTokensUsed += tokens;
    instance.costAccumulated += cost;
    instance.premiumRequests += premiumRequests;

    if (success) {
      instance.tasksCompleted++;
    } else {
      instance.tasksFailed++;
    }

    // Return to idle if no active tasks
    if (instance.activeTasks === 0 && (instance.state === 'busy' || instance.state === 'running')) {
      instance.state = 'idle';
    } else if (instance.activeTasks > 0 && instance.state === 'busy' && instance.activeTasks < instance.config.maxConcurrency) {
      instance.state = 'running';
    }
  }

  /** Mark an agent as working on a task */
  recordTaskStart(agentId: string): void {
    const instance = this.agents.get(agentId);
    if (!instance) return;
    instance.activeTasks++;
    instance.lastActivityAt = new Date();
    if (instance.state === 'idle' || instance.state === 'running') {
      instance.state = instance.activeTasks >= instance.config.maxConcurrency ? 'busy' : 'running';
    }
  }

  /** Get health info for all agents, or a specific agent by ID */
  getHealth(agentId?: string): AgentHealth[] | AgentHealth | undefined {
    if (agentId) {
      const instance = this.agents.get(agentId);
      if (!instance) return undefined;
      return {
        agentId: instance.config.id,
        state: instance.state,
        uptime: instance.startedAt ? Date.now() - instance.startedAt.getTime() : undefined,
        lastError: instance.error,
        tasksCompleted: instance.tasksCompleted,
        tasksFailed: instance.tasksFailed,
        avgLatencyMs: undefined,
      };
    }
    return this.getAll().map(a => ({
      agentId: a.config.id,
      state: a.state,
      uptime: a.startedAt ? Date.now() - a.startedAt.getTime() : undefined,
      lastError: a.error,
      tasksCompleted: a.tasksCompleted,
      tasksFailed: a.tasksFailed,
      avgLatencyMs: undefined,
    }));
  }

  /** Get count of registered agents */
  get count(): number {
    return this.agents.size;
  }

  /** Get count of active agents */
  get activeCount(): number {
    return this.getAll().filter(a =>
      a.state === 'running' || a.state === 'busy'
    ).length;
  }
}

/** Singleton registry */
export const agentRegistry = new AgentRegistry();
