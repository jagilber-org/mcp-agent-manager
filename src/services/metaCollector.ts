// mcp-agent-manager/src/services/metaCollector.ts
// Collects agent/skill/automation performance metadata from events.
// Accumulates stats in memory, periodically flushes to JSONL on disk.
// Optionally syncs insights to mcp-index-server (auto-discovered or MCP_INDEX_URL).
// Resilient: circuit breaker prevents impact when index-server is unreachable.
//
// Env flags:
//   MCP_META_ENABLED          - enable/disable meta collection (default: true)
//   MCP_META_FLUSH_INTERVAL   - local flush interval ms (default: 60000)
//   MCP_INDEX_URL             - explicit index-server base URL (auto-discovered from mcp.json if not set)
//   MCP_META_SYNC_INTERVAL    - sync-to-index interval ms (default: 300000 = 5min)
//   META_DIR                  - override meta storage directory

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { eventBus, ManagerEventName } from './events.js';
import { logger } from './logger.js';
import { getMetaDir } from './dataDir.js';
import { IndexClient, indexClient } from './indexClient.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Whether meta collection is enabled */
export function isMetaEnabled(): boolean {
  const val = process.env.MCP_META_ENABLED;
  // Default true unless explicitly disabled
  return val === undefined || val === '' || val === '1' || val.toLowerCase() === 'true';
}

