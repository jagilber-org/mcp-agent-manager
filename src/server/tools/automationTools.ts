// mcp-agent-manager/src/server/tools/automationTools.ts
// Automation rule tools: create, list, remove, toggle, trigger, status

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { automationEngine } from '../../services/automation/index.js';
import { toolError } from './toolErrors.js';

export function registerAutomationTools(server: McpServer): void {
  // ===== mgr_create_automation =====
  server.tool(
    'mgr_create_automation',
    'Create an automation rule that triggers a skill when specific events occur. Connects events (workspace changes, git commits, agent state changes, etc.) to any registered skill with parameter mapping, throttling, retries, and conditions.',
    {
      id: z.string().describe('Unique rule identifier (kebab-case)'),
      name: z.string().describe('Human-readable rule name'),
      description: z.string().describe('What this automation does'),
      enabled: z.boolean().default(true).describe('Whether the rule is active'),
      priority: z.enum(['critical', 'high', 'normal', 'low']).default('normal').describe('Execution priority'),
      events: z.array(z.string()).min(1).describe('Event names to trigger on. Use * suffix for wildcards (e.g. workspace:*)'),
      filters: z.record(z.string()).optional().describe('Event data field filters (field: pattern). Supports * wildcards.'),
      requiredFields: z.array(z.string()).optional().describe('Event data fields that must be present'),
      skillId: z.string().describe('Skill to invoke when event matches'),
      staticParams: z.record(z.string()).optional().describe('Static parameters always passed to the skill'),
      eventParams: z.record(z.string()).optional().describe('Map skill param names to event data fields (dot notation)'),
      templateParams: z.record(z.string()).optional().describe('Template params with {event.field} placeholders'),
      throttleIntervalMs: z.number().optional().describe('Minimum interval between executions in ms'),
      throttleMode: z.enum(['leading', 'trailing']).optional().describe('Throttle mode: leading fires immediately, trailing debounces'),
      throttleGroupBy: z.string().optional().describe('Event data field to group throttling by (e.g. path for per-workspace)'),
      maxRetries: z.number().optional().describe('Max retry attempts on failure'),
      retryBaseDelayMs: z.number().optional().describe('Base retry delay in ms (doubles each retry)'),
      maxConcurrent: z.number().default(3).describe('Max concurrent executions of this rule (0 = unlimited)'),
      conditions: z.array(z.object({
        type: z.enum(['min-agents', 'skill-exists', 'cooldown', 'custom']).describe('Condition type to evaluate'),
        value: z.union([z.string(), z.number()]).describe('Condition threshold or identifier'),
      })).optional().describe('Runtime conditions that must be met to fire'),
      tags: z.array(z.string()).default([]).describe('Tags for filtering and categorization'),
    },
    async (params) => {
      const rule = automationEngine.registerRule(params);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            status: 'created',
            rule: {
              id: rule.id,
              name: rule.name,
              events: rule.matcher.events,
              skillId: rule.skillId,
              enabled: rule.enabled,
              priority: rule.priority,
              version: rule.version,
            },
          }, null, 2),
        }],
      };
    }
  );

  // ===== mgr_get_automation =====
  server.tool(
    'mgr_get_automation',
    'Get a single automation rule by ID, including its full configuration and execution statistics.',
    {
      id: z.string().describe('Rule ID to retrieve'),
    },
    async ({ id }) => {
      const rule = automationEngine.getRule(id);
      if (!rule) {
        return toolError('mgr_get_automation', `Automation rule not found: ${id}`);
      }
      const stats = automationEngine.getRuleStats(id);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ rule, stats: stats ?? null }, null, 2),
        }],
      };
    }
  );

  // ===== mgr_update_automation =====
  server.tool(
    'mgr_update_automation',
    'Partially update an existing automation rule. Only provided fields are changed; others are preserved. Version is auto-bumped.',
    {
      id: z.string().describe('Rule ID to update'),
      name: z.string().optional().describe('New rule name'),
      description: z.string().optional().describe('New description'),
      enabled: z.boolean().optional().describe('Enable or disable'),
      priority: z.enum(['critical', 'high', 'normal', 'low']).optional().describe('New priority'),
      events: z.array(z.string()).optional().describe('New event list'),
      filters: z.record(z.string()).optional().describe('New event filters'),
      requiredFields: z.array(z.string()).optional().describe('New required fields'),
      skillId: z.string().optional().describe('New target skill'),
      staticParams: z.record(z.string()).optional().describe('New static params'),
      eventParams: z.record(z.string()).optional().describe('New event param mapping'),
      templateParams: z.record(z.string()).optional().describe('New template params'),
      throttleIntervalMs: z.number().optional().describe('New throttle interval'),
      throttleMode: z.enum(['leading', 'trailing']).optional().describe('New throttle mode'),
      throttleGroupBy: z.string().optional().describe('New throttle group-by field'),
      maxRetries: z.number().optional().describe('New max retries'),
      retryBaseDelayMs: z.number().optional().describe('New retry base delay'),
      maxConcurrent: z.number().optional().describe('New max concurrent'),
      conditions: z.array(z.object({
        type: z.enum(['min-agents', 'skill-exists', 'cooldown', 'custom']).describe('Condition type to evaluate'),
        value: z.union([z.string(), z.number()]).describe('Condition threshold or identifier'),
      })).optional().describe('New conditions'),
      tags: z.array(z.string()).optional().describe('New tags'),
    },
    async (params) => {
      const { id, ...updates } = params;
      const rule = automationEngine.updateRule(id, updates);
      if (!rule) {
        return toolError('mgr_update_automation', `Automation rule not found: ${id}`);
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            status: 'updated',
            rule: {
              id: rule.id,
              name: rule.name,
              events: rule.matcher.events,
              skillId: rule.skillId,
              enabled: rule.enabled,
              priority: rule.priority,
              version: rule.version,
            },
          }, null, 2),
        }],
      };
    }
  );

  // ===== mgr_list_automations =====
  server.tool(
    'mgr_list_automations',
    'List all automation rules with their status, matching events, target skills, and execution stats.',
    {
      tag: z.string().optional().describe('Filter by tag'),
      enabled: z.boolean().optional().describe('Filter by enabled/disabled state'),
    },
    async (params) => {
      const rules = automationEngine.listRules({ tag: params.tag, enabled: params.enabled });
      const summary = rules.map(r => {
        const stats = automationEngine.getRuleStats(r.id);
        return {
          id: r.id,
          name: r.name,
          description: r.description,
          enabled: r.enabled,
          priority: r.priority,
          events: r.matcher.events,
          skillId: r.skillId,
          tags: r.tags,
          version: r.version,
          throttle: r.throttle ? `${r.throttle.intervalMs}ms (${r.throttle.mode})` : 'none',
          maxConcurrent: r.maxConcurrent,
          stats: stats ? {
            total: stats.totalExecutions,
            success: stats.successCount,
            failed: stats.failureCount,
            throttled: stats.throttledCount,
            avgDurationMs: Math.round(stats.avgDurationMs),
            lastExecutedAt: stats.lastExecutedAt,
          } : null,
        };
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ count: rules.length, rules: summary }, null, 2),
        }],
      };
    }
  );

  // ===== mgr_remove_automation =====
  server.tool(
    'mgr_remove_automation',
    'Remove an automation rule by ID.',
    {
      id: z.string().describe('Rule ID to remove'),
    },
    async ({ id }) => {
      const removed = automationEngine.removeRule(id);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: removed, id, action: 'removed' }),
        }],
      };
    }
  );

  // ===== mgr_toggle_automation =====
  server.tool(
    'mgr_toggle_automation',
    'Enable or disable an automation rule, or toggle the entire automation engine.',
    {
      ruleId: z.string().optional().describe('Rule ID to toggle. Omit to toggle the entire engine.'),
      enabled: z.boolean().describe('Whether to enable or disable'),
    },
    async ({ ruleId, enabled }) => {
      if (ruleId) {
        const ok = automationEngine.setRuleEnabled(ruleId, enabled);
        if (!ok) {
          return toolError('mgr_toggle_automation', `Rule "${ruleId}" not found.`);
        }
        return {
          content: [{
            type: 'text' as const,
            text: `Automation rule "${ruleId}" ${enabled ? 'enabled' : 'disabled'}.`,
          }],
        };
      }

      automationEngine.setEnabled(enabled);
      return {
        content: [{
          type: 'text' as const,
          text: `Automation engine ${enabled ? 'enabled' : 'disabled'}. ${automationEngine.listRules().length} rules loaded.`,
        }],
      };
    }
  );

  // ===== mgr_trigger_automation =====
  server.tool(
    'mgr_trigger_automation',
    'Manually trigger an automation rule with test data. Useful for testing rules without waiting for events. Supports dry-run mode.',
    {
      ruleId: z.string().describe('Rule ID to trigger'),
      testData: z.record(z.unknown()).default({}).describe('Test event data to pass to the rule'),
      dryRun: z.boolean().default(false).describe('If true, resolves params and shows what would happen without executing'),
    },
    async ({ ruleId, testData, dryRun }) => {
      try {
        const execution = await automationEngine.triggerRule(
          ruleId,
          testData as Record<string, unknown>,
          dryRun
        );
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              executionId: execution.executionId,
              ruleId: execution.ruleId,
              skillId: execution.skillId,
              status: execution.status,
              dryRun,
              resolvedParams: execution.resolvedParams,
              resultSummary: execution.resultSummary,
              durationMs: execution.durationMs,
              error: execution.error,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return toolError('mgr_trigger_automation', `Trigger failed: ${err.message}`);
      }
    }
  );

  // ===== mgr_automation_status =====
  server.tool(
    'mgr_automation_status',
    'Get the automation engine status including rule stats, recent executions, and engine health.',
    {
      ruleId: z.string().optional().describe('Filter executions by rule ID'),
      limit: z.number().default(20).describe('Max recent executions to return'),
    },
    async ({ ruleId, limit }) => {
      const status = automationEngine.getStatus();
      const executions = automationEngine.getExecutions({ ruleId, limit });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            engine: {
              enabled: status.enabled,
              ruleCount: status.ruleCount,
              activeRules: status.activeRules,
              totalExecutions: status.totalExecutions,
              startedAt: status.startedAt,
            },
            ruleStats: status.ruleStats,
            recentExecutions: executions.map(e => ({
              executionId: e.executionId,
              ruleId: e.ruleId,
              skillId: e.skillId,
              triggerEvent: e.triggerEvent,
              status: e.status,
              durationMs: e.durationMs,
              retryAttempt: e.retryAttempt,
              startedAt: e.startedAt,
              completedAt: e.completedAt,
              error: e.error,
            })),
          }, null, 2),
        }],
      };
    }
  );
}
