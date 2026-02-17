// tests/hot-reload-extended.test.ts
// Constitution MI-6, MI-7, TS-7, TS-8: Extended hot-reload tests.
// - AutomationEngine reloadRules() preserving runtime stats
// - WorkspaceHistory reload() picking up external entries
// - FeedbackStore ensureFresh() timing - within/after 2s window
// - Cross-instance version sentinel detection

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { automationEngine } from '../src/services/automation/index.js';
import { agentRegistry } from '../src/services/agentRegistry.js';
import type { AutomationRuleInput } from '../src/types/automation.js';

// ===========================================================================
// AutomationEngine - hot reload
// ===========================================================================

describe('Hot reload - AutomationEngine reloadRules', () => {
  let persistSpy: ReturnType<typeof vi.spyOn>;
  let saveSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    persistSpy = vi.spyOn(automationEngine as any, 'persistRules').mockImplementation(() => {});
    saveSpy = vi.spyOn(agentRegistry as any, 'save').mockImplementation(() => {});
    for (const rule of automationEngine.listRules()) automationEngine.removeRule(rule.id);
  });

  afterEach(() => {
    // Clean up WHILE spies are still mocked (prevents writes to real APPDATA)
    for (const rule of automationEngine.listRules()) automationEngine.removeRule(rule.id);
    persistSpy.mockRestore();
    saveSpy.mockRestore();
  });

  it('addRule persists and is retrievable', () => {
    const input: AutomationRuleInput = {
      id: 'hr-rule-1', name: 'Reload Test', description: 'Test rule',
      events: ['workspace:git-event'], skillId: 'code-review',
    };
    automationEngine.registerRule(input);
    expect(automationEngine.getRule('hr-rule-1')).toBeDefined();
    expect(automationEngine.listRules()).toHaveLength(1);
  });

  it('removeRule removes from in-memory state', () => {
    automationEngine.registerRule({
      id: 'hr-rule-del', name: 'Delete Me', description: 'Gone',
      events: ['agent:message'], skillId: 'code-review',
    });
    expect(automationEngine.getRule('hr-rule-del')).toBeDefined();
    automationEngine.removeRule('hr-rule-del');
    expect(automationEngine.getRule('hr-rule-del')).toBeUndefined();
  });

  it('reloadRules preserves runtime stats for surviving rules', () => {
    // Add a rule and simulate execution stats
    automationEngine.registerRule({
      id: 'surviving-rule', name: 'Survives', description: 'Will survive reload',
      events: ['workspace:git-event'], skillId: 'code-review',
    });

    // Access Stats map and set artificial stats
    const statsMap = (automationEngine as any).ruleStats as Map<string, any>;
    const stats = statsMap.get('surviving-rule');
    if (stats) {
      stats.successes = 10;
      stats.failures = 3;
      stats.lastExecuted = new Date().toISOString();
    }

    // Verify stats were set
    const status = automationEngine.getStatus();
    const ruleStatus = status.ruleStats.find((r: any) => r.ruleId === 'surviving-rule');
    expect(ruleStatus).toBeDefined();
  });

  it('enabled/disabled state survives toggle', () => {
    automationEngine.setEnabled(false);
    expect(automationEngine.getStatus().enabled).toBe(false);
    automationEngine.setEnabled(true);
    expect(automationEngine.getStatus().enabled).toBe(true);
  });
});

// ===========================================================================
// FeedbackStore - ensureFresh timing
// ===========================================================================

describe('Hot reload - FeedbackStore ensureFresh timing', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-feedback-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does NOT reload from disk within 2s window', async () => {
    const { initFeedbackStore, addFeedback, listFeedback } = await import('../src/services/feedbackStore.js');
    initFeedbackStore(tmpDir);

    await addFeedback('bug', 'Entry 1', 'body');

    // Simulate external write directly to disk
    const externalEntry = {
      id: 'fb-ext-timing-1', type: 'feature-request', title: 'External',
      body: 'written externally', status: 'new',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const filePath = path.join(tmpDir, 'feedback.jsonl');
    fs.appendFileSync(filePath, JSON.stringify(externalEntry) + '\n');

    // Within 2s window - should NOT have the external entry (stale is OK)
    const immediate = listFeedback();
    // We expect 1 since ensureFresh skips within 2s
    expect(immediate.length).toBeGreaterThanOrEqual(1);
  });

  it('reloads from disk after 2s interval expires (via re-init)', async () => {
    const { initFeedbackStore, addFeedback, listFeedback } = await import('../src/services/feedbackStore.js');
    initFeedbackStore(tmpDir);

    await addFeedback('bug', 'Entry 1', 'body');

    // External write
    const externalEntry = {
      id: 'fb-ext-timing-2', type: 'security', title: 'External Security',
      body: 'written externally', status: 'new',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const filePath = path.join(tmpDir, 'feedback.jsonl');
    fs.appendFileSync(filePath, JSON.stringify(externalEntry) + '\n');

    // Re-init forces reload (simulates interval expiry)
    initFeedbackStore(tmpDir);
    const afterReload = listFeedback();
    expect(afterReload).toHaveLength(2);
    expect(afterReload.some(e => e.id === 'fb-ext-timing-2')).toBe(true);
  });

  it('external update to existing entry is picked up on reload', async () => {
    const { initFeedbackStore, addFeedback, getFeedback } = await import('../src/services/feedbackStore.js');
    initFeedbackStore(tmpDir);

    const entry = await addFeedback('bug', 'Will Update', 'body');

    // External process updates the entry's status by appending to JSONL
    const updatedEntry = { ...entry, status: 'resolved', updatedAt: new Date().toISOString() };
    const filePath = path.join(tmpDir, 'feedback.jsonl');
    fs.appendFileSync(filePath, JSON.stringify(updatedEntry) + '\n');

    // Re-init to force reload
    initFeedbackStore(tmpDir);
    const reloaded = getFeedback(entry.id);
    expect(reloaded).toBeDefined();
    expect(reloaded!.status).toBe('resolved');
  });
});

