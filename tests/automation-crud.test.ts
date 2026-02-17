// tests/automation-crud.test.ts
// AutomationEngine - Rule CRUD, configuration, and enable/disable toggling.

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
// Rule CRUD
// ---------------------------------------------------------------------------

describe('AutomationEngine - Rule CRUD', () => {
  it('registers a new rule', () => {
    const rule = automationEngine.registerRule(makeRuleInput());
    expect(rule.id).toBe('test-rule-1');
    expect(rule.name).toBe('Test Rule');
    expect(rule.matcher.events).toEqual(['workspace:git-event']);
    expect(rule.skillId).toBe('code-review');
    expect(rule.enabled).toBe(true);
    expect(rule.priority).toBe('normal');
    expect(rule.version).toBe('1.0.0');
  });

  it('updates an existing rule and bumps version', () => {
    automationEngine.registerRule(makeRuleInput());
    const updated = automationEngine.registerRule(makeRuleInput({
      name: 'Updated Rule',
      description: 'Updated description',
    }));
    expect(updated.name).toBe('Updated Rule');
    expect(updated.version).toBe('1.0.1');
  });

  it('removes a rule', () => {
    automationEngine.registerRule(makeRuleInput());
    expect(automationEngine.listRules()).toHaveLength(1);
    const removed = automationEngine.removeRule('test-rule-1');
    expect(removed).toBe(true);
    expect(automationEngine.listRules()).toHaveLength(0);
  });

  it('returns false when removing non-existent rule', () => {
    expect(automationEngine.removeRule('nonexistent')).toBe(false);
  });

  it('gets a rule by ID', () => {
    automationEngine.registerRule(makeRuleInput());
    const rule = automationEngine.getRule('test-rule-1');
    expect(rule).toBeDefined();
    expect(rule!.id).toBe('test-rule-1');
  });

  it('returns undefined for unknown rule ID', () => {
    expect(automationEngine.getRule('nope')).toBeUndefined();
  });

  it('lists rules sorted by priority', () => {
    automationEngine.registerRule(makeRuleInput({ id: 'low', priority: 'low' }));
    automationEngine.registerRule(makeRuleInput({ id: 'critical', priority: 'critical' }));
    automationEngine.registerRule(makeRuleInput({ id: 'high', priority: 'high' }));
    automationEngine.registerRule(makeRuleInput({ id: 'normal', priority: 'normal' }));

    const rules = automationEngine.listRules();
    expect(rules.map(r => r.id)).toEqual(['critical', 'high', 'normal', 'low']);
  });

  it('filters rules by tag', () => {
    automationEngine.registerRule(makeRuleInput({ id: 'r1', tags: ['speckit'] }));
    automationEngine.registerRule(makeRuleInput({ id: 'r2', tags: ['monitoring'] }));
    automationEngine.registerRule(makeRuleInput({ id: 'r3', tags: ['speckit', 'review'] }));

    const speckit = automationEngine.listRules({ tag: 'speckit' });
    expect(speckit).toHaveLength(2);
    expect(speckit.map(r => r.id)).toContain('r1');
    expect(speckit.map(r => r.id)).toContain('r3');
  });

  it('filters rules by enabled state', () => {
    automationEngine.registerRule(makeRuleInput({ id: 'r1', enabled: true }));
    automationEngine.registerRule(makeRuleInput({ id: 'r2', enabled: false }));

    const enabled = automationEngine.listRules({ enabled: true });
    expect(enabled).toHaveLength(1);
    expect(enabled[0].id).toBe('r1');

    const disabled = automationEngine.listRules({ enabled: false });
    expect(disabled).toHaveLength(1);
    expect(disabled[0].id).toBe('r2');
  });

  it('enables and disables a rule', () => {
    automationEngine.registerRule(makeRuleInput());
    expect(automationEngine.getRule('test-rule-1')!.enabled).toBe(true);

    automationEngine.setRuleEnabled('test-rule-1', false);
    expect(automationEngine.getRule('test-rule-1')!.enabled).toBe(false);

    automationEngine.setRuleEnabled('test-rule-1', true);
    expect(automationEngine.getRule('test-rule-1')!.enabled).toBe(true);
  });

  it('returns false when toggling unknown rule', () => {
    expect(automationEngine.setRuleEnabled('nonexistent', true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule Configuration
// ---------------------------------------------------------------------------

describe('AutomationEngine - Rule Configuration', () => {
  it('configures throttle from input', () => {
    const rule = automationEngine.registerRule(makeRuleInput({
      throttleIntervalMs: 5000,
      throttleMode: 'trailing',
      throttleGroupBy: 'path',
    }));

    expect(rule.throttle).toBeDefined();
    expect(rule.throttle!.intervalMs).toBe(5000);
    expect(rule.throttle!.mode).toBe('trailing');
    expect(rule.throttle!.groupBy).toBe('path');
  });

  it('configures retry from input', () => {
    const rule = automationEngine.registerRule(makeRuleInput({
      maxRetries: 3,
      retryBaseDelayMs: 2000,
    }));

    expect(rule.retry).toBeDefined();
    expect(rule.retry!.maxRetries).toBe(3);
    expect(rule.retry!.baseDelayMs).toBe(2000);
    expect(rule.retry!.maxDelayMs).toBe(30000);
  });

  it('configures conditions from input', () => {
    const rule = automationEngine.registerRule(makeRuleInput({
      conditions: [
        { type: 'min-agents', value: 1 },
        { type: 'skill-exists', value: 'code-review' },
      ],
    }));

    expect(rule.conditions).toHaveLength(2);
    expect(rule.conditions![0].type).toBe('min-agents');
    expect(rule.conditions![1].value).toBe('code-review');
  });

  it('sets defaults for optional fields', () => {
    const rule = automationEngine.registerRule(makeRuleInput());

    expect(rule.enabled).toBe(true);
    expect(rule.priority).toBe('normal');
    expect(rule.maxConcurrent).toBe(3);
    expect(rule.tags).toEqual([]);
    expect(rule.throttle).toBeUndefined();
    expect(rule.retry).toBeUndefined();
  });

  it('configures wildcard events', () => {
    const rule = automationEngine.registerRule(makeRuleInput({
      events: ['workspace:*'],
    }));
    expect(rule.matcher.events).toEqual(['workspace:*']);
  });

  it('configures event filters', () => {
    const rule = automationEngine.registerRule(makeRuleInput({
      filters: { event: 'commit', path: '*my-project*' },
    }));
    expect(rule.matcher.filters).toBeDefined();
  });

  it('configures required fields', () => {
    const rule = automationEngine.registerRule(makeRuleInput({
      requiredFields: ['path', 'event'],
    }));
    expect(rule.matcher.requiredFields).toEqual(['path', 'event']);
  });

  it('configures max concurrent', () => {
    const rule = automationEngine.registerRule(makeRuleInput({
      maxConcurrent: 5,
    }));
    expect(rule.maxConcurrent).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Engine Enable/Disable
// ---------------------------------------------------------------------------

describe('AutomationEngine - Enable/Disable', () => {
  it('can be disabled globally', () => {
    automationEngine.setEnabled(false);
    expect(automationEngine.isEnabled()).toBe(false);
  });

  it('can be re-enabled', () => {
    automationEngine.setEnabled(false);
    automationEngine.setEnabled(true);
    expect(automationEngine.isEnabled()).toBe(true);
  });
});
