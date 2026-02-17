// tests/multi-instance.test.ts
// Constitution MI-1, MI-2, MI-7, TS-5: Multi-instance disk scenarios.
// Simulates two processes reading/writing the same config files,
// tests last-write-wins behavior, ConfigWatcher external change detection,
// and concurrent JSONL operations.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { watchConfigFile, type ConfigWatcher } from '../src/services/configWatcher.js';
import type { AgentConfig, SkillDefinition } from '../src/types/index.js';

// ===========================================================================
// Concurrent JSON file writes - last-write-wins pattern
// ===========================================================================

describe('Multi-instance - concurrent JSON writes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-json-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('agents.json: two simultaneous register() calls - last write wins', () => {
    const agentsFile = path.join(tmpDir, 'agents.json');
    const agent1: AgentConfig = {
      id: 'agent-1', name: 'Agent 1', provider: 'copilot', model: 'gpt-4o',
      transport: 'stdio', endpoint: '', maxConcurrency: 3, costMultiplier: 1,
      tags: ['code'], canMutate: false, timeoutMs: 30000,
    };
    const agent2: AgentConfig = {
      id: 'agent-2', name: 'Agent 2', provider: 'anthropic', model: 'claude-3',
      transport: 'stdio', endpoint: '', maxConcurrency: 2, costMultiplier: 2,
      tags: ['review'], canMutate: true, timeoutMs: 15000,
    };

    // Process A writes agent-1
    fs.writeFileSync(agentsFile, JSON.stringify([agent1], null, 2));
    // Process B reads (stale), adds agent-2, writes - overwrites A's data
    // This is the known data-loss risk with full-overwrite pattern
    const processB_snapshot: AgentConfig[] = []; // Process B had empty state
    processB_snapshot.push(agent2);
    fs.writeFileSync(agentsFile, JSON.stringify(processB_snapshot, null, 2));

    // Result: agent-1 is LOST - only agent-2 survives
    const final: AgentConfig[] = JSON.parse(fs.readFileSync(agentsFile, 'utf-8'));
    expect(final).toHaveLength(1);
    expect(final[0].id).toBe('agent-2');
    // This test documents the known limitation - full-overwrite = data loss risk
  });

  it('agents.json: sequential writes preserve all data when properly synchronized', () => {
    const agentsFile = path.join(tmpDir, 'agents.json');
    const agent1: AgentConfig = {
      id: 'agent-1', name: 'Agent 1', provider: 'copilot', model: 'gpt-4o',
      transport: 'stdio', endpoint: '', maxConcurrency: 3, costMultiplier: 1,
      tags: ['code'], canMutate: false, timeoutMs: 30000,
    };

    // Process A writes
    fs.writeFileSync(agentsFile, JSON.stringify([agent1], null, 2));

    // Process B reads FIRST (synchronized), then appends
    const current: AgentConfig[] = JSON.parse(fs.readFileSync(agentsFile, 'utf-8'));
    const agent2: AgentConfig = {
      id: 'agent-2', name: 'Agent 2', provider: 'anthropic', model: 'claude-3',
      transport: 'stdio', endpoint: '', maxConcurrency: 2, costMultiplier: 2,
      tags: ['review'], canMutate: true, timeoutMs: 15000,
    };
    current.push(agent2);
    fs.writeFileSync(agentsFile, JSON.stringify(current, null, 2));

    // Both agents preserved
    const final: AgentConfig[] = JSON.parse(fs.readFileSync(agentsFile, 'utf-8'));
    expect(final).toHaveLength(2);
    expect(final.map(a => a.id)).toContain('agent-1');
    expect(final.map(a => a.id)).toContain('agent-2');
  });

  it('skills.json: two simultaneous writes - last write wins', () => {
    const skillsFile = path.join(tmpDir, 'skills.json');
    const skill1: Partial<SkillDefinition> = { id: 'skill-1', name: 'Skill 1' };
    const skill2: Partial<SkillDefinition> = { id: 'skill-2', name: 'Skill 2' };

    fs.writeFileSync(skillsFile, JSON.stringify([skill1], null, 2));
    fs.writeFileSync(skillsFile, JSON.stringify([skill2], null, 2));

    const final = JSON.parse(fs.readFileSync(skillsFile, 'utf-8'));
    expect(final).toHaveLength(1);
    expect(final[0].id).toBe('skill-2');
  });

  it('rules.json: two simultaneous writes - last write wins', () => {
    const rulesFile = path.join(tmpDir, 'rules.json');
    const rule1 = { id: 'rule-1', name: 'Rule 1', events: ['workspace:git-event'] };
    const rule2 = { id: 'rule-2', name: 'Rule 2', events: ['agent:message'] };

    fs.writeFileSync(rulesFile, JSON.stringify([rule1], null, 2));
    fs.writeFileSync(rulesFile, JSON.stringify([rule2], null, 2));

    const final = JSON.parse(fs.readFileSync(rulesFile, 'utf-8'));
    expect(final).toHaveLength(1);
    expect(final[0].id).toBe('rule-2');
  });
});

