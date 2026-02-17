// tests/agents-config.test.ts
// Tests for the 5-agent configuration in agents.json and agent registry
// loading, tag matching, provider lookup, and multi-agent availability.

import { describe, it, expect, beforeAll, afterAll, beforeEach, type MockInstance } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { agentRegistry } from '../src/services/agentRegistry.js';
import {
  createPersistSpies, restoreSpies, cleanState,
} from './helpers/setup.js';
import type { AgentConfig } from '../src/types/index.js';

let persistSpies: MockInstance[];
beforeAll(() => { persistSpies = createPersistSpies(); });
afterAll(() => { restoreSpies(persistSpies); });
beforeEach(() => { cleanState(); });

// ---------------------------------------------------------------------------
// Agent fixtures matching agents.json
// ---------------------------------------------------------------------------

const COPILOT_1: AgentConfig = {
  id: 'copilot-1',
  name: 'Copilot Code & Review',
  provider: 'copilot',
  model: 'claude-sonnet-4',
  transport: 'stdio',
  endpoint: '',
  maxConcurrency: 5,
  costMultiplier: 1,
  tags: ['code', 'review'],
  canMutate: false,
  timeoutMs: 180000,
};

const COPILOT_2: AgentConfig = {
  id: 'copilot-2',
  name: 'Copilot Security',
  provider: 'copilot',
  model: 'claude-sonnet-4',
  transport: 'stdio',
  endpoint: '',
  maxConcurrency: 3,
  costMultiplier: 1,
  tags: ['security', 'code'],
  canMutate: false,
  timeoutMs: 180000,
};

const COPILOT_3: AgentConfig = {
  id: 'copilot-3',
  name: 'Copilot Fast',
  provider: 'copilot',
  model: 'gpt-4.1-mini',
  transport: 'stdio',
  endpoint: '',
  maxConcurrency: 10,
  costMultiplier: 0.3,
  tags: ['code', 'fast'],
  canMutate: false,
  timeoutMs: 60000,
};

const COPILOT_4: AgentConfig = {
  id: 'copilot-4',
  name: 'Copilot Deep Analysis',
  provider: 'copilot',
  model: 'claude-opus-4',
  transport: 'stdio',
  endpoint: '',
  maxConcurrency: 2,
  costMultiplier: 3,
  tags: ['review', 'security', 'code'],
  canMutate: false,
  timeoutMs: 300000,
};

const COPILOT_5: AgentConfig = {
  id: 'copilot-5',
  name: 'Copilot Writer',
  provider: 'copilot',
  model: 'claude-sonnet-4',
  transport: 'stdio',
  endpoint: '',
  maxConcurrency: 3,
  costMultiplier: 1,
  tags: ['code', 'refactoring'],
  canMutate: true,
  timeoutMs: 180000,
};

const ALL_AGENTS = [COPILOT_1, COPILOT_2, COPILOT_3, COPILOT_4, COPILOT_5];

function registerAllAgents(): void {
  for (const agent of ALL_AGENTS) {
    agentRegistry.register(agent);
  }
}

// ===========================================================================
// Agent Configuration - agents.json Structure
// ===========================================================================

