// mcp-agent-manager/src/services/configWatcher.ts
// Watches JSON config files for external changes and triggers reload callbacks.
// Uses directory-level watching so atomic saves (write-temp → rename) are caught.

import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger.js';

export interface ConfigWatcher {
  /** Call before a self-initiated write so the watcher skips the resulting FS event */
  markSelfWrite(): void;
  /** Stop watching */
  close(): void;
}

/**
 * Watch a config file for external changes.
 * Debounces rapid FS events and ignores writes made by this process within 1 s.
 */
export function watchConfigFile(
  filePath: string,
  onReload: () => void,
  label: string,
): ConfigWatcher {
  let lastSelfWriteMs = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const dir = path.dirname(filePath);
  const basename = path.basename(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const watcher = fs.watch(dir, (eventType, filename) => {
    if (filename !== basename) return;
    // Skip self-writes (within 1 s window)
    if (Date.now() - lastSelfWriteMs < 1000) return;
    // Debounce - FS can fire multiple events for a single save
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!fs.existsSync(filePath)) return;
      logger.info(`[ConfigWatcher] ${label} changed externally, reloading`);
      try {
        onReload();
      } catch (err) {
        logger.error(`[ConfigWatcher] reload failed for ${label}`, { error: String(err) });
      }
    }, 300);
  });

  logger.debug(`[ConfigWatcher] watching ${label} → ${filePath}`);

  return {
    markSelfWrite() {
      lastSelfWriteMs = Date.now();
    },
    close() {
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher.close();
    },
  };
}
