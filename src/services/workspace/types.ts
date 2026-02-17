// mcp-agent-manager/src/services/workspace/types.ts
// Types and constants for the workspace monitoring subsystem

import type { FSWatcher } from 'node:fs';

/** Metadata extracted from a VS Code Copilot chat session JSONL */
export interface SessionMeta {
  sessionId: string;
  title: string;
  models: string[];
  requestCount: number;
  promptTokens: number;
  outputTokens: number;
  errorCount: number;
  firstRequestTs?: number;
  lastRequestTs?: number;
  /** File count from chatEditingSessions state.json */
  filesModified: number;
  /** Edit operation count from state.json */
  editOperations: number;
  /** state.json epoch count */
  epochs: number;
  /** JSONL file size in bytes */
  sizeBytes: number;
  /** Timestamp of last metadata scan */
  scannedAt: string;
}

/** Copilot memory entry from memory-tool */
export interface MemoryEntry {
  subject: string;
  fact: string;
  citations: string[];
  reason: string;
  category: string;
}

export interface MonitoredWorkspace {
  /** Absolute path to the workspace/repo root */
  path: string;
  /** VS Code workspace storage ID (32-char hex) if discovered */
  workspaceId?: string;
  /** Path to chatEditingSessions dir if found */
  chatSessionsPath?: string;
  /** Active fs watchers */
  watchers: FSWatcher[];
  /** Timestamp monitoring started */
  startedAt: Date;
  /** Recent file change events */
  recentChanges: Array<{ ts: string; file: string; kind: string; detail?: string }>;
  /** Known chat session IDs */
  knownSessions: string[];
  /** Recent git events */
  gitEvents: Array<{ ts: string; event: string; detail: string }>;
  /** Remote fetch timer */
  fetchTimer?: ReturnType<typeof setInterval>;
  /** Known remote refs (remote/branch → sha) */
  remoteRefs: Map<string, string>;
  /** Path to chatSessions JSONL directory (separate from chatEditingSessions) */
  chatSessionsJsonlPath?: string;
  /** Mined session metadata */
  sessionMetas: Map<string, SessionMeta>;
  /** Session mining timer */
  mineTimer?: ReturnType<typeof setInterval>;
  /** Debounced re-mine timer */
  mineDebounce?: ReturnType<typeof setTimeout>;
  /** Copilot memories from memory-tool */
  memories: MemoryEntry[];
}

export const MAX_RECENT = 50;
const DEFAULT_FETCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
export const FETCH_INTERVAL_MS =
  parseInt(process.env.GIT_FETCH_INTERVAL_MS || '', 10) || DEFAULT_FETCH_INTERVAL_MS;
export const MINE_INTERVAL_MS = 60_000; // Re-scan every 60s
export const MAX_JSONL_LINES = 5_000; // Read up to N lines per session
