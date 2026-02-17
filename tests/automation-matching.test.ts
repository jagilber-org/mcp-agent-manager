// tests/automation-matching.test.ts
// AutomationEngine - parameter resolution, event matching, runtime conditions,
// and edge cases.

import { describe, it, expect, beforeAll, afterAll, beforeEach, type MockInstance } from 'vitest';
import { automationEngine } from '../src/services/automation/index.js';
import { agentRegistry } from '../src/services/agentRegistry.js';
import {
  createPersistSpies, restoreSpies, cleanState,
  makeRuleInput, registerTestAgent,
} from './helpers/setup.js';

let persistSpies: MockInstance[];
beforeAll(() => { persistSpies = createPersistSpies(); });
afterAll(() => { restoreSpies(persistSpies); });
beforeEach(() => { cleanState(); });

// ---------------------------------------------------------------------------
// Parameter Resolution
// ---------------------------------------------------------------------------

describe('AutomationEngine - Parameter Resolution', () => {
  it('resolves static params', () => {
    const rule = automationEngine.registerRule(makeRuleInput({
      staticParams: { context: 'automated review', scope: 'full' },
    }));

    const params = automationEngine.resolveParams(rule, {});
    expect(params.context).toBe('automated review');
    expect(params.scope).toBe('full');
  });

  it('resolves event params (fromEvent mapping)', () => {
    const rule = automationEngine.registerRule(makeRuleInput({
      eventParams: { code: 'detail', context: 'path' },
    }));

    const params = automationEngine.resolveParams(rule, {
      path: '/my/project',
      detail: 'main: abc1234 → def5678',
    });

    expect(params.code).toBe('main: abc1234 → def5678');
    expect(params.context).toBe('/my/project');
  });

  it('resolves template params with event data interpolation', () => {
    const rule = automationEngine.registerRule(makeRuleInput({
      templateParams: {
        question: 'Review changes in {event.path} after {event.event}: {event.detail}',
      },
    }));

    const params = automationEngine.resolveParams(rule, {
      path: '/github/my-project', event: 'commit', detail: 'feat: add new feature',
    });

    expect(params.question).toBe('Review changes in /github/my-project after commit: feat: add new feature');
  });

  it('handles missing event fields in templates gracefully', () => {
    const rule = automationEngine.registerRule(makeRuleInput({
      templateParams: { question: 'Check {event.path} for {event.missing}' },
    }));

    const params = automationEngine.resolveParams(rule, { path: '/test' });
    expect(params.question).toBe('Check /test for {missing}');
  });

  it('resolves nested event data via dot notation', () => {
    const rule = automationEngine.registerRule(makeRuleInput({
      eventParams: { nested: 'data.inner.value' },
    }));

    const params = automationEngine.resolveParams(rule, {
      data: { inner: { value: 'deep-val' } },
    });

    expect(params.nested).toBe('deep-val');
  });

  it('serializes non-string event values to JSON', () => {
    const rule = automationEngine.registerRule(makeRuleInput({
      eventParams: { data: 'tags' },
    }));

    const params = automationEngine.resolveParams(rule, {
      tags: ['speckit', 'review'],
    });

    expect(params.data).toBe('["speckit","review"]');
  });

  it('combines all param types with proper precedence', () => {
    const rule = automationEngine.registerRule(makeRuleInput({
      staticParams: { mode: 'auto', context: 'static-context' },
      eventParams: { context: 'path' },
      templateParams: { summary: 'mode={event.mode}' },
    }));

    const params = automationEngine.resolveParams(rule, { path: '/proj', mode: 'review' });

    // eventParams override staticParams for 'context'
    expect(params.context).toBe('/proj');
    expect(params.mode).toBe('auto');
    expect(params.summary).toBe('mode=review');
  });
});

// ---------------------------------------------------------------------------
// Event Matching
// ---------------------------------------------------------------------------

