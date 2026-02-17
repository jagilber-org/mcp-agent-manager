// mcp-agent-manager/src/services/storage/diskStorageProvider.ts
// Disk-based storage provider - wraps existing JSONL/JSON file persistence.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { logger } from '../logger.js';
import { getStateDir, getAutomationDir } from '../dataDir.js';
import type { AgentMessage } from '../mailboxTypes.js';
import type { AutomationRule } from '../../types/automation.js';
import type { StorageProvider } from './storageTypes.js';

function getMessagesFile(): string {
  return path.join(getStateDir(), 'messages.jsonl');
}

function getRulesFile(): string {
  return path.join(getAutomationDir(), 'rules.json');
}

/**
 * Disk-based StorageProvider.
 * Messages: JSONL append/rewrite in state dir.
 * Rules: JSON array in automation dir.
 */
export class DiskStorageProvider implements StorageProvider {
  readonly name = 'disk';

  // ---- Messages ----

  async appendMessage(message: AgentMessage): Promise<void> {
    try {
      const dir = getStateDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(getMessagesFile(), JSON.stringify(message) + os.EOL, 'utf-8');
      logger.debug(`[DiskStorage] Appended message ${message.id}`);
    } catch (err: any) {
      logger.warn(`[DiskStorage] Failed to append message: ${err.message}`);
    }
  }

  async loadMessages(): Promise<AgentMessage[]> {
    try {
      const file = getMessagesFile();
      if (!fs.existsSync(file)) return [];
      const raw = fs.readFileSync(file, 'utf-8');
      const lines = raw.trim().split('\n').filter(l => l.trim());
      const messages: AgentMessage[] = [];
      for (const line of lines) {
        try {
          messages.push(JSON.parse(line));
        } catch { /* skip corrupt lines */ }
      }
      logger.debug(`[DiskStorage] Loaded ${messages.length} messages from disk`);
      return messages;
    } catch (err: any) {
      logger.warn(`[DiskStorage] Failed to load messages: ${err.message}`);
      return [];
    }
  }

  async rewriteMessages(messages: AgentMessage[]): Promise<void> {
    try {
      const dir = getStateDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const content = messages.map(m => JSON.stringify(m)).join(os.EOL) + (messages.length ? os.EOL : '');
      const tmpFile = getMessagesFile() + '.tmp';
      fs.writeFileSync(tmpFile, content, 'utf-8');
      fs.renameSync(tmpFile, getMessagesFile());
      logger.debug(`[DiskStorage] Rewrote ${messages.length} messages`);
    } catch (err: any) {
      logger.warn(`[DiskStorage] Failed to rewrite messages: ${err.message}`);
    }
  }

  // ---- Rules ----

  async loadRules(): Promise<AutomationRule[]> {
    try {
      const file = getRulesFile();
      if (!fs.existsSync(file)) return [];
      const raw = fs.readFileSync(file, 'utf-8');
      const arr: AutomationRule[] = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      logger.debug(`[DiskStorage] Loaded ${arr.length} rules from disk`);
      return arr;
    } catch (err: any) {
      logger.warn(`[DiskStorage] Failed to load rules: ${err.message}`);
      return [];
    }
  }

  async saveRules(rules: AutomationRule[]): Promise<void> {
    try {
      const dir = getAutomationDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(getRulesFile(), JSON.stringify(rules, null, 2), 'utf-8');
      logger.debug(`[DiskStorage] Saved ${rules.length} rules`);
    } catch (err: any) {
      logger.warn(`[DiskStorage] Failed to save rules: ${err.message}`);
    }
  }

  // ---- Health ----

  async isAvailable(): Promise<boolean> {
    return true; // Disk is always available
  }
}
