// tests/messaging-api.test.ts
// Messaging REST API tests - exercises all /api/messages/* endpoints via handleAPI
// with mock HTTP objects. Ensures the dashboard viewChannel(), purgeMessages(),
// compose, edit, delete, ack flows all work end-to-end through the HTTP layer.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type MockInstance } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { handleAPI } from '../src/services/dashboard/api.js';
import { agentMailbox } from '../src/services/agentMailbox.js';
import { createPersistSpies, restoreSpies, cleanState } from './helpers/setup.js';

let persistSpies: MockInstance[];
beforeAll(() => { persistSpies = createPersistSpies(); });
afterAll(() => { restoreSpies(persistSpies); });
beforeEach(() => {
  cleanState();
  agentMailbox.purgeAll();
});

// ---------------------------------------------------------------------------
// Mock HTTP helpers (same pattern as automation-api.test.ts)
// ---------------------------------------------------------------------------

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  json(): unknown;
}

function mockReq(method: string, url: string, body?: unknown): IncomingMessage {
  const readable = new Readable();
  readable._read = () => {};
  if (body !== undefined) {
    readable.push(JSON.stringify(body));
    readable.push(null);
  } else {
    readable.push(null);
  }
  (readable as any).method = method;
  (readable as any).url = url;
  return readable as unknown as IncomingMessage;
}

function mockRes(): MockResponse & ServerResponse {
  let statusCode = 200;
  let headers: Record<string, string> = {};
  let body = '';
  const res: any = new Readable();
  res._read = () => {};
  res.writeHead = (code: number, hdrs?: Record<string, string>) => {
    statusCode = code;
    if (hdrs) headers = { ...headers, ...hdrs };
    return res;
  };
  res.end = (data?: string) => { if (data) body = data; };
  res.write = (_data?: string) => true;
  Object.defineProperty(res, 'statusCode', { get: () => statusCode, set: (v: number) => { statusCode = v; } });
  Object.defineProperty(res, 'headers', { get: () => headers });
  Object.defineProperty(res, 'body', { get: () => body });
  res.json = () => JSON.parse(body);
  return res as MockResponse & ServerResponse;
}

// Helper - send a message directly via the mailbox (bypasses HTTP)
async function seedMessage(channel: string, sender: string, recipients: string[], body: string) {
  return agentMailbox.send({ channel, sender, recipients, body });
}

// ---------------------------------------------------------------------------
// POST /api/messages - send a message
// ---------------------------------------------------------------------------

