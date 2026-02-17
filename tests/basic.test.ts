// tests/basic.test.ts
// Basic unit tests for core subsystems

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type MockInstance } from 'vitest';
import { agentRegistry as _agentRegistry } from '../src/services/agentRegistry.js';
import { skillStore as _skillStore } from '../src/services/skillStore.js';
import { automationEngine as _automationEngine } from '../src/services/automation/index.js';

// ---------------------------------------------------------------------------
// Prevent tests from polluting production data files on disk.
// ---------------------------------------------------------------------------
let persistSpies: MockInstance[];

beforeAll(() => {
  persistSpies = [
    vi.spyOn(_skillStore as any, 'persist').mockImplementation(() => {}),
    vi.spyOn(_agentRegistry as any, 'save').mockImplementation(() => {}),
    vi.spyOn(_automationEngine as any, 'persistRules').mockImplementation(() => {}),
  ];
});

afterAll(() => {
  for (const spy of persistSpies) {
    spy.mockRestore();
  }
});

// Reset modules between tests to get fresh singletons
let agentRegistry: typeof import('../src/services/agentRegistry.js').agentRegistry;
let skillStore: typeof import('../src/services/skillStore.js').skillStore;
let eventBus: typeof import('../src/services/events.js').eventBus;

beforeEach(async () => {
  const agentMod = await import('../src/services/agentRegistry.js');
  agentRegistry = agentMod.agentRegistry;
  const eventMod = await import('../src/services/events.js');
  eventBus = eventMod.eventBus;

  // Clean up agents from prior tests
  for (const a of agentRegistry.getAll()) {
    agentRegistry.unregister(a.config.id);
  }
});

describe('AgentRegistry', () => {
  const testConfig = {
    id: 'test-1',
    name: 'Test Agent',
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-20250514',
    transport: 'stdio' as const,
    endpoint: '',
    maxConcurrency: 2,
    costMultiplier: 1,
    tags: ['code', 'review'],
    canMutate: false,
    timeoutMs: 30000,
  };

  it('registers an agent', () => {
    const instance = agentRegistry.register(testConfig);
    expect(instance.config.id).toBe('test-1');
    expect(instance.state).toBe('idle');
    expect(agentRegistry.count).toBe(1);
  });

  it('unregisters an agent', () => {
    agentRegistry.register(testConfig);
    expect(agentRegistry.unregister('test-1')).toBe(true);
    expect(agentRegistry.count).toBe(0);
  });

  it('returns false for unknown unregister', () => {
    expect(agentRegistry.unregister('nope')).toBe(false);
  });

  it('finds agents by tags', () => {
    agentRegistry.register(testConfig);
    agentRegistry.register({ ...testConfig, id: 'test-2', tags: ['security'] });

    const codeAgents = agentRegistry.findByTags(['code']);
    expect(codeAgents).toHaveLength(1);
    expect(codeAgents[0].config.id).toBe('test-1');

    const secAgents = agentRegistry.findByTags(['security']);
    expect(secAgents).toHaveLength(1);
    expect(secAgents[0].config.id).toBe('test-2');
  });

  it('finds available agents under concurrency limit', () => {
    agentRegistry.register(testConfig);
    const available = agentRegistry.findAvailable();
    expect(available).toHaveLength(1);

    // Simulate filling concurrency
    agentRegistry.recordTaskStart('test-1');
    agentRegistry.recordTaskStart('test-1');
    const nowAvailable = agentRegistry.findAvailable();
    expect(nowAvailable).toHaveLength(0); // maxConcurrency=2, both slots taken
  });

  it('tracks task stats', () => {
    agentRegistry.register(testConfig);
    agentRegistry.recordTaskStart('test-1');
    agentRegistry.recordTaskComplete('test-1', 500, 0.01, true);
    agentRegistry.recordTaskStart('test-1');
    agentRegistry.recordTaskComplete('test-1', 200, 0.005, false);

    const inst = agentRegistry.get('test-1')!;
    expect(inst.tasksCompleted).toBe(1);
    expect(inst.tasksFailed).toBe(1);
    expect(inst.totalTokensUsed).toBe(700);
    expect(inst.costAccumulated).toBeCloseTo(0.015);
  });

  it('emits events on register/unregister', () => {
    const events: string[] = [];
    eventBus.onEvent('agent:registered', (d) => events.push(`reg:${d.agentId}`));
    eventBus.onEvent('agent:unregistered', (d) => events.push(`unreg:${d.agentId}`));

    agentRegistry.register(testConfig);
    agentRegistry.unregister('test-1');

    expect(events).toEqual(['reg:test-1', 'unreg:test-1']);
  });
});

describe('EventBus', () => {
  it('delivers typed events', () => {
    let received: any = null;
    eventBus.onEvent('task:started', (data) => { received = data; });
    eventBus.emitEvent('task:started', {
      taskId: 't1',
      skillId: 'code-review',
      strategy: 'fan-out',
      agentCount: 2,
    });
    expect(received).toEqual({
      taskId: 't1',
      skillId: 'code-review',
      strategy: 'fan-out',
      agentCount: 2,
    });
  });
});
