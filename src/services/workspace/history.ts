// mcp-agent-manager/src/services/workspace/history.ts
// Workspace monitoring history - records start/stop sessions with stats

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../logger.js';
import type { MonitoredWorkspace } from './types.js';
import { getConfigDir } from '../dataDir.js';
import { watchConfigFile, ConfigWatcher } from '../configWatcher.js';

const CONFIG_DIR = getConfigDir();
const HISTORY_FILE = join(CONFIG_DIR, 'workspace-history.json');

/** Persisted record of a workspace monitoring session */
export interface WorkspaceHistoryEntry {
  path: string;
  startedAt: string;
  stoppedAt: string;
  durationMs: number;
  sessionCount: number;
  gitEvents: number;
  fileChanges: number;
  lastGitEvent?: string;
  sessionsDiscovered: string[];
  reason: 'manual' | 'shutdown' | 'error';
}

class WorkspaceHistory {
  private entries: WorkspaceHistoryEntry[] = [];
  private loaded = false;
  private configWatcher: ConfigWatcher | null = null;

  /** Load history from disk */
  load(): void {
    if (this.loaded) return;
    if (existsSync(HISTORY_FILE)) {
      try {
        const raw = readFileSync(HISTORY_FILE, 'utf-8');
        this.entries = JSON.parse(raw);
        logger.info(`Loaded ${this.entries.length} workspace history entries`);
      } catch (err: any) {
        logger.error(`Failed to load workspace history: ${err.message}`);
        this.entries = [];
      }
    }
    this.loaded = true;

    // Watch for external file changes (other instances, manual edits)
    if (!this.configWatcher) {
      this.configWatcher = watchConfigFile(HISTORY_FILE, () => this.reload(), 'workspace-history');
    }
  }

  /** Reload history from disk when the file changes externally */
  private reload(): void {
    if (!existsSync(HISTORY_FILE)) return;
    try {
      const raw = readFileSync(HISTORY_FILE, 'utf-8');
      this.entries = JSON.parse(raw);
      logger.info(`Reloaded ${this.entries.length} workspace history entries (external change)`);
    } catch (err: any) {
      logger.error(`Failed to reload workspace history: ${err.message}`);
    }
  }

  /** Persist history to disk */
  private persist(): void {
    try {
      if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
      }
      this.configWatcher?.markSelfWrite();
      writeFileSync(HISTORY_FILE, JSON.stringify(this.entries, null, 2), 'utf-8');
    } catch (err: any) {
      logger.error(`Failed to persist workspace history: ${err.message}`);
    }
  }

  /** Stop watching config file */
  close(): void {
    this.configWatcher?.close();
    this.configWatcher = null;
  }

  /** Record a history entry from a monitored workspace being stopped */
  addEntry(ws: MonitoredWorkspace, reason: 'manual' | 'shutdown' | 'error'): WorkspaceHistoryEntry {
    this.load();
    const now = new Date();
    const entry: WorkspaceHistoryEntry = {
      path: ws.path,
      startedAt: ws.startedAt.toISOString(),
      stoppedAt: now.toISOString(),
      durationMs: now.getTime() - ws.startedAt.getTime(),
      sessionCount: ws.knownSessions.length,
      gitEvents: ws.gitEvents.length,
      fileChanges: ws.recentChanges.length,
      lastGitEvent: ws.gitEvents.length > 0
        ? ws.gitEvents[ws.gitEvents.length - 1].detail
        : undefined,
      sessionsDiscovered: [...ws.knownSessions],
      reason,
    };

    this.entries.unshift(entry);
    this.persist();
    logger.info(`Recorded workspace history: ${ws.path} (${reason}, ${entry.durationMs}ms)`);
    return entry;
  }

  /** Get history entries, optionally filtered by path */
  getHistory(opts?: {
    path?: string;
    limit?: number;
    offset?: number;
  }): WorkspaceHistoryEntry[] {
    this.load();
    let result = [...this.entries];

    // Sort by stoppedAt descending (most recent first)
    result.sort((a, b) => new Date(b.stoppedAt).getTime() - new Date(a.stoppedAt).getTime());

    if (opts?.path) {
      result = result.filter(e => e.path === opts.path);
    }

    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? result.length;
    return result.slice(offset, offset + limit);
  }

  /** Get total count, optionally filtered by path */
  getCount(path?: string): number {
    this.load();
    if (path) {
      return this.entries.filter(e => e.path === path).length;
    }
    return this.entries.length;
  }

  /** Clear history entries for a specific path, or all */
  clearHistory(path?: string): number {
    this.load();
    const before = this.entries.length;
    if (path) {
      this.entries = this.entries.filter(e => e.path !== path);
    } else {
      this.entries = [];
    }
    const removed = before - this.entries.length;
    if (removed > 0) {
      this.persist();
      logger.info(`Cleared ${removed} workspace history entries${path ? ` for ${path}` : ''}`);
    }
    return removed;
  }
}

/** Singleton workspace history */
export const workspaceHistory = new WorkspaceHistory();
