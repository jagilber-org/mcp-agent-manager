// tests/meta-collector.test.ts
// Unit tests for MetaCollector service and IndexClient

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach, type MockInstance } from 'vitest';
import { agentRegistry } from '../src/services/agentRegistry.js';
import { skillStore } from '../src/services/skillStore.js';
import { eventBus } from '../src/services/events.js';
import { routeTask } from '../src/services/taskRouter.js';
import {
  initMetaCollector, shutdownMetaCollector, resetMetaStats,
} from '../src/services/metaCollector.js';
import {
  createPersistSpies, restoreSpies, cleanState,
  TEST_AGENT, TEST_AGENT_2, registerMockProviders,
} from './helpers/setup.js';
import type { SkillDefinition } from '../src/types/index.js';

// Mock node:fs to prevent actual file I/O in the meta collector
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    appendFileSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue(''),
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
  };
});

let persistSpies: MockInstance[];
beforeAll(() => {
  persistSpies = createPersistSpies();
  // Initialize meta collector so event handlers are subscribed
  initMetaCollector();
});
afterAll(() => {
  shutdownMetaCollector();
  restoreSpies(persistSpies);
});
beforeEach(() => {
  cleanState();
  registerMockProviders();
  resetMetaStats();
});

// ===========================================================================
// MetaCollector - Core
// ===========================================================================