function getFlushIntervalMs(): number {
  return parseInt(process.env.MCP_META_FLUSH_INTERVAL || '60000', 10) || 60000;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-agent accumulated stats */
export interface AgentMeta {
  agentId: string;
  provider?: string;
  model?: string;
  totalTasks: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  totalCost: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  avgTokensPerTask: number;
  /** Total premium requests consumed (Copilot billing) */
  premiumRequests: number;
  /** Whether this agent's token counts are estimated */
  tokensEstimated: boolean;
  /** Breakdown by skill */
  skillBreakdown: Record<string, {
    tasks: number;
    successes: number;
    failures: number;
    totalTokens: number;
    totalLatencyMs: number;
  }>;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Per-skill accumulated stats */
export interface SkillMeta {
  skillId: string;
  name?: string;
  strategy?: string;
  totalTasks: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  totalCost: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  /** Total premium requests consumed across executions */
  premiumRequests: number;
  bestAgentId?: string;
  bestAgentSuccessRate?: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Per-automation-rule accumulated stats */
export interface AutomationMeta {
  ruleId: string;
  triggerCount: number;
  lastTriggeredAt?: string;
}

/** Session summary - written once per server lifecycle */
export interface SessionSummary {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  totalTasks: number;
  totalTokens: number;
  totalCost: number;
  agentCount: number;
  skillCount: number;
}

/** A single JSONL meta entry */
export interface MetaEntry {
  ts: string;
  type: 'agent' | 'skill' | 'automation' | 'session' | 'task';
  data: AgentMeta | SkillMeta | AutomationMeta | SessionSummary | TaskMeta;
}

/** Fine-grained per-task record (for trend analysis) */
export interface TaskMeta {
  taskId: string;
  skillId: string;
  strategy: string;
  success: boolean;
  totalTokens: number;
  totalCost: number;
  totalLatencyMs: number;
  agentCount: number;
  completedAt: string;
  /** Whether token counts are estimated */
  tokensEstimated?: boolean;
  /** Premium requests consumed */
  premiumRequests?: number;
}

// ---------------------------------------------------------------------------
// In-memory accumulators
// ---------------------------------------------------------------------------

const agentStats: Map<string, AgentMeta> = new Map();
const skillStats: Map<string, SkillMeta> = new Map();
const automationStats: Map<string, AutomationMeta> = new Map();
const pendingTaskRecords: TaskMeta[] = [];

let sessionStartedAt: Date | null = null;
let sessionTotalTasks = 0;
let sessionTotalTokens = 0;
let sessionTotalCost = 0;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;

// ---------------------------------------------------------------------------
// Meta file helpers
// ---------------------------------------------------------------------------

let metaFilePath: string | null = null;

function ensureMetaFile(): void {
  if (metaFilePath) return;
  const dir = getMetaDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  metaFilePath = join(dir, 'agent-meta.jsonl');
}

function appendMeta(entry: MetaEntry): void {
  ensureMetaFile();
  if (!metaFilePath) return;
  try {
    appendFileSync(metaFilePath, JSON.stringify(entry) + '\n');
  } catch (err: any) {
    logger.warn(`Failed to write meta: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Load historical stats from disk (replay JSONL)
// ---------------------------------------------------------------------------

function loadFromDisk(): void {
  ensureMetaFile();
  if (!metaFilePath || !existsSync(metaFilePath)) return;

  try {
    const raw = readFileSync(metaFilePath, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    let loaded = 0;
    for (const line of lines) {
      try {
        const entry: MetaEntry = JSON.parse(line);
        // Re-hydrate agent and skill aggregates from the latest snapshot per id
        if (entry.type === 'agent') {
          const d = entry.data as AgentMeta;
          agentStats.set(d.agentId, d);
          loaded++;
        } else if (entry.type === 'skill') {
          const d = entry.data as SkillMeta;
          skillStats.set(d.skillId, d);
          loaded++;
        } else if (entry.type === 'automation') {
          const d = entry.data as AutomationMeta;
          automationStats.set(d.ruleId, d);
          loaded++;
        }
      } catch { /* skip malformed */ }
    }
    if (loaded > 0) {
      logger.info(`Meta collector loaded ${loaded} historical entries`);
    }
  } catch (err: any) {
    logger.warn(`Failed to load meta history: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Event handlers - accumulate real-time stats
// ---------------------------------------------------------------------------

function onAgentRegistered(data: { agentId: string; provider: string; model: string; tags: string[] }): void {
  if (!agentStats.has(data.agentId)) {
    agentStats.set(data.agentId, {
      agentId: data.agentId,
      provider: data.provider,
      model: data.model,
      totalTasks: 0,
      successCount: 0,
      failureCount: 0,
      totalTokens: 0,
      totalCost: 0,
      totalLatencyMs: 0,
      avgLatencyMs: 0,
      avgTokensPerTask: 0,
      premiumRequests: 0,
      tokensEstimated: data.provider === 'copilot',
      skillBreakdown: {},
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
  } else {
    // Update provider/model if changed
    const existing = agentStats.get(data.agentId)!;
    existing.provider = data.provider;
    existing.model = data.model;
    existing.lastSeenAt = new Date().toISOString();
  }
}

function onTaskCompleted(data: {
  taskId: string; skillId: string; strategy: string;
  success: boolean; totalTokens: number; totalCost: number;
  totalLatencyMs: number; agentCount: number;
}): void {
  const now = new Date().toISOString();

  // --- Session totals ---
  sessionTotalTasks++;
  sessionTotalTokens += data.totalTokens;
  sessionTotalCost += data.totalCost;

  // --- Skill stats ---
  let sk = skillStats.get(data.skillId);
  if (!sk) {
    sk = {
      skillId: data.skillId,
      strategy: data.strategy,
      totalTasks: 0,
      successCount: 0,
      failureCount: 0,
      totalTokens: 0,
      totalCost: 0,
      totalLatencyMs: 0,
      avgLatencyMs: 0,
      premiumRequests: 0,
      firstSeenAt: now,
      lastSeenAt: now,
    };
    skillStats.set(data.skillId, sk);
  }
  sk.totalTasks++;
  if (data.success) sk.successCount++;
  else sk.failureCount++;
  sk.totalTokens += data.totalTokens;
  sk.totalCost += data.totalCost;
  sk.totalLatencyMs += data.totalLatencyMs;
  sk.avgLatencyMs = sk.totalTasks > 0 ? Math.round(sk.totalLatencyMs / sk.totalTasks) : 0;
  sk.lastSeenAt = now;

  // --- Per-task record (for fine-grained trends) ---
  pendingTaskRecords.push({
    taskId: data.taskId,
    skillId: data.skillId,
    strategy: data.strategy,
    success: data.success,
    totalTokens: data.totalTokens,
    totalCost: data.totalCost,
    totalLatencyMs: data.totalLatencyMs,
    agentCount: data.agentCount,
    completedAt: now,
  });

  // NOTE: We can't break down per-agent here because task:completed only has
  // aggregate data. Agent-level breakdown is updated when agent:state-changed fires
  // after task completion (the registry tracks per-agent in memory).
  // For a deeper breakdown, we'd need to emit richer events from taskRouter.
  // For now, agent stats are accumulated from the agent:registered event +
  // periodic flush pulls latest from agentRegistry.
}

function onSkillRegistered(data: { skillId: string; name: string; strategy: string }): void {
  const existing = skillStats.get(data.skillId);
  if (existing) {
    existing.name = data.name;
    existing.strategy = data.strategy;
  } else {
    skillStats.set(data.skillId, {
      skillId: data.skillId,
      name: data.name,
      strategy: data.strategy,
      totalTasks: 0,
      successCount: 0,
      failureCount: 0,
      totalTokens: 0,
      totalCost: 0,
      totalLatencyMs: 0,
      avgLatencyMs: 0,
      premiumRequests: 0,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// Periodic flush - write accumulated stats to disk + sync to index
// ---------------------------------------------------------------------------

function flush(): void {
  const now = new Date().toISOString();

  // Write agent aggregates
  for (const agent of agentStats.values()) {
    appendMeta({ ts: now, type: 'agent', data: agent });
  }

  // Write skill aggregates
  for (const skill of skillStats.values()) {
    appendMeta({ ts: now, type: 'skill', data: skill });
  }

  // Write automation aggregates
  for (const auto of automationStats.values()) {
    appendMeta({ ts: now, type: 'automation', data: auto });
  }

  // Write pending per-task records
  for (const task of pendingTaskRecords) {
    appendMeta({ ts: now, type: 'task', data: task });
  }
  pendingTaskRecords.length = 0;

  // Sync to index-server if configured
  syncToIndex();

  logger.debug(`Meta flush: ${agentStats.size} agents, ${skillStats.size} skills, ${automationStats.size} automations`);
}

// ---------------------------------------------------------------------------
// Index-server sync (optional)
// ---------------------------------------------------------------------------

async function syncToIndex(): Promise<void> {
  if (!indexClient.isConfigured() || indexClient.isCircuitOpen()) return;

  try {
    // Sync agent insights
    for (const agent of agentStats.values()) {
      await indexClient.storeKnowledge(
        `agent-performance:${agent.agentId}`,
        `Agent ${agent.agentId} (${agent.provider}/${agent.model}): ` +
        `${agent.totalTasks} tasks, ${agent.successCount} success, ${agent.failureCount} failures, ` +
        `avg ${agent.avgLatencyMs}ms latency, ${agent.totalTokens} tokens, $${agent.totalCost.toFixed(4)} cost`,
        {
          category: 'agent-performance',
          agentId: agent.agentId,
          provider: agent.provider,
          model: agent.model,
          totalTasks: agent.totalTasks,
          successRate: agent.totalTasks > 0
            ? (agent.successCount / agent.totalTasks * 100).toFixed(1) + '%'
            : 'N/A',
          source: 'mcp-agent-manager',
        }
      );
    }

    // Sync skill insights
    for (const skill of skillStats.values()) {
      await indexClient.storeKnowledge(
        `skill-performance:${skill.skillId}`,
        `Skill ${skill.skillId} (${skill.strategy}): ` +
        `${skill.totalTasks} executions, ${skill.successCount} success, avg ${skill.avgLatencyMs}ms`,
        {
          category: 'skill-performance',
          skillId: skill.skillId,
          strategy: skill.strategy,
          totalTasks: skill.totalTasks,
          source: 'mcp-agent-manager',
        }
      );
    }

    logger.debug('Meta synced to index-server');
  } catch (err: any) {
    logger.warn(`Index sync failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Initialize the meta collector - subscribes to events, starts flush timer */
export function initMetaCollector(): void {
  if (initialized) return;
  if (!isMetaEnabled()) {
    logger.info('Meta collector disabled (MCP_META_ENABLED=false)');
    return;
  }

  // Load historical data
  loadFromDisk();

  // Subscribe to events
  eventBus.onEvent('agent:registered', onAgentRegistered);
  eventBus.onEvent('task:completed', onTaskCompleted);
  eventBus.onEvent('skill:registered', onSkillRegistered);

  // Track session start
  sessionStartedAt = new Date();

  // Start periodic flush
  const interval = getFlushIntervalMs();
  flushTimer = setInterval(flush, interval);

  initialized = true;
  logger.info(`Meta collector initialized (flush every ${interval}ms, index: ${indexClient.isConfigured() ? `${indexClient.baseUrl} [${indexClient.discoverySource}]` : 'off'})`);
}

/** Shut down the meta collector - final flush + session summary */
export function shutdownMetaCollector(): void {
  if (!initialized) return;

  // Stop timer
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }

  // Write session summary
  if (sessionStartedAt) {
    const now = new Date();
    const summary: SessionSummary = {
      sessionId: `session-${sessionStartedAt.getTime()}`,
      startedAt: sessionStartedAt.toISOString(),
      endedAt: now.toISOString(),
      durationMs: now.getTime() - sessionStartedAt.getTime(),
      totalTasks: sessionTotalTasks,
      totalTokens: sessionTotalTokens,
      totalCost: sessionTotalCost,
      agentCount: agentStats.size,
      skillCount: skillStats.size,
    };
    appendMeta({ ts: now.toISOString(), type: 'session', data: summary });
  }

  // Final flush
  flush();

  initialized = false;
  logger.info('Meta collector shut down');
}

/** Get current agent performance insights */
export function getAgentInsights(): AgentMeta[] {
  return Array.from(agentStats.values());
}

/** Get current skill performance insights */
export function getSkillInsights(): SkillMeta[] {
  return Array.from(skillStats.values());
}

/** Get combined insights summary */
export function getInsightsSummary(): {
  agents: AgentMeta[];
  skills: SkillMeta[];
  session: {
    startedAt: string;
    durationMs: number;
    totalTasks: number;
    totalTokens: number;
    totalCost: number;
  };
  indexServer: { configured: boolean; url: string | null };
} {
  return {
    agents: getAgentInsights(),
    skills: getSkillInsights(),
    session: {
      startedAt: sessionStartedAt?.toISOString() || '',
      durationMs: sessionStartedAt ? Date.now() - sessionStartedAt.getTime() : 0,
      totalTasks: sessionTotalTasks,
      totalTokens: sessionTotalTokens,
      totalCost: sessionTotalCost,
    },
    indexServer: {
      configured: indexClient.isConfigured(),
      url: indexClient.isConfigured() ? indexClient.baseUrl : null,
    },
  };
}

/** Force an immediate flush (useful for testing) */
export function flushNow(): void {
  flush();
}

/**
 * Update agent stats from registry snapshot.
 * Called during flush to capture runtime state that events don't carry.
 */
export function updateAgentFromRegistry(agentId: string, stats: {
  provider: string;
  model: string;
  tasksCompleted: number;
  tasksFailed: number;
  totalTokensUsed: number;
  costAccumulated: number;
}): void {
  let meta = agentStats.get(agentId);
  if (!meta) {
    meta = {
      agentId,
      provider: stats.provider,
      model: stats.model,
      totalTasks: 0,
      successCount: 0,
      failureCount: 0,
      totalTokens: 0,
      totalCost: 0,
      totalLatencyMs: 0,
      avgLatencyMs: 0,
      avgTokensPerTask: 0,
      premiumRequests: 0,
      tokensEstimated: stats.provider === 'copilot',
      skillBreakdown: {},
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    agentStats.set(agentId, meta);
  }

  // Merge registry totals (registry is canonical for per-agent task counts)
  meta.provider = stats.provider;
  meta.model = stats.model;
  meta.totalTasks = stats.tasksCompleted + stats.tasksFailed;
  meta.successCount = stats.tasksCompleted;
  meta.failureCount = stats.tasksFailed;
  meta.totalTokens = stats.totalTokensUsed;
  meta.totalCost = stats.costAccumulated;
  meta.avgTokensPerTask = meta.totalTasks > 0 ? Math.round(meta.totalTokens / meta.totalTasks) : 0;
  meta.lastSeenAt = new Date().toISOString();
}

/** Reset all stats (for testing) */
export function resetMetaStats(): void {
  agentStats.clear();
  skillStats.clear();
  automationStats.clear();
  pendingTaskRecords.length = 0;
  sessionTotalTasks = 0;
  sessionTotalTokens = 0;
  sessionTotalCost = 0;
}
