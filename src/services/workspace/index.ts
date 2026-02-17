// mcp-agent-manager/src/services/workspace/index.ts
// WorkspaceMonitor - orchestrates workspace monitoring via sub-modules

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { logger } from '../logger.js';
import { eventBus } from '../events.js';
import type { MonitoredWorkspace, SessionMeta } from './types.js';
import { findWorkspaceId } from './discovery.js';
import { watchDir } from './fileWatcher.js';
import { watchGit, startRemoteFetch } from './gitMonitor.js';
import { startSessionMining, mineSessions, loadMemories } from './sessionMiner.js';
import { workspaceHistory } from './history.js';
import { getConfigDir } from '../dataDir.js';

// Re-export types for consumers
export type { SessionMeta, MemoryEntry, MonitoredWorkspace } from './types.js';
export type { WorkspaceHistoryEntry } from './history.js';
export { workspaceHistory } from './history.js';

const CONFIG_DIR = getConfigDir();
const MONITORS_FILE = join(CONFIG_DIR, 'monitors.json');

class WorkspaceMonitor {
  private monitors: Map<string, MonitoredWorkspace> = new Map();

  /** Load persisted workspace paths and start monitoring them */
  loadPersistedMonitors(): void {
    // Ensure history is loaded on startup
    workspaceHistory.load();
    if (!existsSync(MONITORS_FILE)) return;
    try {
      const raw = readFileSync(MONITORS_FILE, 'utf-8');
      const paths: string[] = JSON.parse(raw);
      let restored = 0;
      for (const p of paths) {
        if (existsSync(p) && !this.monitors.has(resolve(p))) {
          try {
            this.start(p);
            restored++;
          } catch (err: any) {
            logger.warn(`Failed to restore monitor for ${p}: ${err.message}`);
          }
        }
      }
      if (restored > 0) {
        logger.info(`Restored ${restored} workspace monitor(s) from disk`);
      }
    } catch (err: any) {
      logger.error(`Failed to load persisted monitors: ${err.message}`);
    }
  }

