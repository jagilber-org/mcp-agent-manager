// tests/automation-api.test.ts
// Automation REST API CRUD tests - exercises handleAPI with mock HTTP objects.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type MockInstance } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { handleAPI } from '../src/services/dashboard/api.js';
import { automationEngine } from '../src/services/automation/index.js';
import {
  createPersistSpies, restoreSpies, cleanState, makeRuleInput,
  registerTestAgent, registerMockProviders,
} from './helpers/setup.js';

let persistSpies: MockInstance[];
beforeAll(() => {
  persistSpies = createPersistSpies();
  registerMockProviders();
});
afterAll(() => { restoreSpies(persistSpies); });
beforeEach(() => { cleanState(); });

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

// Helper - seed a rule via the engine directly
function seedRule(id = 'api-rule-1', overrides: Partial<Parameters<typeof makeRuleInput>[0]> = {}) {
  automationEngine.registerRule(makeRuleInput({ id, ...overrides }));
}

// ---------------------------------------------------------------------------
// POST /api/automation - create rule
// ---------------------------------------------------------------------------

describe('POST /api/automation - create rule', () => {
  it('creates rule, returns status created', async () => {
    const req = mockReq('POST', '/api/automation', {
      id: 'new-rule', name: 'New Rule', skillId: 'code-review', events: ['workspace:git-event'],
    });
    const res = mockRes();
    const handled = await handleAPI(req, res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.status).toBe('created');
    expect(data.rule.id).toBe('new-rule');
    expect(automationEngine.getRule('new-rule')).toBeDefined();
  });

  it('returns 400 when required fields missing', async () => {
    const req = mockReq('POST', '/api/automation', { id: 'bad-rule' });
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(400);
    const data = res.json() as any;
    expect(data.error).toContain('Missing');
  });
});

// ---------------------------------------------------------------------------
// GET /api/automation/:id - read single
// ---------------------------------------------------------------------------

describe('GET /api/automation/:id - read single rule', () => {
  it('returns full rule + execution stats', async () => {
    seedRule('get-rule', { name: 'Get Me' });
    const req = mockReq('GET', '/api/automation/get-rule');
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.rule).toBeDefined();
    expect(data.rule.id).toBe('get-rule');
    expect(data.rule.name).toBe('Get Me');
    expect(data.stats).toBeDefined();
  });

  it('returns 404 for unknown', async () => {
    const req = mockReq('GET', '/api/automation/nonexistent');
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(404);
    const data = res.json() as any;
    expect(data.error).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// PUT /api/automation/:id - partial update
// ---------------------------------------------------------------------------

describe('PUT /api/automation/:id - partial update', () => {
  it('returns updated rule with version bumped', async () => {
    seedRule('put-rule');
    const req = mockReq('PUT', '/api/automation/put-rule', { name: 'Updated Rule' });
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.status).toBe('updated');
    expect(data.rule.name).toBe('Updated Rule');
    expect(data.rule.version).toBe('1.0.1');
  });

  it('returns 404 for non-existent', async () => {
    const req = mockReq('PUT', '/api/automation/ghost', { name: 'No' });
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/automation/:id - remove
// ---------------------------------------------------------------------------

describe('DELETE /api/automation/:id - remove', () => {
  it('returns deleted true', async () => {
    seedRule('del-rule');
    const req = mockReq('DELETE', '/api/automation/del-rule');
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.deleted).toBe(true);
    expect(data.id).toBe('del-rule');
    expect(automationEngine.getRule('del-rule')).toBeUndefined();
  });

  it('returns 404 for non-existent', async () => {
    const req = mockReq('DELETE', '/api/automation/nope');
    const res = mockRes();
    await handleAPI(req, res);
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/automation/:id/toggle - enable/disable
// ---------------------------------------------------------------------------

describe('POST /api/automation/:id/toggle', () => {
  it('toggles enabled state', async () => {
    seedRule('toggle-rule');
    expect(automationEngine.getRule('toggle-rule')!.enabled).toBe(true);

    const req = mockReq('POST', '/api/automation/toggle-rule/toggle', { enabled: false });
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.toggled).toBe(true);
    expect(data.enabled).toBe(false);
    expect(automationEngine.getRule('toggle-rule')!.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /api/automation/:id/trigger - manual trigger
// ---------------------------------------------------------------------------

describe('POST /api/automation/:id/trigger', () => {
  it('manual trigger returns execution result', async () => {
    registerTestAgent();
    seedRule('trigger-rule');

    const req = mockReq('POST', '/api/automation/trigger-rule/trigger', {});
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data).toBeDefined();
    expect(data.executionId || data.status).toBeDefined();
  });

  it('dry run does not execute', async () => {
    registerTestAgent();
    seedRule('dryrun-rule');

    const req = mockReq('POST', '/api/automation/dryrun-rule/trigger', { dryRun: true });
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.status).toBe('skipped');
    expect(data.resultSummary).toContain('DRY RUN');
  });
});

// ---------------------------------------------------------------------------
// Full lifecycle
// ---------------------------------------------------------------------------

describe('Automation API full lifecycle', () => {
  it('POST create → GET → PUT update → POST toggle → POST trigger → DELETE', async () => {
    registerTestAgent();

    // Create
    const createReq = mockReq('POST', '/api/automation', {
      id: 'lifecycle', name: 'Lifecycle Rule', skillId: 'code-review', events: ['workspace:git-event'],
    });
    const createRes = mockRes();
    await handleAPI(createReq, createRes);
    expect(createRes.statusCode).toBe(200);
    expect((createRes.json() as any).status).toBe('created');

    // Read
    const getReq = mockReq('GET', '/api/automation/lifecycle');
    const getRes = mockRes();
    await handleAPI(getReq, getRes);
    expect(getRes.statusCode).toBe(200);
    expect((getRes.json() as any).rule.id).toBe('lifecycle');

    // Update
    const putReq = mockReq('PUT', '/api/automation/lifecycle', { name: 'Updated Lifecycle' });
    const putRes = mockRes();
    await handleAPI(putReq, putRes);
    expect(putRes.statusCode).toBe(200);
    expect((putRes.json() as any).rule.name).toBe('Updated Lifecycle');

    // Toggle off
    const toggleReq = mockReq('POST', '/api/automation/lifecycle/toggle', { enabled: false });
    const toggleRes = mockRes();
    await handleAPI(toggleReq, toggleRes);
    expect(toggleRes.statusCode).toBe(200);
    expect((toggleRes.json() as any).enabled).toBe(false);

    // Trigger (dry run, rule is disabled so execution may differ)
    const triggerReq = mockReq('POST', '/api/automation/lifecycle/trigger', { dryRun: true });
    const triggerRes = mockRes();
    await handleAPI(triggerReq, triggerRes);
    expect(triggerRes.statusCode).toBe(200);

    // Delete
    const delReq = mockReq('DELETE', '/api/automation/lifecycle');
    const delRes = mockRes();
    await handleAPI(delReq, delRes);
    expect(delRes.statusCode).toBe(200);
    expect((delRes.json() as any).deleted).toBe(true);

    // Verify removed
    const verifyReq = mockReq('GET', '/api/automation/lifecycle');
    const verifyRes = mockRes();
    await handleAPI(verifyReq, verifyRes);
    expect(verifyRes.statusCode).toBe(404);
  });
});
