// tests/storage-provider.test.ts
// TDD tests for the dual-storage provider system.
// Tests cover: DiskStorageProvider, McpIndexStorageProvider, StorageManager.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AgentMessage } from '../src/services/mailboxTypes.js';
import type { AutomationRule } from '../src/types/automation.js';

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------
vi.mock('../src/services/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock dataDir
// ---------------------------------------------------------------------------
const TEST_STATE_DIR = '/tmp/test-storage-state';
const TEST_AUTOMATION_DIR = '/tmp/test-storage-automation';

vi.mock('../src/services/dataDir.js', () => ({
  getStateDir: vi.fn().mockReturnValue(TEST_STATE_DIR),
  getAutomationDir: vi.fn().mockReturnValue(TEST_AUTOMATION_DIR),
  DATA_DIR: '/tmp/test-storage-data',
}));

// ---------------------------------------------------------------------------
// Mock fs for disk provider tests
// ---------------------------------------------------------------------------
const mockFs = {
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(''),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
};

vi.mock('node:fs', () => ({
  ...mockFs,
  default: mockFs,
}));

vi.mock('fs', () => ({
  ...mockFs,
  default: mockFs,
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: overrides.id ?? `msg-test-${Date.now()}`,
    channel: overrides.channel ?? 'test-channel',
    sender: overrides.sender ?? 'agent-a',
    recipients: overrides.recipients ?? ['agent-b'],
    body: overrides.body ?? 'test message body',
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    ttlSeconds: overrides.ttlSeconds ?? 3600,
    persistent: overrides.persistent ?? false,
    readBy: overrides.readBy ?? [],
    payload: overrides.payload,
  };
}

function makeRule(overrides: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: overrides.id ?? 'test-rule-1',
    name: overrides.name ?? 'Test Rule',
    description: overrides.description ?? 'A test rule',
    enabled: overrides.enabled ?? true,
    priority: overrides.priority ?? 'normal',
    matcher: overrides.matcher ?? { events: ['test:event'] },
    skillId: overrides.skillId ?? 'test-skill',
    paramMapping: overrides.paramMapping ?? {},
    maxConcurrent: overrides.maxConcurrent ?? 3,
    tags: overrides.tags ?? [],
    version: overrides.version ?? '1.0.0',
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  };
}

// ===========================================================================
// DiskStorageProvider Tests
// ===========================================================================

describe('DiskStorageProvider', () => {
  let DiskStorageProvider: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue('');
    const mod = await import('../src/services/storage/diskStorageProvider.js');
    DiskStorageProvider = mod.DiskStorageProvider;
  });

  describe('constructor', () => {
    it('creates instance with name "disk"', () => {
      const provider = new DiskStorageProvider();
      expect(provider.name).toBe('disk');
    });
  });

  describe('isAvailable', () => {
    it('returns true (disk is always available)', async () => {
      const provider = new DiskStorageProvider();
      const available = await provider.isAvailable();
      expect(available).toBe(true);
    });
  });

  describe('appendMessage', () => {
    it('creates directory if it does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const provider = new DiskStorageProvider();
      const msg = makeMessage();

      await provider.appendMessage(msg);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(TEST_STATE_DIR, { recursive: true });
    });

    it('appends JSON line to messages file', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const provider = new DiskStorageProvider();
      const msg = makeMessage({ id: 'msg-append-1', body: 'hello' });

      await provider.appendMessage(msg);

      expect(mockFs.appendFileSync).toHaveBeenCalledTimes(1);
      const [filePath, content] = mockFs.appendFileSync.mock.calls[0];
      expect(filePath).toContain('messages.jsonl');
      const parsed = JSON.parse(content.toString().trim());
      expect(parsed.id).toBe('msg-append-1');
      expect(parsed.body).toBe('hello');
    });

    it('logs warning on write failure', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.appendFileSync.mockImplementationOnce(() => { throw new Error('disk full'); });
      const provider = new DiskStorageProvider();

      // Should not throw
      await provider.appendMessage(makeMessage());

      const { logger } = await import('../src/services/logger.js');
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('loadMessages', () => {
    it('returns empty array when file does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const provider = new DiskStorageProvider();

      const messages = await provider.loadMessages();
      expect(messages).toEqual([]);
    });

    it('parses JSONL file into messages array', async () => {
      const msg1 = makeMessage({ id: 'load-1', body: 'first' });
      const msg2 = makeMessage({ id: 'load-2', body: 'second' });
      const jsonl = JSON.stringify(msg1) + '\n' + JSON.stringify(msg2) + '\n';

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(jsonl);

      const provider = new DiskStorageProvider();
      const messages = await provider.loadMessages();

      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe('load-1');
      expect(messages[1].id).toBe('load-2');
    });

    it('skips corrupt lines without crashing', async () => {
      const msg1 = makeMessage({ id: 'good-1' });
      const jsonl = JSON.stringify(msg1) + '\n' + 'NOT_JSON\n' + '{"broken\n';

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(jsonl);

      const provider = new DiskStorageProvider();
      const messages = await provider.loadMessages();

      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('good-1');
    });

    it('returns empty array on read failure', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementationOnce(() => { throw new Error('EACCES'); });

      const provider = new DiskStorageProvider();
      const messages = await provider.loadMessages();
      expect(messages).toEqual([]);
    });
  });

  describe('rewriteMessages', () => {
    it('writes via temp file and rename for atomicity', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const provider = new DiskStorageProvider();
      const msgs = [makeMessage({ id: 'rw-1' }), makeMessage({ id: 'rw-2' })];

      await provider.rewriteMessages(msgs);

      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
      const [tmpPath] = mockFs.writeFileSync.mock.calls[0];
      expect(tmpPath).toContain('.tmp');
      expect(mockFs.renameSync).toHaveBeenCalledTimes(1);
    });

    it('writes empty string for empty array', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const provider = new DiskStorageProvider();

      await provider.rewriteMessages([]);

      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
      const [, content] = mockFs.writeFileSync.mock.calls[0];
      expect(content).toBe('');
    });
  });

  describe('loadRules', () => {
    it('returns empty array when file does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const provider = new DiskStorageProvider();

      const rules = await provider.loadRules();
      expect(rules).toEqual([]);
    });

    it('parses JSON array from rules file', async () => {
      const rule1 = makeRule({ id: 'rule-1' });
      const rule2 = makeRule({ id: 'rule-2' });
      const json = JSON.stringify([rule1, rule2]);

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(json);

      const provider = new DiskStorageProvider();
      const rules = await provider.loadRules();

      expect(rules).toHaveLength(2);
      expect(rules[0].id).toBe('rule-1');
      expect(rules[1].id).toBe('rule-2');
    });

    it('returns empty array on parse failure', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('NOT_JSON_ARRAY');

      const provider = new DiskStorageProvider();
      const rules = await provider.loadRules();
      expect(rules).toEqual([]);
    });
  });

  describe('saveRules', () => {
    it('writes JSON array to rules file', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const provider = new DiskStorageProvider();
      const rules = [makeRule({ id: 'save-1' })];

      await provider.saveRules(rules);

      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
      const [filePath, content] = mockFs.writeFileSync.mock.calls[0];
      expect(filePath).toContain('rules.json');
      const parsed = JSON.parse(content);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('save-1');
    });

    it('creates directory if missing', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const provider = new DiskStorageProvider();

      await provider.saveRules([]);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(TEST_AUTOMATION_DIR, { recursive: true });
    });
  });
});

