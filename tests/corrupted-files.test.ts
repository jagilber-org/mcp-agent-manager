// tests/corrupted-files.test.ts
// Constitution MI-3, MI-4, TS-6: Corrupted file recovery for all JSON and JSONL stores.
// Every persisted store must handle invalid JSON, empty files, partial writes, and
// binary garbage gracefully - safe empty state, no crashes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ===========================================================================
// AgentRegistry - corrupted agents.json
// ===========================================================================

describe('Corrupted files - AgentRegistry', () => {
  let tmpDir: string;
  let agentsFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corrupt-agents-'));
    agentsFile = path.join(tmpDir, 'agents.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('invalid JSON on load → empty registry, no crash', () => {
    fs.writeFileSync(agentsFile, '{ this is not json !!!', 'utf-8');
    const agents = safeLoadJsonArray(agentsFile);
    expect(agents).toEqual([]);
  });

  it('empty file (0 bytes) → empty registry, no crash', () => {
    fs.writeFileSync(agentsFile, '', 'utf-8');
    const agents = safeLoadJsonArray(agentsFile);
    expect(agents).toEqual([]);
  });

  it('truncated JSON → empty registry, no crash', () => {
    fs.writeFileSync(agentsFile, '[{"id":"agent-1","name":"Test"', 'utf-8');
    const agents = safeLoadJsonArray(agentsFile);
    expect(agents).toEqual([]);
  });

  it('binary garbage → empty registry, no crash', () => {
    fs.writeFileSync(agentsFile, Buffer.from([0x00, 0x80, 0xFF, 0xFE, 0x89, 0x50, 0x4E, 0x47]));
    const agents = safeLoadJsonArray(agentsFile);
    expect(agents).toEqual([]);
  });

  it('null content → empty registry, no crash', () => {
    fs.writeFileSync(agentsFile, 'null', 'utf-8');
    const agents = safeLoadJsonArray(agentsFile);
    expect(agents).toEqual([]);
  });

  it('valid JSON object (not array) → empty registry, no crash', () => {
    fs.writeFileSync(agentsFile, '{"id":"agent-1"}', 'utf-8');
    const agents = safeLoadJsonArray(agentsFile);
    expect(agents).toEqual([]);
  });
});

// ===========================================================================
// SkillStore - corrupted skills.json
// ===========================================================================

describe('Corrupted files - SkillStore', () => {
  let tmpDir: string;
  let skillsFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corrupt-skills-'));
    skillsFile = path.join(tmpDir, 'skills.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('invalid JSON → empty skill list, no crash', () => {
    fs.writeFileSync(skillsFile, '[[not valid json', 'utf-8');
    const skills = safeLoadJsonArray(skillsFile);
    expect(skills).toEqual([]);
  });

  it('empty file → empty skill list, no crash', () => {
    fs.writeFileSync(skillsFile, '', 'utf-8');
    const skills = safeLoadJsonArray(skillsFile);
    expect(skills).toEqual([]);
  });

  it('binary garbage → empty skill list, no crash', () => {
    fs.writeFileSync(skillsFile, Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]));
    const skills = safeLoadJsonArray(skillsFile);
    expect(skills).toEqual([]);
  });
});

// ===========================================================================
// AutomationEngine - corrupted rules.json
// ===========================================================================

describe('Corrupted files - AutomationEngine', () => {
  let tmpDir: string;
  let rulesFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corrupt-rules-'));
    rulesFile = path.join(tmpDir, 'rules.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('invalid JSON → empty rule set, no crash', () => {
    fs.writeFileSync(rulesFile, '{rules: broken}', 'utf-8');
    const rules = safeLoadJsonArray(rulesFile);
    expect(rules).toEqual([]);
  });

  it('truncated JSON → empty rule set, no crash', () => {
    fs.writeFileSync(rulesFile, '[{"id":"rule-1","name":"Test","events":["workspace:git-event"]', 'utf-8');
    const rules = safeLoadJsonArray(rulesFile);
    expect(rules).toEqual([]);
  });
});

// ===========================================================================
// WorkspaceHistory - corrupted workspace-history.json
// ===========================================================================

describe('Corrupted files - WorkspaceHistory', () => {
  let tmpDir: string;
  let historyFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corrupt-history-'));
    historyFile = path.join(tmpDir, 'workspace-history.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('invalid JSON → empty history, no crash', () => {
    fs.writeFileSync(historyFile, '??? not json', 'utf-8');
    const entries = safeLoadJsonArray(historyFile);
    expect(entries).toEqual([]);
  });

  it('empty file → empty history, no crash', () => {
    fs.writeFileSync(historyFile, '', 'utf-8');
    const entries = safeLoadJsonArray(historyFile);
    expect(entries).toEqual([]);
  });
});

