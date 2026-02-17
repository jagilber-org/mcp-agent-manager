// tests/automation-pipeline.test.ts
// Automation Engine - event-to-skill pipeline and full integrated round trips.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, type MockInstance } from 'vitest';
import { agentRegistry } from '../src/services/agentRegistry.js';
import { skillStore } from '../src/services/skillStore.js';
import { automationEngine } from '../src/services/automation/index.js';
import { eventBus } from '../src/services/events.js';
import {
  createPersistSpies, restoreSpies, cleanState,
  TEST_AGENT, TEST_AGENT_2, makeRule, registerMockProviders,
} from './helpers/setup.js';
import type { SkillDefinition } from '../src/types/index.js';

let persistSpies: MockInstance[];
beforeAll(() => { persistSpies = createPersistSpies(); });
afterAll(() => { restoreSpies(persistSpies); });

const AUTOMATION_SKILLS: SkillDefinition[] = [
  {
    id: 'code-review', name: 'Code Review',
    description: 'Reviews code for quality and issues',
    promptTemplate: 'Review: {code}\nContext: {context}',
    strategy: 'single', targetTags: ['code', 'review'],
    version: '1.0.0', categories: ['code', 'review'],
  },
  {
    id: 'security-audit', name: 'Security Audit',
    description: 'Audits code for security issues',
    promptTemplate: 'Audit: {input}',
    strategy: 'single', targetTags: ['security'],
    version: '1.0.0', categories: ['security'],
  },
];

beforeEach(() => {
  cleanState();
  registerMockProviders();
  agentRegistry.register(TEST_AGENT);
  agentRegistry.register(TEST_AGENT_2);
  for (const s of AUTOMATION_SKILLS) {
    if (!skillStore.get(s.id)) skillStore.register(s);
  }
  automationEngine.initialize();
});

afterEach(() => {
  for (const s of AUTOMATION_SKILLS) skillStore.remove(s.id);
});

// ===========================================================================
// Automation Engine - Event → Skill Pipeline
// ===========================================================================