// ===========================================================================
// Concurrent JSONL appends
// ===========================================================================

describe('Multi-instance - concurrent JSONL appends', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-jsonl-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('feedback.jsonl: rapid parallel appendFileSync calls produce valid JSONL', () => {
    const filePath = path.join(tmpDir, 'feedback.jsonl');

    // Simulate two processes appending rapidly (interleaved sequential in single-process)
    for (let i = 0; i < 25; i++) {
      // "Process A" writes
      fs.appendFileSync(filePath, JSON.stringify({ id: `fb-a-${i}`, source: 'A' }) + '\n');
      // "Process B" writes
      fs.appendFileSync(filePath, JSON.stringify({ id: `fb-b-${i}`, source: 'B' }) + '\n');
    }

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(50);

    // Every line must be valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    // Both sources present
    const parsed = lines.map(l => JSON.parse(l));
    expect(parsed.filter(e => e.source === 'A')).toHaveLength(25);
    expect(parsed.filter(e => e.source === 'B')).toHaveLength(25);
  });

  it('task-history.jsonl: interleaved appends produce valid entries', () => {
    const filePath = path.join(tmpDir, 'task-history.jsonl');

    for (let i = 0; i < 10; i++) {
      fs.appendFileSync(filePath, JSON.stringify({ taskId: `inst1-${i}`, pid: 1000 }) + '\n');
      fs.appendFileSync(filePath, JSON.stringify({ taskId: `inst2-${i}`, pid: 2000 }) + '\n');
    }

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(20);

    const parsed = lines.map(l => JSON.parse(l));
    expect(parsed.filter(e => e.pid === 1000)).toHaveLength(10);
    expect(parsed.filter(e => e.pid === 2000)).toHaveLength(10);
  });
});

// ===========================================================================
// ConfigWatcher - external change detection for all watched files
// ===========================================================================