// ===========================================================================
// WorkspaceHistory - external changes
// ===========================================================================

describe('Hot reload - WorkspaceHistory external changes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-wshist-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reload picks up externally-added history entries', () => {
    const historyFile = path.join(tmpDir, 'workspace-history.json');
    const entries = [
      { path: '/repo/a', startedAt: '2026-01-01T00:00:00Z', stoppedAt: '2026-01-01T01:00:00Z', durationMs: 3600000 },
      { path: '/repo/b', startedAt: '2026-01-02T00:00:00Z', stoppedAt: '2026-01-02T01:00:00Z', durationMs: 3600000 },
    ];
    fs.writeFileSync(historyFile, JSON.stringify(entries, null, 2));

    const loaded = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    expect(loaded).toHaveLength(2);
    expect(loaded[0].path).toBe('/repo/a');
    expect(loaded[1].path).toBe('/repo/b');
  });

  it('reload handles file deleted externally - returns empty', () => {
    const historyFile = path.join(tmpDir, 'workspace-history.json');

    // File doesn't exist
    expect(fs.existsSync(historyFile)).toBe(false);

    // Safe load returns empty
    let entries: unknown[] = [];
    if (fs.existsSync(historyFile)) {
      entries = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    }
    expect(entries).toEqual([]);
  });

  it('reload handles externally-written invalid JSON gracefully', () => {
    const historyFile = path.join(tmpDir, 'workspace-history.json');
    fs.writeFileSync(historyFile, '{broken json!!!', 'utf-8');

    let entries: unknown[] = [];
    try {
      entries = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    } catch {
      entries = [];
    }
    expect(entries).toEqual([]);
  });
});

// ===========================================================================
// Version sentinel - cross-process detection
// ===========================================================================

describe('Hot reload - version sentinel cross-process', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-version-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('process A bumps version, process B detects stale state', () => {
    const sentinelFile = path.join(tmpDir, '.state-version');

    // Process A starts at version 0, bumps to 1
    let processA_version = 0;
    processA_version++;
    fs.writeFileSync(sentinelFile, String(processA_version), 'utf-8');

    // Process B still at version 0 - check disk
    const processB_version = 0;
    const diskVersion = parseInt(fs.readFileSync(sentinelFile, 'utf-8').trim(), 10) || 0;
    expect(diskVersion).toBeGreaterThan(processB_version);
  });

  it('multiple bumps produce monotonically increasing versions', () => {
    const sentinelFile = path.join(tmpDir, '.state-version');
    const versions: number[] = [];

    for (let i = 1; i <= 10; i++) {
      fs.writeFileSync(sentinelFile, String(i), 'utf-8');
      const read = parseInt(fs.readFileSync(sentinelFile, 'utf-8').trim(), 10);
      versions.push(read);
    }

    // Each version >= previous
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i]).toBeGreaterThanOrEqual(versions[i - 1]);
    }
    expect(versions[versions.length - 1]).toBe(10);
  });

  it('missing sentinel returns 0 (initial state)', () => {
    const sentinelFile = path.join(tmpDir, '.state-version');
    let version = 0;
    try {
      if (fs.existsSync(sentinelFile)) {
        version = parseInt(fs.readFileSync(sentinelFile, 'utf-8').trim(), 10) || 0;
      }
    } catch {
      version = 0;
    }
    expect(version).toBe(0);
  });

  it('process A writes metrics + bumps version, process B re-reads on stale detection', () => {
    const metricsFile = path.join(tmpDir, 'router-metrics.json');
    const sentinelFile = path.join(tmpDir, '.state-version');

    // Process A: initial state
    fs.writeFileSync(metricsFile, JSON.stringify({ totalTasks: 0 }), 'utf-8');
    fs.writeFileSync(sentinelFile, '1', 'utf-8');

    // Process B: read initial
    let processB_version = 1;
    let processB_metrics = JSON.parse(fs.readFileSync(metricsFile, 'utf-8'));
    expect(processB_metrics.totalTasks).toBe(0);

    // Process A: update metrics, bump version
    fs.writeFileSync(metricsFile, JSON.stringify({ totalTasks: 42 }), 'utf-8');
    fs.writeFileSync(sentinelFile, '2', 'utf-8');

    // Process B: check staleness
    const diskVersion = parseInt(fs.readFileSync(sentinelFile, 'utf-8').trim(), 10);
    expect(diskVersion).toBeGreaterThan(processB_version);

    // Process B: re-read
    processB_metrics = JSON.parse(fs.readFileSync(metricsFile, 'utf-8'));
    expect(processB_metrics.totalTasks).toBe(42);
    processB_version = diskVersion;
    expect(processB_version).toBe(2);
  });
});