describe('POST /api/messages - send message', () => {
  it('sends a message and returns messageId', async () => {
    const req = mockReq('POST', '/api/messages', {
      channel: 'test-ch', sender: 'alice', recipients: ['bob'], body: 'Hello Bob',
    });
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.messageId).toBeDefined();
    expect(data.channel).toBe('test-ch');
    expect(data.status).toBe('sent');
  });

  it('returns 400 when missing required fields', async () => {
    const req = mockReq('POST', '/api/messages', { channel: 'test-ch' });
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid ttlSeconds', async () => {
    const req = mockReq('POST', '/api/messages', {
      channel: 'test-ch', sender: 'alice', recipients: ['bob'], body: 'Hi', ttlSeconds: -1,
    });
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/messages/channels - list channels
// ---------------------------------------------------------------------------

describe('GET /api/messages/channels - list channels', () => {
  it('returns empty list when no messages', async () => {
    const req = mockReq('GET', '/api/messages/channels');
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.count).toBe(0);
    expect(data.channels).toEqual([]);
  });

  it('returns channels after sending messages', async () => {
    await seedMessage('ch-a', 'alice', ['bob'], 'Hello');
    await seedMessage('ch-b', 'carol', ['dave'], 'Hi');
    await seedMessage('ch-a', 'alice', ['bob'], 'Follow-up');

    const req = mockReq('GET', '/api/messages/channels');
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.count).toBe(2);
    const channels = data.channels.map((c: any) => c.channel).sort();
    expect(channels).toEqual(['ch-a', 'ch-b']);
    const chA = data.channels.find((c: any) => c.channel === 'ch-a');
    expect(chA.messageCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// GET /api/messages/:channel - read messages (dashboard viewChannel)
// ---------------------------------------------------------------------------

describe('GET /api/messages/:channel - read messages (viewChannel)', () => {
  it('returns messages for a channel with reader=* (dashboard view)', async () => {
    await seedMessage('dashboard-ch', 'alice', ['bob'], 'Message 1');
    await seedMessage('dashboard-ch', 'bob', ['alice'], 'Message 2');
    await seedMessage('other-ch', 'carol', ['dave'], 'Different channel');

    const req = mockReq('GET', '/api/messages/dashboard-ch?reader=*&unreadOnly=false&limit=50');
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.channel).toBe('dashboard-ch');
    expect(data.count).toBe(2);
    expect(data.messages).toHaveLength(2);
    expect(data.messages[0].body).toBeDefined();
    expect(data.messages[0].sender).toBeDefined();
    expect(data.messages[0].id).toBeDefined();
  });

  it('returns empty array for non-existent channel', async () => {
    const req = mockReq('GET', '/api/messages/no-such-channel?reader=*&unreadOnly=false&limit=50');
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.count).toBe(0);
    expect(data.messages).toEqual([]);
  });

  it('respects limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await seedMessage('limit-ch', 'alice', ['bob'], `Message ${i}`);
    }
    const req = mockReq('GET', '/api/messages/limit-ch?reader=*&unreadOnly=false&limit=2');
    const res = mockRes();
    await handleAPI(req, res);
    const data = res.json() as any;
    expect(data.count).toBe(2);
    expect(data.messages).toHaveLength(2);
  });

  it('handles URL-encoded channel names', async () => {
    await seedMessage('my channel', 'alice', ['bob'], 'Test');
    const req = mockReq('GET', '/api/messages/my%20channel?reader=*&unreadOnly=false&limit=50');
    const res = mockRes();
    await handleAPI(req, res);
    const data = res.json() as any;
    expect(data.channel).toBe('my channel');
    expect(data.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GET /api/messages/stats - reader stats
// ---------------------------------------------------------------------------

describe('GET /api/messages/stats - reader stats', () => {
  it('returns stats for a reader', async () => {
    await seedMessage('stats-ch', 'alice', ['bob'], 'Unread msg');
    const req = mockReq('GET', '/api/messages/stats?reader=bob');
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.reader).toBe('bob');
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(data.unread).toBeGreaterThanOrEqual(1);
  });

  it('returns 400 when reader is missing', async () => {
    const req = mockReq('GET', '/api/messages/stats');
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/messages/ack - acknowledge messages
// ---------------------------------------------------------------------------

describe('POST /api/messages/ack - acknowledge', () => {
  it('acknowledges messages for a reader', async () => {
    const msgId = await seedMessage('ack-ch', 'alice', ['bob'], 'Read me');
    const req = mockReq('POST', '/api/messages/ack', {
      messageIds: [msgId], reader: 'bob',
    });
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.acknowledged).toBe(1);
    expect(data.reader).toBe('bob');
  });

  it('returns 400 when fields are missing', async () => {
    const req = mockReq('POST', '/api/messages/ack', { reader: 'bob' });
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/messages/by-id/:id - get single message
// ---------------------------------------------------------------------------

describe('GET /api/messages/by-id/:id - get message by ID', () => {
  it('returns message when found', async () => {
    const msgId = await seedMessage('byid-ch', 'alice', ['bob'], 'Find me');
    const req = mockReq('GET', `/api/messages/by-id/${msgId}`);
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.id).toBe(msgId);
    expect(data.body).toBe('Find me');
  });

  it('returns 404 for non-existent message', async () => {
    const req = mockReq('GET', '/api/messages/by-id/does-not-exist');
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/messages/by-id/:id - update message
// ---------------------------------------------------------------------------

describe('PUT /api/messages/by-id/:id - update message', () => {
  it('updates message body', async () => {
    const msgId = await seedMessage('edit-ch', 'alice', ['bob'], 'Original');
    const req = mockReq('PUT', `/api/messages/by-id/${msgId}`, { body: 'Updated' });
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.body).toBe('Updated');
  });

  it('returns 404 for non-existent message', async () => {
    const req = mockReq('PUT', '/api/messages/by-id/nope', { body: 'X' });
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/messages - purge / delete messages
// ---------------------------------------------------------------------------

describe('DELETE /api/messages - purge/delete', () => {
  it('purges all messages', async () => {
    await seedMessage('purge-ch', 'alice', ['bob'], 'Gone');
    await seedMessage('purge-ch', 'carol', ['dave'], 'Also gone');
    const req = mockReq('DELETE', '/api/messages', {});
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.purged).toBe(2);
  });

  it('purges by channel', async () => {
    await seedMessage('keep-ch', 'alice', ['bob'], 'Keep');
    await seedMessage('del-ch', 'carol', ['dave'], 'Delete');
    const req = mockReq('DELETE', '/api/messages', { channel: 'del-ch' });
    const res = mockRes();
    await handleAPI(req, res);
    const data = res.json() as any;
    expect(data.purged).toBe(1);
    expect(agentMailbox.getAll()).toHaveLength(1);
  });

  it('deletes specific message IDs', async () => {
    const id1 = await seedMessage('del-ch', 'alice', ['bob'], 'Msg 1');
    const id2 = await seedMessage('del-ch', 'alice', ['bob'], 'Msg 2');
    await seedMessage('del-ch', 'alice', ['bob'], 'Msg 3');
    const req = mockReq('DELETE', '/api/messages', { messageIds: [id1, id2] });
    const res = mockRes();
    await handleAPI(req, res);
    const data = res.json() as any;
    expect(data.purged).toBe(2);
    expect(agentMailbox.getAll()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/messages/inbound - peer receive
// ---------------------------------------------------------------------------

describe('POST /api/messages/inbound - peer receive', () => {
  it('receives a valid message from peer', async () => {
    const msg = {
      id: 'peer-msg-1', channel: 'peer-ch', sender: 'remote',
      recipients: ['local'], body: 'From peer', createdAt: new Date().toISOString(),
      readBy: [],
    };
    const req = mockReq('POST', '/api/messages/inbound', msg);
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.received).toBe(true);
    expect(data.messageId).toBe('peer-msg-1');
  });

  it('deduplicates already-known message', async () => {
    const msgId = await seedMessage('dedup-ch', 'alice', ['bob'], 'Original');
    const existing = agentMailbox.getById(msgId)!;
    const req = mockReq('POST', '/api/messages/inbound', existing);
    const res = mockRes();
    await handleAPI(req, res);
    const data = res.json() as any;
    expect(data.received).toBe(false);
  });

  it('returns 400 for invalid message', async () => {
    const req = mockReq('POST', '/api/messages/inbound', { id: 'x' });
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Snapshot includes messaging data (dashboard SSE path)
// ---------------------------------------------------------------------------

describe('GET /api/snapshot - messaging section', () => {
  it('snapshot includes messaging channels and totalMessages', async () => {
    await seedMessage('snap-a', 'alice', ['bob'], 'Msg A');
    await seedMessage('snap-b', 'carol', ['dave'], 'Msg B');
    const req = mockReq('GET', '/api/snapshot');
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.messaging).toBeDefined();
    expect(data.messaging.totalMessages).toBe(2);
    expect(data.messaging.channels).toHaveLength(2);
  });
});