describe('Automation Engine - Event → Skill Pipeline', () => {
  it('triggers skill on matching event', async () => {
    const rule = makeRule({
      id: 'func-auto-trigger', events: ['workspace:git-event'],
      skillId: 'code-review',
      templateParams: { code: 'Review {event.detail}', context: 'workspace {event.path}' },
    });
    automationEngine.registerRule(rule);

    const execution = await automationEngine.triggerRule('func-auto-trigger', {
      path: '/test/repo', event: 'commit', detail: 'feat: add feature',
    });

    expect(execution.status).toBe('success');
    expect(execution.skillId).toBe('code-review');
    expect(execution.resolvedParams).toBeDefined();
    expect(execution.resolvedParams!.code).toContain('feat: add feature');
    expect(execution.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('dry-run resolves params without executing', async () => {
    const rule = makeRule({
      id: 'func-dry-run', events: ['workspace:file-changed'],
      skillId: 'security-audit',
      templateParams: { input: 'File changed: {event.file} in {event.path}' },
    });
    automationEngine.registerRule(rule);

    const execution = await automationEngine.triggerRule('func-dry-run', {
      path: '/test', file: 'secret.env', kind: 'modified',
    }, true);

    expect(execution.status).toBe('skipped');
    expect(execution.resolvedParams!.input).toBe('File changed: secret.env in /test');
    expect(execution.resultSummary).toContain('[DRY RUN]');
  });

  it('records execution history with stats', async () => {
    const rule = makeRule({
      id: 'func-history', events: ['task:completed'],
      skillId: 'code-review',
      templateParams: { code: 'Task {event.taskId}', context: 'auto-review' },
    });
    automationEngine.registerRule(rule);

    await automationEngine.triggerRule('func-history', { taskId: 't1', success: true });
    await automationEngine.triggerRule('func-history', { taskId: 't2', success: false });

    const stats = automationEngine.getRuleStats('func-history');
    expect(stats).toBeDefined();
    expect(stats!.totalExecutions).toBe(2);
    expect(stats!.successCount).toBe(2);
  });

  it('conditions block execution when not met', async () => {
    for (const a of agentRegistry.getAll()) agentRegistry.unregister(a.config.id);

    const rule = makeRule({
      id: 'func-condition', events: ['workspace:git-event'],
      skillId: 'code-review',
      conditions: [{ type: 'min-agents' as const, value: 5 }],
    });
    automationEngine.registerRule(rule);

    const execution = await automationEngine.triggerRule('func-condition', {
      path: '/test', event: 'commit', detail: 'test',
    });

    expect(execution.status).not.toBe('success');
  });

  it('disabled engine blocks event-driven executions', () => {
    const rule = makeRule({ id: 'func-disabled', events: ['workspace:git-event'] });
    automationEngine.registerRule(rule);
    automationEngine.setEnabled(false);

    const statsBefore = automationEngine.getRuleStats('func-disabled');
    eventBus.emitEvent('workspace:git-event', {
      path: '/test', event: 'commit', detail: 'test',
    });
    const statsAfter = automationEngine.getRuleStats('func-disabled');

    expect(statsAfter?.totalExecutions ?? 0).toBe(statsBefore?.totalExecutions ?? 0);
    automationEngine.setEnabled(true);
  });

  it('toggle rule enabled/disabled', () => {
    const rule = makeRule({ id: 'func-toggle' });
    automationEngine.registerRule(rule);

    automationEngine.setRuleEnabled('func-toggle', false);
    const rules = automationEngine.listRules({ enabled: false });
    expect(rules.some(r => r.id === 'func-toggle')).toBe(true);

    automationEngine.setRuleEnabled('func-toggle', true);
    const enabledRules = automationEngine.listRules({ enabled: true });
    expect(enabledRules.some(r => r.id === 'func-toggle')).toBe(true);
  });

  it('engine status reports correct metrics', async () => {
    const rule = makeRule({ id: 'func-status' });
    automationEngine.registerRule(rule);

    const status = automationEngine.getStatus();
    expect(status.enabled).toBe(true);
    expect(status.ruleCount).toBeGreaterThanOrEqual(1);
    expect(status.activeRules).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// Integrated Pipeline - Full Round Trip
// ===========================================================================

describe('Integrated Pipeline - Full Round Trip', () => {
  it('git event → code-review rule → fan-out → merged result', async () => {
    const rule = makeRule({
      id: 'pipe-code-review', events: ['workspace:git-event'],
      skillId: 'code-review',
      templateParams: {
        code: 'function greet() { return "hi"; }',
        context: 'Commit in {event.path}: {event.detail}',
      },
    });
    automationEngine.registerRule(rule);

    const execution = await automationEngine.triggerRule('pipe-code-review', {
      path: '/github/my-project', event: 'commit', detail: 'feat: add greeting function',
    });

    expect(execution.status).toBe('success');
    expect(execution.resultSummary).toBeTruthy();
    expect(execution.durationMs).toBeGreaterThanOrEqual(0);

    const stats = automationEngine.getRuleStats('pipe-code-review');
    expect(stats!.totalExecutions).toBe(1);
    expect(stats!.successCount).toBe(1);
  });

  it('file change → security-audit rule → result contains audit content', async () => {
    const rule = makeRule({
      id: 'pipe-security', events: ['workspace:file-changed'],
      skillId: 'security-audit',
      templateParams: {
        input: 'File {event.file} changed in {event.path}. Type: {event.kind}',
      },
    });
    automationEngine.registerRule(rule);

    const execution = await automationEngine.triggerRule('pipe-security', {
      path: '/github/my-project', file: 'config/secrets.json', kind: 'modified', detail: 'sensitive file',
    });

    expect(execution.status).toBe('success');
    expect(execution.resolvedParams!.input).toContain('secrets.json');
  });

  it('session update → speckit constitution check → consensus result', async () => {
    const speckitSkill: SkillDefinition = {
      id: 'speckit-constitution-check', name: 'SpecKit Constitution Check',
      description: 'Validate project constitution',
      promptTemplate: 'Validate constitution: {code}',
      strategy: 'consensus', targetTags: ['review', 'code'], mergeResults: true,
      maxTokens: 8000, version: '1.0.0', categories: ['speckit', 'compliance', 'governance'],
    };
    if (!skillStore.get('speckit-constitution-check')) skillStore.register(speckitSkill);

    const rule = makeRule({
      id: 'pipe-speckit', events: ['workspace:session-updated'],
      skillId: 'speckit-constitution-check',
      templateParams: { code: 'Session {event.sessionId} updated for {event.path}' },
    });
    automationEngine.registerRule(rule);

    const execution = await automationEngine.triggerRule('pipe-speckit', {
      path: '/github/my-project', sessionId: 'abc-123', file: 'session.jsonl', sizeBytes: 5000,
    });

    expect(execution.status).toBe('success');
    expect(execution.resolvedParams!.code).toContain('abc-123');
  });

  it('failure analysis chain: task failure → analyze → result', async () => {
    const rule = makeRule({
      id: 'pipe-failure', events: ['task:completed'],
      skillId: 'code-review',
      filters: { success: 'false' },
      templateParams: {
        code: 'Task {event.taskId} failed with strategy {event.strategy}',
        context: 'Failure analysis',
      },
    });
    automationEngine.registerRule(rule);

    const execution = await automationEngine.triggerRule('pipe-failure', {
      taskId: 'failed-task-1', skillId: 'some-skill', strategy: 'single',
      success: false, totalTokens: 100, totalCost: 0.01,
    });

    expect(execution.status).toBe('success');
    expect(execution.resolvedParams!.code).toContain('failed-task-1');
    expect(execution.resolvedParams!.context).toBe('Failure analysis');
  });
});
