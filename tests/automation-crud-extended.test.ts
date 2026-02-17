// tests/automation-crud-extended.test.ts
// AutomationEngine - Extended CRUD tests for get, update, and lifecycle.

import { describe, it, expect, beforeAll, afterAll, beforeEach, type MockInstance } from 'vitest';
import { automationEngine } from '../src/services/automation/index.js';
import {
  createPersistSpies, restoreSpies, cleanState, makeRuleInput,
  registerTestAgent, registerMockProviders,
} from './helpers/setup.js';

let persistSpies: MockInstance[];
beforeAll(() => {
  persistSpies = createPersistSpies();
  registerMockProviders();
});
afterAll(() => { restoreSpies(persistSpies); });
beforeEach(() => { cleanState(); });

// ---------------------------------------------------------------------------
// mgr_get_automation - get single rule + stats
// ---------------------------------------------------------------------------

describe('mgr_get_automation - get single rule by ID', () => {
  it('returns full rule + stats by ID', () => {
    automationEngine.registerRule(makeRuleInput({ id: 'get-test-1', name: 'Get Test' }));
    const rule = automationEngine.getRule('get-test-1');
    const stats = automationEngine.getRuleStats('get-test-1');

    expect(rule).toBeDefined();
    expect(rule!.id).toBe('get-test-1');
    expect(rule!.name).toBe('Get Test');
    expect(rule!.matcher.events).toEqual(['workspace:git-event']);
    expect(rule!.skillId).toBe('code-review');
    expect(rule!.enabled).toBe(true);
    expect(rule!.priority).toBe('normal');

    expect(stats).toBeDefined();
    expect(stats!.ruleId).toBe('get-test-1');
    expect(stats!.totalExecutions).toBe(0);
  });

  it('returns undefined for unknown ID', () => {
    const rule = automationEngine.getRule('nonexistent');
    expect(rule).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mgr_update_automation - partial update
// ---------------------------------------------------------------------------

describe('mgr_update_automation - partial update merges fields', () => {
  it('updates only changed fields, bumps version', () => {
    automationEngine.registerRule(makeRuleInput({ id: 'update-test-1' }));
    const original = automationEngine.getRule('update-test-1')!;
    expect(original.version).toBe('1.0.0');

    const updated = automationEngine.updateRule('update-test-1', {
      name: 'Updated Name',
      description: 'New description',
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe('Updated Name');
    expect(updated!.description).toBe('New description');
    expect(updated!.skillId).toBe('code-review');  // preserved
    expect(updated!.version).toBe('1.0.1');         // bumped
  });

  it('can change events array', () => {
    automationEngine.registerRule(makeRuleInput({ id: 'events-test', events: ['workspace:git-event'] }));
    const updated = automationEngine.updateRule('events-test', {
      events: ['workspace:file-changed', 'workspace:session-updated'],
    });

    expect(updated).toBeDefined();
    expect(updated!.matcher.events).toEqual(['workspace:file-changed', 'workspace:session-updated']);
  });

  it('can change throttle config', () => {
    automationEngine.registerRule(makeRuleInput({ id: 'throttle-test' }));
    const updated = automationEngine.updateRule('throttle-test', {
      throttleIntervalMs: 10000,
      throttleMode: 'trailing',
    });

    expect(updated).toBeDefined();
    expect(updated!.throttle).toBeDefined();
    expect(updated!.throttle!.intervalMs).toBe(10000);
    expect(updated!.throttle!.mode).toBe('trailing');
  });

  it('returns undefined for non-existent rule', () => {
    const result = automationEngine.updateRule('ghost-rule', { name: 'nope' });
    expect(result).toBeUndefined();
  });

  it('preserves execution stats after update', () => {
    automationEngine.registerRule(makeRuleInput({ id: 'stats-test' }));
    const statsBefore = automationEngine.getRuleStats('stats-test');
    expect(statsBefore).toBeDefined();

    automationEngine.updateRule('stats-test', { name: 'Post-Update' });
    const statsAfter = automationEngine.getRuleStats('stats-test');
    expect(statsAfter).toBeDefined();
    expect(statsAfter!.ruleId).toBe('stats-test');
  });
});

// ---------------------------------------------------------------------------
// Round-trip and lifecycle
// ---------------------------------------------------------------------------

describe('Automation CRUD round-trips', () => {
  it('create → get - all fields match', () => {
    const input = makeRuleInput({
      id: 'roundtrip-rule-1',
      name: 'Round Trip Rule',
      events: ['workspace:git-event', 'workspace:file-changed'],
      skillId: 'code-review',
      priority: 'high',
      tags: ['speckit', 'review'],
    });
    automationEngine.registerRule(input);

    const rule = automationEngine.getRule('roundtrip-rule-1')!;
    expect(rule.id).toBe(input.id);
    expect(rule.name).toBe(input.name);
    expect(rule.matcher.events).toEqual(input.events);
    expect(rule.skillId).toBe(input.skillId);
    expect(rule.priority).toBe(input.priority);
    expect(rule.tags).toEqual(input.tags);
  });

  it('full lifecycle: create → read → update → toggle → trigger (dry) → delete → read undefined', async () => {
    registerTestAgent();

    // Create
    automationEngine.registerRule(makeRuleInput({ id: 'lifecycle-rule' }));

    // Read
    let rule = automationEngine.getRule('lifecycle-rule');
    expect(rule).toBeDefined();
    expect(rule!.version).toBe('1.0.0');

    // Update
    automationEngine.updateRule('lifecycle-rule', { name: 'Lifecycle Updated' });
    rule = automationEngine.getRule('lifecycle-rule');
    expect(rule!.name).toBe('Lifecycle Updated');
    expect(rule!.version).toBe('1.0.1');

    // Toggle
    automationEngine.setRuleEnabled('lifecycle-rule', false);
    expect(automationEngine.getRule('lifecycle-rule')!.enabled).toBe(false);
    automationEngine.setRuleEnabled('lifecycle-rule', true);

    // Trigger dry-run
    const exec = await automationEngine.triggerRule('lifecycle-rule', { test: true }, true);
    expect(exec.status).toBe('skipped');
    expect(exec.resultSummary).toContain('DRY RUN');

    // Delete
    const removed = automationEngine.removeRule('lifecycle-rule');
    expect(removed).toBe(true);

    // Read → undefined
    expect(automationEngine.getRule('lifecycle-rule')).toBeUndefined();
  });
});