// ===========================================================================
// McpIndexStorageProvider Tests
// ===========================================================================

describe('McpIndexStorageProvider', () => {
  let McpIndexStorageProvider: any;
  let mockIndexClient: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockIndexClient = {
      isConfigured: vi.fn().mockReturnValue(true),
      isCircuitOpen: vi.fn().mockReturnValue(false),
      baseUrl: 'http://localhost:8787',
      storeKnowledge: vi.fn().mockResolvedValue(true),
      getKnowledge: vi.fn().mockResolvedValue(null),
      searchKnowledge: vi.fn().mockResolvedValue([]),
      healthCheck: vi.fn().mockResolvedValue({ ok: true }),
    };

    const mod = await import('../src/services/storage/mcpIndexStorageProvider.js');
    McpIndexStorageProvider = mod.McpIndexStorageProvider;
  });

  describe('constructor', () => {
    it('creates instance with name "mcp-index"', () => {
      const provider = new McpIndexStorageProvider(mockIndexClient);
      expect(provider.name).toBe('mcp-index');
    });
  });

  describe('isAvailable', () => {
    it('returns true when index client is configured and healthy', async () => {
      mockIndexClient.healthCheck.mockResolvedValue({ ok: true });
      const provider = new McpIndexStorageProvider(mockIndexClient);

      const available = await provider.isAvailable();
      expect(available).toBe(true);
    });

    it('returns false when index client is not configured', async () => {
      mockIndexClient.isConfigured.mockReturnValue(false);
      const provider = new McpIndexStorageProvider(mockIndexClient);

      const available = await provider.isAvailable();
      expect(available).toBe(false);
    });

    it('returns false when health check fails', async () => {
      mockIndexClient.healthCheck.mockResolvedValue({ ok: false });
      const provider = new McpIndexStorageProvider(mockIndexClient);

      const available = await provider.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('appendMessage', () => {
    it('stores message in index server with proper key', async () => {
      mockIndexClient.storeKnowledge.mockResolvedValue(true);
      // Mock getKnowledge to return existing messages list
      mockIndexClient.getKnowledge.mockResolvedValue({
        key: 'agent-manager/messages',
        content: '[]',
      });

      const provider = new McpIndexStorageProvider(mockIndexClient);
      const msg = makeMessage({ id: 'idx-msg-1', body: 'stored in index' });

      await provider.appendMessage(msg);

      expect(mockIndexClient.storeKnowledge).toHaveBeenCalled();
      const [key, content] = mockIndexClient.storeKnowledge.mock.calls[0];
      expect(key).toBe('agent-manager/messages');
      const parsed = JSON.parse(content);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.some((m: any) => m.id === 'idx-msg-1')).toBe(true);
    });

    it('handles store failure gracefully', async () => {
      mockIndexClient.getKnowledge.mockResolvedValue(null);
      mockIndexClient.storeKnowledge.mockResolvedValue(false);

      const provider = new McpIndexStorageProvider(mockIndexClient);
      // Should not throw
      await provider.appendMessage(makeMessage());

      const { logger } = await import('../src/services/logger.js');
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('loadMessages', () => {
    it('returns messages from index server', async () => {
      const msgs = [makeMessage({ id: 'loaded-1' }), makeMessage({ id: 'loaded-2' })];
      mockIndexClient.getKnowledge.mockResolvedValue({
        key: 'agent-manager/messages',
        content: JSON.stringify(msgs),
      });

      const provider = new McpIndexStorageProvider(mockIndexClient);
      const loaded = await provider.loadMessages();

      expect(loaded).toHaveLength(2);
      expect(loaded[0].id).toBe('loaded-1');
      expect(loaded[1].id).toBe('loaded-2');
    });

    it('returns empty array when key not found', async () => {
      mockIndexClient.getKnowledge.mockResolvedValue(null);

      const provider = new McpIndexStorageProvider(mockIndexClient);
      const loaded = await provider.loadMessages();
      expect(loaded).toEqual([]);
    });

    it('returns empty array on parse error', async () => {
      mockIndexClient.getKnowledge.mockResolvedValue({
        key: 'agent-manager/messages',
        content: 'NOT_JSON',
      });

      const provider = new McpIndexStorageProvider(mockIndexClient);
      const loaded = await provider.loadMessages();
      expect(loaded).toEqual([]);
    });

    it('returns empty array when not configured', async () => {
      mockIndexClient.isConfigured.mockReturnValue(false);

      const provider = new McpIndexStorageProvider(mockIndexClient);
      const loaded = await provider.loadMessages();
      expect(loaded).toEqual([]);
    });
  });

  describe('rewriteMessages', () => {
    it('writes full message array to index server', async () => {
      mockIndexClient.storeKnowledge.mockResolvedValue(true);

      const provider = new McpIndexStorageProvider(mockIndexClient);
      const msgs = [makeMessage({ id: 'rw-idx-1' }), makeMessage({ id: 'rw-idx-2' })];

      await provider.rewriteMessages(msgs);

      expect(mockIndexClient.storeKnowledge).toHaveBeenCalledTimes(1);
      const [key, content] = mockIndexClient.storeKnowledge.mock.calls[0];
      expect(key).toBe('agent-manager/messages');
      const parsed = JSON.parse(content);
      expect(parsed).toHaveLength(2);
    });
  });

  describe('loadRules', () => {
    it('returns rules from index server', async () => {
      const rules = [makeRule({ id: 'idx-rule-1' })];
      mockIndexClient.getKnowledge.mockResolvedValue({
        key: 'agent-manager/rules',
        content: JSON.stringify(rules),
      });

      const provider = new McpIndexStorageProvider(mockIndexClient);
      const loaded = await provider.loadRules();

      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe('idx-rule-1');
    });

    it('returns empty array when key not found', async () => {
      mockIndexClient.getKnowledge.mockResolvedValue(null);

      const provider = new McpIndexStorageProvider(mockIndexClient);
      const loaded = await provider.loadRules();
      expect(loaded).toEqual([]);
    });
  });

  describe('saveRules', () => {
    it('writes rules to index server', async () => {
      mockIndexClient.storeKnowledge.mockResolvedValue(true);

      const provider = new McpIndexStorageProvider(mockIndexClient);
      const rules = [makeRule({ id: 'save-idx-1' })];

      await provider.saveRules(rules);

      expect(mockIndexClient.storeKnowledge).toHaveBeenCalledTimes(1);
      const [key, content] = mockIndexClient.storeKnowledge.mock.calls[0];
      expect(key).toBe('agent-manager/rules');
      const parsed = JSON.parse(content);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('save-idx-1');
    });
  });
});

// ===========================================================================
// StorageManager Tests
// ===========================================================================

describe('StorageManager', () => {
  let StorageManager: any;
  let mockDisk: any;
  let mockIndex: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockDisk = {
      name: 'disk',
      appendMessage: vi.fn().mockResolvedValue(undefined),
      loadMessages: vi.fn().mockResolvedValue([]),
      rewriteMessages: vi.fn().mockResolvedValue(undefined),
      loadRules: vi.fn().mockResolvedValue([]),
      saveRules: vi.fn().mockResolvedValue(undefined),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    mockIndex = {
      name: 'mcp-index',
      appendMessage: vi.fn().mockResolvedValue(undefined),
      loadMessages: vi.fn().mockResolvedValue([]),
      rewriteMessages: vi.fn().mockResolvedValue(undefined),
      loadRules: vi.fn().mockResolvedValue([]),
      saveRules: vi.fn().mockResolvedValue(undefined),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const mod = await import('../src/services/storage/storageManager.js');
    StorageManager = mod.StorageManager;
  });

  // -- Backend: disk only --

  describe('backend=disk', () => {
    it('appendMessage writes only to disk', async () => {
      const mgr = new StorageManager('disk', mockDisk, mockIndex);
      const msg = makeMessage();

      await mgr.appendMessage(msg);

      expect(mockDisk.appendMessage).toHaveBeenCalledWith(msg);
      expect(mockIndex.appendMessage).not.toHaveBeenCalled();
    });

    it('loadMessages reads only from disk', async () => {
      const msgs = [makeMessage({ id: 'disk-1' })];
      mockDisk.loadMessages.mockResolvedValue(msgs);

      const mgr = new StorageManager('disk', mockDisk, mockIndex);
      const loaded = await mgr.loadMessages();

      expect(loaded).toEqual(msgs);
      expect(mockDisk.loadMessages).toHaveBeenCalled();
      expect(mockIndex.loadMessages).not.toHaveBeenCalled();
    });

    it('rewriteMessages writes only to disk', async () => {
      const mgr = new StorageManager('disk', mockDisk, mockIndex);
      const msgs = [makeMessage()];

      await mgr.rewriteMessages(msgs);

      expect(mockDisk.rewriteMessages).toHaveBeenCalledWith(msgs);
      expect(mockIndex.rewriteMessages).not.toHaveBeenCalled();
    });

    it('loadRules reads only from disk', async () => {
      const rules = [makeRule({ id: 'disk-rule-1' })];
      mockDisk.loadRules.mockResolvedValue(rules);

      const mgr = new StorageManager('disk', mockDisk, mockIndex);
      const loaded = await mgr.loadRules();

      expect(loaded).toEqual(rules);
      expect(mockIndex.loadRules).not.toHaveBeenCalled();
    });

    it('saveRules writes only to disk', async () => {
      const mgr = new StorageManager('disk', mockDisk, mockIndex);
      const rules = [makeRule()];

      await mgr.saveRules(rules);

      expect(mockDisk.saveRules).toHaveBeenCalledWith(rules);
      expect(mockIndex.saveRules).not.toHaveBeenCalled();
    });
  });

  // -- Backend: mcp-index only --

  describe('backend=mcp-index', () => {
    it('appendMessage writes only to mcp-index', async () => {
      const mgr = new StorageManager('mcp-index', mockDisk, mockIndex);
      const msg = makeMessage();

      await mgr.appendMessage(msg);

      expect(mockIndex.appendMessage).toHaveBeenCalledWith(msg);
      expect(mockDisk.appendMessage).not.toHaveBeenCalled();
    });

    it('loadMessages reads from mcp-index', async () => {
      const msgs = [makeMessage({ id: 'idx-1' })];
      mockIndex.loadMessages.mockResolvedValue(msgs);

      const mgr = new StorageManager('mcp-index', mockDisk, mockIndex);
      const loaded = await mgr.loadMessages();

      expect(loaded).toEqual(msgs);
      expect(mockIndex.loadMessages).toHaveBeenCalled();
    });

    it('falls back to disk when mcp-index is unavailable for loadMessages', async () => {
      mockIndex.isAvailable.mockResolvedValue(false);
      mockIndex.loadMessages.mockRejectedValue(new Error('unavailable'));
      const diskMsgs = [makeMessage({ id: 'fallback-1' })];
      mockDisk.loadMessages.mockResolvedValue(diskMsgs);

      const mgr = new StorageManager('mcp-index', mockDisk, mockIndex);
      const loaded = await mgr.loadMessages();

      expect(loaded).toEqual(diskMsgs);
    });

    it('falls back to disk when mcp-index is unavailable for loadRules', async () => {
      mockIndex.isAvailable.mockResolvedValue(false);
      mockIndex.loadRules.mockRejectedValue(new Error('unavailable'));
      const diskRules = [makeRule({ id: 'fallback-rule-1' })];
      mockDisk.loadRules.mockResolvedValue(diskRules);

      const mgr = new StorageManager('mcp-index', mockDisk, mockIndex);
      const loaded = await mgr.loadRules();

      expect(loaded).toEqual(diskRules);
    });

    it('saveRules writes only to mcp-index', async () => {
      const mgr = new StorageManager('mcp-index', mockDisk, mockIndex);
      const rules = [makeRule()];

      await mgr.saveRules(rules);

      expect(mockIndex.saveRules).toHaveBeenCalledWith(rules);
      expect(mockDisk.saveRules).not.toHaveBeenCalled();
    });
  });

  // -- Backend: both --

  describe('backend=both', () => {
    it('appendMessage writes to both providers', async () => {
      const mgr = new StorageManager('both', mockDisk, mockIndex);
      const msg = makeMessage();

      await mgr.appendMessage(msg);

      expect(mockDisk.appendMessage).toHaveBeenCalledWith(msg);
      expect(mockIndex.appendMessage).toHaveBeenCalledWith(msg);
    });

    it('loadMessages prefers disk results (disk-primary)', async () => {
      const diskMsgs = [makeMessage({ id: 'disk-pref-1' })];
      mockDisk.loadMessages.mockResolvedValue(diskMsgs);
      mockIndex.loadMessages.mockResolvedValue([makeMessage({ id: 'idx-pref-1' })]);

      const mgr = new StorageManager('both', mockDisk, mockIndex);
      const loaded = await mgr.loadMessages();

      expect(loaded).toEqual(diskMsgs);
    });

    it('loadMessages falls back to disk when mcp-index returns empty', async () => {
      mockIndex.loadMessages.mockResolvedValue([]);
      const diskMsgs = [makeMessage({ id: 'disk-fallback-1' })];
      mockDisk.loadMessages.mockResolvedValue(diskMsgs);

      const mgr = new StorageManager('both', mockDisk, mockIndex);
      const loaded = await mgr.loadMessages();

      expect(loaded).toEqual(diskMsgs);
    });

    it('loadMessages falls back to disk when mcp-index throws', async () => {
      mockIndex.loadMessages.mockRejectedValue(new Error('network error'));
      const diskMsgs = [makeMessage({ id: 'disk-err-fallback' })];
      mockDisk.loadMessages.mockResolvedValue(diskMsgs);

      const mgr = new StorageManager('both', mockDisk, mockIndex);
      const loaded = await mgr.loadMessages();

      expect(loaded).toEqual(diskMsgs);
    });

    it('rewriteMessages writes to both providers', async () => {
      const mgr = new StorageManager('both', mockDisk, mockIndex);
      const msgs = [makeMessage()];

      await mgr.rewriteMessages(msgs);

      expect(mockDisk.rewriteMessages).toHaveBeenCalledWith(msgs);
      expect(mockIndex.rewriteMessages).toHaveBeenCalledWith(msgs);
    });

    it('saveRules writes to both providers', async () => {
      const mgr = new StorageManager('both', mockDisk, mockIndex);
      const rules = [makeRule()];

      await mgr.saveRules(rules);

      expect(mockDisk.saveRules).toHaveBeenCalledWith(rules);
      expect(mockIndex.saveRules).toHaveBeenCalledWith(rules);
    });

    it('loadRules prefers disk, falls back to mcp-index', async () => {
      const diskRules = [makeRule({ id: 'disk-rules-primary' })];
      mockDisk.loadRules.mockResolvedValue(diskRules);
      mockIndex.loadRules.mockResolvedValue([makeRule({ id: 'idx-rules-1' })]);

      const mgr = new StorageManager('both', mockDisk, mockIndex);
      const loaded = await mgr.loadRules();

      expect(loaded).toEqual(diskRules);
    });

    it('write failure on one provider does not block the other', async () => {
      mockIndex.appendMessage.mockRejectedValue(new Error('index down'));
      const mgr = new StorageManager('both', mockDisk, mockIndex);
      const msg = makeMessage();

      // Should not throw
      await mgr.appendMessage(msg);

      // Disk should still have been called
      expect(mockDisk.appendMessage).toHaveBeenCalledWith(msg);
    });

    it('saveRules failure on one provider does not block the other', async () => {
      mockDisk.saveRules.mockRejectedValue(new Error('disk full'));
      const mgr = new StorageManager('both', mockDisk, mockIndex);
      const rules = [makeRule()];

      // Should not throw
      await mgr.saveRules(rules);

      // Index should still have been called
      expect(mockIndex.saveRules).toHaveBeenCalledWith(rules);
    });
  });

  // -- Backend switching --

  describe('backend switching', () => {
    it('getBackend returns current backend', () => {
      const mgr = new StorageManager('disk', mockDisk, mockIndex);
      expect(mgr.getBackend()).toBe('disk');
    });

    it('setBackend changes the active backend', () => {
      const mgr = new StorageManager('disk', mockDisk, mockIndex);
      mgr.setBackend('mcp-index');
      expect(mgr.getBackend()).toBe('mcp-index');
    });

    it('after setBackend, operations use new backend', async () => {
      const mgr = new StorageManager('disk', mockDisk, mockIndex);
      mgr.setBackend('mcp-index');

      await mgr.appendMessage(makeMessage());

      expect(mockIndex.appendMessage).toHaveBeenCalled();
      expect(mockDisk.appendMessage).not.toHaveBeenCalled();
    });
  });

  // -- Status / health --

  describe('getStatus', () => {
    it('returns both provider availability', async () => {
      mockDisk.isAvailable.mockResolvedValue(true);
      mockIndex.isAvailable.mockResolvedValue(false);

      const mgr = new StorageManager('both', mockDisk, mockIndex);
      const status = await mgr.getStatus();

      expect(status.backend).toBe('both');
      expect(status.disk.available).toBe(true);
      expect(status.mcpIndex.available).toBe(false);
    });
  });
});

// ===========================================================================
// resolveStorageBackend Tests
// ===========================================================================

describe('resolveStorageBackend', () => {
  let resolveStorageBackend: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../src/services/storage/storageTypes.js');
    resolveStorageBackend = mod.resolveStorageBackend;
  });

  it('defaults to both when env not set', () => {
    delete process.env.MCP_STORAGE_BACKEND;
    const backend = resolveStorageBackend();
    expect(backend).toBe('both');
  });

  it('returns disk when env is "disk"', () => {
    process.env.MCP_STORAGE_BACKEND = 'disk';
    const backend = resolveStorageBackend();
    expect(backend).toBe('disk');
    delete process.env.MCP_STORAGE_BACKEND;
  });

  it('returns both when env is "both"', () => {
    process.env.MCP_STORAGE_BACKEND = 'both';
    const backend = resolveStorageBackend();
    expect(backend).toBe('both');
    delete process.env.MCP_STORAGE_BACKEND;
  });

  it('returns both for unknown values', () => {
    process.env.MCP_STORAGE_BACKEND = 'invalid';
    const backend = resolveStorageBackend();
    expect(backend).toBe('both');
    delete process.env.MCP_STORAGE_BACKEND;
  });

  it('handles mixed case', () => {
    process.env.MCP_STORAGE_BACKEND = 'DISK';
    const backend = resolveStorageBackend();
    expect(backend).toBe('disk');
    delete process.env.MCP_STORAGE_BACKEND;
  });
});