describe('MetaCollector', () => {
  describe('isMetaEnabled', () => {
    const origEnv = process.env.MCP_META_ENABLED;

    afterEach(() => {
      if (origEnv === undefined) delete process.env.MCP_META_ENABLED;
      else process.env.MCP_META_ENABLED = origEnv;
    });

    it('defaults to true when env not set', async () => {
      delete process.env.MCP_META_ENABLED;
      const { isMetaEnabled } = await import('../src/services/metaCollector.js');
      expect(isMetaEnabled()).toBe(true);
    });

    it('returns false when explicitly disabled', async () => {
      process.env.MCP_META_ENABLED = 'false';
      const { isMetaEnabled } = await import('../src/services/metaCollector.js');
      expect(isMetaEnabled()).toBe(false);
    });

    it('returns true when set to "1"', async () => {
      process.env.MCP_META_ENABLED = '1';
      const { isMetaEnabled } = await import('../src/services/metaCollector.js');
      expect(isMetaEnabled()).toBe(true);
    });

    it('returns true when set to "true"', async () => {
      process.env.MCP_META_ENABLED = 'true';
      const { isMetaEnabled } = await import('../src/services/metaCollector.js');
      expect(isMetaEnabled()).toBe(true);
    });
  });

  describe('getInsightsSummary', () => {
    it('returns empty insights initially', async () => {
      const { getInsightsSummary } = await import('../src/services/metaCollector.js');
      const summary = getInsightsSummary();
      expect(summary.agents).toEqual([]);
      expect(summary.skills).toEqual([]);
      expect(summary.session).toBeDefined();
      expect(summary.indexServer).toBeDefined();
      expect(summary.indexServer.configured).toBe(false);
    });
  });

  describe('updateAgentFromRegistry', () => {
    it('creates agent meta entry from registry data', async () => {
      const { updateAgentFromRegistry, getAgentInsights } = await import('../src/services/metaCollector.js');

      updateAgentFromRegistry('test-agent', {
        provider: 'copilot',
        model: 'gpt-4o',
        tasksCompleted: 10,
        tasksFailed: 2,
        totalTokensUsed: 5000,
        costAccumulated: 0.5,
      });

      const insights = getAgentInsights();
      expect(insights).toHaveLength(1);
      expect(insights[0].agentId).toBe('test-agent');
      expect(insights[0].totalTasks).toBe(12);
      expect(insights[0].successCount).toBe(10);
      expect(insights[0].failureCount).toBe(2);
      expect(insights[0].totalTokens).toBe(5000);
      expect(insights[0].totalCost).toBe(0.5);
      expect(insights[0].avgTokensPerTask).toBe(Math.round(5000 / 12));
    });

    it('updates existing agent meta entry', async () => {
      const { updateAgentFromRegistry, getAgentInsights } = await import('../src/services/metaCollector.js');

      updateAgentFromRegistry('test-agent', {
        provider: 'copilot',
        model: 'gpt-4o',
        tasksCompleted: 5,
        tasksFailed: 1,
        totalTokensUsed: 2000,
        costAccumulated: 0.2,
      });

      // Later update with more data
      updateAgentFromRegistry('test-agent', {
        provider: 'copilot',
        model: 'gpt-4o',
        tasksCompleted: 15,
        tasksFailed: 3,
        totalTokensUsed: 8000,
        costAccumulated: 0.8,
      });

      const insights = getAgentInsights();
      expect(insights).toHaveLength(1);
      expect(insights[0].totalTasks).toBe(18);
      expect(insights[0].successCount).toBe(15);
    });
  });

  describe('event-driven accumulation', () => {
    it('accumulates skill stats from task:completed events', async () => {
      const { getSkillInsights } = await import('../src/services/metaCollector.js');

      // Emit task:completed events
      eventBus.emitEvent('task:completed', {
        taskId: 'task-1',
        skillId: 'code-review',
        strategy: 'single',
        success: true,
        totalTokens: 500,
        totalCost: 0.05,
        totalLatencyMs: 1000,
        agentCount: 1,
      });

      eventBus.emitEvent('task:completed', {
        taskId: 'task-2',
        skillId: 'code-review',
        strategy: 'single',
        success: false,
        totalTokens: 200,
        totalCost: 0.02,
        totalLatencyMs: 500,
        agentCount: 1,
      });

      const skills = getSkillInsights();
      const crSkill = skills.find(s => s.skillId === 'code-review');
      expect(crSkill).toBeDefined();
      expect(crSkill!.totalTasks).toBe(2);
      expect(crSkill!.successCount).toBe(1);
      expect(crSkill!.failureCount).toBe(1);
      expect(crSkill!.totalTokens).toBe(700);
      expect(crSkill!.avgLatencyMs).toBe(750);
    });

    it('tracks multiple skills independently', async () => {
      const { getSkillInsights } = await import('../src/services/metaCollector.js');

      eventBus.emitEvent('task:completed', {
        taskId: 't1', skillId: 'skill-a', strategy: 'single',
        success: true, totalTokens: 100, totalCost: 0.01, totalLatencyMs: 200, agentCount: 1,
      });

      eventBus.emitEvent('task:completed', {
        taskId: 't2', skillId: 'skill-b', strategy: 'fan-out',
        success: true, totalTokens: 300, totalCost: 0.03, totalLatencyMs: 400, agentCount: 2,
      });

      const skills = getSkillInsights();
      expect(skills).toHaveLength(2);
      expect(skills.find(s => s.skillId === 'skill-a')?.totalTokens).toBe(100);
      expect(skills.find(s => s.skillId === 'skill-b')?.strategy).toBe('fan-out');
    });

    it('registers agent meta from agent:registered event', async () => {
      const { getAgentInsights } = await import('../src/services/metaCollector.js');

      eventBus.emitEvent('agent:registered', {
        agentId: 'new-agent',
        provider: 'anthropic',
        model: 'claude-sonnet',
        tags: ['code'],
      });

      const agents = getAgentInsights();
      const found = agents.find(a => a.agentId === 'new-agent');
      expect(found).toBeDefined();
      expect(found!.provider).toBe('anthropic');
      expect(found!.model).toBe('claude-sonnet');
      expect(found!.totalTasks).toBe(0);
    });

    it('updates existing agent provider/model on re-register', async () => {
      const { getAgentInsights } = await import('../src/services/metaCollector.js');

      eventBus.emitEvent('agent:registered', {
        agentId: 'agent-x', provider: 'copilot', model: 'gpt-4o', tags: [],
      });
      eventBus.emitEvent('agent:registered', {
        agentId: 'agent-x', provider: 'anthropic', model: 'claude-opus', tags: ['code'],
      });

      const agents = getAgentInsights();
      const found = agents.find(a => a.agentId === 'agent-x');
      expect(found!.provider).toBe('anthropic');
      expect(found!.model).toBe('claude-opus');
    });
  });

  describe('resetMetaStats', () => {
    it('clears all accumulated data', async () => {
      const { resetMetaStats: resetMeta, getInsightsSummary } = await import('../src/services/metaCollector.js');

      eventBus.emitEvent('agent:registered', {
        agentId: 'temp', provider: 'copilot', model: 'm', tags: [],
      });
      eventBus.emitEvent('task:completed', {
        taskId: 't', skillId: 's', strategy: 'single',
        success: true, totalTokens: 100, totalCost: 0.01, totalLatencyMs: 100, agentCount: 1,
      });

      resetMeta();
      const summary = getInsightsSummary();
      expect(summary.agents).toHaveLength(0);
      expect(summary.skills).toHaveLength(0);
      expect(summary.session.totalTasks).toBe(0);
    });
  });
});