  private saveMonitoredPaths(): void {
    try {
      if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
      }
      const paths = [...this.monitors.keys()];
      writeFileSync(MONITORS_FILE, JSON.stringify(paths, null, 2));
    } catch (err: any) {
      logger.error(`Failed to save monitored paths: ${err.message}`);
    }
  }

  /**
   * Start monitoring a workspace path. Discovers VS Code workspace storage,
   * watches chat sessions, .git, and .vscode directories.
   */
  start(workspacePath: string): MonitoredWorkspace {
    const absPath = resolve(workspacePath);
    if (this.monitors.has(absPath)) {
      logger.info(`Already monitoring: ${absPath}`);
      return this.monitors.get(absPath)!;
    }

    if (!existsSync(absPath)) {
      throw new Error(`Workspace path does not exist: ${absPath}`);
    }

    const ws: MonitoredWorkspace = {
      path: absPath,
      watchers: [],
      startedAt: new Date(),
      recentChanges: [],
      knownSessions: [],
      gitEvents: [],
      remoteRefs: new Map(),
      sessionMetas: new Map(),
      memories: [],
    };

    // 1. Discover VS Code workspace storage ID
    const wsId = findWorkspaceId(absPath);
    if (wsId) {
      ws.workspaceId = wsId.id;
      ws.chatSessionsPath = wsId.chatPath;
      ws.chatSessionsJsonlPath = wsId.jsonlPath;
      logger.info(`Discovered workspace ID: ${wsId.id} for ${absPath}`);

      // Enumerate existing chat sessions
      if (wsId.chatPath && existsSync(wsId.chatPath)) {
        try {
          ws.knownSessions = readdirSync(wsId.chatPath, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);
        } catch { /* ignore */ }
      }

      if (wsId.chatPath && existsSync(wsId.chatPath)) {
        watchDir(ws, wsId.chatPath, 'chat-session');
      }
      if (wsId.memoryPath) {
        loadMemories(ws, wsId.memoryPath);
      }
      startSessionMining(ws);
      if (wsId.jsonlPath && existsSync(wsId.jsonlPath)) {
        watchDir(ws, wsId.jsonlPath, 'chat-jsonl');
      }
    }

    // 2. Watch .git directory
    const gitDir = join(absPath, '.git');
    if (existsSync(gitDir)) {
      watchGit(ws, gitDir);
      startRemoteFetch(ws, gitDir);
    }

    // 3. Watch .vscode directory
    const vscodeDir = join(absPath, '.vscode');
    if (existsSync(vscodeDir)) {
      watchDir(ws, vscodeDir, 'vscode-config');
    }

    this.monitors.set(absPath, ws);
    this.saveMonitoredPaths();

    eventBus.emitEvent('workspace:monitoring', {
      path: absPath,
      workspaceId: ws.workspaceId,
      sessionCount: ws.knownSessions.length,
    });

    logger.info(`Started monitoring workspace: ${absPath} (${ws.watchers.length} watchers, ${ws.knownSessions.length} sessions)`);
    return ws;
  }

  stop(workspacePath: string, skipPersist = false): boolean {
    const absPath = resolve(workspacePath);
    const ws = this.monitors.get(absPath);
    if (!ws) return false;

    // Record history before teardown
    const reason = skipPersist ? 'shutdown' : 'manual';
    workspaceHistory.addEntry(ws, reason);

    for (const w of ws.watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    if (ws.fetchTimer) clearInterval(ws.fetchTimer);
    if (ws.mineTimer) clearInterval(ws.mineTimer);
    if (ws.mineDebounce) clearTimeout(ws.mineDebounce);

    this.monitors.delete(absPath);
    if (!skipPersist) this.saveMonitoredPaths();
    eventBus.emitEvent('workspace:stopped', { path: absPath });
    logger.info(`Stopped monitoring workspace: ${absPath}`);
    return true;
  }

  stopAll(skipPersist = false): number {
    let count = 0;
    for (const path of [...this.monitors.keys()]) {
      if (this.stop(path, skipPersist)) count++;
    }
    return count;
  }

  getAll(): MonitoredWorkspace[] {
    return [...this.monitors.values()];
  }

  get(workspacePath: string): MonitoredWorkspace | undefined {
    return this.monitors.get(resolve(workspacePath));
  }

  async mineNow(workspacePath?: string): Promise<{ path: string; sessionCount: number; sessions: SessionMeta[] }[]> {
    const targets: MonitoredWorkspace[] = [];
    if (workspacePath) {
      const ws = this.monitors.get(resolve(workspacePath));
      if (!ws) throw new Error(`Not monitoring: ${workspacePath}`);
      targets.push(ws);
    } else {
      targets.push(...this.monitors.values());
    }

    const results: { path: string; sessionCount: number; sessions: SessionMeta[] }[] = [];
    for (const ws of targets) {
      await mineSessions(ws);
      results.push({
        path: ws.path,
        sessionCount: ws.sessionMetas.size,
        sessions: [...ws.sessionMetas.values()],
      });
    }
    return results;
  }

  /** Get detailed status for a single monitored workspace */
  getDetail(workspacePath: string): object | undefined {
    const ws = this.monitors.get(resolve(workspacePath));
    if (!ws) return undefined;
    return {
      path: ws.path,
      workspaceId: ws.workspaceId,
      chatSessionsPath: ws.chatSessionsPath,
      watcherCount: ws.watchers.length,
      sessionCount: ws.knownSessions.length,
      knownSessions: ws.knownSessions,
      recentChanges: ws.recentChanges.slice(0, 50),
      gitEvents: ws.gitEvents.slice(0, 50),
      sessionMetas: [...ws.sessionMetas.values()],
      memoryCount: ws.memories.length,
      memories: ws.memories,
      startedAt: ws.startedAt.toISOString(),
      monitoringMs: Date.now() - ws.startedAt.getTime(),
    };
  }

  getStatus(): object {
    return {
      count: this.monitors.size,
      workspaces: [...this.monitors.entries()].map(([path, ws]) => ({
        path,
        workspaceId: ws.workspaceId,
        chatSessionsPath: ws.chatSessionsPath,
        watcherCount: ws.watchers.length,
        sessionCount: ws.knownSessions.length,
        recentChangeCount: ws.recentChanges.length,
        gitEventCount: ws.gitEvents.length,
        sessionMetas: [...ws.sessionMetas.values()],
        memoryCount: ws.memories.length,
        startedAt: ws.startedAt.toISOString(),
        monitoringMs: Date.now() - ws.startedAt.getTime(),
      })),
    };
  }
}

/** Singleton workspace monitor */
export const workspaceMonitor = new WorkspaceMonitor();
