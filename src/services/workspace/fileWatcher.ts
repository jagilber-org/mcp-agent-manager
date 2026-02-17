// mcp-agent-manager/src/services/workspace/fileWatcher.ts
// Generic directory watcher for workspace monitoring

import { watch } from 'node:fs';
import { join } from 'node:path';
import { statSync } from 'node:fs';
import { logger } from '../logger.js';
import { eventBus } from '../events.js';
import type { MonitoredWorkspace } from './types.js';
import { MAX_RECENT } from './types.js';
import { mineSessions } from './sessionMiner.js';

/**
 * Watch a directory for file changes and emit events.
 * Handles special cases for chat-session and chat-jsonl kinds.
 */
export function watchDir(ws: MonitoredWorkspace, dirPath: string, kind: string): void {
  try {
    const watcher = watch(dirPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const now = new Date().toISOString();
      const filePath = join(dirPath, filename);

      // Track change
      const change = { ts: now, file: filename, kind, detail: eventType };
      ws.recentChanges.unshift(change);
      if (ws.recentChanges.length > MAX_RECENT) ws.recentChanges.pop();

      // Emit event
      eventBus.emitEvent('workspace:file-changed', {
        path: ws.path,
        file: filename,
        kind,
        detail: eventType,
      });

      // Special handling for chat session state.json updates
      if (kind === 'chat-session' && filename.endsWith('state.json')) {
        const sessionId = filename.split(/[\\/]/)[0];
        if (!ws.knownSessions.includes(sessionId)) {
          ws.knownSessions.push(sessionId);
        }

        let sizeBytes = 0;
        try { sizeBytes = statSync(filePath).size; } catch { /* ignore */ }

        eventBus.emitEvent('workspace:session-updated', {
          path: ws.path,
          sessionId,
          file: filename,
          sizeBytes,
        });

        // Debounced re-mine
        if (ws.mineDebounce) clearTimeout(ws.mineDebounce);
        ws.mineDebounce = setTimeout(() => mineSessions(ws), 5_000);
      }

      // JSONL file changes also trigger re-mine
      if (kind === 'chat-jsonl' && filename.endsWith('.jsonl')) {
        if (ws.mineDebounce) clearTimeout(ws.mineDebounce);
        ws.mineDebounce = setTimeout(() => mineSessions(ws), 5_000);
      }
    });

    ws.watchers.push(watcher);
    logger.debug(`Watching ${kind}: ${dirPath}`);
  } catch (err) {
    logger.warn(`Failed to watch ${dirPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
