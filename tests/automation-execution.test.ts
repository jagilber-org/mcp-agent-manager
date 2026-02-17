// tests/automation-execution.test.ts
// AutomationEngine - manual trigger, dry run, execution records, status/history,
// and integration scenarios.

import { describe, it, expect, beforeAll, afterAll, beforeEach, type MockInstance } from 'vitest';
import { automationEngine } from '../src/services/automation/index.js';
import {
  createPersistSpies, restoreSpies, cleanState, makeRuleInput,
} from './helpers/setup.js';

let persistSpies: MockInstance[];
beforeAll(() => { persistSpies = createPersistSpies(); });
afterAll(() => { restoreSpies(persistSpies); });
beforeEach(() => { cleanState(); });

// ---------------------------------------------------------------------------
// Manual Trigger & Dry Run
// ---------------------------------------------------------------------------

describe('AutomationEngine - Manual Trigger', () => {
  it('dry-run returns resolved params without executing', async () => {
    automationEngine.registerRule(makeRuleInput({
      staticParams: { code: 'console.log("hello")' },
      templateParams: { context: 'git commit on {event.path}' },
    }));

    const exec = await automationEngine.triggerRule('test-rule-1', { path: '/proj' }, true);

    expect(exec.status).toBe('skipped');
    expect(exec.resolvedParams.code).toBe('console.log("hello")');
    expect(exec.resolvedParams.context).toBe('git commit on /proj');
    expect(exec.resultSummary).toContain('[DRY RUN]');
    expect(exec.resultSummary).toContain('code-review');
  });

  it('throws when triggering non-existent rule', async () => {
    await expect(
      automationEngine.triggerRule('nonexistent', {})
    ).rejects.toThrow('Automation rule not found: nonexistent');
  });

  it('records execution in history after dry run', async () => {
    automationEngine.registerRule(makeRuleInput());
    const beforeCount = automationEngine.getExecutions({ ruleId: 'test-rule-1' }).length;
    await automationEngine.triggerRule('test-rule-1', {}, true);

    const executions = automationEngine.getExecutions({ ruleId: 'test-rule-1' });
    expect(executions.length).toBe(beforeCount + 1);
    expect(executions[0].status).toBe('skipped');
  });

  it('trigger with missing skill records failure', async () => {
    automationEngine.registerRule(makeRuleInput({ skillId: 'nonexistent-skill' }));

    const exec = await automationEngine.triggerRule('test-rule-1', {});
    expect(exec.status).toBe('failed');
    expect(exec.error).toContain('Skill not found');
  });
});

// ---------------------------------------------------------------------------
// Engine Status & History
// ---------------------------------------------------------------------------