// ===========================================================================
// IndexClient
// ===========================================================================

describe('IndexClient', () => {
  const origUrl = process.env.MCP_INDEX_URL;
  const origInterval = process.env.MCP_META_SYNC_INTERVAL;
  const origAppData = process.env.APPDATA;

  afterEach(() => {
    if (origUrl === undefined) delete process.env.MCP_INDEX_URL;
    else process.env.MCP_INDEX_URL = origUrl;
    if (origInterval === undefined) delete process.env.MCP_META_SYNC_INTERVAL;
    else process.env.MCP_META_SYNC_INTERVAL = origInterval;
    if (origAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = origAppData;
  });

  it('isConfigured returns false when no URL and no auto-discovery', async () => {
    delete process.env.MCP_INDEX_URL;
    delete process.env.APPDATA;
    const { IndexClient } = await import('../src/services/indexClient.js');
    const client = new IndexClient();
    expect(client.isConfigured()).toBe(false);
    expect(client.baseUrl).toBeNull();
    expect(client.discoverySource).toBe('none');
  });

  it('isConfigured returns true when MCP_INDEX_URL is set', async () => {
    process.env.MCP_INDEX_URL = 'http://localhost:3901';
    const { IndexClient } = await import('../src/services/indexClient.js');
    const client = new IndexClient();
    client.reload();
    expect(client.isConfigured()).toBe(true);
    expect(client.baseUrl).toBe('http://localhost:3901');
    expect(client.discoverySource).toBe('env');
  });

  it('storeKnowledge returns false when not configured', async () => {
    delete process.env.MCP_INDEX_URL;
    delete process.env.APPDATA;
    const { IndexClient } = await import('../src/services/indexClient.js');
    const client = new IndexClient();
    const result = await client.storeKnowledge('key', 'content');
    expect(result).toBe(false);
  });

  it('searchKnowledge returns empty when not configured', async () => {
    delete process.env.MCP_INDEX_URL;
    delete process.env.APPDATA;
    const { IndexClient } = await import('../src/services/indexClient.js');
    const client = new IndexClient();
    const results = await client.searchKnowledge('query');
    expect(results).toEqual([]);
  });

  it('getKnowledge returns null when not configured', async () => {
    delete process.env.MCP_INDEX_URL;
    delete process.env.APPDATA;
    const { IndexClient } = await import('../src/services/indexClient.js');
    const client = new IndexClient();
    const result = await client.getKnowledge('key');
    expect(result).toBeNull();
  });

  it('healthCheck returns error when not configured', async () => {
    delete process.env.MCP_INDEX_URL;
    delete process.env.APPDATA;
    const { IndexClient } = await import('../src/services/indexClient.js');
    const client = new IndexClient();
    const health = await client.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.error).toContain('not configured');
    expect(health.circuit).toBeDefined();
    expect(health.discoverySource).toBe('none');
  });

  it('getSyncIntervalMs returns default 300000', async () => {
    delete process.env.MCP_META_SYNC_INTERVAL;
    const { getSyncIntervalMs } = await import('../src/services/indexClient.js');
    expect(getSyncIntervalMs()).toBe(300000);
  });

  it('getSyncIntervalMs respects env override', async () => {
    process.env.MCP_META_SYNC_INTERVAL = '60000';
    const { getSyncIntervalMs } = await import('../src/services/indexClient.js');
    expect(getSyncIntervalMs()).toBe(60000);
  });

  describe('circuit breaker', () => {
    it('starts with circuit closed', async () => {
      delete process.env.MCP_INDEX_URL;
      delete process.env.APPDATA;
      const { IndexClient } = await import('../src/services/indexClient.js');
      const client = new IndexClient();
      expect(client.isCircuitOpen()).toBe(false);
      expect(client.circuitState.failures).toBe(0);
    });

    it('isCircuitOpen returns false when failures < threshold', async () => {
      const { IndexClient } = await import('../src/services/indexClient.js');
      const client = new IndexClient();
      // Manually set some failures (less than threshold of 3)
      (client as any)._circuit.failures = 2;
      expect(client.isCircuitOpen()).toBe(false);
    });

    it('isCircuitOpen returns true when failures >= threshold and within cooldown', async () => {
      const { IndexClient } = await import('../src/services/indexClient.js');
      const client = new IndexClient();
      (client as any)._circuit.failures = 3;
      (client as any)._circuit.openedAt = Date.now(); // Just opened
      expect(client.isCircuitOpen()).toBe(true);
    });

    it('isCircuitOpen returns false (half-open) after cooldown elapsed', async () => {
      const { IndexClient } = await import('../src/services/indexClient.js');
      const client = new IndexClient();
      (client as any)._circuit.failures = 3;
      (client as any)._circuit.openedAt = Date.now() - 120_000; // 2min ago, past 60s cooldown
      expect(client.isCircuitOpen()).toBe(false); // Half-open: allows probe
    });

    it('resetCircuit clears failures', async () => {
      const { IndexClient } = await import('../src/services/indexClient.js');
      const client = new IndexClient();
      (client as any)._circuit.failures = 5;
      (client as any)._circuit.openedAt = Date.now();
      client.resetCircuit();
      expect(client.isCircuitOpen()).toBe(false);
      expect(client.circuitState.failures).toBe(0);
    });

    it('storeKnowledge returns false when circuit is open', async () => {
      process.env.MCP_INDEX_URL = 'http://localhost:9999';
      const { IndexClient } = await import('../src/services/indexClient.js');
      const client = new IndexClient();
      client.reload();
      (client as any)._circuit.failures = 3;
      (client as any)._circuit.openedAt = Date.now();
      const result = await client.storeKnowledge('key', 'content');
      expect(result).toBe(false);
    });

    it('searchKnowledge returns empty when circuit is open', async () => {
      process.env.MCP_INDEX_URL = 'http://localhost:9999';
      const { IndexClient } = await import('../src/services/indexClient.js');
      const client = new IndexClient();
      client.reload();
      (client as any)._circuit.failures = 3;
      (client as any)._circuit.openedAt = Date.now();
      const results = await client.searchKnowledge('query');
      expect(results).toEqual([]);
    });
  });

  describe('auto-discovery', () => {
    it('discoverIndexUrl returns env override when MCP_INDEX_URL set', async () => {
      process.env.MCP_INDEX_URL = 'http://custom:1234';
      const { discoverIndexUrl } = await import('../src/services/indexClient.js');
      expect(discoverIndexUrl()).toBe('http://custom:1234');
    });

    it('discoverIndexUrl returns null when APPDATA not set and no env override', async () => {
      delete process.env.MCP_INDEX_URL;
      delete process.env.APPDATA;
      const { discoverIndexUrl } = await import('../src/services/indexClient.js');
      expect(discoverIndexUrl()).toBeNull();
    });
  });
});

