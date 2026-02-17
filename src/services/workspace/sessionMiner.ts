// mcp-agent-manager/src/services/workspace/sessionMiner.ts
// Chat session JSONL metadata mining and Copilot memory loading

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, basename } from 'node:path';
import { logger } from '../logger.js';
import type { MonitoredWorkspace, SessionMeta, MemoryEntry } from './types.js';
import { MINE_INTERVAL_MS, MAX_JSONL_LINES } from './types.js';

// Security constants for state.json processing
const MAX_STATE_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit
const SESSION_ID_REGEX = /^[a-f0-9-]{36}$/; // Valid UUID format

// ── Session mining lifecycle ───────────────────────────────────────────

/** Start periodic session metadata mining */
export function startSessionMining(ws: MonitoredWorkspace): void {
  setTimeout(() => mineSessions(ws), 3_000);

  ws.mineTimer = setInterval(() => {
    mineSessions(ws);
  }, MINE_INTERVAL_MS);

  if (ws.mineTimer && typeof ws.mineTimer === 'object' && 'unref' in ws.mineTimer) {
    ws.mineTimer.unref();
  }
}

/** Scan all chat session JSONL files and extract metadata */
export async function mineSessions(ws: MonitoredWorkspace): Promise<void> {
  if (!ws.chatSessionsJsonlPath || !existsSync(ws.chatSessionsJsonlPath)) return;

  try {
    const files = readdirSync(ws.chatSessionsJsonlPath)
      .filter(f => f.endsWith('.jsonl'));

    for (const file of files) {
      const sessionId = file.replace('.jsonl', '');
      const filePath = join(ws.chatSessionsJsonlPath, file);

      try {
        const stat = statSync(filePath);
        const existing = ws.sessionMetas.get(sessionId);

        // Skip if already scanned and file hasn't changed
        if (existing && existing.sizeBytes === stat.size) continue;

        const meta = await mineSessionJsonl(sessionId, filePath, stat.size);

        // Enrich with chatEditingSessions state.json data
        if (ws.chatSessionsPath) {
          enrichFromEditingSession(meta, ws.chatSessionsPath);
        }

        ws.sessionMetas.set(sessionId, meta);
      } catch (err) {
        logger.debug(`Failed to mine session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    logger.debug(`Mined ${ws.sessionMetas.size} session(s) for ${ws.path}`);
  } catch (err) {
    logger.debug(`Session mining failed for ${ws.path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── JSONL parsing ──────────────────────────────────────────────────────

/** Stream-read a chat session JSONL and extract metadata */
function mineSessionJsonl(sessionId: string, filePath: string, sizeBytes: number): Promise<SessionMeta> {
  return new Promise((resolve, reject) => {
    const meta: SessionMeta = {
      sessionId,
      title: '',
      models: [],
      requestCount: 0,
      promptTokens: 0,
      outputTokens: 0,
      errorCount: 0,
      filesModified: 0,
      editOperations: 0,
      epochs: 0,
      sizeBytes,
      scannedAt: new Date().toISOString(),
    };

    const modelSet = new Set<string>();
    let lineCount = 0;

    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      lineCount++;
      if (lineCount > MAX_JSONL_LINES) {
        rl.close();
        return;
      }

      try {
        const obj = JSON.parse(line) as { kind: number; k?: string | (string | number)[]; v?: any };
        const k = Array.isArray(obj.k) ? obj.k.join(' ') : (obj.k || '');

        // Header (kind=0): extract model and initial request count
        if (obj.kind === 0 && obj.v) {
          const model = obj.v.inputState?.selectedModel?.identifier;
          if (model && !modelSet.has(model)) {
            modelSet.add(model);
            meta.models.push(model);
          }
          if (Array.isArray(obj.v.requests)) {
            for (const req of obj.v.requests) {
              if (req.requestId) {
                meta.requestCount++;
                if (typeof req.timestamp === 'number') {
                  if (!meta.firstRequestTs || req.timestamp < meta.firstRequestTs) meta.firstRequestTs = req.timestamp;
                  if (!meta.lastRequestTs || req.timestamp > meta.lastRequestTs) meta.lastRequestTs = req.timestamp;
                }
              }
            }
          }
        }

        // Session title
        if (k === 'customTitle' && obj.v) {
          meta.title = String(obj.v);
        }

        // Model used (incremental update)
        if (k === 'inputState selectedModel' && obj.v?.identifier) {
          const model = String(obj.v.identifier);
          if (!modelSet.has(model)) {
            modelSet.add(model);
            meta.models.push(model);
          }
        }

        // New request (kind=2, k=requests)
        if (obj.kind === 2 && k === 'requests' && obj.v) {
          const entries = obj.v.requestId ? [obj.v] : Object.values(obj.v);
          for (const req of entries) {
            if (req && typeof req === 'object' && (req as any).requestId) {
              meta.requestCount++;
              const ts = (req as any).timestamp;
              if (typeof ts === 'number') {
                if (!meta.firstRequestTs || ts < meta.firstRequestTs) meta.firstRequestTs = ts;
                if (!meta.lastRequestTs || ts > meta.lastRequestTs) meta.lastRequestTs = ts;
              }
            }
          }
        }

        // Request result (kind=1, k=requests N result)
        if (obj.kind === 1 && /^requests \d+ result$/.test(k)) {
          const md = obj.v?.metadata || {};
          if (md.promptTokens) {
            meta.promptTokens += parseInt(md.promptTokens, 10) || 0;
          }
          if (md.outputTokens) {
            meta.outputTokens += parseInt(md.outputTokens, 10) || 0;
          }
          if (obj.v?.errorDetails) {
            meta.errorCount++;
          }
          if (obj.v?.timings?.totalElapsed) {
            if (obj.v.details && typeof obj.v.details === 'string') {
              const detailModel = obj.v.details.split('•')[0]?.trim();
              if (detailModel && !modelSet.has(detailModel)) {
                modelSet.add(detailModel);
                meta.models.push(detailModel);
              }
            }
          }
        }
      } catch { /* skip malformed lines */ }
    });

    rl.on('close', () => resolve(meta));
    rl.on('error', reject);
  });
}

// ── Enrichment ─────────────────────────────────────────────────────────

/** Enrich session meta with data from chatEditingSessions state.json */
function enrichFromEditingSession(meta: SessionMeta, chatEditingDir: string): void {
  // Sanitize session ID to prevent path traversal
  const sanitizedSessionId = basename(meta.sessionId).replace(/[^a-zA-Z0-9-]/g, '');
  if (!SESSION_ID_REGEX.test(sanitizedSessionId) || sanitizedSessionId !== meta.sessionId) {
    logger.warn(`Invalid session ID format: ${meta.sessionId}`);
    return;
  }

  const stateFile = join(chatEditingDir, sanitizedSessionId, 'state.json');
  if (!existsSync(stateFile)) return;

  try {
    // Check file size before reading
    const stats = statSync(stateFile);
    if (stats.size > MAX_STATE_FILE_SIZE) {
      logger.warn(`State file too large (${stats.size} bytes): ${stateFile}`);
      return;
    }

    const raw = readFileSync(stateFile, 'utf-8');

    // Safe JSON parsing with prototype pollution protection
    const state = JSON.parse(raw, (key, value) => {
      // Block prototype pollution
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return undefined;
      }
      return value;
    });

    // Validate expected structure and safely extract values
    if (typeof state !== 'object' || state === null) {
      logger.warn(`Invalid state file format: ${stateFile}`);
      return;
    }

    meta.filesModified = Array.isArray(state.initialFileContents) ? state.initialFileContents.length : 0;
    meta.editOperations = Array.isArray(state.timeline?.operations) ? state.timeline.operations.length : 0;
    meta.epochs = typeof state.timeline?.epochCounter === 'number' ? state.timeline.epochCounter : 0;
  } catch (err) {
    logger.debug(`Failed to parse state file ${stateFile}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    // Continue processing other files
  }
}

// ── Copilot memories ───────────────────────────────────────────────────

/** Load Copilot memory entries from memory-tool directory */
export function loadMemories(ws: MonitoredWorkspace, memoryDir: string): void {
  try {
    const files = readdirSync(memoryDir).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      try {
        const content = readFileSync(join(memoryDir, file), 'utf-8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line) as MemoryEntry;
            ws.memories.push(entry);
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
    logger.info(`Loaded ${ws.memories.length} Copilot memories for ${ws.path}`);
  } catch (err) {
    logger.debug(`Failed to load memories: ${err instanceof Error ? err.message : String(err)}`);
  }
}