describe('AutomationEngine - Status & History', () => {
  it('returns engine status', () => {
    automationEngine.registerRule(makeRuleInput({ id: 'r1' }));
    automationEngine.registerRule(makeRuleInput({ id: 'r2', enabled: false }));

    const status = automationEngine.getStatus();
    expect(status.enabled).toBe(true);
    expect(status.ruleCount).toBe(2);
    expect(status.activeRules).toBe(1);
    expect(status.startedAt).toBeDefined();
    expect(status.ruleStats.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty status with no rules', () => {
    const status = automationEngine.getStatus();
    expect(status.ruleCount).toBe(0);
    expect(status.activeRules).toBe(0);
    expect(typeof status.totalExecutions).toBe('number');
  });

  it('tracks execution history', async () => {
    automationEngine.registerRule(makeRuleInput());

    await automationEngine.triggerRule('test-rule-1', { path: '/test' }, true);
    await automationEngine.triggerRule('test-rule-1', { path: '/test2' }, true);

    const allExecs = automationEngine.getExecutions();
    expect(allExecs.length).toBeGreaterThanOrEqual(2);
  });

  it('filters executions by rule ID', async () => {
    automationEngine.registerRule(makeRuleInput({ id: 'r1' }));
    automationEngine.registerRule(makeRuleInput({ id: 'r2' }));

    await automationEngine.triggerRule('r1', {}, true);
    await automationEngine.triggerRule('r2', {}, true);

    const r1Execs = automationEngine.getExecutions({ ruleId: 'r1' });
    expect(r1Execs.every(e => e.ruleId === 'r1')).toBe(true);
  });

  it('filters executions by status', async () => {
    automationEngine.registerRule(makeRuleInput());
    await automationEngine.triggerRule('test-rule-1', {}, true);

    const skipped = automationEngine.getExecutions({ status: 'skipped' });
    expect(skipped.every(e => e.status === 'skipped')).toBe(true);
  });

  it('limits execution history results', async () => {
    automationEngine.registerRule(makeRuleInput());

    for (let i = 0; i < 10; i++) {
      await automationEngine.triggerRule('test-rule-1', {}, true);
    }

    const limited = automationEngine.getExecutions({ limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it('returns per-rule stats', async () => {
    automationEngine.registerRule(makeRuleInput());
    await automationEngine.triggerRule('test-rule-1', {}, true);

    const stats = automationEngine.getRuleStats('test-rule-1');
    expect(stats).toBeDefined();
    expect(stats!.ruleId).toBe('test-rule-1');
  });

  it('returns undefined stats for unknown rule', () => {
    expect(automationEngine.getRuleStats('nonexistent')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Execution Records
// ---------------------------------------------------------------------------

describe('AutomationEngine - Execution Records', () => {
  it('dry-run execution has correct structure', async () => {
    automationEngine.registerRule(makeRuleInput({
      staticParams: { code: 'test' },
    }));

    const exec = await automationEngine.triggerRule(
      'test-rule-1',
      { path: '/test', event: 'commit', detail: 'test commit' },
      true,
    );

    expect(exec.executionId).toMatch(/^exec-test-rule-1-/);
    expect(exec.ruleId).toBe('test-rule-1');
    expect(exec.skillId).toBe('code-review');
    expect(exec.triggerEvent).toBe('manual:trigger');
    expect(exec.triggerData.path).toBe('/test');
    expect(exec.resolvedParams.code).toBe('test');
    expect(exec.status).toBe('skipped');
    expect(exec.retryAttempt).toBe(0);
    expect(exec.startedAt).toBeDefined();
    expect(exec.completedAt).toBeDefined();
  });

  it('failed execution records error', async () => {
    automationEngine.registerRule(makeRuleInput({ skillId: 'nonexistent-skill-xyz' }));

    const exec = await automationEngine.triggerRule('test-rule-1', {});

    expect(exec.status).toBe('failed');
    expect(exec.error).toBeDefined();
    expect(exec.error).toContain('Skill not found');
    expect(exec.durationMs).toBeDefined();
    expect(exec.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('execution records trigger data snapshot', async () => {
    automationEngine.registerRule(makeRuleInput());

    const testData = {
      path: '/repos/my-app',
      event: 'commit',
      detail: 'fix: resolve issue #42',
    };

    const exec = await automationEngine.triggerRule('test-rule-1', testData, true);

    expect(exec.triggerData.path).toBe('/repos/my-app');
    expect(exec.triggerData.event).toBe('commit');
    expect(exec.triggerData.detail).toBe('fix: resolve issue #42');
  });
});

// ---------------------------------------------------------------------------
// Integration Scenarios
// ---------------------------------------------------------------------------

describe('AutomationEngine - Integration Scenarios', () => {
  it('SpecKit validation on git commit (dry run)', async () => {
    automationEngine.registerRule(makeRuleInput({
      id: 'speckit-on-commit',
      name: 'SpecKit Constitution Check on Commit',
      events: ['workspace:git-event'],
      skillId: 'speckit-constitution-check',
      filters: { event: 'commit' },
      staticParams: { context: 'Project constitution validation triggered by git commit' },
      templateParams: { context: 'Git commit on {event.path}: {event.detail}' },
      throttleIntervalMs: 30000,
      throttleMode: 'leading',
      throttleGroupBy: 'path',
      conditions: [{ type: 'min-agents', value: 1 }],
      tags: ['speckit', 'compliance'],
    }));

    const rule = automationEngine.getRule('speckit-on-commit')!;
    expect(rule.matcher.events).toEqual(['workspace:git-event']);
    expect(rule.skillId).toBe('speckit-constitution-check');
    expect(rule.throttle!.intervalMs).toBe(30000);
    expect(rule.tags).toContain('speckit');

    const exec = await automationEngine.triggerRule('speckit-on-commit', {
      path: '/repos/my-app', event: 'commit', detail: 'feat: major architecture change',
    }, true);

    expect(exec.status).toBe('skipped');
    expect(exec.resolvedParams.context).toContain('Git commit on /repos/my-app');
    expect(exec.resolvedParams.context).toContain('major architecture change');
  });

  it('code review on workspace file change (dry run)', async () => {
    automationEngine.registerRule(makeRuleInput({
      id: 'review-on-change',
      name: 'Auto Code Review on File Change',
      events: ['workspace:file-changed'],
      skillId: 'code-review',
      filters: { kind: 'vscode-config' },
      templateParams: {
        code: 'Changed file: {event.file}',
        context: 'Workspace {event.path}, change type: {event.detail}',
      },
      maxConcurrent: 1,
      tags: ['code', 'review'],
    }));

    const exec = await automationEngine.triggerRule('review-on-change', {
      path: '/repos/app', file: 'settings.json', kind: 'vscode-config', detail: 'rename',
    }, true);

    expect(exec.resolvedParams.code).toBe('Changed file: settings.json');
    expect(exec.resolvedParams.context).toContain('/repos/app');
  });

  it('security audit on agent registration (dry run)', async () => {
    automationEngine.registerRule(makeRuleInput({
      id: 'audit-new-agent',
      name: 'Security Audit on New Agent',
      events: ['agent:registered'],
      skillId: 'security-audit',
      templateParams: {
        input: 'New agent registered: {event.agentId} (provider: {event.provider}, model: {event.model}). Tags: {event.tags}. Verify security posture.',
      },
      tags: ['security'],
    }));

    const exec = await automationEngine.triggerRule('audit-new-agent', {
      agentId: 'new-agent-1', provider: 'anthropic', model: 'claude-sonnet-4-20250514',
      tags: ['code', 'mutate'],
    }, true);

    expect(exec.resolvedParams.input).toContain('new-agent-1');
    expect(exec.resolvedParams.input).toContain('anthropic');
  });

  it('fan-out analysis on task failure (dry run)', async () => {
    automationEngine.registerRule(makeRuleInput({
      id: 'analyze-failure',
      name: 'Analyze Task Failure',
      events: ['task:completed'],
      skillId: 'consensus-check',
      filters: { success: 'false' },
      templateParams: {
        question: 'Task {event.taskId} failed using skill {event.skillId} with strategy {event.strategy}. What went wrong? Tokens used: {event.totalTokens}',
      },
      priority: 'high',
      maxRetries: 2,
      tags: ['debugging', 'resilience'],
    }));

    const exec = await automationEngine.triggerRule('analyze-failure', {
      taskId: 'task-42', skillId: 'code-review', strategy: 'fan-out',
      success: false, totalTokens: 8500,
    }, true);

    expect(exec.resolvedParams.question).toContain('task-42');
    expect(exec.resolvedParams.question).toContain('fan-out');
    expect(exec.resolvedParams.question).toContain('8500');
  });
});
