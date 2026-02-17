// tests/skill-api.test.ts
// Skill REST API CRUD tests - exercises handleAPI with mock HTTP objects.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type MockInstance } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { handleAPI } from '../src/services/dashboard/api.js';
import { skillStore } from '../src/services/skillStore.js';
import { createPersistSpies, restoreSpies, cleanState } from './helpers/setup.js';
import type { SkillDefinition } from '../src/types/index.js';

let persistSpies: MockInstance[];
beforeAll(() => { persistSpies = createPersistSpies(); });
afterAll(() => { restoreSpies(persistSpies); });
beforeEach(() => {
  cleanState();
  // Remove any skills left over
  for (const s of skillStore.list()) skillStore.remove(s.id);
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
  res.end = (data?: string) => {
    if (data) body = data;
  };
  res.write = (_data?: string) => true;

  // Getters for assertions
  Object.defineProperty(res, 'statusCode', { get: () => statusCode, set: (v: number) => { statusCode = v; } });
  Object.defineProperty(res, 'headers', { get: () => headers });
  Object.defineProperty(res, 'body', { get: () => body });
  res.json = () => JSON.parse(body);

  return res as MockResponse & ServerResponse;
}

// Helper - register a test skill easily
function seedSkill(id = 'api-skill-1', overrides: Partial<SkillDefinition> = {}): void {
  skillStore.register({
    id,
    name: overrides.name ?? 'API Test Skill',
    description: overrides.description ?? 'desc',
    promptTemplate: overrides.promptTemplate ?? 'Do {thing}',
    strategy: overrides.strategy ?? 'single',
    version: overrides.version ?? '1.0.0',
    categories: overrides.categories ?? ['test'],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// POST /api/skills - create
// ---------------------------------------------------------------------------

describe('POST /api/skills - create skill', () => {
  it('creates skill, returns 200 + status registered', async () => {
    const req = mockReq('POST', '/api/skills', {
      id: 'new-skill', name: 'New Skill', promptTemplate: 'Do {x}',
    });
    const res = mockRes();
    const handled = await handleAPI(req, res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.status).toBe('registered');
    expect(data.skill).toBe('new-skill');
    expect(skillStore.get('new-skill')).toBeDefined();
  });

  it('returns 400 when required fields missing', async () => {
    const req = mockReq('POST', '/api/skills', { id: 'no-name' });
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(400);
    const data = res.json() as any;
    expect(data.error).toContain('Missing');
  });
});

// ---------------------------------------------------------------------------
// GET /api/skills/:id - read single
// ---------------------------------------------------------------------------

describe('GET /api/skills/:id - read single skill', () => {
  it('returns full SkillDefinition', async () => {
    seedSkill('read-skill', { name: 'Read Me', categories: ['alpha', 'beta'] });
    const req = mockReq('GET', '/api/skills/read-skill');
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.id).toBe('read-skill');
    expect(data.name).toBe('Read Me');
    expect(data.categories).toEqual(['alpha', 'beta']);
  });

  it('returns 404 for unknown', async () => {
    const req = mockReq('GET', '/api/skills/nonexistent');
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(404);
    const data = res.json() as any;
    expect(data.error).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// PUT /api/skills/:id - partial update
// ---------------------------------------------------------------------------

describe('PUT /api/skills/:id - partial update', () => {
  it('returns updated skill with version bumped', async () => {
    seedSkill('put-skill', { version: '1.0.0' });
    const req = mockReq('PUT', '/api/skills/put-skill', { name: 'Updated Name' });
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.status).toBe('updated');
    expect(data.skill.name).toBe('Updated Name');
    expect(data.skill.version).toBe('1.0.1');
    // Preserved field
    expect(data.skill.promptTemplate).toBe('Do {thing}');
  });

  it('returns 404 for non-existent', async () => {
    const req = mockReq('PUT', '/api/skills/ghost', { name: 'No' });
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/skills/:id - remove
// ---------------------------------------------------------------------------

describe('DELETE /api/skills/:id - remove', () => {
  it('returns deleted true', async () => {
    seedSkill('del-skill');
    const req = mockReq('DELETE', '/api/skills/del-skill');
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(200);
    const data = res.json() as any;
    expect(data.deleted).toBe(true);
    expect(data.id).toBe('del-skill');
    expect(skillStore.get('del-skill')).toBeUndefined();
  });

  it('returns 404 for non-existent', async () => {
    const req = mockReq('DELETE', '/api/skills/nope');
    const res = mockRes();
    await handleAPI(req, res);

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/skills - list all
// ---------------------------------------------------------------------------

describe('GET /api/skills - list after mutations', () => {
  it('count changes after create and delete', async () => {
    seedSkill('list-1');
    seedSkill('list-2');

    const reqList = mockReq('GET', '/api/skills');
    const resList = mockRes();
    await handleAPI(reqList, resList);
    const list = resList.json() as any[];
    expect(list.length).toBeGreaterThanOrEqual(2);

    // Delete one
    skillStore.remove('list-1');
    const reqList2 = mockReq('GET', '/api/skills');
    const resList2 = mockRes();
    await handleAPI(reqList2, resList2);
    const list2 = resList2.json() as any[];
    expect(list2.length).toBe(list.length - 1);
  });
});
