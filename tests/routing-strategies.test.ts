// tests/routing-strategies.test.ts
// Tests for improved routing strategies: consensus (real synthesis),
// cost-optimized (quality evaluation), fallback (fallbackOnEmpty),
// and evaluate (two-agent workflow).

import { describe, it, expect, beforeAll, afterAll, beforeEach, type MockInstance } from 'vitest';
import { agentRegistry } from '../src/services/agentRegistry.js';
import { skillStore } from '../src/services/skillStore.js';
import { registerProvider, routeTask } from '../src/services/taskRouter.js';
import {
  createPersistSpies, restoreSpies, cleanState,
  TEST_AGENT, TEST_AGENT_2,
  createMockProvider, createFailingProvider, registerMockProviders,
} from './helpers/setup.js';
import type { AgentConfig, AgentResponse, SkillDefinition } from '../src/types/index.js';

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
// Consensus Strategy - Real Synthesis
// ===========================================================================

describe('Consensus Strategy - synthesis pass', () => {
  it('produces a synthesis that includes "Consensus" marker', async () => {
    const skill: SkillDefinition = {
      id: 'test-consensus-synth', name: 'Consensus Synth', description: 'Test',
      promptTemplate: 'Explain {topic}', strategy: 'consensus',
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    const result = await routeTask({
      taskId: 'consensus-synth-1', skillId: 'test-consensus-synth',
      params: { topic: 'TypeScript generics' }, priority: 0, createdAt: new Date(),
    });

    expect(result.success).toBe(true);
    // Should have fan-out responses + synthesis response
    expect(result.responses.length).toBeGreaterThanOrEqual(3);
    expect(result.finalContent).toContain('Consensus');
    expect(result.finalContent).toContain('synthesized by');

    skillStore.remove('test-consensus-synth');
  });

  it('falls back gracefully with only 1 successful response', async () => {
    registerProvider('copilot', createFailingProvider('copilot-down'));

    const skill: SkillDefinition = {
      id: 'test-consensus-single', name: 'Consensus Single', description: 'Test',
      promptTemplate: '{question}', strategy: 'consensus',
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    const result = await routeTask({
      taskId: 'consensus-single-1', skillId: 'test-consensus-single',
      params: { question: 'test' }, priority: 0, createdAt: new Date(),
    });

    expect(result.success).toBe(true);
    // With only 1 success, no synthesis pass happens
    const successCount = result.responses.filter(r => r.success).length;
    expect(successCount).toBe(1);

    skillStore.remove('test-consensus-single');
    registerMockProviders();
  });

  it('respects synthesizerTags when specified', async () => {
    const skill: SkillDefinition = {
      id: 'test-consensus-tags', name: 'Consensus Tags', description: 'Test',
      promptTemplate: '{question}', strategy: 'consensus',
      synthesizerTags: ['review'],
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    const result = await routeTask({
      taskId: 'consensus-tags-1', skillId: 'test-consensus-tags',
      params: { question: 'agree?' }, priority: 0, createdAt: new Date(),
    });

    expect(result.success).toBe(true);
    expect(result.finalContent).toContain('Consensus');

    skillStore.remove('test-consensus-tags');
  });
});

// ===========================================================================
// Cost-Optimized Strategy - Quality Evaluation
// ===========================================================================

describe('Cost-Optimized Strategy - quality evaluation', () => {
  it('accepts high-quality response from cheap agent', async () => {
    // Mock a provider that returns substantive content
    registerProvider('copilot', createMockProvider(
      'Here is a detailed explanation of TypeScript generics with code examples and best practices for type-safe programming',
      10
    ));

    const skill: SkillDefinition = {
      id: 'test-cost-quality', name: 'Cost Quality', description: 'Test',
      promptTemplate: 'Explain {topic} with examples', strategy: 'cost-optimized',
      qualityThreshold: 0.3,
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    const result = await routeTask({
      taskId: 'cost-quality-1', skillId: 'test-cost-quality',
      params: { topic: 'TypeScript generics' }, priority: 0, createdAt: new Date(),
    });

    expect(result.success).toBe(true);
    // Should accept from cheaper agent without escalating
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0].agentId).toBe('func-agent-1');

    skillStore.remove('test-cost-quality');
    registerMockProviders();
  });

  it('escalates when cheap agent returns low-quality response', async () => {
    // Mock cheap provider returns near-empty content
    registerProvider('copilot', async (agent: AgentConfig): Promise<AgentResponse> => ({
      agentId: agent.id,
      model: agent.model,
      content: 'ok',
      tokenCount: 2,
      latencyMs: 5,
      costUnits: 0,
      success: true,
      timestamp: new Date(),
      tokenCountEstimated: true,
      premiumRequests: 1,
    }));

    const skill: SkillDefinition = {
      id: 'test-cost-escalate', name: 'Cost Escalate', description: 'Test',
      promptTemplate: 'Explain {topic} in detail with working code examples', strategy: 'cost-optimized',
      qualityThreshold: 0.5,
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    const result = await routeTask({
      taskId: 'cost-escalate-1', skillId: 'test-cost-escalate',
      params: { topic: 'TypeScript generics' }, priority: 0, createdAt: new Date(),
    });

    expect(result.success).toBe(true);
    // Should have escalated to second agent
    expect(result.responses.length).toBeGreaterThanOrEqual(2);

    skillStore.remove('test-cost-escalate');
    registerMockProviders();
  });

  it('uses default threshold when qualityThreshold not set', async () => {
    const skill: SkillDefinition = {
      id: 'test-cost-default', name: 'Cost Default', description: 'Test',
      promptTemplate: '{question}', strategy: 'cost-optimized',
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    const result = await routeTask({
      taskId: 'cost-default-1', skillId: 'test-cost-default',
      params: { question: 'explain closures' }, priority: 0, createdAt: new Date(),
    });

    expect(result.success).toBe(true);

    skillStore.remove('test-cost-default');
  });
});

// ===========================================================================
// Fallback Strategy - fallbackOnEmpty
// ===========================================================================

describe('Fallback Strategy - fallbackOnEmpty', () => {
  it('falls back on empty response when fallbackOnEmpty is true', async () => {
    // Mock copilot returns empty success
    registerProvider('copilot', async (agent: AgentConfig): Promise<AgentResponse> => ({
      agentId: agent.id,
      model: agent.model,
      content: '  ',
      tokenCount: 0,
      latencyMs: 5,
      costUnits: 0,
      success: true,
      timestamp: new Date(),
      tokenCountEstimated: true,
      premiumRequests: 1,
    }));

    const skill: SkillDefinition = {
      id: 'test-fallback-empty', name: 'Fallback Empty', description: 'Test',
      promptTemplate: '{question}', strategy: 'fallback',
      fallbackOnEmpty: true,
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    const result = await routeTask({
      taskId: 'fallback-empty-1', skillId: 'test-fallback-empty',
      params: { question: 'test' }, priority: 0, createdAt: new Date(),
    });

    expect(result.success).toBe(true);
    // Should have tried copilot first (empty), then fallen back to anthropic
    expect(result.responses.length).toBe(2);
    const lastResponse = result.responses[result.responses.length - 1];
    expect(lastResponse.success).toBe(true);
    expect(lastResponse.content.length).toBeGreaterThan(20);

    skillStore.remove('test-fallback-empty');
    registerMockProviders();
  });

  it('does NOT fall back on empty when fallbackOnEmpty is false', async () => {
    // Mock copilot returns empty success
    registerProvider('copilot', async (agent: AgentConfig): Promise<AgentResponse> => ({
      agentId: agent.id,
      model: agent.model,
      content: '',
      tokenCount: 0,
      latencyMs: 5,
      costUnits: 0,
      success: true,
      timestamp: new Date(),
      tokenCountEstimated: true,
      premiumRequests: 1,
    }));

    const skill: SkillDefinition = {
      id: 'test-fallback-no-empty', name: 'Fallback No Empty', description: 'Test',
      promptTemplate: '{question}', strategy: 'fallback',
      // fallbackOnEmpty not set (defaults to undefined/false)
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    const result = await routeTask({
      taskId: 'fallback-no-empty-1', skillId: 'test-fallback-no-empty',
      params: { question: 'test' }, priority: 0, createdAt: new Date(),
    });

    // Should accept the empty response without fallback
    expect(result.responses).toHaveLength(1);

    skillStore.remove('test-fallback-no-empty');
    registerMockProviders();
  });

  it('original fallback still works on provider errors', async () => {
    registerProvider('copilot', createFailingProvider('boom'));
    registerProvider('anthropic', createMockProvider('rescue'));

    const skill: SkillDefinition = {
      id: 'test-fallback-error', name: 'Fallback Error', description: 'Test',
      promptTemplate: '{question}', strategy: 'fallback',
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    const result = await routeTask({
      taskId: 'fallback-error-1', skillId: 'test-fallback-error',
      params: { question: 'test' }, priority: 0, createdAt: new Date(),
    });

    expect(result.success).toBe(true);
    expect(result.responses.length).toBe(2);
    expect(result.responses[0].success).toBe(false);
    expect(result.responses[1].success).toBe(true);
    expect(result.responses[1].content).toContain('rescue');

    skillStore.remove('test-fallback-error');
    registerMockProviders();
  });
});

// ===========================================================================
// Evaluate Strategy - Two-agent Workflow
// ===========================================================================

describe('Evaluate Strategy - two-agent workflow', () => {
  it('sends to doer then evaluator, combines results', async () => {
    const skill: SkillDefinition = {
      id: 'test-evaluate', name: 'Evaluate Test', description: 'Test',
      promptTemplate: 'Implement {feature}', strategy: 'evaluate',
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    const result = await routeTask({
      taskId: 'evaluate-1', skillId: 'test-evaluate',
      params: { feature: 'a sorting algorithm' }, priority: 0, createdAt: new Date(),
    });

    expect(result.success).toBe(true);
    expect(result.responses).toHaveLength(2);
    // Final content should include both original and evaluation
    expect(result.finalContent).toContain('Original Response');
    expect(result.finalContent).toContain('Evaluation');

    skillStore.remove('test-evaluate');
  });

  it('returns just doer response when doer fails', async () => {
    registerProvider('copilot', createFailingProvider('doer-error'));

    const skill: SkillDefinition = {
      id: 'test-evaluate-fail', name: 'Evaluate Fail', description: 'Test',
      promptTemplate: '{question}', strategy: 'evaluate',
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    const result = await routeTask({
      taskId: 'evaluate-fail-1', skillId: 'test-evaluate-fail',
      params: { question: 'test' }, priority: 0, createdAt: new Date(),
    });

    // Doer failed => only 1 response, no evaluation
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0].success).toBe(false);

    skillStore.remove('test-evaluate-fail');
    registerMockProviders();
  });

  it('falls back to single when only 1 agent available', async () => {
    agentRegistry.unregister('func-agent-2');

    const skill: SkillDefinition = {
      id: 'test-evaluate-single', name: 'Evaluate Single', description: 'Test',
      promptTemplate: '{question}', strategy: 'evaluate',
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    const result = await routeTask({
      taskId: 'evaluate-single-1', skillId: 'test-evaluate-single',
      params: { question: 'test' }, priority: 0, createdAt: new Date(),
    });

    // With 1 agent, falls back to single strategy
    expect(result.success).toBe(true);
    expect(result.responses).toHaveLength(1);

    skillStore.remove('test-evaluate-single');
  });
});

// ===========================================================================
// Premium Requests & Estimated Tokens in TaskResult
// ===========================================================================

describe('Metrics propagation in task results', () => {
  it('tracks premiumRequests and tokensEstimated in history entries', async () => {
    const skill: SkillDefinition = {
      id: 'test-metrics-track', name: 'Metrics Track', description: 'Test',
      promptTemplate: '{input}', strategy: 'single',
      version: '1.0.0', categories: ['test'],
    };
    skillStore.register(skill);

    await routeTask({
      taskId: 'metrics-track-1', skillId: 'test-metrics-track',
      params: { input: 'test' }, priority: 0, createdAt: new Date(),
    });

    const metrics = (await import('../src/services/taskRouter.js')).getRouterMetrics();
    const entry = metrics.recentTasks.find(t => t.taskId === 'metrics-track-1');
    expect(entry).toBeDefined();
    expect(typeof entry!.premiumRequests).toBe('number');
    expect(typeof entry!.tokensEstimated).toBe('boolean');

    skillStore.remove('test-metrics-track');
  });
});
