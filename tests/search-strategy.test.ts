// tests/search-strategy.test.ts
// Tests for searchStrategy parameter on mgr_send_message - verifies that
// code discovery guidance prefixes are correctly prepended to message bodies
// for VS Code session receivers with semantic_search access.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger
vi.mock('../src/services/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock dataDir
vi.mock('../src/services/dataDir.js', () => ({
  getStateDir: vi.fn().mockReturnValue('/tmp/test-state'),
  DATA_DIR: '/tmp/test-data',
}));

// Mock fs
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(''),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
}));

const { agentMailbox, _resetMailboxForTest } = await import('../src/services/agentMailbox.js');

beforeEach(() => { _resetMailboxForTest(); });

// ---------------------------------------------------------------------------
// Replicate the SEARCH_STRATEGY_PREFIXES from messagingTools.ts
// so tests can verify the exact prefix was prepended.
// ---------------------------------------------------------------------------

const SEMANTIC_FIRST_PREFIX = [
  'IMPORTANT - Code Discovery Strategy: This is a large repository.',
  'Use semantic_search as your PRIMARY tool for code discovery, architecture questions, and finding relevant files.',
  'Only use grep_search as a follow-up for exact symbol or string lookups after semantic_search narrows the search space.',
  'Do NOT start with grep_search and regex pattern guessing - it is slow and often misses relevant code in large repos.',
  '',
].join('\n');

const GREP_FIRST_PREFIX = [
  'IMPORTANT - Code Discovery Strategy: Use grep_search with targeted regex patterns as your PRIMARY tool.',
  'Use semantic_search only for broad conceptual questions when grep patterns are unclear.',
  '',
].join('\n');

/**
 * Simulates the tool-layer logic from mgr_send_message:
 *   const prefix = SEARCH_STRATEGY_PREFIXES[searchStrategy] || '';
 *   const body = prefix ? `${prefix}${originalBody}` : originalBody;
 */
function applySearchStrategy(
  searchStrategy: 'semantic-first' | 'grep-first' | 'auto',
  originalBody: string,
): string {
  const prefixes: Record<string, string> = {
    'semantic-first': SEMANTIC_FIRST_PREFIX,
    'grep-first': GREP_FIRST_PREFIX,
  };
  const prefix = prefixes[searchStrategy] || '';
  return prefix ? `${prefix}${originalBody}` : originalBody;
}

// ===========================================================================
// Search Strategy Prefixes - Unit Tests
// ===========================================================================

describe('Search Strategy - Prefix Construction', () => {
  it('semantic-first prefix contains semantic_search guidance', () => {
    const body = applySearchStrategy('semantic-first', 'Find the event bus code');
    expect(body).toContain('semantic_search');
    expect(body).toContain('PRIMARY tool');
    expect(body).toContain('Do NOT start with grep_search');
    expect(body.endsWith('Find the event bus code')).toBe(true);
  });

  it('grep-first prefix contains grep_search guidance', () => {
    const body = applySearchStrategy('grep-first', 'Find the event bus code');
    expect(body).toContain('grep_search');
    expect(body).toContain('PRIMARY tool');
    expect(body).toContain('semantic_search only for broad conceptual questions');
    expect(body.endsWith('Find the event bus code')).toBe(true);
  });

  it('auto strategy does NOT modify the body', () => {
    const original = 'Find the event bus code';
    const body = applySearchStrategy('auto', original);
    expect(body).toBe(original);
  });

  it('semantic-first prefix is prepended, not appended', () => {
    const body = applySearchStrategy('semantic-first', 'MY_ORIGINAL_TASK');
    expect(body.indexOf('IMPORTANT')).toBe(0);
    expect(body.indexOf('MY_ORIGINAL_TASK')).toBeGreaterThan(100);
  });

  it('original body is preserved intact after prefix', () => {
    const original = 'Analyze src/services/*.ts for security issues\nCheck all exports';
    const body = applySearchStrategy('semantic-first', original);
    expect(body).toContain(original);
    // Ensure the original appears exactly once
    const idx = body.indexOf(original);
    expect(body.indexOf(original, idx + 1)).toBe(-1);
  });
});

