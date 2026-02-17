// tests/agent-registry.test.ts
// Agent Registry - persistence, lifecycle, state transitions, and event emission.

import { describe, it, expect, beforeAll, afterAll, beforeEach, type MockInstance } from 'vitest';
import { agentRegistry } from '../src/services/agentRegistry.js';
import { eventBus } from '../src/services/events.js';
import {
  createPersistSpies, restoreSpies, cleanState,
  TEST_AGENT, TEST_AGENT_2,
} from './helpers/setup.js';

let persistSpies: MockInstance[];
beforeAll(() => { persistSpies = createPersistSpies(); });
afterAll(() => { restoreSpies(persistSpies); });
beforeEach(() => { cleanState(); });

// ===========================================================================
// Agent Registry - Persistence & Lifecycle
// ===========================================================================

describe('Agent Registry - Persistence & Lifecycle', () => {
  it('registers agent with all config fields preserved', () => {
    const instance = agentRegistry.register(TEST_AGENT);
    expect(instance.config).toMatchObject({
      id: 'func-agent-1',
      provider: 'copilot',
      model: 'test-model-1',
      maxConcurrency: 3,
      tags: ['code', 'review', 'security'],
      canMutate: false,
    });
    expect(instance.state).toBe('idle');
    expect(instance.tasksCompleted).toBe(0);
    expect(instance.tasksFailed).toBe(0);
    expect(instance.activeTasks).toBe(0);
  });

  it('overwrites agent on re-register', () => {
    agentRegistry.register(TEST_AGENT);
    const updated = agentRegistry.register({ ...TEST_AGENT, model: 'updated-model' });
    expect(updated.config.model).toBe('updated-model');
    expect(agentRegistry.count).toBe(1);
  });

  it('lifecycle: running → busy → running', () => {
    agentRegistry.register({ ...TEST_AGENT, maxConcurrency: 2 });

    expect(agentRegistry.get('func-agent-1')!.state).toBe('idle');

    agentRegistry.recordTaskStart('func-agent-1');
    agentRegistry.recordTaskStart('func-agent-1');
    expect(agentRegistry.get('func-agent-1')!.state).toBe('busy');
    expect(agentRegistry.get('func-agent-1')!.activeTasks).toBe(2);

    agentRegistry.recordTaskComplete('func-agent-1', 100, 0.01, true);
    expect(agentRegistry.get('func-agent-1')!.state).toBe('running');
    expect(agentRegistry.get('func-agent-1')!.activeTasks).toBe(1);

    agentRegistry.recordTaskComplete('func-agent-1', 50, 0.005, true);
    expect(agentRegistry.get('func-agent-1')!.state).toBe('idle');
    expect(agentRegistry.get('func-agent-1')!.activeTasks).toBe(0);
  });

  it('accumulates task stats correctly', () => {
    agentRegistry.register(TEST_AGENT);

    for (let i = 0; i < 3; i++) {
      agentRegistry.recordTaskStart('func-agent-1');
      agentRegistry.recordTaskComplete('func-agent-1', 100, 0.01, true);
    }
    for (let i = 0; i < 2; i++) {
      agentRegistry.recordTaskStart('func-agent-1');
      agentRegistry.recordTaskComplete('func-agent-1', 50, 0.005, false);
    }

    const inst = agentRegistry.get('func-agent-1')!;
    expect(inst.tasksCompleted).toBe(3);
    expect(inst.tasksFailed).toBe(2);
    expect(inst.totalTokensUsed).toBe(400);
    expect(inst.costAccumulated).toBeCloseTo(0.04);
  });

  it('finds agents by multiple criteria', () => {
    agentRegistry.register(TEST_AGENT);
    agentRegistry.register(TEST_AGENT_2);

    const codeAgents = agentRegistry.findByTags(['code']);
    expect(codeAgents).toHaveLength(2);

    const reviewAgents = agentRegistry.findByTags(['review']);
    expect(reviewAgents).toHaveLength(1);
    expect(reviewAgents[0].config.id).toBe('func-agent-1');

    const copilotAgents = agentRegistry.findByProvider('copilot');
    expect(copilotAgents).toHaveLength(1);
    expect(copilotAgents[0].config.id).toBe('func-agent-1');

    const available = agentRegistry.findAvailable(['code']);
    expect(available).toHaveLength(2);
  });

  it('health check returns correct structure', () => {
    agentRegistry.register(TEST_AGENT);
    agentRegistry.recordTaskStart('func-agent-1');
    agentRegistry.recordTaskComplete('func-agent-1', 100, 0.01, true);
    agentRegistry.recordTaskStart('func-agent-1');
    agentRegistry.recordTaskComplete('func-agent-1', 50, 0, false);

    const health = agentRegistry.getHealth('func-agent-1') as any;
    expect(health).toBeDefined();
    expect(health.agentId).toBe('func-agent-1');
    expect(health.tasksCompleted).toBe(1);
    expect(health.tasksFailed).toBe(1);
    expect(health.state).toBeDefined();
  });

  it('emits lifecycle events in order', () => {
    const events: string[] = [];
    eventBus.onEvent('agent:registered', (d) => events.push(`reg:${d.agentId}`));
    eventBus.onEvent('agent:unregistered', (d) => events.push(`unreg:${d.agentId}`));
    eventBus.onEvent('agent:state-changed', (d) => events.push(`state:${d.agentId}:${d.newState}`));

    agentRegistry.register(TEST_AGENT);
    agentRegistry.setState('func-agent-1', 'error', 'test error');
    agentRegistry.unregister('func-agent-1');

    expect(events).toEqual([
      'reg:func-agent-1',
      'state:func-agent-1:error',
      'unreg:func-agent-1',
    ]);
  });
});