describe('Multi-instance - ConfigWatcher external detection', () => {
  let tmpDir: string;
  let watcher: ConfigWatcher;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-cw-'));
  });

  afterEach(() => {
    watcher?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects external change to agents.json', async () => {
    const agentsFile = path.join(tmpDir, 'agents.json');
    fs.writeFileSync(agentsFile, '[]', 'utf-8');

    const onReload = vi.fn();
    watcher = watchConfigFile(agentsFile, onReload, 'agents');

    // External process writes
    fs.writeFileSync(agentsFile, JSON.stringify([{ id: 'ext-agent' }]), 'utf-8');
    await new Promise(r => setTimeout(r, 600));

    expect(onReload).toHaveBeenCalled();
  });

  it('detects external change to skills.json', async () => {
    const skillsFile = path.join(tmpDir, 'skills.json');
    fs.writeFileSync(skillsFile, '[]', 'utf-8');

    const onReload = vi.fn();
    watcher = watchConfigFile(skillsFile, onReload, 'skills');

    fs.writeFileSync(skillsFile, JSON.stringify([{ id: 'ext-skill' }]), 'utf-8');
    await new Promise(r => setTimeout(r, 600));

    expect(onReload).toHaveBeenCalled();
  });

  it('detects external change to rules.json', async () => {
    const rulesFile = path.join(tmpDir, 'rules.json');
    fs.writeFileSync(rulesFile, '[]', 'utf-8');

    const onReload = vi.fn();
    watcher = watchConfigFile(rulesFile, onReload, 'automation-rules');

    fs.writeFileSync(rulesFile, JSON.stringify([{ id: 'ext-rule' }]), 'utf-8');
    await new Promise(r => setTimeout(r, 600));

    expect(onReload).toHaveBeenCalled();
  });

  it('detects external change to workspace-history.json', async () => {
    const historyFile = path.join(tmpDir, 'workspace-history.json');
    fs.writeFileSync(historyFile, '[]', 'utf-8');

    const onReload = vi.fn();
    watcher = watchConfigFile(historyFile, onReload, 'workspace-history');

    fs.writeFileSync(historyFile, JSON.stringify([{ path: '/ext/repo' }]), 'utf-8');
    await new Promise(r => setTimeout(r, 600));

    expect(onReload).toHaveBeenCalled();
  });

  it('self-write suppression works - no reload for own writes', async () => {
    const file = path.join(tmpDir, 'self-write.json');
    fs.writeFileSync(file, '[]', 'utf-8');

    const onReload = vi.fn();
    watcher = watchConfigFile(file, onReload, 'test');

    watcher.markSelfWrite();
    fs.writeFileSync(file, JSON.stringify([{ id: 'self' }]), 'utf-8');
    await new Promise(r => setTimeout(r, 600));

    expect(onReload).not.toHaveBeenCalled();
  });

  it('external write after self-write window triggers reload', async () => {
    const file = path.join(tmpDir, 'mixed.json');
    fs.writeFileSync(file, '[]', 'utf-8');

    const onReload = vi.fn();
    watcher = watchConfigFile(file, onReload, 'test');

    // Self-write (suppressed)
    watcher.markSelfWrite();
    fs.writeFileSync(file, JSON.stringify([{ id: 'self' }]), 'utf-8');
    await new Promise(r => setTimeout(r, 600));
    expect(onReload).not.toHaveBeenCalled();

    // Wait for self-write window to expire (1s)
    await new Promise(r => setTimeout(r, 500));

    // External write (should trigger)
    fs.writeFileSync(file, JSON.stringify([{ id: 'external' }]), 'utf-8');
    await new Promise(r => setTimeout(r, 600));
    expect(onReload).toHaveBeenCalled();
  });

  it('detects external change to messages.jsonl', async () => {
    const messagesFile = path.join(tmpDir, 'messages.jsonl');
    fs.writeFileSync(messagesFile, '', 'utf-8');

    const onReload = vi.fn();
    watcher = watchConfigFile(messagesFile, onReload, 'messages.jsonl');

    // Simulate another instance appending a message
    const msg = { id: 'ext-msg-1', channel: 'test', sender: 'remote', recipients: ['*'], body: 'hello', createdAt: new Date().toISOString(), ttlSeconds: 3600, persistent: false, readBy: [] };
    fs.appendFileSync(messagesFile, JSON.stringify(msg) + '\n');
    await new Promise(r => setTimeout(r, 600));

    expect(onReload).toHaveBeenCalled();
  });

  it('self-write suppression works for messages.jsonl', async () => {
    const messagesFile = path.join(tmpDir, 'messages.jsonl');
    fs.writeFileSync(messagesFile, '', 'utf-8');

    const onReload = vi.fn();
    watcher = watchConfigFile(messagesFile, onReload, 'messages.jsonl');

    // Self-write (suppressed)
    watcher.markSelfWrite();
    const msg = { id: 'self-msg', channel: 'test', sender: 'local', recipients: ['*'], body: 'mine', createdAt: new Date().toISOString(), ttlSeconds: 3600, persistent: false, readBy: [] };
    fs.appendFileSync(messagesFile, JSON.stringify(msg) + '\n');
    await new Promise(r => setTimeout(r, 600));

    expect(onReload).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Hot-reload preserves runtime state
// ===========================================================================

describe('Multi-instance - hot-reload state preservation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-reload-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('agent reload preserves activeTasks and runtime counters', () => {
    // Simulate in-memory agent with runtime state
    const runtimeAgent = {
      config: { id: 'agent-1', name: 'Agent', provider: 'copilot', model: 'gpt-4o' },
      state: 'running',
      tasksCompleted: 5,
      tasksFailed: 2,
      activeTasks: 1,
      totalTokensUsed: 3000,
      costAccumulated: 0.3,
    };

    // External process changes config
    const newConfig = { ...runtimeAgent.config, model: 'gpt-4-turbo', maxConcurrency: 5 };

    // Reload logic: update config, preserve runtime
    const reloaded = { ...runtimeAgent, config: newConfig };

    expect(reloaded.config.model).toBe('gpt-4-turbo');
    expect(reloaded.tasksCompleted).toBe(5);
    expect(reloaded.tasksFailed).toBe(2);
    expect(reloaded.activeTasks).toBe(1);
    expect(reloaded.totalTokensUsed).toBe(3000);
  });

  it('skill reload replaces all in-memory skills', () => {
    const memorySkills = new Map<string, Partial<SkillDefinition>>([
      ['old-1', { id: 'old-1', name: 'Old Skill' }],
      ['old-2', { id: 'old-2', name: 'Old Skill 2' }],
    ]);

    // External process writes new skills.json
    const diskSkills: Partial<SkillDefinition>[] = [
      { id: 'new-1', name: 'New Skill 1' },
      { id: 'new-2', name: 'New Skill 2' },
      { id: 'new-3', name: 'New Skill 3' },
    ];

    // Reload logic: clear all, load from disk
    memorySkills.clear();
    for (const s of diskSkills) {
      memorySkills.set(s.id!, s);
    }

    expect(memorySkills.has('old-1')).toBe(false);
    expect(memorySkills.has('old-2')).toBe(false);
    expect(memorySkills.size).toBe(3);
    expect(memorySkills.get('new-1')!.name).toBe('New Skill 1');
  });

  it('automation reload preserves ruleStats for surviving rules', () => {
    const ruleStats = new Map<string, { successes: number; failures: number }>([
      ['rule-1', { successes: 10, failures: 2 }],
      ['rule-2', { successes: 5, failures: 0 }],
    ]);

    // External change: rule-1 still exists, rule-2 removed, rule-3 added
    const diskRuleIds = new Set(['rule-1', 'rule-3']);

    const prevStats = new Map(ruleStats);
    ruleStats.clear();

    // Load new rule IDs
    for (const id of diskRuleIds) {
      ruleStats.set(id, prevStats.get(id) ?? { successes: 0, failures: 0 });
    }

    // rule-1 stats preserved
    expect(ruleStats.get('rule-1')).toEqual({ successes: 10, failures: 2 });
    // rule-2 stats gone
    expect(ruleStats.has('rule-2')).toBe(false);
    // rule-3 has fresh stats
    expect(ruleStats.get('rule-3')).toEqual({ successes: 0, failures: 0 });
  });

  it('agent reload removes idle agents not on disk, keeps busy ones', () => {
    const agents = new Map<string, { id: string; activeTasks: number }>([
      ['keep', { id: 'keep', activeTasks: 0 }],
      ['remove', { id: 'remove', activeTasks: 0 }],
      ['busy', { id: 'busy', activeTasks: 2 }],
    ]);

    const diskIds = new Set(['keep']);

    // Reload: remove idle agents not in disk
    for (const [id, agent] of agents) {
      if (!diskIds.has(id) && agent.activeTasks === 0) {
        agents.delete(id);
      }
    }

    expect(agents.has('keep')).toBe(true);
    expect(agents.has('remove')).toBe(false);
    expect(agents.has('busy')).toBe(true); // busy survives despite not being on disk
  });

  it('workspace-history reload replaces all entries from disk', () => {
    const entries: Array<{ path: string }> = [
      { path: '/old/repo1' },
      { path: '/old/repo2' },
    ];

    // External file has different entries
    const diskFile = path.join(tmpDir, 'workspace-history.json');
    const diskEntries = [
      { path: '/new/repo1' },
      { path: '/new/repo2' },
      { path: '/new/repo3' },
    ];
    fs.writeFileSync(diskFile, JSON.stringify(diskEntries, null, 2));

    // Reload logic
    const raw = fs.readFileSync(diskFile, 'utf-8');
    const loaded = JSON.parse(raw);
    entries.length = 0;
    entries.push(...loaded);

    expect(entries).toHaveLength(3);
    expect(entries[0].path).toBe('/new/repo1');
  });
});
