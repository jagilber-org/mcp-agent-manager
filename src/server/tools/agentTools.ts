// mcp-agent-manager/src/server/tools/agentTools.ts
// Agent lifecycle tools: spawn, stop, list, status, stop-all

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentConfig, AgentTransport, ProviderName } from '../../types/index.js';
import { agentRegistry } from '../../services/agentRegistry.js';
import { killSession, killAllSessions } from '../../providers/copilot.js';
import { toolError } from './toolErrors.js';

export function registerAgentTools(server: McpServer): void {
  // ===== mgr_spawn_agent =====
  server.tool(
    'mgr_spawn_agent',
    'Register a new agent with the manager. Configures provider, model, transport, and capabilities.',
    {
      id: z.string().describe('Unique agent identifier'),
      name: z.string().describe('Human-readable agent name'),
      provider: z.enum(['anthropic', 'copilot', 'openai', 'custom']).describe('LLM provider backend'),
      model: z.string().describe('Model name (e.g. claude-sonnet-4-20250514, gpt-4o)'),
      transport: z.enum(['stdio', 'tcp', 'http']).default('stdio').describe('Connection mode'),
      endpoint: z.string().optional().describe('Endpoint: command for stdio, host:port for tcp, URL for http'),
      tags: z.array(z.string()).default([]).describe('Capability tags for routing (e.g. code, security, review)'),
      canMutate: z.boolean().default(false).describe('Whether agent can write/mutate (vs read-only)'),
      costMultiplier: z.number().default(1).describe('Relative cost (1x baseline)'),
      maxConcurrency: z.number().default(1).describe('Max simultaneous tasks'),
      timeoutMs: z.number().default(60000).describe('Request timeout in ms'),
      binaryPath: z.string().optional().describe('Path to CLI binary (for copilot provider)'),
      cliArgs: z.array(z.string()).optional().describe('Additional CLI args'),
      env: z.record(z.string()).optional().describe('Environment variables for the agent process'),
    },
    async (params) => {
      const config: AgentConfig = {
        id: params.id,
        name: params.name,
        provider: params.provider as ProviderName,
        model: params.model,
        transport: (params.transport || 'stdio') as AgentTransport,
        endpoint: params.endpoint || params.binaryPath || '',
        args: params.cliArgs,
        env: params.env,
        maxConcurrency: params.maxConcurrency,
        costMultiplier: params.costMultiplier,
        tags: params.tags,
        canMutate: params.canMutate,
        timeoutMs: params.timeoutMs,
        binaryPath: params.binaryPath,
        cliArgs: params.cliArgs,
      };

      agentRegistry.register(config);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            status: 'registered',
            agent: config.id,
            provider: config.provider,
            model: config.model,
            tags: config.tags,
          }, null, 2),
        }],
      };
    }
  );

  // ===== mgr_stop_agent =====
  server.tool(
    'mgr_stop_agent',
    'Stop and unregister an agent. Kills any active ACP sessions.',
    {
      agentId: z.string().describe('Agent ID to stop'),
    },
    async ({ agentId }) => {
      const existed = agentRegistry.unregister(agentId);
      killSession(agentId);

      return {
        content: [{
          type: 'text' as const,
          text: existed
            ? `Agent ${agentId} stopped and unregistered.`
            : `Agent ${agentId} not found.`,
        }],
      };
    }
  );

  // ===== mgr_list_agents =====
  server.tool(
    'mgr_list_agents',
    'List all registered agents with their current state, stats, and capabilities.',
    {
      filterTags: z.array(z.string()).optional().describe('Filter by capability tags'),
      filterProvider: z.string().optional().describe('Filter by provider name'),
    },
    async (params) => {
      let instances = agentRegistry.getAll();

      if (params.filterTags && params.filterTags.length > 0) {
        instances = agentRegistry.findByTags(params.filterTags);
      }
      if (params.filterProvider) {
        instances = instances.filter(i => i.config.provider === params.filterProvider);
      }

      const summary = instances.map(i => ({
        id: i.config.id,
        name: i.config.name,
        provider: i.config.provider,
        model: i.config.model,
        state: i.state,
        tags: i.config.tags,
        canMutate: i.config.canMutate,
        tasksCompleted: i.tasksCompleted,
        tasksFailed: i.tasksFailed,
        activeTasks: i.activeTasks,
        totalTokens: i.totalTokensUsed,
        costAccumulated: i.costAccumulated,
      }));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(summary, null, 2),
        }],
      };
    }
  );

  // ===== mgr_agent_status =====
  server.tool(
    'mgr_agent_status',
    'Get detailed status and health information for a specific agent.',
    {
      agentId: z.string().describe('Agent ID to check'),
    },
    async ({ agentId }) => {
      const health = agentRegistry.getHealth(agentId);
      if (!health) {
        return toolError('mgr_agent_status', `Agent ${agentId} not found.`);
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(health, null, 2),
        }],
      };
    }
  );

  // ===== mgr_get_agent =====
  server.tool(
    'mgr_get_agent',
    'Get full configuration and runtime state for a single agent by ID.',
    {
      agentId: z.string().describe('Agent ID to retrieve'),
    },
    async ({ agentId }) => {
      const instance = agentRegistry.get(agentId);
      if (!instance) {
        return toolError('mgr_get_agent', `Agent not found: ${agentId}`);
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            ...instance.config,
            state: instance.state,
            tasksCompleted: instance.tasksCompleted,
            tasksFailed: instance.tasksFailed,
            activeTasks: instance.activeTasks,
            totalTokensUsed: instance.totalTokensUsed,
            costAccumulated: instance.costAccumulated,
            startedAt: instance.startedAt,
            lastActivityAt: instance.lastActivityAt,
            error: instance.error,
          }, null, 2),
        }],
      };
    }
  );

  // ===== mgr_update_agent =====
  server.tool(
    'mgr_update_agent',
    'Partially update an existing agent configuration. Only provided fields are changed; runtime state (tasks, tokens) is preserved.',
    {
      agentId: z.string().describe('Agent ID to update'),
      name: z.string().optional().describe('New human-readable name'),
      model: z.string().optional().describe('New model name'),
      tags: z.array(z.string()).optional().describe('New capability tags'),
      maxConcurrency: z.number().optional().describe('New max concurrent tasks'),
      costMultiplier: z.number().optional().describe('New cost multiplier'),
      canMutate: z.boolean().optional().describe('New mutation permission'),
      timeoutMs: z.number().optional().describe('New timeout in ms'),
      env: z.record(z.string()).optional().describe('New environment variables'),
    },
    async (params) => {
      const { agentId, ...updates } = params;

      // Remove undefined values from updates
      const cleanUpdates: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(updates)) {
        if (v !== undefined) cleanUpdates[k] = v;
      }

      if (Object.keys(cleanUpdates).length === 0) {
        return toolError('mgr_update_agent', 'No fields to update. Provide at least one optional field.');
      }

      const updated = agentRegistry.update(agentId, cleanUpdates as any);
      if (!updated) {
        return toolError('mgr_update_agent', `Agent not found: ${agentId}`);
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            status: 'updated',
            agent: agentId,
            updatedFields: Object.keys(cleanUpdates),
          }, null, 2),
        }],
      };
    }
  );

  // ===== mgr_stop_all =====
  server.tool(
    'mgr_stop_all',
    'Stop all agents and kill all active sessions. Use for clean shutdown.',
    {},
    async () => {
      const agents = agentRegistry.getAll();
      for (const inst of agents) {
        agentRegistry.unregister(inst.config.id);
      }
      killAllSessions();

      return {
        content: [{
          type: 'text' as const,
          text: `Stopped ${agents.length} agent(s). All sessions killed.`,
        }],
      };
    }
  );
}