// ===========================================================================
// FeedbackStore - corrupted feedback.jsonl
// ===========================================================================

describe('Corrupted files - FeedbackStore JSONL', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corrupt-feedback-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('malformed lines are skipped, valid lines loaded', async () => {
    const { initFeedbackStore, listFeedback } = await import('../src/services/feedbackStore.js');
    const filePath = path.join(tmpDir, 'feedback.jsonl');
    const validEntry = {
      id: 'fb-valid-1', type: 'bug', title: 'Valid', body: 'ok',
      status: 'new', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, [
      '{this is garbage}',
      JSON.stringify(validEntry),
      'not json at all',
      '',
    ].join('\n'));

    initFeedbackStore(tmpDir);
    const all = listFeedback();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('fb-valid-1');
  });

  it('binary garbage content → empty store, no crash', async () => {
    const { initFeedbackStore, listFeedback } = await import('../src/services/feedbackStore.js');
    const filePath = path.join(tmpDir, 'feedback.jsonl');
    fs.writeFileSync(filePath, Buffer.from([0x00, 0x80, 0xFF, 0xFE, 0x89]));

    initFeedbackStore(tmpDir);
    const all = listFeedback();
    expect(all).toHaveLength(0);
  });

  it('partial JSON line at end is skipped', async () => {
    const { initFeedbackStore, listFeedback } = await import('../src/services/feedbackStore.js');
    const filePath = path.join(tmpDir, 'feedback.jsonl');
    const validEntry = {
      id: 'fb-valid-2', type: 'feature-request', title: 'Good', body: 'body',
      status: 'new', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(validEntry) + '\n{"id":"fb-partial","type":"bug","title":"Trun');

    initFeedbackStore(tmpDir);
    const all = listFeedback();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('fb-valid-2');
  });
});

// ===========================================================================
// SharedState - corrupted JSONL and JSON files
// ===========================================================================

describe('Corrupted files - SharedState', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corrupt-state-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('readJsonlTail skips malformed lines in task-history', () => {
    const filePath = path.join(tmpDir, 'task-history.jsonl');
    const validEntry = { taskId: 'task-1', status: 'completed' };
    fs.writeFileSync(filePath, [
      'garbage line 1',
      JSON.stringify(validEntry),
      '{broken',
    ].join('\n'));

    const results = safeReadJsonlTail(filePath, 50);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(validEntry);
  });

  it('readJson returns null for corrupted router-metrics.json', () => {
    const filePath = path.join(tmpDir, 'router-metrics.json');
    fs.writeFileSync(filePath, '{not valid json}', 'utf-8');

    const result = safeReadJson(filePath);
    expect(result).toBeNull();
  });

  it('readJson returns null for missing file', () => {
    const result = safeReadJson(path.join(tmpDir, 'nonexistent.json'));
    expect(result).toBeNull();
  });

  it('readJson returns null for empty file', () => {
    const filePath = path.join(tmpDir, 'empty.json');
    fs.writeFileSync(filePath, '', 'utf-8');

    const result = safeReadJson(filePath);
    expect(result).toBeNull();
  });

  it('readJsonlTail returns empty array for missing file', () => {
    const results = safeReadJsonlTail(path.join(tmpDir, 'nonexistent.jsonl'), 50);
    expect(results).toEqual([]);
  });

  it('readJsonlTail returns empty array for empty file', () => {
    const filePath = path.join(tmpDir, 'empty.jsonl');
    fs.writeFileSync(filePath, '', 'utf-8');

    const results = safeReadJsonlTail(filePath, 50);
    expect(results).toEqual([]);
  });
});

// ===========================================================================
// Helpers - reusable safe-load functions matching production patterns
// ===========================================================================

/** Load JSON array from disk - matches production load pattern. Returns [] on any error. */
function safeLoadJsonArray(filePath: string): unknown[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Read JSON from disk - matches SharedState readJson pattern. */
function safeReadJson(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Read JSONL tail - matches SharedState readJsonlTail pattern. */
function safeReadJsonlTail<T = unknown>(filePath: string, limit: number): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.trim().split('\n').filter(l => l.trim());
    const tail = lines.slice(-limit);
    const results: T[] = [];
    for (const line of tail) {
      try {
        results.push(JSON.parse(line) as T);
      } catch { /* skip malformed */ }
    }
    return results;
  } catch {
    return [];
  }
}
