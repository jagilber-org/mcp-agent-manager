// tests/workspace-history.test.ts
// WorkspaceHistory - persistence layer tests: add, get, filter, clear, pagination.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type MockInstance } from 'vitest';
import { workspaceHistory, type WorkspaceHistoryEntry } from '../src/services/workspace/history.js';

// Prevent disk writes
let persistSpy: MockInstance;
beforeAll(() => {
  persistSpy = vi.spyOn(workspaceHistory as any, 'persist').mockImplementation(() => {});
});
afterAll(() => { persistSpy.mockRestore(); });
beforeEach(() => {
  // Clear internal state
  (workspaceHistory as any).entries = [];
  (workspaceHistory as any).loaded = true;
});

// Helper: create a fake MonitoredWorkspace-like object
function fakeWs(path: string, opts: { sessions?: string[]; gitEvents?: any[]; changes?: any[]; startedMs?: number } = {}): any {
  return {
    path,
    startedAt: new Date(Date.now() - (opts.startedMs ?? 60000)),
    knownSessions: opts.sessions ?? ['session-1', 'session-2'],
    gitEvents: opts.gitEvents ?? [{ event: 'commit', detail: 'fix: typo' }],
    recentChanges: opts.changes ?? [{ kind: 'change', file: 'README.md' }],
  };
}

// ---------------------------------------------------------------------------
// Basic operations
// ---------------------------------------------------------------------------

describe('WorkspaceHistory - basic operations', () => {
  it('initializes empty', () => {
    const entries = workspaceHistory.getHistory();
    expect(entries).toEqual([]);
    expect(workspaceHistory.getCount()).toBe(0);
  });

  it('addEntry stores entry with correct fields', () => {
    const entry = workspaceHistory.addEntry(fakeWs('/test/project'), 'manual');

    expect(entry.path).toBe('/test/project');
    expect(entry.startedAt).toBeDefined();
    expect(entry.stoppedAt).toBeDefined();
    expect(typeof entry.durationMs).toBe('number');
    expect(entry.durationMs).toBeGreaterThan(0);
    expect(entry.sessionCount).toBe(2);
    expect(entry.gitEvents).toBe(1);
    expect(entry.fileChanges).toBe(1);
    expect(entry.lastGitEvent).toBe('fix: typo');
    expect(entry.sessionsDiscovered).toEqual(['session-1', 'session-2']);
    expect(entry.reason).toBe('manual');
  });

  it('addEntry persists to disk (spy called)', () => {
    workspaceHistory.addEntry(fakeWs('/persist-test'), 'manual');
    expect(persistSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getHistory - sorting, filtering, pagination
// ---------------------------------------------------------------------------

describe('WorkspaceHistory - getHistory', () => {
  it('returns entries sorted by stoppedAt descending', () => {
    // Add entries with different delays to ensure different stoppedAt
    workspaceHistory.addEntry(fakeWs('/first', { startedMs: 3000 }), 'manual');
    // Nudge time forward
    const entry2 = workspaceHistory.addEntry(fakeWs('/second', { startedMs: 1000 }), 'manual');

    const history = workspaceHistory.getHistory();
    expect(history.length).toBe(2);
    // Most recent stoppedAt first (second was added later)
    const t0 = new Date(history[0].stoppedAt).getTime();
    const t1 = new Date(history[1].stoppedAt).getTime();
    expect(t0).toBeGreaterThanOrEqual(t1);
  });

  it('filters by workspace path', () => {
    workspaceHistory.addEntry(fakeWs('/alpha'), 'manual');
    workspaceHistory.addEntry(fakeWs('/beta'), 'shutdown');
    workspaceHistory.addEntry(fakeWs('/alpha'), 'manual');

    const alphaHistory = workspaceHistory.getHistory({ path: '/alpha' });
    expect(alphaHistory.length).toBe(2);
    alphaHistory.forEach(e => expect(e.path).toBe('/alpha'));
  });

  it('supports limit and offset pagination', () => {
    for (let i = 0; i < 5; i++) {
      workspaceHistory.addEntry(fakeWs(`/project-${i}`), 'manual');
    }
    expect(workspaceHistory.getCount()).toBe(5);

    const page1 = workspaceHistory.getHistory({ limit: 2, offset: 0 });
    expect(page1.length).toBe(2);

    const page2 = workspaceHistory.getHistory({ limit: 2, offset: 2 });
    expect(page2.length).toBe(2);

    const page3 = workspaceHistory.getHistory({ limit: 2, offset: 4 });
    expect(page3.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getCount
// ---------------------------------------------------------------------------

describe('WorkspaceHistory - getCount', () => {
  it('returns total count', () => {
    workspaceHistory.addEntry(fakeWs('/a'), 'manual');
    workspaceHistory.addEntry(fakeWs('/b'), 'shutdown');
    expect(workspaceHistory.getCount()).toBe(2);
  });

  it('returns filtered count by path', () => {
    workspaceHistory.addEntry(fakeWs('/a'), 'manual');
    workspaceHistory.addEntry(fakeWs('/b'), 'shutdown');
    workspaceHistory.addEntry(fakeWs('/a'), 'error');
    expect(workspaceHistory.getCount('/a')).toBe(2);
    expect(workspaceHistory.getCount('/b')).toBe(1);
    expect(workspaceHistory.getCount('/c')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// clearHistory
// ---------------------------------------------------------------------------

describe('WorkspaceHistory - clearHistory', () => {
  it('clears entries for a specific path, preserves others', () => {
    workspaceHistory.addEntry(fakeWs('/keep'), 'manual');
    workspaceHistory.addEntry(fakeWs('/remove'), 'manual');
    workspaceHistory.addEntry(fakeWs('/remove'), 'shutdown');

    const removed = workspaceHistory.clearHistory('/remove');
    expect(removed).toBe(2);
    expect(workspaceHistory.getCount()).toBe(1);
    expect(workspaceHistory.getHistory()[0].path).toBe('/keep');
  });

  it('clears all when no path specified', () => {
    workspaceHistory.addEntry(fakeWs('/a'), 'manual');
    workspaceHistory.addEntry(fakeWs('/b'), 'manual');

    const removed = workspaceHistory.clearHistory();
    expect(removed).toBe(2);
    expect(workspaceHistory.getCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Entry field validation
// ---------------------------------------------------------------------------

describe('WorkspaceHistory - entry fields', () => {
  it('all required fields present and correct types', () => {
    const entry = workspaceHistory.addEntry(fakeWs('/field-test', {
      sessions: ['s1', 's2', 's3'],
      gitEvents: [
        { event: 'commit', detail: 'first' },
        { event: 'push', detail: 'second' },
      ],
      changes: [{ kind: 'add', file: 'a.ts' }, { kind: 'change', file: 'b.ts' }],
    }), 'shutdown');

    expect(typeof entry.path).toBe('string');
    expect(typeof entry.startedAt).toBe('string');
    expect(typeof entry.stoppedAt).toBe('string');
    expect(typeof entry.durationMs).toBe('number');
    expect(typeof entry.sessionCount).toBe('number');
    expect(typeof entry.gitEvents).toBe('number');
    expect(typeof entry.fileChanges).toBe('number');
    expect(typeof entry.reason).toBe('string');
    expect(Array.isArray(entry.sessionsDiscovered)).toBe(true);

    expect(entry.sessionCount).toBe(3);
    expect(entry.gitEvents).toBe(2);
    expect(entry.fileChanges).toBe(2);
    expect(entry.lastGitEvent).toBe('second');
    expect(entry.reason).toBe('shutdown');
  });
});