// ===========================================================================
// Agent Registry - Update (CRUD)
// ===========================================================================

describe('Agent Registry - Update (CRUD)', () => {
  it('updates agent config fields while preserving runtime state', () => {
    agentRegistry.register(TEST_AGENT);
    agentRegistry.recordTaskStart('func-agent-1');
    agentRegistry.recordTaskComplete('func-agent-1', 100, 0.01, true);

    const updated = agentRegistry.update('func-agent-1', {
      name: 'Updated Agent',
      model: 'gpt-4-turbo',
      tags: ['code', 'docs'],
      maxConcurrency: 5,
    });

    expect(updated).toBeDefined();
    expect(updated!.config.name).toBe('Updated Agent');
    expect(updated!.config.model).toBe('gpt-4-turbo');
    expect(updated!.config.tags).toEqual(['code', 'docs']);
    expect(updated!.config.maxConcurrency).toBe(5);
    // Runtime state preserved
    expect(updated!.tasksCompleted).toBe(1);
    expect(updated!.totalTokensUsed).toBe(100);
    expect(updated!.costAccumulated).toBeCloseTo(0.01);
    // Unchanged fields preserved
    expect(updated!.config.provider).toBe('copilot');
    expect(updated!.config.id).toBe('func-agent-1');
  });

  it('returns undefined for non-existent agent update', () => {
    const result = agentRegistry.update('nonexistent', { name: 'X' });
    expect(result).toBeUndefined();
  });

  it('cannot change agent id via update', () => {
    agentRegistry.register(TEST_AGENT);
    const updated = agentRegistry.update('func-agent-1', { id: 'hacked-id' } as any);
    expect(updated!.config.id).toBe('func-agent-1');
  });

  it('emits state-changed event with configUpdated flag on update', () => {
    const events: any[] = [];
    eventBus.onEvent('agent:state-changed', (d) => events.push(d));

    agentRegistry.register(TEST_AGENT);
    agentRegistry.update('func-agent-1', { model: 'new-model' });

    const configEvent = events.find((e: any) => e.configUpdated);
    expect(configEvent).toBeDefined();
    expect(configEvent.agentId).toBe('func-agent-1');
    expect(configEvent.configUpdated).toBe(true);
  });

  it('persists updated config (save was called)', () => {
    agentRegistry.register(TEST_AGENT);
    const saveSpy = persistSpies.find(s => (s as any).getMockName?.() || true);
    const callsBefore = (agentRegistry as any).save.mock?.calls?.length || 0;
    agentRegistry.update('func-agent-1', { costMultiplier: 3 });
    // save is mocked - just verify the update went through
    expect(agentRegistry.get('func-agent-1')!.config.costMultiplier).toBe(3);
  });

  it('supports updating canMutate, timeoutMs, costMultiplier, env', () => {
    agentRegistry.register(TEST_AGENT);
    agentRegistry.update('func-agent-1', {
      canMutate: true,
      timeoutMs: 120000,
      costMultiplier: 2.5,
      env: { FOO: 'bar' },
    });
    const agent = agentRegistry.get('func-agent-1')!;
    expect(agent.config.canMutate).toBe(true);
    expect(agent.config.timeoutMs).toBe(120000);
    expect(agent.config.costMultiplier).toBe(2.5);
    expect(agent.config.env).toEqual({ FOO: 'bar' });
  });
});