// ===========================================================================
// MetaTools env-gating
// ===========================================================================

describe('MetaTools env-gating', () => {
  const origVal = process.env.MCP_META_TOOLS;

  afterEach(() => {
    if (origVal === undefined) delete process.env.MCP_META_TOOLS;
    else process.env.MCP_META_TOOLS = origVal;
  });

  it('isMetaToolsEnabled returns false by default', async () => {
    delete process.env.MCP_META_TOOLS;
    const { isMetaToolsEnabled } = await import('../src/server/tools/metaTools.js');
    expect(isMetaToolsEnabled()).toBe(false);
  });

  it('isMetaToolsEnabled returns true when set to "true"', async () => {
    process.env.MCP_META_TOOLS = 'true';
    const { isMetaToolsEnabled } = await import('../src/server/tools/metaTools.js');
    expect(isMetaToolsEnabled()).toBe(true);
  });

  it('isMetaToolsEnabled returns true when set to "1"', async () => {
    process.env.MCP_META_TOOLS = '1';
    const { isMetaToolsEnabled } = await import('../src/server/tools/metaTools.js');
    expect(isMetaToolsEnabled()).toBe(true);
  });

  it('isMetaToolsEnabled returns false for arbitrary string', async () => {
    process.env.MCP_META_TOOLS = 'no';
    const { isMetaToolsEnabled } = await import('../src/server/tools/metaTools.js');
    expect(isMetaToolsEnabled()).toBe(false);
  });
});

