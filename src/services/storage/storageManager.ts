// mcp-agent-manager/src/services/storage/storageManager.ts
// Orchestrates dual-backend storage - disk and/or mcp-index-server.
//
// Backend modes:
//   "disk"      - disk only (original behavior)
//   "mcp-index" - mcp-index-server primary, disk fallback for reads
//   "both"      - write to both, read from disk (primary), mcp-index as backup
//
// Default: "both" (set via MCP_STORAGE_BACKEND env var)

import { logger } from '../logger.js';
import type { AgentMessage } from '../mailboxTypes.js';
import type { AutomationRule } from '../../types/automation.js';
import type { StorageProvider, StorageBackend } from './storageTypes.js';

export interface StorageStatus {
  backend: StorageBackend;
  disk: { available: boolean };
  mcpIndex: { available: boolean };
}

/**
 * StorageManager - orchestrates read/write across configured storage backends.
 * Writes: sent to active backend(s).
 * Reads: prefer mcp-index when configured, fall back to disk.
 */
export class StorageManager {
  private _backend: StorageBackend;
  private _disk: StorageProvider;
  private _index: StorageProvider;

  constructor(backend: StorageBackend, disk: StorageProvider, index: StorageProvider) {
    this._backend = backend;
    this._disk = disk;
    this._index = index;
    logger.info(`[StorageManager] Initialized with backend="${backend}"`);
  }

  getBackend(): StorageBackend {
    return this._backend;
  }

  setBackend(backend: StorageBackend): void {
    this._backend = backend;
    logger.info(`[StorageManager] Backend switched to "${backend}"`);
  }

  // ---- Messages ----

  async appendMessage(message: AgentMessage): Promise<void> {
    if (this._backend === 'disk') {
      await this._disk.appendMessage(message);
    } else if (this._backend === 'mcp-index') {
      await this._safeCall(() => this._index.appendMessage(message), 'mcp-index.appendMessage');
    } else {
      // both - write to both, don't let one failure block the other
      await Promise.allSettled([
        this._safeCall(() => this._disk.appendMessage(message), 'disk.appendMessage'),
        this._safeCall(() => this._index.appendMessage(message), 'mcp-index.appendMessage'),
      ]);
    }
  }

  async loadMessages(): Promise<AgentMessage[]> {
    if (this._backend === 'disk') {
      return this._disk.loadMessages();
    }

    if (this._backend === 'both') {
      // Disk is primary, mcp-index is backup
      try {
        const msgs = await this._disk.loadMessages();
        if (msgs.length > 0) return msgs;
      } catch (err: any) {
        logger.warn(`[StorageManager] disk loadMessages failed, trying mcp-index: ${err.message}`);
      }
      // Fall back to mcp-index
      try {
        const indexAvail = await this._index.isAvailable();
        if (indexAvail) return await this._index.loadMessages();
      } catch (err: any) {
        logger.warn(`[StorageManager] mcp-index loadMessages also failed: ${err.message}`);
      }
      return [];
    }

    // mcp-index only: try index first, fall back to disk
    try {
      const indexAvail = await this._index.isAvailable();
      if (indexAvail) {
        const msgs = await this._index.loadMessages();
        if (msgs.length > 0) return msgs;
      }
    } catch (err: any) {
      logger.warn(`[StorageManager] mcp-index loadMessages failed, falling back to disk: ${err.message}`);
    }

    logger.debug('[StorageManager] Falling back to disk for loadMessages');
    return this._disk.loadMessages();
  }

  async rewriteMessages(messages: AgentMessage[]): Promise<void> {
    if (this._backend === 'disk') {
      await this._disk.rewriteMessages(messages);
    } else if (this._backend === 'mcp-index') {
      await this._safeCall(() => this._index.rewriteMessages(messages), 'mcp-index.rewriteMessages');
    } else {
      await Promise.allSettled([
        this._safeCall(() => this._disk.rewriteMessages(messages), 'disk.rewriteMessages'),
        this._safeCall(() => this._index.rewriteMessages(messages), 'mcp-index.rewriteMessages'),
      ]);
    }
  }

  // ---- Rules ----

  async loadRules(): Promise<AutomationRule[]> {
    if (this._backend === 'disk') {
      return this._disk.loadRules();
    }

    if (this._backend === 'both') {
      // Disk is primary, mcp-index is backup
      try {
        const rules = await this._disk.loadRules();
        if (rules.length > 0) return rules;
      } catch (err: any) {
        logger.warn(`[StorageManager] disk loadRules failed, trying mcp-index: ${err.message}`);
      }
      try {
        const indexAvail = await this._index.isAvailable();
        if (indexAvail) return await this._index.loadRules();
      } catch (err: any) {
        logger.warn(`[StorageManager] mcp-index loadRules also failed: ${err.message}`);
      }
      return [];
    }

    // mcp-index only: try index first, fall back to disk
    try {
      const indexAvail = await this._index.isAvailable();
      if (indexAvail) {
        const rules = await this._index.loadRules();
        if (rules.length > 0) return rules;
      }
    } catch (err: any) {
      logger.warn(`[StorageManager] mcp-index loadRules failed, falling back to disk: ${err.message}`);
    }

    logger.debug('[StorageManager] Falling back to disk for loadRules');
    return this._disk.loadRules();
  }

  async saveRules(rules: AutomationRule[]): Promise<void> {
    if (this._backend === 'disk') {
      await this._disk.saveRules(rules);
    } else if (this._backend === 'mcp-index') {
      await this._safeCall(() => this._index.saveRules(rules), 'mcp-index.saveRules');
    } else {
      await Promise.allSettled([
        this._safeCall(() => this._disk.saveRules(rules), 'disk.saveRules'),
        this._safeCall(() => this._index.saveRules(rules), 'mcp-index.saveRules'),
      ]);
    }
  }

  // ---- Status ----

  async getStatus(): Promise<StorageStatus> {
    const [diskAvail, indexAvail] = await Promise.allSettled([
      this._disk.isAvailable(),
      this._index.isAvailable(),
    ]);

    return {
      backend: this._backend,
      disk: { available: diskAvail.status === 'fulfilled' ? diskAvail.value : false },
      mcpIndex: { available: indexAvail.status === 'fulfilled' ? indexAvail.value : false },
    };
  }

  // ---- Internal ----

  private async _safeCall(fn: () => Promise<void>, label: string): Promise<void> {
    try {
      await fn();
    } catch (err: any) {
      logger.warn(`[StorageManager] ${label} failed: ${err.message}`);
    }
  }
}
