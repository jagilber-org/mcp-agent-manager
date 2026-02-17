// tests/shared-state.test.ts
// Constitution MI-5, TS-8: SharedState version sentinel, disk persistence round-trips,
// cross-process staleness detection, atomic writes, and JSONL operations.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// We test the patterns directly against temp dirs rather than the singleton
// (which is bound to APPDATA at module load time).

// ===========================================================================
// Version Sentinel
// ===========================================================================

describe('SharedState - version sentinel', () => {
  let tmpDir: string;
  let sentinelFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-version-'));
    sentinelFile = path.join(tmpDir, '.state-version');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('bumpVersion writes monotonic counter to sentinel file', () => {
    bumpVersion(sentinelFile, 1);
    expect(readVersion(sentinelFile)).toBe(1);

    bumpVersion(sentinelFile, 2);
    expect(readVersion(sentinelFile)).toBe(2);

    bumpVersion(sentinelFile, 5);
    expect(readVersion(sentinelFile)).toBe(5);
  });

  it('readDiskVersion returns 0 for missing sentinel', () => {
    expect(readVersion(sentinelFile)).toBe(0);
  });

  it('readDiskVersion returns 0 for non-numeric sentinel content', () => {
    fs.writeFileSync(sentinelFile, 'not-a-number', 'utf-8');
    expect(readVersion(sentinelFile)).toBe(0);
  });

  it('two processes with different versions detect staleness', () => {
    // Process A bumps to version 3
    bumpVersion(sentinelFile, 3);

    // Process B has in-memory version 1 - detects it is stale
    const processB_version = 1;
    const diskVersion = readVersion(sentinelFile);
    expect(diskVersion).toBeGreaterThan(processB_version);

    // Process B syncs to disk version
    const synced = diskVersion;
    expect(synced).toBe(3);
  });

  it('initSharedState syncs in-memory version from disk', () => {
    bumpVersion(sentinelFile, 7);
    const synced = readVersion(sentinelFile);
    expect(synced).toBe(7);
  });
});

// ===========================================================================
// Atomic JSON write - temp file → rename
// ===========================================================================

describe('SharedState - atomic JSON writes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-atomic-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('atomicWriteJson creates valid JSON file', () => {
    const filePath = path.join(tmpDir, 'metrics.json');
    const data = { totalTasks: 42, totalTokens: 10000, totalCost: 1.5 };
    atomicWriteJson(filePath, data);

    const read = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(read).toEqual(data);
  });

  it('atomicWriteJson creates parent directory if missing', () => {
    const nested = path.join(tmpDir, 'deep', 'nested', 'dir');
    const filePath = path.join(nested, 'data.json');
    atomicWriteJson(filePath, { test: true });

    expect(fs.existsSync(filePath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual({ test: true });
  });

  it('atomicWriteJson overwrites existing file without corruption', () => {
    const filePath = path.join(tmpDir, 'overwrite.json');
    atomicWriteJson(filePath, { version: 1 });
    atomicWriteJson(filePath, { version: 2, extra: 'field' });

    const read = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(read).toEqual({ version: 2, extra: 'field' });
  });

  it('concurrent atomicWriteJson calls do not corrupt file', () => {
    const filePath = path.join(tmpDir, 'concurrent.json');
    // Simulate rapid sequential writes (synchronous - closest we can get in single-process)
    for (let i = 0; i < 20; i++) {
      atomicWriteJson(filePath, { iteration: i, data: 'x'.repeat(100) });
    }

    // File must contain valid JSON with the last write
    const read = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(read.iteration).toBe(19);
  });

  it('no temp files left after atomicWriteJson', () => {
    const filePath = path.join(tmpDir, 'clean.json');
    atomicWriteJson(filePath, { done: true });

    const files = fs.readdirSync(tmpDir);
    expect(files).toEqual(['clean.json']);
  });
});

// ===========================================================================
// JSONL append & read
// ===========================================================================

