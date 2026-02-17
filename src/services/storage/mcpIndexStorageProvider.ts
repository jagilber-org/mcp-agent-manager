// mcp-agent-manager/src/services/storage/mcpIndexStorageProvider.ts
// MCP Index Server storage provider - persists data via mcp-index-server HTTP API.

import { logger } from '../logger.js';
import type { IndexClient } from '../indexClient.js';
import type { AgentMessage } from '../mailboxTypes.js';
import type { AutomationRule } from '../../types/automation.js';
import type { StorageProvider } from './storageTypes.js';

// Storage keys in the index server
const MESSAGES_KEY = 'agent-manager/messages';
const RULES_KEY = 'agent-manager/rules';

/**
 * MCP Index Server StorageProvider.
 * Stores messages and rules as JSON blobs in the mcp-index-server knowledge store.
 */
export class McpIndexStorageProvider implements StorageProvider {
  readonly name = 'mcp-index';
  private _client: IndexClient;

  constructor(client: IndexClient) {
    this._client = client;
  }

  // ---- Messages ----

  async appendMessage(message: AgentMessage): Promise<void> {
    if (!this._client.isConfigured()) {
      logger.warn('[McpIndexStorage] Cannot append message: index server not configured');
      return;
    }

    try {
      // Load existing messages, append new one, write back
      const existing = await this._loadJson<AgentMessage[]>(MESSAGES_KEY) ?? [];
      existing.push(message);
      const ok = await this._storeJson(MESSAGES_KEY, existing, { type: 'messages', count: existing.length });
      if (!ok) {
        logger.warn(`[McpIndexStorage] Failed to append message ${message.id}`);
      } else {
        logger.debug(`[McpIndexStorage] Appended message ${message.id} (total: ${existing.length})`);
      }
    } catch (err: any) {
      logger.warn(`[McpIndexStorage] appendMessage error: ${err.message}`);
    }
  }

  async loadMessages(): Promise<AgentMessage[]> {
    if (!this._client.isConfigured()) {
      logger.debug('[McpIndexStorage] Cannot load messages: index server not configured');
      return [];
    }

    try {
      const messages = await this._loadJson<AgentMessage[]>(MESSAGES_KEY);
      if (!messages || !Array.isArray(messages)) return [];
      logger.debug(`[McpIndexStorage] Loaded ${messages.length} messages from index`);
      return messages;
    } catch (err: any) {
      logger.warn(`[McpIndexStorage] loadMessages error: ${err.message}`);
      return [];
    }
  }

  async rewriteMessages(messages: AgentMessage[]): Promise<void> {
    if (!this._client.isConfigured()) {
      logger.warn('[McpIndexStorage] Cannot rewrite messages: index server not configured');
      return;
    }

    try {
      const ok = await this._storeJson(MESSAGES_KEY, messages, { type: 'messages', count: messages.length });
      if (!ok) {
        logger.warn(`[McpIndexStorage] Failed to rewrite ${messages.length} messages`);
      } else {
        logger.debug(`[McpIndexStorage] Rewrote ${messages.length} messages`);
      }
    } catch (err: any) {
      logger.warn(`[McpIndexStorage] rewriteMessages error: ${err.message}`);
    }
  }

  // ---- Rules ----

  async loadRules(): Promise<AutomationRule[]> {
    if (!this._client.isConfigured()) {
      logger.debug('[McpIndexStorage] Cannot load rules: index server not configured');
      return [];
    }

    try {
      const rules = await this._loadJson<AutomationRule[]>(RULES_KEY);
      if (!rules || !Array.isArray(rules)) return [];
      logger.debug(`[McpIndexStorage] Loaded ${rules.length} rules from index`);
      return rules;
    } catch (err: any) {
      logger.warn(`[McpIndexStorage] loadRules error: ${err.message}`);
      return [];
    }
  }

  async saveRules(rules: AutomationRule[]): Promise<void> {
    if (!this._client.isConfigured()) {
      logger.warn('[McpIndexStorage] Cannot save rules: index server not configured');
      return;
    }

    try {
      const ok = await this._storeJson(RULES_KEY, rules, { type: 'rules', count: rules.length });
      if (!ok) {
        logger.warn(`[McpIndexStorage] Failed to save ${rules.length} rules`);
      } else {
        logger.debug(`[McpIndexStorage] Saved ${rules.length} rules`);
      }
    } catch (err: any) {
      logger.warn(`[McpIndexStorage] saveRules error: ${err.message}`);
    }
  }

  // ---- Health ----

  async isAvailable(): Promise<boolean> {
    if (!this._client.isConfigured()) return false;
    try {
      const health = await this._client.healthCheck();
      return health.ok;
    } catch {
      return false;
    }
  }

  // ---- Internal helpers ----

  private async _loadJson<T>(key: string): Promise<T | null> {
    const result = await this._client.getKnowledge(key);
    if (!result?.content) return null;
    try {
      return JSON.parse(result.content) as T;
    } catch {
      logger.warn(`[McpIndexStorage] Failed to parse JSON for key '${key}'`);
      return null;
    }
  }

  private async _storeJson(key: string, data: unknown, metadata?: Record<string, unknown>): Promise<boolean> {
    return this._client.storeKnowledge(key, JSON.stringify(data), metadata);
  }
}
