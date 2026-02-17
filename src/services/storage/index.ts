// mcp-agent-manager/src/services/storage/index.ts
// Barrel export + singleton factory for the storage subsystem.

import { logger } from '../logger.js';
import { indexClient } from '../indexClient.js';
import { DiskStorageProvider } from './diskStorageProvider.js';
import { McpIndexStorageProvider } from './mcpIndexStorageProvider.js';
import { StorageManager } from './storageManager.js';
import { resolveStorageBackend } from './storageTypes.js';

export { DiskStorageProvider } from './diskStorageProvider.js';
export { McpIndexStorageProvider } from './mcpIndexStorageProvider.js';
export { StorageManager } from './storageManager.js';
export type { StorageProvider, StorageBackend } from './storageTypes.js';
export type { StorageStatus } from './storageManager.js';
export { resolveStorageBackend } from './storageTypes.js';

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

let _instance: StorageManager | null = null;

/** Get (or create) the singleton StorageManager. */
export function getStorageManager(): StorageManager {
  if (!_instance) {
    const backend = resolveStorageBackend();
    const disk = new DiskStorageProvider();
    const index = new McpIndexStorageProvider(indexClient);
    _instance = new StorageManager(backend, disk, index);
    logger.info(`[Storage] StorageManager created: backend="${backend}"`);
  }
  return _instance;
}

/** Reset the singleton (for testing). */
export function _resetStorageManagerForTest(): void {
  _instance = null;
}