// ===========================================================================
// DataDir - getMetaDir
// ===========================================================================

describe('DataDir - getMetaDir', () => {
  const origMeta = process.env.META_DIR;

  afterEach(() => {
    if (origMeta === undefined) delete process.env.META_DIR;
    else process.env.META_DIR = origMeta;
  });

  it('returns DATA_DIR/meta by default', async () => {
    delete process.env.META_DIR;
    const { getMetaDir, DATA_DIR } = await import('../src/services/dataDir.js');
    expect(getMetaDir()).toContain('meta');
  });

  it('respects META_DIR env override', async () => {
    process.env.META_DIR = '/custom/meta';
    const { getMetaDir } = await import('../src/services/dataDir.js');
    expect(getMetaDir()).toBe('/custom/meta');
  });
});

// ===========================================================================
// Integration - real task through metaCollector
// ===========================================================================

describe('MetaCollector - integration with routeTask', () => {
  it('accumulates meta when tasks complete', async () => {
    const { getSkillInsights, getInsightsSummary } = await import('../src/services/metaCollector.js');

    agentRegistry.register(TEST_AGENT);

    const skill: SkillDefinition = {
      id: 'meta-test-skill',
      name: 'Meta Test',
      description: 'Test for meta',
      promptTemplate: '{input}',
      strategy: 'single',
      version: '1.0.0',
      categories: ['test'],
    };
    skillStore.register(skill);

    await routeTask({
      taskId: 'meta-task-1',
      skillId: 'meta-test-skill',
      params: { input: 'hello meta' },
      priority: 0,
      createdAt: new Date(),
    });

    // task:completed event should have populated skill stats
    const skills = getSkillInsights();
    const found = skills.find(s => s.skillId === 'meta-test-skill');
    expect(found).toBeDefined();
    expect(found!.totalTasks).toBe(1);
    expect(found!.successCount).toBe(1);
    expect(found!.totalTokens).toBeGreaterThan(0);

    // Session summary
    const summary = getInsightsSummary();
    expect(summary.session.totalTasks).toBeGreaterThanOrEqual(1);

    skillStore.remove('meta-test-skill');
  });
});
