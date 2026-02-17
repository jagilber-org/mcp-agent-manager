// mcp-agent-manager/src/services/feedbackStore.ts
// Local in-memory feedback store with JSONL persistence.

import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { FeedbackType } from '../types/index.js';
import { logger } from './logger.js';
import { eventBus } from './events.js';
import { getLogsDir } from './dataDir.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeedbackEntry {
  id: string;
  type: FeedbackType;
  title: string;
  body: string;
  status: 'new' | 'acknowledged' | 'resolved' | 'rejected';
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const entries: Map<string, FeedbackEntry> = new Map();
let persistPath: string | null = null;
let lastDiskLoadMs = 0;
const DISK_RELOAD_INTERVAL_MS = 2000; // re-read disk at most every 2 s

/** (Re-)initialize the store, optionally loading entries from a JSONL file. */
export function initFeedbackStore(logDir?: string): void {
  entries.clear();
  const dir = logDir || getLogsDir();
  persistPath = join(dir, 'feedback.jsonl');
  loadFromDisk();
}

function loadFromDisk(): void {
  if (!persistPath || !existsSync(persistPath)) return;
  try {
    const lines = readFileSync(persistPath, 'utf-8').split('\n').filter(Boolean);
    entries.clear();
    for (const line of lines) {
      try {
        const entry: FeedbackEntry = JSON.parse(line);
        entries.set(entry.id, entry);
      } catch {
        // skip malformed lines (MI-4: tolerant JSONL parsing)
      }
    }
    lastDiskLoadMs = Date.now();
    logger.info(`Loaded ${entries.size} feedback entries from disk`);
  } catch (err: any) {
    logger.warn(`Failed to load feedback store: ${err.message}`);
  }
}

/** Reload from disk if enough time has passed (picks up cross-instance writes). */
function ensureFresh(): void {
  if (Date.now() - lastDiskLoadMs >= DISK_RELOAD_INTERVAL_MS) {
    loadFromDisk();
  }
}

function appendToDisk(entry: FeedbackEntry): void {
  if (!persistPath) return;
  try {
    mkdirSync(dirname(persistPath), { recursive: true });
    appendFileSync(persistPath, JSON.stringify(entry) + '\n');
  } catch (err: any) {
    logger.warn(`Failed to persist feedback entry: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let nextId = 1;

function generateId(): string {
  return `fb-${Date.now()}-${nextId++}`;
}

/** Submit a new feedback entry. Persists locally. */
export async function addFeedback(
  type: FeedbackType,
  title: string,
  body: string,
  metadata?: Record<string, unknown>,
): Promise<FeedbackEntry> {
  const now = new Date().toISOString();
  const entry: FeedbackEntry = {
    id: generateId(),
    type,
    title,
    body,
    status: 'new',
    metadata,
    createdAt: now,
    updatedAt: now,
  };

  entries.set(entry.id, entry);
  appendToDisk(entry);
  eventBus.emit('agent:message', {
    agentId: 'feedback-store',
    message: `New ${type} feedback: ${title}`,
  });

  logger.info(`Feedback submitted: [${type}] ${title} (${entry.id})`);
  return entry;
}

/** List feedback entries, optionally filtered by type and/or status. */
export function listFeedback(filters?: {
  type?: FeedbackType;
  status?: FeedbackEntry['status'];
}): FeedbackEntry[] {
  ensureFresh();
  let result = Array.from(entries.values());
  if (filters?.type) {
    result = result.filter((e) => e.type === filters.type);
  }
  if (filters?.status) {
    result = result.filter((e) => e.status === filters.status);
  }
  return result.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/** Get a single feedback entry by ID. */
export function getFeedback(id: string): FeedbackEntry | undefined {
  ensureFresh();
  return entries.get(id);
}

/** Update feedback status. */
export function updateFeedbackStatus(
  id: string,
  status: FeedbackEntry['status'],
): FeedbackEntry | undefined {
  ensureFresh();
  const entry = entries.get(id);
  if (!entry) return undefined;
  entry.status = status;
  entry.updatedAt = new Date().toISOString();
  appendToDisk(entry); // append-only log; latest wins on reload
  return entry;
}

/** Total counts by status. */
export function feedbackStats(): Record<string, number> {
  ensureFresh();
  const stats: Record<string, number> = { total: entries.size };
  for (const entry of entries.values()) {
    stats[entry.status] = (stats[entry.status] ?? 0) + 1;
  }
  return stats;
}
