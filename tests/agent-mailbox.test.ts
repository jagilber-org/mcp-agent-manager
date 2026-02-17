// tests/agent-mailbox.test.ts
// AgentMailbox - messaging service unit tests covering send, read,
// channels, acknowledgement, stats, TTL expiration, broadcast vs directed,
// peer receive/dedup, and persistence helpers.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger to suppress output
vi.mock('../src/services/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock dataDir to avoid real filesystem
vi.mock('../src/services/dataDir.js', () => ({
  getStateDir: vi.fn().mockReturnValue('/tmp/test-state'),
  DATA_DIR: '/tmp/test-data',
}));

// Mock fs to prevent real disk I/O
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(''),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  watch: vi.fn().mockReturnValue({ close: vi.fn() }),
}));

// Import fs mock for manipulation in tests
import * as fs from 'node:fs';

// Import after mocks are set up
const { agentMailbox, _resetMailboxForTest } = await import('../src/services/agentMailbox.js');

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetMailboxForTest();
});

// ===========================================================================
// Send
// ===========================================================================

describe('AgentMailbox - Send', () => {
  it('returns a message ID', async () => {
    const id = await agentMailbox.send({
      channel: 'send-basic',
      sender: 'agent-a',
      recipients: ['agent-b'],
      body: 'hello',
    });

    expect(id).toMatch(/^msg-\d+-\d+$/);
  });

  it('generated IDs are unique', async () => {
    const id1 = await agentMailbox.send({
      channel: 'send-unique',
      sender: 'agent-a',
      recipients: ['agent-b'],
      body: 'first',
    });
    const id2 = await agentMailbox.send({
      channel: 'send-unique',
      sender: 'agent-a',
      recipients: ['agent-b'],
      body: 'second',
    });

    expect(id1).not.toBe(id2);
  });

  it('defaults ttlSeconds to 3600', async () => {
    await agentMailbox.send({
      channel: 'send-ttl',
      sender: 'agent-a',
      recipients: ['*'],
      body: 'check ttl',
    });

    const messages = await agentMailbox.read({
      channel: 'send-ttl',
      reader: 'agent-a',
      markRead: false,
    });

    expect(messages[0].ttlSeconds).toBe(3600);
  });

  it('accepts custom ttlSeconds', async () => {
    await agentMailbox.send({
      channel: 'send-custom-ttl',
      sender: 'agent-a',
      recipients: ['*'],
      body: 'short lived',
      ttlSeconds: 60,
    });

    const messages = await agentMailbox.read({
      channel: 'send-custom-ttl',
      reader: 'agent-a',
      markRead: false,
    });

    expect(messages[0].ttlSeconds).toBe(60);
  });

  it('accepts optional payload', async () => {
    await agentMailbox.send({
      channel: 'send-payload',
      sender: 'agent-a',
      recipients: ['agent-b'],
      body: 'with data',
      payload: { key: 'value', count: 42 },
    });

    const messages = await agentMailbox.read({
      channel: 'send-payload',
      reader: 'agent-b',
      markRead: false,
    });

    expect(messages[0].payload).toEqual({ key: 'value', count: 42 });
  });
});

// ===========================================================================
// Read - Directed Messages
// ===========================================================================