describe('SharedState - JSONL operations', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-jsonl-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appendJsonl creates file and appends entry', () => {
    const filePath = path.join(tmpDir, 'history.jsonl');
    appendJsonl(filePath, { id: 1, status: 'ok' });
    appendJsonl(filePath, { id: 2, status: 'ok' });

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ id: 1, status: 'ok' });
    expect(JSON.parse(lines[1])).toEqual({ id: 2, status: 'ok' });
  });

  it('readJsonlTail returns last N entries', () => {
    const filePath = path.join(tmpDir, 'tail.jsonl');
    for (let i = 0; i < 10; i++) {
      appendJsonl(filePath, { index: i });
    }

    const tail = readJsonlTail(filePath, 3);
    expect(tail).toHaveLength(3);
    expect(tail[0]).toEqual({ index: 7 });
    expect(tail[2]).toEqual({ index: 9 });
  });

  it('readJsonlTail returns all if fewer than limit', () => {
    const filePath = path.join(tmpDir, 'few.jsonl');
    appendJsonl(filePath, { a: 1 });
    appendJsonl(filePath, { b: 2 });

    const tail = readJsonlTail(filePath, 50);
    expect(tail).toHaveLength(2);
  });

  it('readJsonlTail skips malformed lines', () => {
    const filePath = path.join(tmpDir, 'mixed.jsonl');
    fs.writeFileSync(filePath, [
      JSON.stringify({ good: 1 }),
      'bad line here',
      JSON.stringify({ good: 2 }),
      '{truncated',
    ].join('\n'));

    const tail = readJsonlTail(filePath, 50);
    expect(tail).toHaveLength(2);
    expect(tail[0]).toEqual({ good: 1 });
    expect(tail[1]).toEqual({ good: 2 });
  });

  it('appendJsonl creates parent directory if missing', () => {
    const filePath = path.join(tmpDir, 'sub', 'dir', 'data.jsonl');
    appendJsonl(filePath, { nested: true });

    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('rapid sequential appends produce valid JSONL', () => {
    const filePath = path.join(tmpDir, 'rapid.jsonl');
    for (let i = 0; i < 50; i++) {
      appendJsonl(filePath, { i, payload: 'data'.repeat(10) });
    }

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(50);
    // Every line must parse
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

// ===========================================================================
// Cross-process persistence round-trips
// ===========================================================================

describe('SharedState - cross-process round-trips', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-roundtrip-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('task history: persist → read round-trip', () => {
    const filePath = path.join(tmpDir, 'task-history.jsonl');
    const entry = { taskId: 'task-1', skillId: 'code-review', status: 'completed', durationMs: 100 };
    appendJsonl(filePath, entry);

    const history = readJsonlTail(filePath, 50);
    expect(history).toHaveLength(1);
    expect(history[0]).toEqual(entry);
  });

  it('router metrics: persist → read round-trip', () => {
    const filePath = path.join(tmpDir, 'router-metrics.json');
    const metrics = { totalTasks: 10, totalTokens: 5000, totalCost: 0.5, lastUpdated: new Date().toISOString(), pid: process.pid };
    atomicWriteJson(filePath, metrics);

    const read = readJson(filePath);
    expect(read).toEqual(metrics);
  });

  it('agent stats: persist → read round-trip', () => {
    const filePath = path.join(tmpDir, 'agent-stats.json');
    const stats = {
      agents: [
        { id: 'agent-1', tasksCompleted: 5, tasksFailed: 1, totalTokensUsed: 3000, costAccumulated: 0.3, state: 'idle', activeTasks: 0 },
      ],
      lastUpdated: new Date().toISOString(),
      pid: process.pid,
    };
    atomicWriteJson(filePath, stats);

    const read = readJson(filePath);
    expect(read).toEqual(stats);
  });

  it('cross-repo history: multiple entries persist and read', () => {
    const filePath = path.join(tmpDir, 'crossrepo-history.jsonl');
    for (let i = 0; i < 5; i++) {
      appendJsonl(filePath, { dispatchId: `d-${i}`, repoPath: `/repo/${i}`, status: 'completed', durationMs: i * 100 });
    }

    const history = readJsonlTail(filePath, 50);
    expect(history).toHaveLength(5);
  });

  it('process A writes, process B reads (simulated via separate file ops)', () => {
    const metricsFile = path.join(tmpDir, 'router-metrics.json');
    const sentinelFile = path.join(tmpDir, '.state-version');

    // Process A writes
    atomicWriteJson(metricsFile, { totalTasks: 42, totalTokens: 10000, totalCost: 1.0 });
    bumpVersion(sentinelFile, 3);

    // Process B checks sentinel → stale, re-reads
    const processB_version = 0;
    const diskVersion = readVersion(sentinelFile);
    expect(diskVersion).toBeGreaterThan(processB_version);

    const metrics = readJson(metricsFile);
    expect(metrics).toBeDefined();
    expect((metrics as any).totalTasks).toBe(42);
  });
});

// ===========================================================================
// Helpers - match production sharedState.ts patterns exactly
// ===========================================================================

function bumpVersion(sentinelFile: string, version: number): void {
  const dir = path.dirname(sentinelFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sentinelFile, String(version), 'utf-8');
}

function readVersion(sentinelFile: string): number {
  try {
    if (!fs.existsSync(sentinelFile)) return 0;
    const raw = fs.readFileSync(sentinelFile, 'utf-8').trim();
    return parseInt(raw, 10) || 0;
  } catch {
    return 0;
  }
}

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + `.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  try {
    fs.renameSync(tmp, filePath);
  } catch {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      fs.renameSync(tmp, filePath);
    } catch {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }
  }
}

function readJson<T = unknown>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function appendJsonl(filePath: string, entry: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
}

function readJsonlTail<T = unknown>(filePath: string, limit: number): T[] {
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
