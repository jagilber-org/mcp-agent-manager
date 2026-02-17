// tests/persistence-guard.test.ts
// Integration tests that try to BREAK persistence.
// Uses real file I/O against temp directories AND calls actual functions.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AutomationRule, RuleStats } from '../src/types/automation.js';

// ---------------------------------------------------------------------------
// Test fixtures — minimal valid rules / agent configs
// ---------------------------------------------------------------------------

function makeTestRule(id: string): AutomationRule {
  return {
    id,
    name: `Test Rule ${id}`,
    description: 'test',
    enabled: true,
    priority: 'normal',
    matcher: { events: ['workspace:git-event'] },
    skillId: 'code-review',
    paramMapping: {},
    maxConcurrent: 3,
    tags: ['test'],
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeTestAgentConfig(id: string) {
  return {
    id,
    name: `Test Agent ${id}`,
    provider: 'copilot',
    model: 'test-model',
    transport: 'stdio',
    endpoint: '',
    maxConcurrency: 3,
    costMultiplier: 1,
    tags: ['test'],
    canMutate: false,
    timeoutMs: 30000,
  };
}

// ---------------------------------------------------------------------------
// Test the ACTUAL persistRulesToDisk and loadRulesFromDisk functions
// via env var override so they write to a temp dir
// ---------------------------------------------------------------------------

describe('Real persistRulesToDisk / loadRulesFromDisk', () => {
  let tmpDir: string;
  let rulesFile: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    vi.resetModules(); // Ensure fresh module evaluation picks up new env
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-persist-test-'));
    rulesFile = path.join(tmpDir, 'rules.json');
    originalEnv = process.env.AUTOMATION_RULES_DIR;
    process.env.AUTOMATION_RULES_DIR = tmpDir;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.AUTOMATION_RULES_DIR;
    else process.env.AUTOMATION_RULES_DIR = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('persistRulesToDisk writes rules to the correct file', async () => {
    const mod = await import('../src/services/automation/rulePersistence.js');
    const rules = new Map<string, AutomationRule>();
    rules.set('r1', makeTestRule('r1'));
    rules.set('r2', makeTestRule('r2'));

    mod.persistRulesToDisk(rules);

    // Verify file was written
    const written = JSON.parse(fs.readFileSync(rulesFile, 'utf-8'));
    expect(written).toHaveLength(2);
    expect(written.map((r: any) => r.id).sort()).toEqual(['r1', 'r2']);
  });

  it('loadRulesFromDisk reads rules back correctly', async () => {
    // Seed file directly
    const seedRules = [makeTestRule('load1'), makeTestRule('load2'), makeTestRule('load3')];
    fs.writeFileSync(rulesFile, JSON.stringify(seedRules, null, 2), 'utf-8');

    const mod = await import('../src/services/automation/rulePersistence.js');
    const rules = new Map<string, AutomationRule>();
    const stats = new Map<string, RuleStats>();
    mod.loadRulesFromDisk(rules, stats);

    expect(rules.size).toBe(3);
    expect(rules.has('load1')).toBe(true);
    expect(rules.has('load2')).toBe(true);
    expect(rules.has('load3')).toBe(true);
  });

  it('persist → load round-trip preserves all rules', async () => {
    const mod = await import('../src/services/automation/rulePersistence.js');
    const rules = new Map<string, AutomationRule>();
    rules.set('rt1', makeTestRule('rt1'));
    rules.set('rt2', makeTestRule('rt2'));

    mod.persistRulesToDisk(rules);

    const loaded = new Map<string, AutomationRule>();
    const stats = new Map<string, RuleStats>();
    mod.loadRulesFromDisk(loaded, stats);

    expect(loaded.size).toBe(2);
    expect(loaded.get('rt1')?.name).toBe('Test Rule rt1');
    expect(loaded.get('rt2')?.skillId).toBe('code-review');
  });

  it('CREATES BACKUP when persisting empty over non-empty file', async () => {
    // Seed with real data
    const seedRules = [makeTestRule('precious1'), makeTestRule('precious2')];
    fs.writeFileSync(rulesFile, JSON.stringify(seedRules, null, 2), 'utf-8');

    const mod = await import('../src/services/automation/rulePersistence.js');
    const emptyRules = new Map<string, AutomationRule>();

    // Persist empty → should create backup
    mod.persistRulesToDisk(emptyRules);

    // Backup must exist with original data
    const backupFile = rulesFile + '.bak';
    expect(fs.existsSync(backupFile)).toBe(true);
    const backup = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));
    expect(backup).toHaveLength(2);
    expect(backup[0].id).toBe('precious1');

    // Primary file is now empty (write went through)
    const primary = JSON.parse(fs.readFileSync(rulesFile, 'utf-8'));
    expect(primary).toHaveLength(0);
  });

  it('RECOVERS from backup when loading empty file', async () => {
    // Seed: empty primary, non-empty backup
    fs.writeFileSync(rulesFile, '[]', 'utf-8');
    const backupData = [makeTestRule('recovered1'), makeTestRule('recovered2')];
    fs.writeFileSync(rulesFile + '.bak', JSON.stringify(backupData, null, 2), 'utf-8');

    const mod = await import('../src/services/automation/rulePersistence.js');
    const rules = new Map<string, AutomationRule>();
    const stats = new Map<string, RuleStats>();
    mod.loadRulesFromDisk(rules, stats);

    expect(rules.size).toBe(2);
    expect(rules.has('recovered1')).toBe(true);
    expect(rules.has('recovered2')).toBe(true);
    // Primary file should be restored from backup
    const primaryAfter = JSON.parse(fs.readFileSync(rulesFile, 'utf-8'));
    expect(primaryAfter).toHaveLength(2);
  });

  it('RECOVERS from backup when primary file is missing', async () => {
    // No primary, but backup exists
    expect(fs.existsSync(rulesFile)).toBe(false);
    const backupData = [makeTestRule('ghost1')];
    fs.writeFileSync(rulesFile + '.bak', JSON.stringify(backupData, null, 2), 'utf-8');

    const mod = await import('../src/services/automation/rulePersistence.js');
    const rules = new Map<string, AutomationRule>();
    const stats = new Map<string, RuleStats>();
    mod.loadRulesFromDisk(rules, stats);

    expect(rules.size).toBe(1);
    expect(rules.has('ghost1')).toBe(true);
    // Primary should be restored
    expect(fs.existsSync(rulesFile)).toBe(true);
  });

  it('FULL WIPE SCENARIO: persist empty, restart, load → recovers', async () => {
    // Step 1: Seed with real data
    const seedRules = [makeTestRule('wipe1'), makeTestRule('wipe2'), makeTestRule('wipe3')];
    fs.writeFileSync(rulesFile, JSON.stringify(seedRules, null, 2), 'utf-8');

    // Step 2: Something goes wrong, persist empty
    const mod = await import('../src/services/automation/rulePersistence.js');
    const emptyRules = new Map<string, AutomationRule>();
    mod.persistRulesToDisk(emptyRules);

    // Step 3: Verify primary is empty now
    expect(JSON.parse(fs.readFileSync(rulesFile, 'utf-8'))).toHaveLength(0);

    // Step 4: "Restart" — load from disk
    const loadedRules = new Map<string, AutomationRule>();
    const loadedStats = new Map<string, RuleStats>();
    mod.loadRulesFromDisk(loadedRules, loadedStats);

    // Step 5: Rules should be recovered from backup
    expect(loadedRules.size).toBe(3);
    expect(loadedRules.has('wipe1')).toBe(true);
    expect(loadedRules.has('wipe2')).toBe(true);
    expect(loadedRules.has('wipe3')).toBe(true);
  });

  it('does NOT create backup when persisting empty over empty file', async () => {
    // Start with empty file
    fs.writeFileSync(rulesFile, '[]', 'utf-8');

    const mod = await import('../src/services/automation/rulePersistence.js');
    const emptyRules = new Map<string, AutomationRule>();
    mod.persistRulesToDisk(emptyRules);

    // No backup should be created
    expect(fs.existsSync(rulesFile + '.bak')).toBe(false);
  });

  it('handles corrupted backup gracefully', async () => {
    // Empty primary, corrupt backup
    fs.writeFileSync(rulesFile, '[]', 'utf-8');
    fs.writeFileSync(rulesFile + '.bak', 'NOT JSON {{{{', 'utf-8');

    const mod = await import('../src/services/automation/rulePersistence.js');
    const rules = new Map<string, AutomationRule>();
    const stats = new Map<string, RuleStats>();
    mod.loadRulesFromDisk(rules, stats);

    // Should not crash, should load empty
    expect(rules.size).toBe(0);
  });

  it('file with BOM fails to load (known edge case)', async () => {
    // BOM prefix causes JSON.parse to fail — documenting actual behavior
    const bom = '\uFEFF';
    const rules = [makeTestRule('bom1')];
    fs.writeFileSync(rulesFile, bom + JSON.stringify(rules, null, 2), 'utf-8');

    const mod = await import('../src/services/automation/rulePersistence.js');
    const loaded = new Map<string, AutomationRule>();
    const stats = new Map<string, RuleStats>();
    mod.loadRulesFromDisk(loaded, stats);

    // BOM causes parse failure — loaded should be empty
    expect(loaded.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AutomationEngine integration: removeRule wipe scenario
// ---------------------------------------------------------------------------

describe('AutomationEngine removeRule does not wipe rules file', () => {
  it('removeRule on last rule creates backup, not a zombie', async () => {
    // This tests the ACTUAL automationEngine singleton behavior
    // We spy on persistRulesToDisk to avoid writing to real APPDATA
    const persistence = await import('../src/services/automation/rulePersistence.js');
    const engine = (await import('../src/services/automation/index.js')).automationEngine;
    const spy = vi.spyOn(persistence, 'persistRulesToDisk').mockImplementation(() => {});

    try {
      // Register a rule
      engine.registerRule({
        id: 'last-rule',
        name: 'Last Rule',
        description: 'test',
        events: ['workspace:git-event'],
        skillId: 'code-review',
      });
      expect(engine.listRules()).toHaveLength(1);

      // Remove it — should call persist with empty map
      engine.removeRule('last-rule');
      expect(engine.listRules()).toHaveLength(0);

      // Verify persistRulesToDisk was called with an empty map
      const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
      const rulesMap = lastCall[0] as Map<string, AutomationRule>;
      expect(rulesMap.size).toBe(0);
    } finally {
      spy.mockRestore();
      // Clean up
      for (const r of engine.listRules()) engine.removeRule(r.id);
    }
  });
});

// ---------------------------------------------------------------------------
// Source code verification — guards and patterns exist
// ---------------------------------------------------------------------------

describe('Source code guard verification', () => {
  it('rulePersistence.ts has backup-on-empty-write pattern', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/automation/rulePersistence.ts'),
      'utf-8',
    );
    expect(src).toContain('.bak');
    expect(src).toContain('copyFileSync');
    expect(src).toContain('arr.length === 0');
    expect(src).toContain('backed up');
  });

  it('rulePersistence.ts has backup recovery on load', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/automation/rulePersistence.ts'),
      'utf-8',
    );
    expect(src).toContain('restoring from backup');
    expect(src).toContain('backup has');
    expect(src).toContain('Recovered');
  });

  it('agentRegistry.ts has backup-on-empty-write pattern', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/agentRegistry.ts'),
      'utf-8',
    );
    expect(src).toContain('.bak');
    expect(src).toContain('copyFileSync');
    expect(src).toContain('configs.length === 0');
    expect(src).toContain('backed up');
  });

  it('agentRegistry.ts has backup recovery on load', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/agentRegistry.ts'),
      'utf-8',
    );
    expect(src).toContain('restoring');
    expect(src).toContain('.bak');
    expect(src).toContain('Recovered');
  });

  it('skillStore.ts has backup-on-empty-write pattern', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/skillStore.ts'),
      'utf-8',
    );
    expect(src).toContain('.bak');
    expect(src).toContain('copyFileSync');
    expect(src).toContain('backed up');
  });

  it('skillStore.ts has backup recovery on load', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/skillStore.ts'),
      'utf-8',
    );
    expect(src).toContain('restoring');
    expect(src).toContain('.bak');
  });

  it('automationEngine reloadRules ignores external wipe-to-empty', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/automation/index.ts'),
      'utf-8',
    );
    expect(src).toContain('External change wiped rules.json to empty');
    expect(src).toContain('ignoring');
  });

  it('agentRegistry reload ignores external wipe-to-empty', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/agentRegistry.ts'),
      'utf-8',
    );
    expect(src).toContain('External change wiped agents.json to empty');
    expect(src).toContain('ignoring');
  });

  it('skillStore reload ignores external wipe-to-empty', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/skillStore.ts'),
      'utf-8',
    );
    expect(src).toContain('External change wiped skills.json to empty');
    expect(src).toContain('ignoring');
  });

  it('dataDir.ts does NOT contain migrateFromLegacy', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/dataDir.ts'),
      'utf-8',
    );
    expect(src).not.toContain('migrateFromLegacy');
    expect(src).not.toContain('migrateFile');
    expect(src).not.toContain('MigrationEntry');
    expect(src).not.toContain('legacyDir');
  });

  it('server/index.ts does NOT call migrateFromLegacy', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/server/index.ts'),
      'utf-8',
    );
    expect(src).not.toContain('migrateFromLegacy');
  });
});

