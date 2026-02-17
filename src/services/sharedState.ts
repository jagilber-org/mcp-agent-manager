// mcp-agent-manager/src/services/sharedState.ts
// Cross-process shared state via disk persistence.
//
// Pattern borrowed from mcp-index-server:
//   - JSONL append-only for history (task history, cross-repo history)
//   - Atomic-rename JSON writes for current state (router metrics, agent stats)
//   - Version sentinel file touched on every mutation; readers poll it to
//     know when to re-read (10 s default, configurable via MCP_STATE_POLL_MS)
//
// All state lives under DATA_DIR/state/:
//   task-history.jsonl       - one TaskHistoryEntry per line
//   crossrepo-history.jsonl  - one CrossRepoResult per line
//   router-metrics.json      - { totalTasks, totalTokens, totalCost }
//   agent-stats.json         - aggregated per-agent stats
//   .state-version           - monotonic counter (integer in file), mtime = last mutation

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getStateDir } from './dataDir.js';
import { logger } from './logger.js';
import type { TaskHistoryEntry } from './taskRouter.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const stateDir = getStateDir();

const TASK_HISTORY_FILE = path.join(stateDir, 'task-history.jsonl');
const CROSSREPO_HISTORY_FILE = path.join(stateDir, 'crossrepo-history.jsonl');
const ROUTER_METRICS_FILE = path.join(stateDir, 'router-metrics.json');
const AGENT_STATS_FILE = path.join(stateDir, 'agent-stats.json');
const VERSION_SENTINEL = path.join(stateDir, '.state-version');

// ---------------------------------------------------------------------------
// Version sentinel - monotonic counter bumped on every mutation
// ---------------------------------------------------------------------------

let currentVersion = 0;

function bumpVersion(): void {
  currentVersion++;
  try {
    ensureDir(stateDir);
    fs.writeFileSync(VERSION_SENTINEL, String(currentVersion), 'utf-8');
  } catch (err: any) {
    logger.warn(`[SharedState] Failed to bump version sentinel: ${err.message}`);
  }
}

/** Read the on-disk version (for cross-process invalidation checks) */
export function readDiskVersion(): number {
  try {
    if (!fs.existsSync(VERSION_SENTINEL)) return 0;
    const raw = fs.readFileSync(VERSION_SENTINEL, 'utf-8').trim();
    return parseInt(raw, 10) || 0;
  } catch {
    return 0;
  }
}

/** Return current in-memory version */
export function getVersion(): number {
  return currentVersion;
}

// ---------------------------------------------------------------------------
// JSONL helpers - append-only, one JSON object per line
// ---------------------------------------------------------------------------

function appendJsonl(filePath: string, entry: unknown): void {
  try {
    ensureDir(path.dirname(filePath));
    const line = JSON.stringify(entry) + os.EOL;
    fs.appendFileSync(filePath, line, 'utf-8');
  } catch (err: any) {
    logger.warn(`[SharedState] JSONL append failed (${filePath}): ${err.message}`);
  }
}

function readJsonlTail<T>(filePath: string, limit: number): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.trim().split('\n').filter(l => l.trim());
    const tail = lines.slice(-limit);
    const results: T[] = [];
    for (const line of tail) {
      try {
        results.push(JSON.parse(line) as T);
      } catch {
        // skip malformed lines
      }
    }
    return results;
  } catch (err: any) {
    logger.warn(`[SharedState] JSONL read failed (${filePath}): ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Atomic JSON write - temp file → rename
// ---------------------------------------------------------------------------

function atomicWriteJson(filePath: string, data: unknown): void {
  try {
    ensureDir(path.dirname(filePath));
    const tmp = filePath + `.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    try {
      fs.renameSync(tmp, filePath);
    } catch {
      // EPERM on Windows if target is locked - retry after brief delay
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        fs.renameSync(tmp, filePath);
      } catch (retryErr: any) {
        // Last resort: direct write (non-atomic but functional)
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      }
    }
  } catch (err: any) {
    logger.warn(`[SharedState] Atomic write failed (${filePath}): ${err.message}`);
  }
}

function readJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err: any) {
    logger.warn(`[SharedState] JSON read failed (${filePath}): ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ensure directory exists
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Task History
// ---------------------------------------------------------------------------

/** Append a task history entry to JSONL and bump version */
export function persistTaskHistoryEntry(entry: TaskHistoryEntry): void {
  appendJsonl(TASK_HISTORY_FILE, entry);
  bumpVersion();
}

/** Read recent task history from disk */
export function readTaskHistory(limit = 50): TaskHistoryEntry[] {
  return readJsonlTail<TaskHistoryEntry>(TASK_HISTORY_FILE, limit).reverse();
}

// ---------------------------------------------------------------------------
// Cross-Repo History
// ---------------------------------------------------------------------------

/** Serializable subset of CrossRepoResult for disk persistence */
export interface CrossRepoHistoryEntry {
  dispatchId: string;
  repoPath: string;
  status: string;
  content: string;
  estimatedTokens?: number;
  durationMs: number;
  model?: string;
  error?: string;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  prompt?: string;
  exitCode?: number;
  sessionFile?: string;
}

/** Append a cross-repo result to JSONL and bump version */
export function persistCrossRepoEntry(entry: CrossRepoHistoryEntry): void {
  appendJsonl(CROSSREPO_HISTORY_FILE, entry);
  bumpVersion();
}

/** Read recent cross-repo history from disk */
export function readCrossRepoHistory(limit = 50): CrossRepoHistoryEntry[] {
  return readJsonlTail<CrossRepoHistoryEntry>(CROSSREPO_HISTORY_FILE, limit).reverse();
}

// ---------------------------------------------------------------------------
// Router Metrics
// ---------------------------------------------------------------------------

export interface RouterMetricsSnapshot {
  totalTasks: number;
  totalTokens: number;
  totalCost: number;
  /** Total premium requests consumed (Copilot billing) */
  totalPremiumRequests?: number;
  /** Total tokens from estimated (non-metered) providers */
  totalEstimatedTokens?: number;
  lastUpdated: string;
  pid: number;
}

/** Persist router metrics (full overwrite, atomic rename) */
export function persistRouterMetrics(metrics: { totalTasks: number; totalTokens: number; totalCost: number; totalPremiumRequests?: number; totalEstimatedTokens?: number }): void {
  const snapshot: RouterMetricsSnapshot = {
    ...metrics,
    lastUpdated: new Date().toISOString(),
    pid: process.pid,
  };
  atomicWriteJson(ROUTER_METRICS_FILE, snapshot);
  bumpVersion();
}

/** Read router metrics from disk */
export function readRouterMetrics(): RouterMetricsSnapshot | null {
  return readJson<RouterMetricsSnapshot>(ROUTER_METRICS_FILE);
}

// ---------------------------------------------------------------------------
// Agent Stats (aggregated)
// ---------------------------------------------------------------------------

export interface AgentStatsSnapshot {
  agents: Array<{
    id: string;
    tasksCompleted: number;
    tasksFailed: number;
    totalTokensUsed: number;
    costAccumulated: number;
    state: string;
    activeTasks: number;
    lastActivityAt?: string;
    /** Number of premium requests consumed (Copilot billing) */
    premiumRequests?: number;
    /** Whether token counts are estimated (non-metered provider) */
    tokensEstimated?: boolean;
  }>;
  lastUpdated: string;
  pid: number;
}

/** Persist agent stats (full overwrite, atomic rename) */
export function persistAgentStats(stats: AgentStatsSnapshot): void {
  atomicWriteJson(AGENT_STATS_FILE, stats);
  bumpVersion();
}

/** Read agent stats from disk */
export function readAgentStats(): AgentStatsSnapshot | null {
  return readJson<AgentStatsSnapshot>(AGENT_STATS_FILE);
}

// ---------------------------------------------------------------------------
// Initialization - sync version from disk on startup
// ---------------------------------------------------------------------------

/** Call on startup to sync version counter from disk */
export function initSharedState(): void {
  ensureDir(stateDir);
  currentVersion = readDiskVersion();
  logger.info(`[SharedState] Initialized - version=${currentVersion}, dir=${stateDir}`);
}