describe('AgentMailbox - Directed Messages', () => {
  it('recipient can read directed message', async () => {
    await agentMailbox.send({
      channel: 'directed-read',
      sender: 'agent-a',
      recipients: ['agent-b'],
      body: 'for agent-b only',
    });

    const messages = await agentMailbox.read({
      channel: 'directed-read',
      reader: 'agent-b',
      markRead: false,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe('for agent-b only');
    expect(messages[0].sender).toBe('agent-a');
  });

  it('sender can read their own directed message', async () => {
    await agentMailbox.send({
      channel: 'directed-sender',
      sender: 'agent-a',
      recipients: ['agent-b'],
      body: 'sent by me',
    });

    const messages = await agentMailbox.read({
      channel: 'directed-sender',
      reader: 'agent-a',
      markRead: false,
    });

    expect(messages).toHaveLength(1);
  });

  it('non-recipient cannot read directed message', async () => {
    await agentMailbox.send({
      channel: 'directed-hidden',
      sender: 'agent-a',
      recipients: ['agent-b'],
      body: 'private',
    });

    const messages = await agentMailbox.read({
      channel: 'directed-hidden',
      reader: 'agent-c',
      markRead: false,
    });

    expect(messages).toHaveLength(0);
  });

  it('reader=* (wildcard) can read all directed messages', async () => {
    await agentMailbox.send({
      channel: 'directed-wildcard',
      sender: 'agent-a',
      recipients: ['agent-b'],
      body: 'private but visible to wildcard reader',
    });

    const messages = await agentMailbox.read({
      channel: 'directed-wildcard',
      reader: '*',
      markRead: false,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe('private but visible to wildcard reader');
  });

  it('multi-recipient message visible to all recipients', async () => {
    await agentMailbox.send({
      channel: 'directed-multi',
      sender: 'agent-a',
      recipients: ['agent-b', 'agent-c'],
      body: 'for two',
    });

    const bMessages = await agentMailbox.read({
      channel: 'directed-multi',
      reader: 'agent-b',
      markRead: false,
    });
    const cMessages = await agentMailbox.read({
      channel: 'directed-multi',
      reader: 'agent-c',
      markRead: false,
    });

    expect(bMessages).toHaveLength(1);
    expect(cMessages).toHaveLength(1);
  });
});

// ===========================================================================
// peekChannel - diagnostics
// ===========================================================================

describe('AgentMailbox - peekChannel', () => {
  it('returns senders and recipients for a channel', async () => {
    await agentMailbox.send({
      channel: 'peek-test',
      sender: 'agent-a',
      recipients: ['agent-b', 'agent-c'],
      body: 'directed message',
    });

    const peek = agentMailbox.peekChannel('peek-test');
    expect(peek).toBeDefined();
    expect(peek!.messageCount).toBe(1);
    expect(peek!.senders).toEqual(['agent-a']);
    expect(peek!.recipients.sort()).toEqual(['agent-b', 'agent-c']);
  });

  it('returns undefined for non-existent channel', () => {
    const peek = agentMailbox.peekChannel('no-such-channel');
    expect(peek).toBeUndefined();
  });

  it('aggregates senders and recipients across multiple messages', async () => {
    await agentMailbox.send({
      channel: 'peek-multi',
      sender: 'agent-a',
      recipients: ['agent-b'],
      body: 'msg 1',
    });
    await agentMailbox.send({
      channel: 'peek-multi',
      sender: 'agent-c',
      recipients: ['agent-d', 'agent-b'],
      body: 'msg 2',
    });

    const peek = agentMailbox.peekChannel('peek-multi');
    expect(peek!.messageCount).toBe(2);
    expect(peek!.senders.sort()).toEqual(['agent-a', 'agent-c']);
    expect(peek!.recipients.sort()).toEqual(['agent-b', 'agent-d']);
  });
});

// ===========================================================================
// Read - Broadcast
// ===========================================================================

describe('AgentMailbox - Broadcast', () => {
  it('broadcast message visible to any reader', async () => {
    await agentMailbox.send({
      channel: 'broadcast-all',
      sender: 'agent-a',
      recipients: ['*'],
      body: 'hello everyone',
    });

    const bMessages = await agentMailbox.read({
      channel: 'broadcast-all',
      reader: 'agent-b',
      markRead: false,
    });
    const cMessages = await agentMailbox.read({
      channel: 'broadcast-all',
      reader: 'agent-c',
      markRead: false,
    });
    const xMessages = await agentMailbox.read({
      channel: 'broadcast-all',
      reader: 'agent-x',
      markRead: false,
    });

    expect(bMessages).toHaveLength(1);
    expect(cMessages).toHaveLength(1);
    expect(xMessages).toHaveLength(1);
  });

  it('broadcast recipients field is ["*"]', async () => {
    await agentMailbox.send({
      channel: 'broadcast-star',
      sender: 'agent-a',
      recipients: ['*'],
      body: 'broadcast',
    });

    const messages = await agentMailbox.read({
      channel: 'broadcast-star',
      reader: 'anyone',
      markRead: false,
    });

    expect(messages[0].recipients).toEqual(['*']);
  });
});

// ===========================================================================
// Read - Unread Filtering & Mark Read
// ===========================================================================

describe('AgentMailbox - Read Status', () => {
  it('messages start as unread', async () => {
    await agentMailbox.send({
      channel: 'unread-init',
      sender: 'agent-a',
      recipients: ['*'],
      body: 'new message',
    });

    const messages = await agentMailbox.read({
      channel: 'unread-init',
      reader: 'agent-b',
      unreadOnly: true,
      markRead: false,
    });

    expect(messages).toHaveLength(1);
  });

  it('markRead=true marks messages as read for that reader', async () => {
    await agentMailbox.send({
      channel: 'mark-read',
      sender: 'agent-a',
      recipients: ['*'],
      body: 'read me',
    });

    // First read marks as read
    await agentMailbox.read({
      channel: 'mark-read',
      reader: 'agent-b',
      unreadOnly: true,
      markRead: true,
    });

    // Second read with unreadOnly should return empty
    const messages = await agentMailbox.read({
      channel: 'mark-read',
      reader: 'agent-b',
      unreadOnly: true,
      markRead: false,
    });

    expect(messages).toHaveLength(0);
  });

  it('read status is per-reader (reader A read does not affect reader B)', async () => {
    await agentMailbox.send({
      channel: 'per-reader',
      sender: 'agent-a',
      recipients: ['*'],
      body: 'per reader test',
    });

    // agent-b reads and marks
    await agentMailbox.read({
      channel: 'per-reader',
      reader: 'agent-b',
      markRead: true,
    });

    // agent-c should still see it as unread
    const messages = await agentMailbox.read({
      channel: 'per-reader',
      reader: 'agent-c',
      unreadOnly: true,
      markRead: false,
    });

    expect(messages).toHaveLength(1);
  });

  it('unreadOnly=false returns all messages regardless of read status', async () => {
    await agentMailbox.send({
      channel: 'read-all',
      sender: 'agent-a',
      recipients: ['*'],
      body: 'already read',
    });

    // Read and mark
    await agentMailbox.read({
      channel: 'read-all',
      reader: 'agent-b',
      markRead: true,
    });

    // unreadOnly=false still returns the message
    const messages = await agentMailbox.read({
      channel: 'read-all',
      reader: 'agent-b',
      unreadOnly: false,
      markRead: false,
    });

    expect(messages).toHaveLength(1);
  });

  it('includeRead=true returns read messages even when unreadOnly=true', async () => {
    await agentMailbox.send({
      channel: 'include-read',
      sender: 'agent-a',
      recipients: ['*'],
      body: 'peek me',
    });

    // Read and mark
    await agentMailbox.read({
      channel: 'include-read',
      reader: 'agent-b',
      markRead: true,
    });

    // includeRead overrides unreadOnly
    const messages = await agentMailbox.read({
      channel: 'include-read',
      reader: 'agent-b',
      unreadOnly: true,
      includeRead: true,
      markRead: false,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe('peek me');
  });

  it('default markRead=false does not mark messages as read (peek mode)', async () => {
    await agentMailbox.send({
      channel: 'peek-default',
      sender: 'agent-a',
      recipients: ['*'],
      body: 'peek default',
    });

    // First read - default markRead is false
    const first = await agentMailbox.read({
      channel: 'peek-default',
      reader: 'agent-b',
    });
    expect(first).toHaveLength(1);

    // Second read - message should still be unread
    const second = await agentMailbox.read({
      channel: 'peek-default',
      reader: 'agent-b',
      unreadOnly: true,
    });
    expect(second).toHaveLength(1);
  });

  it('includeRead=true with default unreadOnly still returns read messages', async () => {
    await agentMailbox.send({
      channel: 'include-default',
      sender: 'agent-a',
      recipients: ['*'],
      body: 'include test',
    });

    // Mark as read explicitly
    await agentMailbox.read({
      channel: 'include-default',
      reader: 'agent-b',
      markRead: true,
    });

    // includeRead alone should be enough to see read messages
    const messages = await agentMailbox.read({
      channel: 'include-default',
      reader: 'agent-b',
      includeRead: true,
    });

    expect(messages).toHaveLength(1);
  });
});

// ===========================================================================
// Acknowledge
// ===========================================================================

describe('AgentMailbox - Acknowledge', () => {
  it('ack marks specific messages as read', async () => {
    const id = await agentMailbox.send({
      channel: 'ack-test',
      sender: 'agent-a',
      recipients: ['*'],
      body: 'ack me',
    });

    const count = agentMailbox.ack([id], 'agent-b');
    expect(count).toBe(1);

    // Should no longer appear as unread
    const messages = await agentMailbox.read({
      channel: 'ack-test',
      reader: 'agent-b',
      unreadOnly: true,
      markRead: false,
    });
    expect(messages).toHaveLength(0);
  });

  it('ack returns 0 for unknown message IDs', () => {
    const count = agentMailbox.ack(['nonexistent-id'], 'agent-b');
    expect(count).toBe(0);
  });

  it('double-ack does not double-count', async () => {
    const id = await agentMailbox.send({
      channel: 'double-ack',
      sender: 'agent-a',
      recipients: ['*'],
      body: 'double',
    });

    const first = agentMailbox.ack([id], 'agent-b');
    const second = agentMailbox.ack([id], 'agent-b');

    expect(first).toBe(1);
    expect(second).toBe(0);
  });
});

// ===========================================================================
// List Channels
// ===========================================================================

describe('AgentMailbox - List Channels', () => {
  it('lists channels with message counts', async () => {
    // Use unique channel names
    const ch = `list-ch-${Date.now()}`;
    await agentMailbox.send({
      channel: ch,
      sender: 'agent-a',
      recipients: ['*'],
      body: 'msg1',
    });
    await agentMailbox.send({
      channel: ch,
      sender: 'agent-a',
      recipients: ['*'],
      body: 'msg2',
    });

    const channels = agentMailbox.listChannels();
    const found = channels.find(c => c.channel === ch);

    expect(found).toBeDefined();
    expect(found!.messageCount).toBe(2);
    expect(found!.latestAt).toBeDefined();
  });

  it('returns empty array when no messages exist', () => {
    const channels = agentMailbox.listChannels();
    expect(channels).toHaveLength(0);
  });
});

// ===========================================================================
// Stats
// ===========================================================================

describe('AgentMailbox - Stats', () => {
  it('returns total and unread counts for a reader', async () => {
    const ch = `stats-${Date.now()}`;
    await agentMailbox.send({
      channel: ch,
      sender: 'agent-a',
      recipients: ['*'],
      body: 'one',
    });
    await agentMailbox.send({
      channel: ch,
      sender: 'agent-a',
      recipients: ['*'],
      body: 'two',
    });

    // Read one message
    await agentMailbox.read({
      channel: ch,
      reader: 'agent-b',
      limit: 1,
      markRead: true,
    });

    const stats = agentMailbox.getStats('agent-b', ch);
    expect(stats.total).toBe(2);
    expect(stats.unread).toBe(1);
  });

  it('returns zero for reader with no visible messages', () => {
    const stats = agentMailbox.getStats('ghost-reader', 'nonexistent-channel-xyz');
    expect(stats.total).toBe(0);
    expect(stats.unread).toBe(0);
    expect(stats.channels).toBe(0);
  });

  it('channels count reflects distinct channels with visible messages', async () => {
    const prefix = `stats-multi-${Date.now()}`;
    await agentMailbox.send({
      channel: `${prefix}-a`,
      sender: 'agent-x',
      recipients: ['*'],
      body: 'ch-a',
    });
    await agentMailbox.send({
      channel: `${prefix}-b`,
      sender: 'agent-x',
      recipients: ['*'],
      body: 'ch-b',
    });

    const stats = agentMailbox.getStats('agent-y');
    expect(stats.channels).toBe(2);
  });
});

// ===========================================================================
// TTL Expiration
// ===========================================================================

describe('AgentMailbox - TTL Expiration', () => {
  it('expired messages are pruned on read', async () => {
    // Send with 1s TTL then wait for it to expire
    await agentMailbox.send({
      channel: 'ttl-expire',
      sender: 'agent-a',
      recipients: ['*'],
      body: 'ephemeral',
      ttlSeconds: 1,
    });

    // Wait for the message to expire (1s TTL + small buffer)
    await new Promise(r => setTimeout(r, 1100));

    const messages = await agentMailbox.read({
      channel: 'ttl-expire',
      reader: 'agent-b',
      markRead: false,
    });

    expect(messages).toHaveLength(0);
  });

  it('non-expired messages survive pruning', async () => {
    await agentMailbox.send({
      channel: 'ttl-survive',
      sender: 'agent-a',
      recipients: ['*'],
      body: 'long lived',
      ttlSeconds: 9999,
    });

    const messages = await agentMailbox.read({
      channel: 'ttl-survive',
      reader: 'agent-b',
      markRead: false,
    });

    expect(messages).toHaveLength(1);
  });
});

// ===========================================================================
// Message Ordering
// ===========================================================================

describe('AgentMailbox - Ordering', () => {
  it('messages are returned in chronological order (oldest first)', async () => {
    const ch = `order-${Date.now()}`;
    await agentMailbox.send({ channel: ch, sender: 'a', recipients: ['*'], body: 'first' });
    // Small delay to ensure distinct timestamps
    await new Promise(r => setTimeout(r, 5));
    await agentMailbox.send({ channel: ch, sender: 'a', recipients: ['*'], body: 'second' });
    await new Promise(r => setTimeout(r, 5));
    await agentMailbox.send({ channel: ch, sender: 'a', recipients: ['*'], body: 'third' });

    const messages = await agentMailbox.read({
      channel: ch,
      reader: 'b',
      markRead: false,
    });

    expect(messages).toHaveLength(3);
    expect(messages[0].body).toBe('first');
    expect(messages[1].body).toBe('second');
    expect(messages[2].body).toBe('third');
  });

  it('limit caps the number of returned messages', async () => {
    const ch = `order-limit-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      await agentMailbox.send({ channel: ch, sender: 'a', recipients: ['*'], body: `msg-${i}` });
    }

    const messages = await agentMailbox.read({
      channel: ch,
      reader: 'b',
      limit: 3,
      markRead: false,
    });

    expect(messages).toHaveLength(3);
  });
});

// ===========================================================================
// Channel Isolation
// ===========================================================================

describe('AgentMailbox - Channel Isolation', () => {
  it('messages on different channels are isolated', async () => {
    await agentMailbox.send({
      channel: 'alpha',
      sender: 'agent-a',
      recipients: ['*'],
      body: 'alpha msg',
    });
    await agentMailbox.send({
      channel: 'beta',
      sender: 'agent-a',
      recipients: ['*'],
      body: 'beta msg',
    });

    const alpha = await agentMailbox.read({
      channel: 'alpha',
      reader: 'agent-b',
      markRead: false,
    });
    const beta = await agentMailbox.read({
      channel: 'beta',
      reader: 'agent-b',
      markRead: false,
    });

    expect(alpha).toHaveLength(1);
    expect(alpha[0].body).toBe('alpha msg');
    expect(beta).toHaveLength(1);
    expect(beta[0].body).toBe('beta msg');
  });
});

// ===========================================================================
// Peer Receive & Deduplication
// ===========================================================================

describe('AgentMailbox - Peer Receive', () => {
  it('receiveFromPeer adds a new message', () => {
    const isNew = agentMailbox.receiveFromPeer({
      id: 'peer-msg-1',
      channel: 'peer-ch',
      sender: 'remote-agent',
      recipients: ['*'],
      body: 'from peer',
      createdAt: new Date().toISOString(),
      ttlSeconds: 3600,
      readBy: [],
    });

    expect(isNew).toBe(true);
    const all = agentMailbox.getAll();
    expect(all.some(m => m.id === 'peer-msg-1')).toBe(true);
  });

  it('receiveFromPeer deduplicates by message ID', async () => {
    const msg = {
      id: 'dedup-msg-1',
      channel: 'dedup-ch',
      sender: 'remote-agent',
      recipients: ['*'],
      body: 'original',
      createdAt: new Date().toISOString(),
      ttlSeconds: 3600,
      readBy: [],
    };

    const first = agentMailbox.receiveFromPeer(msg);
    const second = agentMailbox.receiveFromPeer({ ...msg, body: 'duplicate' });

    expect(first).toBe(true);
    expect(second).toBe(false);

    const messages = await agentMailbox.read({
      channel: 'dedup-ch',
      reader: 'anyone',
      markRead: false,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe('original');
  });

  it('receiveFromPeer rejects expired messages', () => {
    const isNew = agentMailbox.receiveFromPeer({
      id: 'expired-peer-msg',
      channel: 'peer-ch',
      sender: 'remote-agent',
      recipients: ['*'],
      body: 'old',
      createdAt: new Date(Date.now() - 100_000).toISOString(),
      ttlSeconds: 1,
      readBy: [],
    });

    expect(isNew).toBe(false);
  });

  it('locally sent messages are also deduplicated on peer receive', async () => {
    const id = await agentMailbox.send({
      channel: 'local-then-peer',
      sender: 'local-agent',
      recipients: ['*'],
      body: 'local version',
    });

    const isNew = agentMailbox.receiveFromPeer({
      id,
      channel: 'local-then-peer',
      sender: 'local-agent',
      recipients: ['*'],
      body: 'peer version',
      createdAt: new Date().toISOString(),
      ttlSeconds: 3600,
      readBy: [],
    });

    expect(isNew).toBe(false);
  });
});

// ===========================================================================
// getAll
// ===========================================================================

describe('AgentMailbox - getAll', () => {
  it('returns all non-expired messages', async () => {
    await agentMailbox.send({ channel: 'all-1', sender: 'a', recipients: ['*'], body: 'one' });
    await agentMailbox.send({ channel: 'all-2', sender: 'a', recipients: ['*'], body: 'two' });

    const all = agentMailbox.getAll();
    expect(all).toHaveLength(2);
  });

  it('returns empty array when store is empty', () => {
    const all = agentMailbox.getAll();
    expect(all).toHaveLength(0);
  });
});

// ===========================================================================
// TTL Enforcement
// ===========================================================================

describe('AgentMailbox - TTL Enforcement', () => {
  it('clamps ttlSeconds to max on send', async () => {
    const id = await agentMailbox.send({
      channel: 'ttl-cap',
      sender: 'a',
      recipients: ['*'],
      body: 'huge ttl',
      ttlSeconds: 999_999,
    });

    const all = agentMailbox.getAll();
    const msg = all.find(m => m.id === id);
    expect(msg).toBeDefined();
    expect(msg!.ttlSeconds).toBe(86_400);
  });

  it('clamps ttlSeconds to minimum of 1 on send', async () => {
    const id = await agentMailbox.send({
      channel: 'ttl-min',
      sender: 'a',
      recipients: ['*'],
      body: 'tiny ttl',
      ttlSeconds: -5,
    });

    const all = agentMailbox.getAll();
    const msg = all.find(m => m.id === id);
    expect(msg).toBeDefined();
    expect(msg!.ttlSeconds).toBe(1);
  });

  it('clamps ttlSeconds on peer receive', () => {
    const isNew = agentMailbox.receiveFromPeer({
      id: 'peer-ttl-cap',
      channel: 'ttl-cap',
      sender: 'remote',
      recipients: ['*'],
      body: 'huge peer ttl',
      createdAt: new Date().toISOString(),
      ttlSeconds: 999_999,
      readBy: [],
    });

    expect(isNew).toBe(true);
    const all = agentMailbox.getAll();
    const msg = all.find(m => m.id === 'peer-ttl-cap');
    expect(msg!.ttlSeconds).toBe(86_400);
  });

  it('uses default TTL when not specified', async () => {
    const id = await agentMailbox.send({
      channel: 'ttl-default',
      sender: 'a',
      recipients: ['*'],
      body: 'default ttl',
    });

    const all = agentMailbox.getAll();
    const msg = all.find(m => m.id === id);
    expect(msg!.ttlSeconds).toBe(3_600);
  });
});

// ===========================================================================
// Purge Channel
// ===========================================================================

describe('AgentMailbox - purgeChannel', () => {
  it('removes all messages on a specific channel', async () => {
    await agentMailbox.send({ channel: 'purge-ch', sender: 'a', recipients: ['*'], body: 'one' });
    await agentMailbox.send({ channel: 'purge-ch', sender: 'a', recipients: ['*'], body: 'two' });
    await agentMailbox.send({ channel: 'keep-ch', sender: 'a', recipients: ['*'], body: 'keep' });

    const removed = agentMailbox.purgeChannel('purge-ch');
    expect(removed).toBe(2);

    const all = agentMailbox.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].channel).toBe('keep-ch');
  });

  it('returns 0 for nonexistent channel', () => {
    const removed = agentMailbox.purgeChannel('no-such-channel');
    expect(removed).toBe(0);
  });
});

// ===========================================================================
// Delete Messages
// ===========================================================================

describe('AgentMailbox - deleteMessages', () => {
  it('deletes specific messages by ID', async () => {
    const id1 = await agentMailbox.send({ channel: 'del-test', sender: 'a', recipients: ['*'], body: 'msg1' });
    const id2 = await agentMailbox.send({ channel: 'del-test', sender: 'a', recipients: ['*'], body: 'msg2' });
    await agentMailbox.send({ channel: 'del-test', sender: 'a', recipients: ['*'], body: 'msg3' });

    const removed = agentMailbox.deleteMessages([id1, id2]);
    expect(removed).toBe(2);

    const remaining = agentMailbox.getAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].body).toBe('msg3');
  });

  it('returns 0 for unknown IDs', () => {
    const removed = agentMailbox.deleteMessages(['fake-id-1', 'fake-id-2']);
    expect(removed).toBe(0);
  });
});

// ===========================================================================
// TTL with missing ttlSeconds (regression: old messages without field)
// ===========================================================================

describe('AgentMailbox - Missing TTL Handling', () => {
  it('receiveFromPeer treats missing ttlSeconds as DEFAULT_TTL_SECONDS', () => {
    // Simulate an old message with no ttlSeconds field but recent timestamp
    const isNew = agentMailbox.receiveFromPeer({
      id: 'no-ttl-recent',
      channel: 'legacy-ch',
      sender: 'old-agent',
      recipients: ['*'],
      body: 'no ttl field',
      createdAt: new Date().toISOString(),
      ttlSeconds: undefined as unknown as number,
      readBy: [],
    });
    expect(isNew).toBe(true);
  });

  it('receiveFromPeer expires old message with missing ttlSeconds', () => {
    // Simulate an old message from 2 hours ago with no TTL → should expire (default 1h)
    const isNew = agentMailbox.receiveFromPeer({
      id: 'no-ttl-old',
      channel: 'legacy-ch',
      sender: 'old-agent',
      recipients: ['*'],
      body: 'ancient',
      createdAt: new Date(Date.now() - 7200_000).toISOString(),
      ttlSeconds: undefined as unknown as number,
      readBy: [],
    });
    expect(isNew).toBe(false);
  });
});

// ===========================================================================
// Deduplication on load (regression: JSONL with duplicate entries)
// ===========================================================================

describe('AgentMailbox - Deduplication', () => {
  it('receiveFromPeer does not create duplicates', async () => {
    await agentMailbox.send({ channel: 'dedup-stress', sender: 'a', recipients: ['*'], body: 'original' });

    // Try receiving same-id messages multiple times from peer
    const msg = agentMailbox.getAll()[0];
    for (let i = 0; i < 5; i++) {
      const result = agentMailbox.receiveFromPeer({ ...msg });
      expect(result).toBe(false);
    }

    const all = agentMailbox.getAll();
    expect(all).toHaveLength(1);
  });
});

// ===========================================================================
// Stress Test - concurrent operations
// ===========================================================================

describe('AgentMailbox - Stress', () => {
  it('handles 100 concurrent sends across 10 channels', async () => {
    const promises: Promise<string>[] = [];
    for (let i = 0; i < 100; i++) {
      promises.push(agentMailbox.send({
        channel: `stress-ch-${i % 10}`,
        sender: `agent-${i % 5}`,
        recipients: ['*'],
        body: `stress message ${i}`,
        ttlSeconds: 300,
      }));
    }

    const ids = await Promise.all(promises);

    // All IDs unique
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(100);

    // All messages readable
    const all = agentMailbox.getAll();
    expect(all).toHaveLength(100);

    // Channel counts are correct
    const channels = agentMailbox.listChannels();
    expect(channels).toHaveLength(10);
    for (const ch of channels) {
      expect(ch.messageCount).toBe(10);
    }
  });

  it('handles rapid send-read-purge cycle', async () => {
    // Send
    for (let i = 0; i < 20; i++) {
      await agentMailbox.send({
        channel: 'cycle-ch',
        sender: 'a',
        recipients: ['*'],
        body: `cycle-${i}`,
      });
    }
    expect(agentMailbox.getAll()).toHaveLength(20);

    // Read
    const msgs = await agentMailbox.read({
      channel: 'cycle-ch',
      reader: 'b',
      markRead: true,
      limit: 50,
    });
    expect(msgs).toHaveLength(20);

    // Stats reflect read
    const stats = agentMailbox.getStats('b', 'cycle-ch');
    expect(stats.total).toBe(20);
    expect(stats.unread).toBe(0);

    // Purge channel
    const removed = agentMailbox.purgeChannel('cycle-ch');
    expect(removed).toBe(20);

    // Verify empty
    expect(agentMailbox.getAll()).toHaveLength(0);
    expect(agentMailbox.listChannels()).toHaveLength(0);
  });

  it('handles interleaved directed + broadcast messages', async () => {
    // Mix of broadcast and directed
    await agentMailbox.send({ channel: 'mix', sender: 'a', recipients: ['*'], body: 'broadcast1' });
    await agentMailbox.send({ channel: 'mix', sender: 'a', recipients: ['b'], body: 'directed-to-b' });
    await agentMailbox.send({ channel: 'mix', sender: 'a', recipients: ['c'], body: 'directed-to-c' });
    await agentMailbox.send({ channel: 'mix', sender: 'a', recipients: ['*'], body: 'broadcast2' });
    await agentMailbox.send({ channel: 'mix', sender: 'a', recipients: ['b', 'c'], body: 'multi-directed' });

    // Agent b sees: broadcast1, directed-to-b, broadcast2, multi-directed (4)
    const bMsgs = await agentMailbox.read({ channel: 'mix', reader: 'b', markRead: false });
    expect(bMsgs).toHaveLength(4);

    // Agent c sees: broadcast1, directed-to-c, broadcast2, multi-directed (4)
    const cMsgs = await agentMailbox.read({ channel: 'mix', reader: 'c', markRead: false });
    expect(cMsgs).toHaveLength(4);

    // Agent d sees only broadcasts (2)
    const dMsgs = await agentMailbox.read({ channel: 'mix', reader: 'd', markRead: false });
    expect(dMsgs).toHaveLength(2);

    // Agent a (sender) sees ALL (5)
    const aMsgs = await agentMailbox.read({ channel: 'mix', reader: 'a', markRead: false });
    expect(aMsgs).toHaveLength(5);

    // Delete specific messages, verify counts update
    const toDelete = bMsgs.filter(m => m.body.startsWith('directed')).map(m => m.id);
    agentMailbox.deleteMessages(toDelete);

    const bAfter = await agentMailbox.read({ channel: 'mix', reader: 'b', markRead: false });
    expect(bAfter).toHaveLength(3); // lost directed-to-b
  });
});

// ===========================================================================
// Persistent Messages
// ===========================================================================

describe('AgentMailbox - Persistent Messages', () => {
  it('persistent message is not expired by TTL sweep', async () => {
    const id = await agentMailbox.send({
      channel: 'persist-ch',
      sender: 'a',
      recipients: ['*'],
      body: 'I survive TTL',
      persistent: true,
    });

    const msg = agentMailbox.getAll().find(m => m.id === id);
    expect(msg!.persistent).toBe(true);
    expect(msg!.ttlSeconds).toBe(0);
    expect(agentMailbox._isExpired(msg!)).toBe(false);
  });

  it('persistent message coexists with ephemeral messages', async () => {
    await agentMailbox.send({ channel: 'mixed-ttl', sender: 'a', recipients: ['*'], body: 'ephemeral', ttlSeconds: 60 });
    await agentMailbox.send({ channel: 'mixed-ttl', sender: 'a', recipients: ['*'], body: 'forever', persistent: true });

    const msgs = await agentMailbox.read({ channel: 'mixed-ttl', reader: 'b', markRead: false });
    expect(msgs).toHaveLength(2);

    const persistent = msgs.find(m => m.body === 'forever');
    expect(persistent!.persistent).toBe(true);

    const ephemeral = msgs.find(m => m.body === 'ephemeral');
    expect(ephemeral!.persistent).toBeFalsy();
  });

  it('persistent message survives receiveFromPeer with old timestamp', () => {
    const isNew = agentMailbox.receiveFromPeer({
      id: 'persist-peer-old',
      channel: 'persist-ch',
      sender: 'remote',
      recipients: ['*'],
      body: 'old but persistent',
      createdAt: new Date(Date.now() - 200_000_000).toISOString(), // ~2.3 days ago
      ttlSeconds: 0,
      persistent: true,
      readBy: [],
    });
    expect(isNew).toBe(true);
    expect(agentMailbox._isExpired({ ttlSeconds: 0, persistent: true, createdAt: new Date(Date.now() - 200_000_000).toISOString() } as any)).toBe(false);
  });

  it('persistent message is still purgeable', async () => {
    await agentMailbox.send({ channel: 'purge-persist', sender: 'a', recipients: ['*'], body: 'stays', persistent: true });
    expect(agentMailbox.getAll().length).toBeGreaterThan(0);

    const removed = agentMailbox.purgeChannel('purge-persist');
    expect(removed).toBeGreaterThan(0);

    const left = agentMailbox.getAll().filter(m => m.channel === 'purge-persist');
    expect(left).toHaveLength(0);
  });

  it('default persistent is false', async () => {
    const id = await agentMailbox.send({
      channel: 'default-persist',
      sender: 'a',
      recipients: ['*'],
      body: 'normal msg',
    });
    const msg = agentMailbox.getAll().find(m => m.id === id);
    expect(msg!.persistent).toBe(false);
    expect(msg!.ttlSeconds).toBe(3_600);
  });
});

// ===========================================================================
// Cross-instance reload (_reloadFromDisk)
// ===========================================================================

describe('AgentMailbox - Cross-instance reload', () => {
  /**
   * Helper: set up the fs mock so loadMessagesFromLog() returns the given messages.
   * This simulates another instance writing to messages.jsonl.
   */
  function simulateDiskMessages(messages: any[]): void {
    const jsonl = messages.map(m => JSON.stringify(m)).join('\n');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(jsonl);
  }

  function makeMessage(overrides: Partial<any> = {}): any {
    return {
      id: `ext-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      channel: 'cross-inst',
      sender: 'remote-agent',
      recipients: ['*'],
      body: 'from another instance',
      createdAt: new Date().toISOString(),
      ttlSeconds: 3600,
      persistent: false,
      readBy: [],
      ...overrides,
    };
  }

  it('_reloadFromDisk merges new external messages into local store', async () => {
    // Start with one local message
    await agentMailbox.send({ channel: 'reload-test', sender: 'local', recipients: ['*'], body: 'local msg' });
    expect(agentMailbox.getAll()).toHaveLength(1);

    // Simulate disk having local + 2 external messages
    const localMsg = agentMailbox.getAll()[0];
    const ext1 = makeMessage({ id: 'ext-1', channel: 'reload-test', body: 'external 1' });
    const ext2 = makeMessage({ id: 'ext-2', channel: 'reload-test', body: 'external 2' });
    simulateDiskMessages([localMsg, ext1, ext2]);

    // Trigger reload (as ConfigWatcher would)
    agentMailbox._reloadFromDisk();

    const all = agentMailbox.getAll();
    expect(all).toHaveLength(3);
    expect(all.some(m => m.id === 'ext-1')).toBe(true);
    expect(all.some(m => m.id === 'ext-2')).toBe(true);
  });

  it('_reloadFromDisk does not duplicate existing messages', async () => {
    await agentMailbox.send({ channel: 'dedup-reload', sender: 'local', recipients: ['*'], body: 'exists' });
    const existing = agentMailbox.getAll()[0];

    // Disk contains the same message
    simulateDiskMessages([existing]);

    agentMailbox._reloadFromDisk();

    expect(agentMailbox.getAll()).toHaveLength(1);
  });

  it('_reloadFromDisk merges readBy from disk into in-memory messages', async () => {
    await agentMailbox.send({ channel: 'readby-merge', sender: 'a', recipients: ['*'], body: 'test' });
    const msg = agentMailbox.getAll()[0];
    expect(msg.readBy).toEqual([]);

    // Disk version has readBy from another instance's reader
    const diskMsg = { ...msg, readBy: ['remote-reader'] };
    simulateDiskMessages([diskMsg]);

    agentMailbox._reloadFromDisk();

    const updated = agentMailbox.getById(msg.id);
    expect(updated!.readBy).toContain('remote-reader');
  });

  it('_reloadFromDisk skips expired external messages', () => {
    const expired = makeMessage({
      id: 'expired-ext',
      createdAt: new Date(Date.now() - 100_000_000).toISOString(),
      ttlSeconds: 1,
      persistent: false,
    });
    simulateDiskMessages([expired]);

    agentMailbox._reloadFromDisk();

    expect(agentMailbox.getAll()).toHaveLength(0);
  });

  it('_reloadFromDisk picks up persistent messages from another instance', () => {
    const persistent = makeMessage({
      id: 'persist-ext',
      body: 'I survive forever',
      persistent: true,
      ttlSeconds: 0,
      createdAt: new Date(Date.now() - 200_000_000).toISOString(),
    });
    simulateDiskMessages([persistent]);

    agentMailbox._reloadFromDisk();

    const all = agentMailbox.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('persist-ext');
    expect(all[0].persistent).toBe(true);
  });

  it('_reloadFromDisk updates body for existing messages changed externally', async () => {
    await agentMailbox.send({ channel: 'body-update', sender: 'a', recipients: ['*'], body: 'original' });
    const msg = agentMailbox.getAll()[0];

    // Disk has updated body (another instance edited it)
    const diskMsg = { ...msg, body: 'edited by remote' };
    simulateDiskMessages([diskMsg]);

    agentMailbox._reloadFromDisk();

    const updated = agentMailbox.getById(msg.id);
    expect(updated!.body).toBe('edited by remote');
  });

  it('_reloadFromDisk with empty disk does not remove in-memory messages', async () => {
    await agentMailbox.send({ channel: 'no-clobber', sender: 'a', recipients: ['*'], body: 'keep me' });
    expect(agentMailbox.getAll()).toHaveLength(1);

    // Disk returns empty (e.g. file was truncated by another instance's purge)
    simulateDiskMessages([]);

    agentMailbox._reloadFromDisk();

    // In-memory messages should still exist (reload is additive, not destructive)
    expect(agentMailbox.getAll()).toHaveLength(1);
  });
});