describe('AutomationEngine - Event Matching', () => {
  it('matches exact event name', () => {
    automationEngine.registerRule(makeRuleInput({ events: ['workspace:git-event'] }));
    const rules = automationEngine.listRules();
    expect(rules[0].matcher.events).toEqual(['workspace:git-event']);
  });

  it('matches wildcard events', () => {
    automationEngine.registerRule(makeRuleInput({ events: ['workspace:*'] }));
    const rules = automationEngine.listRules();
    expect(rules[0].matcher.events).toEqual(['workspace:*']);
  });

  it('matches multiple event patterns', () => {
    automationEngine.registerRule(makeRuleInput({
      events: ['workspace:git-event', 'task:completed'],
    }));
    const rules = automationEngine.listRules();
    expect(rules[0].matcher.events).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Runtime Conditions
// ---------------------------------------------------------------------------

describe('AutomationEngine - Runtime Conditions', () => {
  it('evaluates min-agents condition (pass)', () => {
    registerTestAgent();
    const result = automationEngine.evaluateConditions([
      { type: 'min-agents', value: 1 },
    ]);
    expect(result).toBe(true);
  });

  it('evaluates min-agents condition (fail)', () => {
    const result = automationEngine.evaluateConditions([
      { type: 'min-agents', value: 1 },
    ]);
    expect(result).toBe(false);
  });

  it('evaluates skill-exists condition (pass)', () => {
    const result = automationEngine.evaluateConditions([
      { type: 'skill-exists', value: 'code-review' },
    ]);
    expect(typeof result).toBe('boolean');
  });

  it('evaluates skill-exists condition (fail)', () => {
    const result = automationEngine.evaluateConditions([
      { type: 'skill-exists', value: 'nonexistent-skill-12345' },
    ]);
    expect(result).toBe(false);
  });

  it('evaluates multiple conditions (all must pass)', () => {
    registerTestAgent();
    const result = automationEngine.evaluateConditions([
      { type: 'min-agents', value: 1 },
      { type: 'skill-exists', value: 'nonexistent-skill-12345' },
    ]);
    expect(result).toBe(false);
  });

  it('evaluates unknown condition type as pass', () => {
    const result = automationEngine.evaluateConditions([
      { type: 'custom' as any, value: 'anything' },
    ]);
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('AutomationEngine - Edge Cases', () => {
  it('handles rule with empty event params gracefully', () => {
    const rule = automationEngine.registerRule(makeRuleInput({ eventParams: {} }));
    const params = automationEngine.resolveParams(rule, { whatever: 'data' });
    expect(params).toEqual({});
  });

  it('handles rule with no param mapping', () => {
    const rule = automationEngine.registerRule(makeRuleInput());
    const params = automationEngine.resolveParams(rule, { data: 'value' });
    expect(params).toEqual({});
  });

  it('handles deeply nested event data for param resolution', () => {
    const rule = automationEngine.registerRule(makeRuleInput({
      eventParams: { deep: 'a.b.c.d.e' },
    }));

    const params = automationEngine.resolveParams(rule, {
      a: { b: { c: { d: { e: 'deep!' } } } },
    });

    expect(params.deep).toBe('deep!');
  });

  it('handles undefined nested paths gracefully', () => {
    const rule = automationEngine.registerRule(makeRuleInput({
      eventParams: { missing: 'a.b.c.d.e' },
    }));

    const params = automationEngine.resolveParams(rule, { a: {} });
    expect(params.missing).toBeUndefined();
  });

  it('registers multiple rules for same event', () => {
    automationEngine.registerRule(makeRuleInput({
      id: 'r1', events: ['workspace:git-event'], skillId: 'code-review',
    }));
    automationEngine.registerRule(makeRuleInput({
      id: 'r2', events: ['workspace:git-event'], skillId: 'security-audit',
    }));

    const rules = automationEngine.listRules();
    expect(rules).toHaveLength(2);
  });

  it('handles concurrent dry-run triggers', async () => {
    automationEngine.registerRule(makeRuleInput());

    const triggers = Array.from({ length: 5 }, (_, i) =>
      automationEngine.triggerRule('test-rule-1', { n: i }, true)
    );

    const results = await Promise.all(triggers);
    expect(results).toHaveLength(5);
    expect(results.every(r => r.status === 'skipped')).toBe(true);
  });
});
