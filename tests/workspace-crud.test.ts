// tests/workspace-crud.test.ts
// Workspace MCP tool CRUD tests - service-level tests for monitor, get, history.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type MockInstance } from 'vitest';
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
  // Clear all monitors
  workspaceMonitor.stopAll(true);
  // Clear workspace history
  workspaceHistory.clearHistory();
});

// ---------------------------------------------------------------------------
// mgr_get_workspace - get detailed status
// ---------------------------------------------------------------------------

describe('mgr_get_workspace - single workspace detail', () => {
  it('returns detailed status for monitored path', () => {
    // Use cwd as a real existing path
    const testPath = process.cwd();
    workspaceMonitor.start(testPath);

    const detail = workspaceMonitor.getDetail(testPath) as any;
    expect(detail).toBeDefined();
    expect(detail.path).toBe(testPath);
    expect(detail.startedAt).toBeDefined();
    expect(typeof detail.sessionCount).toBe('number');
    expect(typeof detail.watcherCount).toBe('number');
    expect(Array.isArray(detail.gitEvents)).toBe(true);

    workspaceMonitor.stop(testPath, true);
  });

  it('returns undefined for unmonitored path', () => {
    const detail = workspaceMonitor.getDetail('/some/fake/path/that/does/not/exist');
    expect(detail).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// start + get round-trip
// ---------------------------------------------------------------------------

describe('workspace start + get round-trip', () => {
  it('start monitoring, read back, status matches', () => {
    const testPath = process.cwd();
    const ws = workspaceMonitor.start(testPath);
    expect(ws.path).toBe(testPath);

    const detail = workspaceMonitor.getDetail(testPath) as any;
    expect(detail).toBeDefined();
    expect(detail.path).toBe(testPath);
    expect(detail.monitoringMs).toBeGreaterThanOrEqual(0);

    workspaceMonitor.stop(testPath, true);
  });
});

// ---------------------------------------------------------------------------
// stop + get confirms removal
// ---------------------------------------------------------------------------

describe('workspace stop + get confirms removal', () => {
  it('stop returns true, get returns undefined', () => {
    const testPath = process.cwd();
    workspaceMonitor.start(testPath);

    const stopped = workspaceMonitor.stop(testPath, true);
    expect(stopped).toBe(true);

    const detail = workspaceMonitor.getDetail(testPath);
    expect(detail).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// History recording on stop
// ---------------------------------------------------------------------------

describe('mgr_list_workspace_history - history recording', () => {
  it('history entry recorded on stop with reason manual', () => {
    const testPath = process.cwd();
    workspaceMonitor.start(testPath);

    // Stop with manual reason (default when skipPersist=false)
    workspaceMonitor.stop(testPath);

    const entries = workspaceHistory.getHistory({});
    expect(entries.length).toBe(1);
    expect(entries[0].path).toBe(testPath);
    expect(entries[0].reason).toBe('manual');
    expect(entries[0].startedAt).toBeDefined();
    expect(entries[0].stoppedAt).toBeDefined();
  });

  it('history entry recorded on shutdown stop', () => {
    const testPath = process.cwd();
    workspaceMonitor.start(testPath);

    // Stop with skipPersist=true means reason='shutdown'
    workspaceMonitor.stop(testPath, true);

    const entries = workspaceHistory.getHistory({});
    expect(entries.length).toBe(1);
    expect(entries[0].reason).toBe('shutdown');
  });

  it('history accumulates across multiple start/stop cycles', () => {
    const testPath = process.cwd();
    for (let i = 0; i < 3; i++) {
      workspaceMonitor.start(testPath);
      workspaceMonitor.stop(testPath, true);
    }

    const entries = workspaceHistory.getHistory({ path: testPath });
    expect(entries.length).toBe(3);
  });

  it('history entry contains non-negative stats', () => {
    const testPath = process.cwd();
    workspaceMonitor.start(testPath);
    workspaceMonitor.stop(testPath, true);

    const entry = workspaceHistory.getHistory({})[0];
    expect(entry.sessionCount).toBeGreaterThanOrEqual(0);
    expect(entry.gitEvents).toBeGreaterThanOrEqual(0);
    expect(entry.fileChanges).toBeGreaterThanOrEqual(0);
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns empty array when no history', () => {
    const entries = workspaceHistory.getHistory({});
    expect(entries).toEqual([]);
    expect(workspaceHistory.getCount()).toBe(0);
  });
});
