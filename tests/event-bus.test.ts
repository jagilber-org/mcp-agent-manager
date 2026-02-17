// tests/event-bus.test.ts
// Event Bus - propagation of workspace, agent, and task events with correct data.

import { describe, it, expect, beforeAll, afterAll, beforeEach, type MockInstance } from 'vitest';
import { agentRegistry } from '../src/services/agentRegistry.js';
import { skillStore } from '../src/services/skillStore.js';
import { eventBus } from '../src/services/events.js';
import { routeTask } from '../src/services/taskRouter.js';
import {
  createPersistSpies, restoreSpies, cleanState,
  TEST_AGENT, registerMockProviders,
} from './helpers/setup.js';
import type { SkillDefinition } from '../src/types/index.js';

let persistSpies: MockInstance[];
beforeAll(() => { persistSpies = createPersistSpies(); });
afterAll(() => { restoreSpies(persistSpies); });
beforeEach(() => {
  cleanState();
  registerMockProviders();
});

// ===========================================================================
// Event Bus - Propagation & Typing
// ===========================================================================

describe('Event Bus - Propagation & Typing', () => {
  it('delivers all workspace event types', () => {
    const received: string[] = [];

    const wsEvents = [
      'workspace:monitoring',
      'workspace:stopped',
      'workspace:file-changed',
      'workspace:session-updated',
      'workspace:git-event',
      'workspace:remote-update',
    ] as const;

    for (const evt of wsEvents) {
      eventBus.onEvent(evt, () => received.push(evt));
    }

    eventBus.emitEvent('workspace:monitoring', { path: '/test', sessionCount: 0 });
    eventBus.emitEvent('workspace:stopped', { path: '/test' });
    eventBus.emitEvent('workspace:file-changed', { path: '/test', file: 'a.ts', kind: 'modified' });
    eventBus.emitEvent('workspace:session-updated', { path: '/test', sessionId: 's1', file: 'f.jsonl', sizeBytes: 100 });
    eventBus.emitEvent('workspace:git-event', { path: '/test', event: 'commit', detail: 'test' });
    eventBus.emitEvent('workspace:remote-update', { path: '/test', remote: 'origin', branch: 'main', oldRef: 'a', newRef: 'b', detail: 'fast-forward' });

    expect(received).toHaveLength(6);
    expect(received).toEqual([
      'workspace:monitoring',
      'workspace:stopped',
      'workspace:file-changed',
      'workspace:session-updated',
      'workspace:git-event',
      'workspace:remote-update',
    ]);
  });

  it('delivers agent lifecycle events with correct data', () => {
    let regData: any = null;
    let stateData: any = null;

    eventBus.onEvent('agent:registered', (d) => { regData = d; });
    eventBus.onEvent('agent:state-changed', (d) => { stateData = d; });

    agentRegistry.register(TEST_AGENT);
    agentRegistry.setState('func-agent-1', 'busy');

    expect(regData).toMatchObject({
      agentId: 'func-agent-1',
      provider: 'copilot',
      model: 'test-model-1',
      tags: ['code', 'review', 'security'],
    });

    expect(stateData).toMatchObject({
      agentId: 'func-agent-1',
      previousState: 'idle',
      newState: 'busy',
    });
  });

  it('delivers task events with metrics', async () => {
    agentRegistry.register(TEST_AGENT);
    let completedData: any = null;
    eventBus.onEvent('task:completed', (d) => { completedData = d; });

    const skill: SkillDefinition = {
      id: 'func-bus-task', name: 'Bus Task', description: 'Test',
      promptTemplate: '{input}', strategy: 'single',
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    await routeTask({
      taskId: 'bus-task-1', skillId: 'func-bus-task',
      params: { input: 'test' }, priority: 0, createdAt: new Date(),
    });

    expect(completedData).toBeDefined();
    expect(completedData.taskId).toBe('bus-task-1');
    expect(completedData.success).toBe(true);
    expect(completedData.totalTokens).toBeGreaterThan(0);
    expect(completedData.totalLatencyMs).toBeGreaterThanOrEqual(0);

    skillStore.remove('func-bus-task');
  });
});