describe('Agents Config - agents.json Validation', () => {
  // seed/ is the checked-in default; runtime copy lives in APPDATA/agents/
  const agentsPath = path.resolve('seed', 'agents.json');

  it('agents.json contains exactly 5 agents', () => {
    const raw = fs.readFileSync(agentsPath, 'utf-8');
    const configs: AgentConfig[] = JSON.parse(raw);
    expect(configs).toHaveLength(5);
  });

  it('all agents have unique IDs', () => {
    const configs: AgentConfig[] = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
    const ids = configs.map(c => c.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('all agents are copilot provider', () => {
    const configs: AgentConfig[] = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
    expect(configs.every(c => c.provider === 'copilot')).toBe(true);
  });

  it('agent IDs follow copilot-N naming convention', () => {
    const configs: AgentConfig[] = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
    for (const config of configs) {
      expect(config.id).toMatch(/^copilot-\d+$/);
    }
  });

  it('all agents have required fields', () => {
    const configs: AgentConfig[] = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
    for (const config of configs) {
      expect(config.id).toBeDefined();
      expect(config.name).toBeDefined();
      expect(config.provider).toBeDefined();
      expect(config.model).toBeDefined();
      expect(config.tags).toBeDefined();
      expect(Array.isArray(config.tags)).toBe(true);
      expect(config.tags!.length).toBeGreaterThan(0);
      expect(typeof config.maxConcurrency).toBe('number');
      expect(typeof config.canMutate).toBe('boolean');
      expect(typeof config.timeoutMs).toBe('number');
    }
  });

  it('only copilot-5 has canMutate=true', () => {
    const configs: AgentConfig[] = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
    const mutable = configs.filter(c => c.canMutate);
    expect(mutable).toHaveLength(1);
    expect(mutable[0].id).toBe('copilot-5');
  });

  it('copilot-3 has lowest costMultiplier (fast/cheap agent)', () => {
    const configs: AgentConfig[] = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
    const copilot3 = configs.find(c => c.id === 'copilot-3')!;
    expect(copilot3.costMultiplier).toBe(0.3);
    expect(copilot3.model).toBe('gpt-4.1-mini');
    expect(copilot3.maxConcurrency).toBe(10);
  });

  it('copilot-4 has highest costMultiplier (deep analysis agent)', () => {
    const configs: AgentConfig[] = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
    const copilot4 = configs.find(c => c.id === 'copilot-4')!;
    expect(copilot4.costMultiplier).toBe(3);
    expect(copilot4.model).toBe('claude-opus-4');
    expect(copilot4.maxConcurrency).toBe(2);
  });
});

// ===========================================================================
// Registry - 5-Agent Registration & Lookup
// ===========================================================================

describe('Agents Config - Registry with 5 Agents', () => {
  it('registers all 5 agents successfully', () => {
    registerAllAgents();
    expect(agentRegistry.count).toBe(5);
  });

  it('all 5 agents start in idle state', () => {
    registerAllAgents();
    for (const agent of ALL_AGENTS) {
      const inst = agentRegistry.get(agent.id);
      expect(inst).toBeDefined();
      expect(inst!.state).toBe('idle');
    }
  });

  it('preserves config fields for each agent', () => {
    registerAllAgents();
    for (const agent of ALL_AGENTS) {
      const inst = agentRegistry.get(agent.id)!;
      expect(inst.config.id).toBe(agent.id);
      expect(inst.config.name).toBe(agent.name);
      expect(inst.config.model).toBe(agent.model);
      expect(inst.config.tags).toEqual(agent.tags);
      expect(inst.config.canMutate).toBe(agent.canMutate);
      expect(inst.config.maxConcurrency).toBe(agent.maxConcurrency);
      expect(inst.config.costMultiplier).toBe(agent.costMultiplier);
      expect(inst.config.timeoutMs).toBe(agent.timeoutMs);
    }
  });
});

// ===========================================================================
// Tag-based Routing with 5 Agents
// ===========================================================================

describe('Agents Config - Tag Matching with 5 Agents', () => {
  beforeEach(() => { registerAllAgents(); });

  it('findByTags(["code"]) returns all 5 agents', () => {
    const results = agentRegistry.findByTags(['code']);
    expect(results).toHaveLength(5);
  });

  it('findByTags(["review"]) returns copilot-1 and copilot-4', () => {
    const results = agentRegistry.findByTags(['review']);
    const ids = results.map(r => r.config.id).sort();
    expect(ids).toEqual(['copilot-1', 'copilot-4']);
  });

  it('findByTags(["security"]) returns copilot-2 and copilot-4', () => {
    const results = agentRegistry.findByTags(['security']);
    const ids = results.map(r => r.config.id).sort();
    expect(ids).toEqual(['copilot-2', 'copilot-4']);
  });

  it('findByTags(["fast"]) returns only copilot-3', () => {
    const results = agentRegistry.findByTags(['fast']);
    expect(results).toHaveLength(1);
    expect(results[0].config.id).toBe('copilot-3');
  });

  it('findByTags(["refactoring"]) returns only copilot-5', () => {
    const results = agentRegistry.findByTags(['refactoring']);
    expect(results).toHaveLength(1);
    expect(results[0].config.id).toBe('copilot-5');
  });

  it('findByTags(["review", "code"]) uses OR logic - returns agents with either tag', () => {
    const results = agentRegistry.findByTags(['review', 'code']);
    // All 5 have "code", plus copilot-1 and copilot-4 have "review" - OR means all 5
    expect(results).toHaveLength(5);
  });

  it('findByTags(["security", "review"]) returns copilot-1, copilot-2, copilot-4', () => {
    const results = agentRegistry.findByTags(['security', 'review']);
    const ids = results.map(r => r.config.id).sort();
    // copilot-1 has review, copilot-2 has security, copilot-4 has both
    expect(ids).toEqual(['copilot-1', 'copilot-2', 'copilot-4']);
  });

  it('findByTags with unknown tag returns empty', () => {
    const results = agentRegistry.findByTags(['nonexistent-tag']);
    expect(results).toHaveLength(0);
  });
});

// ===========================================================================
// Provider-based Lookup with 5 Agents
// ===========================================================================

describe('Agents Config - Provider Lookup with 5 Agents', () => {
  beforeEach(() => { registerAllAgents(); });

  it('findByProvider("copilot") returns all 5 agents', () => {
    const results = agentRegistry.findByProvider('copilot');
    expect(results).toHaveLength(5);
  });

  it('findByProvider("anthropic") returns empty (no anthropic agents configured)', () => {
    const results = agentRegistry.findByProvider('anthropic');
    expect(results).toHaveLength(0);
  });
});

// ===========================================================================
// Availability with 5 Agents
// ===========================================================================

describe('Agents Config - Availability with 5 Agents', () => {
  beforeEach(() => { registerAllAgents(); });

  it('all 5 agents are initially available for "code" tag', () => {
    const available = agentRegistry.findAvailable(['code']);
    expect(available).toHaveLength(5);
  });

  it('busy agent is excluded from available pool', () => {
    // Fill copilot-4 to capacity (maxConcurrency: 2)
    agentRegistry.recordTaskStart('copilot-4');
    agentRegistry.recordTaskStart('copilot-4');

    const available = agentRegistry.findAvailable(['review']);
    const ids = available.map(a => a.config.id);
    // copilot-4 should be busy and excluded
    expect(ids).not.toContain('copilot-4');
    // copilot-1 still available for review
    expect(ids).toContain('copilot-1');
  });

  it('stopped agent is excluded from available pool', () => {
    agentRegistry.setState('copilot-3', 'stopped');

    const available = agentRegistry.findAvailable(['fast']);
    expect(available).toHaveLength(0);
  });

  it('error agent is excluded from available pool', () => {
    agentRegistry.setState('copilot-2', 'error', 'test error');

    const available = agentRegistry.findAvailable(['security']);
    const ids = available.map(a => a.config.id);
    expect(ids).not.toContain('copilot-2');
    // copilot-4 still available for security
    expect(ids).toContain('copilot-4');
  });

  it('multiple agents share load across code tasks', () => {
    // Start tasks on copilot-1 and copilot-2
    agentRegistry.recordTaskStart('copilot-1');
    agentRegistry.recordTaskStart('copilot-2');

    const available = agentRegistry.findAvailable(['code']);
    // All should still be available (none at capacity)
    expect(available).toHaveLength(5);

    // Each has 1 active task except the ones we started
    expect(agentRegistry.get('copilot-1')!.activeTasks).toBe(1);
    expect(agentRegistry.get('copilot-2')!.activeTasks).toBe(1);
    expect(agentRegistry.get('copilot-3')!.activeTasks).toBe(0);
  });
});

// ===========================================================================
// Cross-Repo Agent Selection (copilot provider sort by load)
// ===========================================================================

describe('Agents Config - Cross-Repo Agent Selection', () => {
  beforeEach(() => { registerAllAgents(); });

  it('lowest-load copilot agent is selected first', () => {
    // Simulate some load
    agentRegistry.recordTaskStart('copilot-1');
    agentRegistry.recordTaskStart('copilot-1');
    agentRegistry.recordTaskStart('copilot-2');

    const copilotAgents = agentRegistry.findByProvider('copilot');
    const available = copilotAgents.filter(inst => {
      const stateOk = inst.state === 'idle' || inst.state === 'running';
      const capacityOk = inst.activeTasks < inst.config.maxConcurrency;
      return stateOk && capacityOk;
    });
    available.sort((a, b) => a.activeTasks - b.activeTasks);

    // Agents with 0 active tasks should come first
    expect(available[0].activeTasks).toBe(0);
    // copilot-3, copilot-4, copilot-5 all have 0 tasks
    expect(['copilot-3', 'copilot-4', 'copilot-5']).toContain(available[0].config.id);
  });

  it('fully loaded agent is excluded from dispatch pool', () => {
    // Fill copilot-4 to capacity (maxConcurrency: 2)
    agentRegistry.recordTaskStart('copilot-4');
    agentRegistry.recordTaskStart('copilot-4');

    const copilotAgents = agentRegistry.findByProvider('copilot');
    const available = copilotAgents.filter(inst => {
      const stateOk = inst.state === 'idle' || inst.state === 'running';
      const capacityOk = inst.activeTasks < inst.config.maxConcurrency;
      return stateOk && capacityOk;
    });

    const ids = available.map(a => a.config.id);
    expect(ids).not.toContain('copilot-4');
    expect(available.length).toBe(4);
  });
});