// ===========================================================================
// Search Strategy - End-to-End via Mailbox
// ===========================================================================

describe('Search Strategy - Message Body Integration', () => {
  it('semantic-first: message body contains semantic_search guidance when read back', async () => {
    const originalTask = 'Find how event bus emits crossrepo:dispatched events';
    const body = applySearchStrategy('semantic-first', originalTask);

    await agentMailbox.send({
      channel: 'strategy-test',
      sender: 'orchestrator',
      recipients: ['*'],
      body,
      ttlSeconds: 120,
    });

    const messages = await agentMailbox.read({
      channel: 'strategy-test',
      reader: 'windowsfabric',
      unreadOnly: false,
      limit: 10,
      markRead: false,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].body).toContain('semantic_search');
    expect(messages[0].body).toContain('PRIMARY tool');
    expect(messages[0].body).toContain(originalTask);
  });

  it('grep-first: message body contains grep_search guidance when read back', async () => {
    const originalTask = 'Find the exact import path for agentMailbox';
    const body = applySearchStrategy('grep-first', originalTask);

    await agentMailbox.send({
      channel: 'strategy-test',
      sender: 'orchestrator',
      recipients: ['*'],
      body,
      ttlSeconds: 120,
    });

    const messages = await agentMailbox.read({
      channel: 'strategy-test',
      reader: 'small-repo-agent',
      unreadOnly: false,
      limit: 10,
      markRead: false,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].body).toContain('grep_search');
    expect(messages[0].body).toContain(originalTask);
  });

  it('auto: message body is unmodified when read back', async () => {
    const originalTask = 'Just do the thing';
    const body = applySearchStrategy('auto', originalTask);

    await agentMailbox.send({
      channel: 'strategy-test',
      sender: 'orchestrator',
      recipients: ['*'],
      body,
      ttlSeconds: 120,
    });

    const messages = await agentMailbox.read({
      channel: 'strategy-test',
      reader: 'any-agent',
      unreadOnly: false,
      limit: 10,
      markRead: false,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe(originalTask);
    expect(messages[0].body).not.toContain('semantic_search');
    expect(messages[0].body).not.toContain('IMPORTANT');
  });

  it('semantic-first: receiver sees prefix regardless of their agent ID', async () => {
    const body = applySearchStrategy('semantic-first', 'Check architecture');

    await agentMailbox.send({
      channel: 'strategy-directed',
      sender: 'mcp-agent-manager',
      recipients: ['windowsfabric'],
      body,
      ttlSeconds: 120,
    });

    // Receiver reads with their ID
    const messages = await agentMailbox.read({
      channel: 'strategy-directed',
      reader: 'windowsfabric',
      unreadOnly: false,
      limit: 10,
      markRead: false,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].body).toContain('Use semantic_search as your PRIMARY tool');
    expect(messages[0].body).toContain('Check architecture');
  });

  it('strategy prefix does not affect message metadata', async () => {
    const body = applySearchStrategy('semantic-first', 'task body');

    const messageId = await agentMailbox.send({
      channel: 'meta-test',
      sender: 'test-sender',
      recipients: ['test-reader'],
      body,
      ttlSeconds: 300,
      payload: { taskType: 'search', priority: 1 },
    });

    const messages = await agentMailbox.read({
      channel: 'meta-test',
      reader: 'test-reader',
      unreadOnly: false,
      limit: 10,
      markRead: false,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(messageId);
    expect(messages[0].sender).toBe('test-sender');
    expect(messages[0].recipients).toEqual(['test-reader']);
    expect(messages[0].payload).toEqual({ taskType: 'search', priority: 1 });
  });
});
