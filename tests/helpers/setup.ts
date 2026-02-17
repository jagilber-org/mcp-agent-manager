// tests/helpers/setup.ts
// Shared test fixtures, mock providers, and spy helpers used across test files.

import { vi, type MockInstance } from 'vitest';
import { agentRegistry } from '../../src/services/agentRegistry.js';
import { skillStore } from '../../src/services/skillStore.js';
import { automationEngine } from '../../src/services/automation/index.js';
import { registerProvider } from '../../src/services/taskRouter.js';
import * as sharedState from '../../src/services/sharedState.js';
import * as mailboxPersistence from '../../src/services/mailboxPersistence.js';
import type { AgentConfig, AgentResponse } from '../../src/types/index.js';
import type { AutomationRuleInput } from '../../src/types/automation.js';

// ---------------------------------------------------------------------------
// Persist-spy helpers - prevent tests from writing to disk
// ---------------------------------------------------------------------------

/** Create spies that intercept disk-write methods on all store singletons. */
export function createPersistSpies(): MockInstance[] {
  return [
    vi.spyOn(skillStore as any, 'persist').mockImplementation(() => {}),
    vi.spyOn(agentRegistry as any, 'save').mockImplementation(() => {}),
    vi.spyOn(automationEngine as any, 'persistRules').mockImplementation(() => {}),
    vi.spyOn(sharedState, 'persistCrossRepoEntry').mockImplementation(() => {}),
    vi.spyOn(sharedState, 'persistTaskHistoryEntry').mockImplementation(() => {}),
    vi.spyOn(sharedState, 'persistRouterMetrics').mockImplementation(() => {}),
    vi.spyOn(sharedState, 'persistAgentStats').mockImplementation(() => {}),
    vi.spyOn(mailboxPersistence, 'appendMessageToLog').mockImplementation(() => {}),
    vi.spyOn(mailboxPersistence, 'rewriteMessageLog').mockImplementation(() => {}),
    vi.spyOn(mailboxPersistence, 'broadcastToPeers').mockImplementation(() => {}),
  ];
}

/** Restore all persist spies. */
export function restoreSpies(spies: MockInstance[]): void {
  for (const spy of spies) spy.mockRestore();
}

// ---------------------------------------------------------------------------
// Clean-state helper - reset singletons between tests
// ---------------------------------------------------------------------------

/** Remove all agents, rules; re-enable engine. */
export function cleanState(): void {
  for (const a of agentRegistry.getAll()) agentRegistry.unregister(a.config.id);
  for (const rule of automationEngine.listRules()) automationEngine.removeRule(rule.id);
  automationEngine.setEnabled(true);
}

// ---------------------------------------------------------------------------
// Agent fixtures
// ---------------------------------------------------------------------------

export const TEST_AGENT: AgentConfig = {
  id: 'func-agent-1',
  name: 'Functional Test Agent',
  provider: 'copilot',
  model: 'test-model-1',
  transport: 'stdio',
  endpoint: '',
  maxConcurrency: 3,
  costMultiplier: 1,
  tags: ['code', 'review', 'security'],
  canMutate: false,
  timeoutMs: 30000,
};

export const TEST_AGENT_2: AgentConfig = {
  id: 'func-agent-2',
  name: 'Functional Test Agent 2',
  provider: 'anthropic',
  model: 'test-model-2',
  transport: 'stdio',
  endpoint: '',
  maxConcurrency: 2,
  costMultiplier: 2,
  tags: ['code', 'security', 'fast'],
  canMutate: true,
  timeoutMs: 15000,
};

// ---------------------------------------------------------------------------
// Mock providers
// ---------------------------------------------------------------------------

/** Returns a provider that emits predictable success responses. */
export function createMockProvider(responseContent = 'mock-response', latencyMs = 10) {
  return async (agent: AgentConfig, prompt: string, _maxTokens: number, _timeoutMs: number): Promise<AgentResponse> => ({
    agentId: agent.id,
    model: agent.model,
    content: `${responseContent} from ${agent.id}: ${prompt.substring(0, 50)}`,
    tokenCount: Math.ceil((prompt.length + responseContent.length) / 4),
    latencyMs,
    costUnits: agent.costMultiplier * 0.001,
    success: true,
    timestamp: new Date(),
    tokenCountEstimated: true,
    premiumRequests: 1,
  });
}

/** Returns a provider that always fails. */
export function createFailingProvider(errorMsg = 'provider-error') {
  return async (agent: AgentConfig): Promise<AgentResponse> => ({
    agentId: agent.id,
    model: agent.model,
    content: '',
    tokenCount: 0,
    latencyMs: 5,
    costUnits: 0,
    success: false,
    error: errorMsg,
    timestamp: new Date(),
    tokenCountEstimated: false,
    premiumRequests: 0,
  });
}

// ---------------------------------------------------------------------------
// Rule builders
// ---------------------------------------------------------------------------

/** Build a rule for functional / pipeline tests. */
export function makeRule(overrides: Partial<AutomationRuleInput> = {}): AutomationRuleInput {
  return {
    id: overrides.id ?? 'func-rule-1',
    name: overrides.name ?? 'Functional Test Rule',
    description: overrides.description ?? 'Test rule for functional validation',
    events: overrides.events ?? ['workspace:git-event'],
    skillId: overrides.skillId ?? 'code-review',
    ...overrides,
  };
}

/** Build a minimal valid rule for automation-unit tests. */
export function makeRuleInput(overrides: Partial<AutomationRuleInput> = {}): AutomationRuleInput {
  return {
    id: overrides.id ?? 'test-rule-1',
    name: overrides.name ?? 'Test Rule',
    description: overrides.description ?? 'A test automation rule',
    events: overrides.events ?? ['workspace:git-event'],
    skillId: overrides.skillId ?? 'code-review',
    ...overrides,
  };
}

/** Register one throwaway test agent (used by automation tests). */
export function registerTestAgent(id = 'test-agent-1'): void {
  agentRegistry.register({
    id,
    name: 'Test Agent',
    provider: 'copilot',
    model: 'gpt-4o',
    transport: 'stdio',
    endpoint: '',
    maxConcurrency: 5,
    costMultiplier: 1,
    tags: ['code', 'review'],
    canMutate: false,
    timeoutMs: 30000,
  });
}

/** Register default mock providers for copilot and anthropic. */
export function registerMockProviders(): void {
  registerProvider('copilot', createMockProvider('copilot-response'));
  registerProvider('anthropic', createMockProvider('anthropic-response'));
}
