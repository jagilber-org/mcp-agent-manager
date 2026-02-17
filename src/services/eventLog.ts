// mcp-agent-manager/src/services/eventLog.ts
// Structured JSONL event log - appends every event to a machine-parseable file.
// Each line is a self-contained JSON object with timestamp, event name, and data.

import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_EVENT_NAMES, eventBus } from './events.js';
import { logger } from './logger.js';
import { getLogsDir } from './dataDir.js';

const LOG_DIR = getLogsDir();
const LOG_FILE = join(LOG_DIR, 'events.jsonl');

/** Max events kept in-memory ring buffer for snapshot API */
const RECENT_EVENT_LIMIT = 200;

let initialized = false;

/** In-memory ring buffer of recent events for the snapshot API */
const recentEvents: EventLogEntry[] = [];

export interface EventLogEntry {
  ts: string;
  event: string;
  [key: string]: unknown;
}

/** Ensure log directory exists */
function ensureLogDir(): void {
  if (initialized) return;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    initialized = true;
  } catch (err: any) {
    logger.warn(`Failed to create event log directory: ${err.message}`);
  }
}

/** Append a single event line to the JSONL log */
function writeEvent(event: string, data: Record<string, unknown>): void {
  ensureLogDir();
  if (!initialized) return;

  const entry: EventLogEntry = {
    ts: new Date().toISOString(),
    event,
    ...data,
  };

  // Push to in-memory ring buffer
  recentEvents.push(entry);
  if (recentEvents.length > RECENT_EVENT_LIMIT) {
    recentEvents.splice(0, recentEvents.length - RECENT_EVENT_LIMIT);
  }

  try {
    appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (err: any) {
    logger.warn(`Failed to write event log: ${err.message}`);
  }
}

/**
 * Get recent events from the in-memory ring buffer.
 * On first call, seeds the buffer from the tail of the JSONL file.
 */
export function getRecentEvents(limit: number = 100): EventLogEntry[] {
  if (recentEvents.length === 0) {
    seedRecentEvents();
  }
  return recentEvents.slice(-limit);
}

/** Clear the event log on disk and in memory */
export function clearEventLog(): void {
  recentEvents.length = 0;
  try {
    const tmpFile = LOG_FILE + '.tmp';
    writeFileSync(tmpFile, '', 'utf-8');
    renameSync(tmpFile, LOG_FILE);
    logger.info('[EventLog] Cleared event log');
  } catch (err: any) {
    logger.warn(`[EventLog] Failed to clear: ${err.message}`);
  }
}

/** Seed the in-memory ring buffer from the tail of the JSONL file */
function seedRecentEvents(): void {
  try {
    if (!existsSync(LOG_FILE)) return;
    const raw = readFileSync(LOG_FILE, 'utf-8');
    const lines = raw.trim().split('\n').filter(l => l.trim());
    // Take last RECENT_EVENT_LIMIT lines
    const tail = lines.slice(-RECENT_EVENT_LIMIT);
    for (const line of tail) {
      try {
        recentEvents.push(JSON.parse(line));
      } catch { /* skip corrupt lines */ }
    }
  } catch { /* best-effort */ }
}

/** Subscribe to all event bus events and log them to the JSONL file */
export function initializeEventLog(): void {
  for (const eventName of ALL_EVENT_NAMES) {
    eventBus.onEvent(eventName, (data) => {
      writeEvent(eventName, data as Record<string, unknown>);
    });
  }

  // Write startup marker
  writeEvent('server:started', {
    pid: process.pid,
    nodeVersion: process.version,
  });

  logger.info(`Event log initialized: ${LOG_FILE}`);
}
