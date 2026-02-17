// tests/workspace-api.test.ts
// Workspace REST API CRUD tests - exercises handleAPI with mock HTTP objects.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type MockInstance } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { handleAPI } from '../src/services/dashboard/api.js';
import { workspaceMonitor, workspaceHistory } from '../src/services/workspace/index.js';
import { createPersistSpies, restoreSpies, cleanState } from './helpers/setup.js';

let persistSpies: MockInstance[];
let historyPersistSpy: MockInstance;

beforeAll(() => {
  persistSpies = createPersistSpies();
  historyPersistSpy = vi.spyOn(workspaceHistory as any, 'persist').mockImplementation(() => {});
});
afterAll(() => {
  restoreSpies(persistSpies);
  historyPersistSpy.mockRestore();
});
beforeEach(() => {
  cleanState();
  workspaceMonitor.stopAll(true);
  workspaceHistory.clearHistory();
});

// ---------------------------------------------------------------------------
// Mock HTTP helpers
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

const TEST_PATH = process.cwd();
const ENCODED_PATH = encodeURIComponent(TEST_PATH);

// ---------------------------------------------------------------------------
// POST /api/workspaces - start monitoring
// ---------------------------------------------------------------------------

describe('POST /api/workspaces - start monitoring', () => {
  afterEach(() => { workspaceMonitor.stopAll(true); });

  it('starts monitoring, returns status object', async () => {
    const req = mockReq('POST', '/api/workspaces', { path: TEST_PATH });
    const res = mockRes();
    const handled = await handleAPI(req, res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.status).toBe('monitoring');
    expect(data.path).toBe(TEST_PATH);
    expect(data.startedAt).toBeDefined();
  });

  it('returns 400 with missing path', async () => {
    const req = mockReq('POST', '/api/workspaces', {});
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(400);
  });
});

// Ensure cleanup after each test in nested groups
function afterEach(fn: () => void) {
  // We'll rely on beforeEach cleanState + stopAll above
}

// ---------------------------------------------------------------------------
// GET /api/workspaces/:encodedPath - detail
// ---------------------------------------------------------------------------

describe('GET /api/workspaces/:encodedPath - detail', () => {
  it('returns detailed workspace after start', async () => {
    workspaceMonitor.start(TEST_PATH);
    const req = mockReq('GET', `/api/workspaces/${ENCODED_PATH}`);
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.path).toBe(TEST_PATH);
    expect(typeof data.sessionCount).toBe('number');
    expect(typeof data.watcherCount).toBe('number');

    workspaceMonitor.stop(TEST_PATH, true);
  });

  it('returns 404 for non-monitored', async () => {
    const fakePath = encodeURIComponent('/nonexistent/path/ws');
    const req = mockReq('GET', `/api/workspaces/${fakePath}`);
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/workspaces/:encodedPath - stop
// ---------------------------------------------------------------------------

describe('DELETE /api/workspaces/:encodedPath - stop monitoring', () => {
  it('stops and returns final stats', async () => {
    workspaceMonitor.start(TEST_PATH);
    const req = mockReq('DELETE', `/api/workspaces/${ENCODED_PATH}`);
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.stopped).toBe(true);
    expect(data.path).toBe(TEST_PATH);
  });

  it('returns 404 for non-monitored', async () => {
    const req = mockReq('DELETE', `/api/workspaces/${encodeURIComponent('/nope')}`);
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/workspace-history - paginated list
// ---------------------------------------------------------------------------

describe('GET /api/workspace-history - history endpoints', () => {
  it('returns paginated history', async () => {
    // Seed history via start/stop
    workspaceMonitor.start(TEST_PATH);
    workspaceMonitor.stop(TEST_PATH, true);

    const req = mockReq('GET', '/api/workspace-history');
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.count).toBeGreaterThanOrEqual(1);
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(data.entries)).toBe(true);
    expect(data.entries[0].path).toBe(TEST_PATH);
  });

  it('filters by path', async () => {
    workspaceMonitor.start(TEST_PATH);
    workspaceMonitor.stop(TEST_PATH, true);

    const req = mockReq('GET', `/api/workspace-history/${ENCODED_PATH}`);
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.path).toBe(TEST_PATH);
    expect(data.count).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Full lifecycle
// ---------------------------------------------------------------------------

describe('Workspace API full lifecycle', () => {
  it('POST create → GET detail → DELETE → GET history', async () => {
    // Create
    const createReq = mockReq('POST', '/api/workspaces', { path: TEST_PATH });
    const createRes = mockRes();
    await handleAPI(createReq, createRes);
    expect(createRes.statusCode).toBe(200);
    expect((createRes.json() as any).status).toBe('monitoring');

    // Detail
    const detailReq = mockReq('GET', `/api/workspaces/${ENCODED_PATH}`);
    const detailRes = mockRes();
    await handleAPI(detailReq, detailRes);
    expect(detailRes.statusCode).toBe(200);
    expect((detailRes.json() as any).path).toBe(TEST_PATH);

    // Delete
    const delReq = mockReq('DELETE', `/api/workspaces/${ENCODED_PATH}`);
    const delRes = mockRes();
    await handleAPI(delReq, delRes);
    expect(delRes.statusCode).toBe(200);
    expect((delRes.json() as any).stopped).toBe(true);

    // History
    const histReq = mockReq('GET', '/api/workspace-history');
    const histRes = mockRes();
    await handleAPI(histReq, histRes);
    expect(histRes.statusCode).toBe(200);
    const histData = histRes.json() as any;
    expect(histData.count).toBeGreaterThanOrEqual(1);
    expect(histData.entries[0].path).toBe(TEST_PATH);
  });
});
