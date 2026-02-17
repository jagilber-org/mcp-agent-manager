// tests/task-router.test.ts
// Task Router - strategy execution (single, fan-out, fallback, race,
// consensus, cost-optimized), event emission, and metrics accumulation.

import { describe, it, expect, beforeAll, afterAll, beforeEach, type MockInstance } from 'vitest';
import { agentRegistry } from '../src/services/agentRegistry.js';
import { skillStore } from '../src/services/skillStore.js';
import { eventBus } from '../src/services/events.js';
import { registerProvider, routeTask, getRouterMetrics } from '../src/services/taskRouter.js';
import {
  createPersistSpies, restoreSpies, cleanState,
  TEST_AGENT, TEST_AGENT_2,
  createMockProvider, createFailingProvider, registerMockProviders,
} from './helpers/setup.js';
import type { SkillDefinition } from '../src/types/index.js';

let persistSpies: MockInstance[];
beforeAll(() => { persistSpies = createPersistSpies(); });
afterAll(() => { restoreSpies(persistSpies); });
beforeEach(() => {
  cleanState();
  registerMockProviders();
  agentRegistry.register(TEST_AGENT);
  agentRegistry.register(TEST_AGENT_2);
});

// ===========================================================================
// Task Router - Strategy Execution
// ===========================================================================

describe('Task Router - Strategy Execution', () => {
  it('single strategy: picks one agent, returns one response', async () => {
    const skill: SkillDefinition = {
      id: 'func-single', name: 'Single Test', description: 'Test',
      promptTemplate: 'Test prompt: {input}', strategy: 'single',
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    const result = await routeTask({
      taskId: 'func-task-1', skillId: 'func-single',
      params: { input: 'hello world' }, priority: 0, createdAt: new Date(),
    });

    expect(result.success).toBe(true);
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0].success).toBe(true);
    expect(result.responses[0].content).toContain('hello world');
    expect(result.totalTokens).toBeGreaterThan(0);
    expect(result.totalLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.strategy).toBe('single');

    skillStore.remove('func-single');
  });

  it('fan-out strategy: sends to all agents, collects all responses', async () => {
    const skill: SkillDefinition = {
      id: 'func-fanout', name: 'Fan-out Test', description: 'Test',
      promptTemplate: 'Review: {code}', strategy: 'fan-out', mergeResults: true,
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    const result = await routeTask({
      taskId: 'func-task-fanout', skillId: 'func-fanout',
      params: { code: 'const x = 1;' }, priority: 0, createdAt: new Date(),
    });

    expect(result.success).toBe(true);
    expect(result.responses.length).toBeGreaterThanOrEqual(2);
    expect(result.finalContent).toContain('func-agent-1');
    expect(result.finalContent).toContain('func-agent-2');

    skillStore.remove('func-fanout');
  });

  it('fallback strategy: tries agents in cost order', async () => {
    registerProvider('copilot', createFailingProvider('copilot-down'));
    registerProvider('anthropic', createMockProvider('fallback-success'));

    const skill: SkillDefinition = {
      id: 'func-fallback', name: 'Fallback Test', description: 'Test',
      promptTemplate: 'Test: {input}', strategy: 'fallback',
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    const result = await routeTask({
      taskId: 'func-task-fallback', skillId: 'func-fallback',
      params: { input: 'test' }, priority: 0, createdAt: new Date(),
    });

    expect(result.success).toBe(true);
    const failed = result.responses.find(r => !r.success);
    const succeeded = result.responses.find(r => r.success);
    expect(failed).toBeDefined();
    expect(failed!.error).toBe('copilot-down');
    expect(succeeded).toBeDefined();
    expect(succeeded!.content).toContain('fallback-success');

    skillStore.remove('func-fallback');
    registerMockProviders();
  });

  it('race strategy: returns first success', async () => {
    const skill: SkillDefinition = {
      id: 'func-race', name: 'Race Test', description: 'Test',
      promptTemplate: '{question}', strategy: 'race',
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    const result = await routeTask({
      taskId: 'func-task-race', skillId: 'func-race',
      params: { question: 'who wins?' }, priority: 0, createdAt: new Date(),
    });

    expect(result.success).toBe(true);
    expect(result.responses.length).toBeGreaterThanOrEqual(1);
    expect(result.finalContent).toBeTruthy();

    skillStore.remove('func-race');
  });

  it('consensus strategy: merges multiple agent responses', async () => {
    const skill: SkillDefinition = {
      id: 'func-consensus', name: 'Consensus Test', description: 'Test',
      promptTemplate: '{question}', strategy: 'consensus', mergeResults: true,
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    const result = await routeTask({
      taskId: 'func-task-consensus', skillId: 'func-consensus',
      params: { question: 'agree?' }, priority: 0, createdAt: new Date(),
    });

    expect(result.success).toBe(true);
    expect(result.responses.length).toBeGreaterThanOrEqual(2);
    expect(result.finalContent).toContain('Consensus');

    skillStore.remove('func-consensus');
  });

  it('cost-optimized strategy: starts with cheapest agent', async () => {
    const skill: SkillDefinition = {
      id: 'func-cost-opt', name: 'Cost Opt Test', description: 'Test',
      promptTemplate: '{question}', strategy: 'cost-optimized',
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    const result = await routeTask({
      taskId: 'func-task-cost', skillId: 'func-cost-opt',
      params: { question: 'cheap first' }, priority: 0, createdAt: new Date(),
    });

    expect(result.success).toBe(true);
    expect(result.responses[0].agentId).toBe('func-agent-1');

    skillStore.remove('func-cost-opt');
  });

  it('emits task:started and task:completed events', async () => {
    const events: string[] = [];
    eventBus.onEvent('task:started', (d) => events.push(`started:${d.taskId}`));
    eventBus.onEvent('task:completed', (d) => events.push(`completed:${d.taskId}:${d.success}`));

    const skill: SkillDefinition = {
      id: 'func-event-test', name: 'Event Test', description: 'Test',
      promptTemplate: '{input}', strategy: 'single',
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    await routeTask({
      taskId: 'func-event-task', skillId: 'func-event-test',
      params: { input: 'test' }, priority: 0, createdAt: new Date(),
    });

    expect(events).toContain('started:func-event-task');
    expect(events).toContain('completed:func-event-task:true');

    skillStore.remove('func-event-test');
  });

  it('metrics accumulate across tasks', async () => {
    const before = getRouterMetrics();

    const skill: SkillDefinition = {
      id: 'func-metrics', name: 'Metrics Test', description: 'Test',
      promptTemplate: '{input}', strategy: 'single',
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    await routeTask({
      taskId: 'func-metrics-1', skillId: 'func-metrics',
      params: { input: 'a' }, priority: 0, createdAt: new Date(),
    });
    await routeTask({
      taskId: 'func-metrics-2', skillId: 'func-metrics',
      params: { input: 'b' }, priority: 0, createdAt: new Date(),
    });

    const after = getRouterMetrics();
    expect(after.totalTasks).toBe(before.totalTasks + 2);
    expect(after.totalTokens).toBeGreaterThan(before.totalTokens);

    skillStore.remove('func-metrics');
  });
});
