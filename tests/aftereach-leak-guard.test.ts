// tests/aftereach-leak-guard.test.ts
// Constitution TS-9, DG-2, DG-4: Red-green regression test for the afterEach
// spy ordering bug that leaked test data to %APPDATA%/mcp-agent-manager/.
//
// Root cause: afterEach blocks called saveSpy.mockRestore() BEFORE cleanup,
// so unregister()/removeRule() invoked the REAL save()/persistRules(),
// writing test artifacts to production APPDATA directories.
//
// This test verifies that:
//   1. The real save() method writes to the AGENTS_FILE on disk
//   2. Spy-active cleanup (correct ordering) prevents disk writes
//   3. Restoring spy before cleanup DOES cause disk writes (proves the bug)
//
// ISOLATION: Uses AGENTS_DIR env override (vi.hoisted) to redirect all disk
// I/O to a temp directory — production APPDATA is never touched (DG-2).

import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';

// Redirect AGENTS_DIR to temp BEFORE agentRegistry module loads
vi.hoisted(() => {
  const tmp = process.env.TEMP || process.env.TMPDIR || '/tmp';
  process.env.AGENTS_DIR = tmp + '/leak-guard-test-' + process.pid;
});

import * as fs from 'fs';
import * as path from 'path';
import { agentRegistry } from '../src/services/agentRegistry.js';
import { getAgentsDir } from '../src/services/dataDir.js';
import type { AgentConfig } from '../src/types/agents.js';

const AGENTS_DIR = getAgentsDir();
const AGENTS_FILE = path.join(AGENTS_DIR, 'agents.json');

// Sentinel content that save() would never produce — proves save() overwrote it
const SENTINEL = '["SENTINEL_UNTOUCHED"]';

const testAgent: AgentConfig = {
  id: 'leak-guard-test-agent',
  name: 'Leak Guard',
  provider: 'test',
  model: 'test-model',
  transport: 'stdio',
  endpoint: '',
  maxConcurrency: 1,
  costMultiplier: 1,
  tags: ['test'],
  canMutate: false,
  timeoutMs: 5000,
};

describe('afterEach leak guard - TS-9 regression', () => {
  // Each test starts with a clean sentinel file
  beforeEach(() => {
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
    fs.writeFileSync(AGENTS_FILE, SENTINEL, 'utf-8');
  });

  // Clean up temp dir after all tests
  afterAll(() => {
    delete process.env.AGENTS_DIR;
    try { fs.rmSync(AGENTS_DIR, { recursive: true, force: true }); } catch { /* already gone */ }
  });

  it('writes to isolated temp dir, not production APPDATA', () => {
    // Verify our env override is in effect
    expect(AGENTS_DIR).toContain('leak-guard-test-');
    expect(AGENTS_FILE).not.toContain('Roaming');
    expect(fs.existsSync(AGENTS_FILE)).toBe(true);
  });

  it('real save() writes to AGENTS_FILE on disk (proves mechanism)', () => {
    // Register with REAL save() — no spy
    agentRegistry.register(testAgent);

    const afterRegister = fs.readFileSync(AGENTS_FILE, 'utf-8');

    // save() MUST have overwritten the sentinel with actual agent data
    expect(afterRegister).toContain('leak-guard-test-agent');
    expect(afterRegister).not.toBe(SENTINEL);

    // Clean up
    agentRegistry.unregister(testAgent.id);
  });

  it('WRONG order: restore spy then cleanup → writes to disk (proves the bug)', () => {
    const before = fs.readFileSync(AGENTS_FILE, 'utf-8');
    expect(before).toBe(SENTINEL);

    // Simulate the old buggy pattern
    const saveSpy = vi.spyOn(agentRegistry as any, 'save').mockImplementation(() => {});
    agentRegistry.register(testAgent);

    // ===== BUGGY ordering: restore THEN cleanup =====
    saveSpy.mockRestore();                    // real save() is live now
    agentRegistry.unregister(testAgent.id);   // calls REAL save() → writes to disk

    const after = fs.readFileSync(AGENTS_FILE, 'utf-8');

    // File MUST have been modified — the sentinel was overwritten
    expect(after).not.toBe(SENTINEL);
  });

  it('CORRECT order: cleanup then restore spy → no disk write', () => {
    const before = fs.readFileSync(AGENTS_FILE, 'utf-8');
    expect(before).toBe(SENTINEL);

    const saveSpy = vi.spyOn(agentRegistry as any, 'save').mockImplementation(() => {});
    agentRegistry.register(testAgent);

    // ===== CORRECT ordering: cleanup WHILE spy is active =====
    agentRegistry.unregister(testAgent.id); // calls mocked save() — no disk write
    saveSpy.mockRestore();

    const after = fs.readFileSync(AGENTS_FILE, 'utf-8');

    // File MUST NOT have changed — sentinel is intact
    expect(after).toBe(SENTINEL);
  });
});
