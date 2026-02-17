// mcp-agent-manager/src/server/tools/taskTools.ts
// Task execution tools: assign, send prompt, history, metrics

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SkillDefinition, TaskRequest } from '../../types/index.js';
import { agentRegistry } from '../../services/agentRegistry.js';
import { skillStore } from '../../services/skillStore.js';
import { routeTask, getRouterMetrics } from '../../services/taskRouter.js';
import { automationEngine } from '../../services/automation/index.js';
import { toolError } from './toolErrors.js';

let taskCounter = 0;
const startTime = Date.now();

export function registerTaskTools(server: McpServer): void {
  // ===== mgr_assign_task =====
  server.tool(
    'mgr_assign_task',
    'Execute a registered skill. Routes to appropriate agent(s) based on the skill\'s routing strategy.',
    {
      skillId: z.string().describe('Skill ID to execute'),
      params: z.record(z.string()).default({}).describe('Parameters to fill into the skill\'s prompt template'),
      priority: z.number().default(0).describe('Task priority (higher = more important)'),
    },
    async ({ skillId, params, priority }) => {
      const taskId = `task-${++taskCounter}-${Date.now()}`;

      const request: TaskRequest = {
        taskId,
        skillId,
        params,
        priority,
        createdAt: new Date(),
      };

      try {
        const result = await routeTask(request);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              taskId: result.taskId,
              success: result.success,
              strategy: result.strategy,
              agentCount: result.responses.length,
              totalTokens: result.totalTokens,
              totalCost: result.totalCost,
              latencyMs: result.totalLatencyMs,
              content: result.finalContent,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return toolError('mgr_assign_task', `${err.message} (taskId: ${taskId})`);
      }
    }
  );

  // ===== mgr_send_prompt =====
  server.tool(
    'mgr_send_prompt',
    'Send a raw prompt directly to a specific agent, bypassing the skill system.',
    {
      agentId: z.string().describe('Target agent ID'),
      prompt: z.string().describe('The prompt text to send'),
      maxTokens: z.number().default(4000).describe('Max response tokens'),
    },
    async ({ agentId, prompt, maxTokens }) => {
      const taskId = `direct-${++taskCounter}-${Date.now()}`;
      const instance = agentRegistry.get(agentId);

      if (!instance) {
        return toolError('mgr_send_prompt', `Agent ${agentId} not found.`);
      }

      const skill: SkillDefinition = {
        id: `_direct_${taskId}`,
        name: 'Direct Prompt',
        description: 'Ad-hoc direct prompt',
        promptTemplate: '{prompt}',
        targetAgents: [agentId],
        strategy: 'single',
        maxTokens,
        version: '0',
        categories: [],
      };

      skillStore.register(skill);
      try {
        const request: TaskRequest = {
          taskId,
          skillId: skill.id,
          params: { prompt },
          priority: 0,
          createdAt: new Date(),
        };
        const result = await routeTask(request);
        const primary = result.responses[0];

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: primary?.success ?? false,
              agentId: primary?.agentId ?? agentId,
              model: primary?.model ?? instance.config.model,
              content: result.finalContent || primary?.content || '',
              tokenCount: primary?.tokenCount ?? 0,
              latencyMs: primary?.latencyMs ?? 0,
              error: primary?.error,
            }),
          }],
        };
      } finally {
        skillStore.remove(skill.id);
      }
    }
  );

  // ===== mgr_list_task_history =====
  server.tool(
    'mgr_list_task_history',
    'View task execution history with full results, responses, errors, and timing. Filter by rule, status, or agent. Shows what the agent actually returned.',
    {
      ruleId: z.string().optional().describe('Filter by automation rule ID'),
      status: z.enum(['pending', 'running', 'success', 'failed', 'skipped']).optional().describe('Filter by execution status'),
      limit: z.number().default(20).describe('Max results to return (default 20)'),
    },
    async ({ ruleId, status, limit }) => {
      const executions = automationEngine.getExecutions({ ruleId, status, limit });

      const results = executions.map(e => ({
        executionId: e.executionId,
        ruleId: e.ruleId,
        skillId: e.skillId,
        status: e.status,
        triggerEvent: e.triggerEvent,
        taskId: e.taskId,
        retryAttempt: e.retryAttempt,
        durationMs: e.durationMs,
        startedAt: e.startedAt,
        completedAt: e.completedAt,
        error: e.error,
        resultSummary: e.resultSummary,
        resolvedParams: e.resolvedParams,
      }));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            total: results.length,
            executions: results,
            retryQueue: automationEngine.getRetryQueueStatus(),
          }, null, 2),
        }],
      };
    }
  );

  // ===== mgr_get_metrics =====
  server.tool(
    'mgr_get_metrics',
    'Get aggregate metrics: total tasks, tokens, costs, per-agent breakdown.',
    {},
    async () => {
      const routerMetrics = getRouterMetrics();
      const allAgents = agentRegistry.getAll();
      const skills = skillStore.list();

      const agentMetrics: Record<string, any> = {};
      for (const inst of allAgents) {
        agentMetrics[inst.config.id] = {
          provider: inst.config.provider,
          model: inst.config.model,
          state: inst.state,
          tasks: inst.tasksCompleted + inst.tasksFailed,
          tokens: inst.totalTokensUsed,
          cost: inst.costAccumulated,
          errorRate: inst.tasksCompleted + inst.tasksFailed > 0
            ? inst.tasksFailed / (inst.tasksCompleted + inst.tasksFailed)
            : 0,
        };
      }

      const metrics = {
        totalAgents: allAgents.length,
        activeAgents: allAgents.filter(a => a.state !== 'stopped' && a.state !== 'error').length,
        totalTasks: routerMetrics.totalTasks,
        totalTokens: routerMetrics.totalTokens,
        totalCost: routerMetrics.totalCost,
        skillCount: skills.length,
        uptimeMs: Date.now() - startTime,
        agentMetrics,
      };

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(metrics, null, 2),
        }],
      };
    }
  );
}