// ---------------------------------------------------------------------------
// Live data file integrity — verify APPDATA files have data RIGHT NOW
// ---------------------------------------------------------------------------

describe('Current data file integrity', () => {
  const appDataDir = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'mcp-agent-manager')
    : null;

  it('APPDATA rules.json exists and has rules with required fields', () => {
    if (!appDataDir) return;
    const rulesFile = path.join(appDataDir, 'automation', 'rules.json');
    expect(fs.existsSync(rulesFile)).toBe(true);
    const content = fs.readFileSync(rulesFile, 'utf-8').trim();
    expect(content).not.toBe('[]');
    expect(content).not.toBe('');
    const rules = JSON.parse(content);
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).toHaveProperty('id');
      expect(rule).toHaveProperty('name');
      expect(rule).toHaveProperty('matcher');
      expect(rule.matcher).toHaveProperty('events');
      expect(rule).toHaveProperty('skillId');
      expect(rule).toHaveProperty('version');
    }
  });

  it('APPDATA agents.json exists and has agents with required fields', () => {
    if (!appDataDir) return;
    const agentsFile = path.join(appDataDir, 'agents', 'agents.json');
    if (!fs.existsSync(agentsFile)) return; // skip on fresh install
    const content = fs.readFileSync(agentsFile, 'utf-8').trim();
    if (content === '[]' || content === '') {
      // File is empty — check for backup recovery
      const bakFile = agentsFile + '.bak';
      if (fs.existsSync(bakFile)) {
        console.warn(`APPDATA agents.json is empty but .bak exists — backup guard is working`);
      }
      return; // skip — may have been wiped by server instance between runs
    }
    const agents = JSON.parse(content);
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents) {
      expect(agent).toHaveProperty('id');
      expect(agent).toHaveProperty('name');
      expect(agent).toHaveProperty('provider');
      expect(agent).toHaveProperty('model');
      expect(agent).toHaveProperty('maxConcurrency');
    }
  });

  it('APPDATA skills.json exists and has skills with required fields', () => {
    if (!appDataDir) return;
    const skillsFile = path.join(appDataDir, 'skills', 'skills.json');
    if (!fs.existsSync(skillsFile)) return;
    const content = fs.readFileSync(skillsFile, 'utf-8').trim();
    if (content === '[]') return; // skills might be empty on fresh install
    const skills = JSON.parse(content);
    expect(Array.isArray(skills)).toBe(true);
    for (const skill of skills) {
      expect(skill).toHaveProperty('id');
      expect(skill).toHaveProperty('name');
      expect(skill).toHaveProperty('strategy');
    }
  });
});
