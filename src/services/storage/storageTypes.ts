// mcp-agent-manager/src/services/storage/storageTypes.ts
// Storage provider interface and configuration types for dual-backend persistence.

import type { AgentMessage } from '../mailboxTypes.js';
import type { AutomationRule } from '../../types/automation.js';

// ---------------------------------------------------------------------------
// Storage backend configuration
// ---------------------------------------------------------------------------

/** Which storage backend(s) to use for persistence */
export type StorageBackend = 'disk' | 'mcp-index' | 'both';

/** Resolve the storage backend from environment */
export function resolveStorageBackend(): StorageBackend {
  const raw = (process.env.MCP_STORAGE_BACKEND || 'both').toLowerCase().trim();
  if (raw === 'disk' || raw === 'mcp-index' || raw === 'both') return raw;
  return 'both';
}

// ---------------------------------------------------------------------------
// Storage provider interface
// ---------------------------------------------------------------------------

/**
 * Abstract storage provider for persisting messages and automation rules.
 * Implementations: DiskStorageProvider, McpIndexStorageProvider.
 */
export interface StorageProvider {
  /** Human-readable name for logging */
  readonly name: string;

  // ---- Messages ----

  /** Append a single message to storage */
  appendMessage(message: AgentMessage): Promise<void>;

  /** Load all persisted messages */
  loadMessages(): Promise<AgentMessage[]>;

  /** Rewrite all messages (atomic replace) */
  rewriteMessages(messages: AgentMessage[]): Promise<void>;

  // ---- Automation Rules ----

  /** Load all persisted automation rules */
  loadRules(): Promise<AutomationRule[]>;

  /** Save all automation rules (atomic replace) */
  saveRules(rules: AutomationRule[]): Promise<void>;

  // ---- Health ----

  /** Check whether this storage provider is operational */
  isAvailable(): Promise<boolean>;
}
