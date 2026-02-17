// mcp-agent-manager/src/server/tools/skillTools.ts
// Skill management tools: register, get, update, remove, list

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { RoutingStrategy, SkillDefinition } from '../../types/index.js';
import { skillStore } from '../../services/skillStore.js';
import { toolError } from './toolErrors.js';

export function registerSkillTools(server: McpServer): void {
  // ===== mgr_register_skill =====
  server.tool(
    'mgr_register_skill',
    'Register or update a skill definition (prompt template, routing strategy, target agents/tags).',
    {
      id: z.string().describe('Unique skill identifier'),
      name: z.string().describe('Human-readable skill name'),
      description: z.string().describe('What this skill does'),
      promptTemplate: z.string().describe('Prompt template with {param} placeholders'),
      strategy: z.enum(['single', 'race', 'fan-out', 'consensus', 'fallback', 'cost-optimized'])
        .default('single').describe('Routing strategy'),
      targetAgents: z.array(z.string()).optional().describe('Specific agent IDs to target'),
      targetTags: z.array(z.string()).optional().describe('Agent tags to match'),
      maxTokens: z.number().optional().describe('Max response tokens'),
      timeoutMs: z.number().optional().describe('Timeout override'),
      mergeResults: z.boolean().default(false).describe('Merge multi-agent results into one response'),
      categories: z.array(z.string()).default([]).describe('Categories for search/filtering'),
    },
    async (params) => {
      const skill: SkillDefinition = {
        id: params.id,
        name: params.name,
        description: params.description,
        promptTemplate: params.promptTemplate,
        strategy: params.strategy as RoutingStrategy,
        targetAgents: params.targetAgents,
        targetTags: params.targetTags,
        maxTokens: params.maxTokens,
        timeoutMs: params.timeoutMs,
        mergeResults: params.mergeResults,
        version: '1.0.0',
        categories: params.categories,
      };

      skillStore.register(skill);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ status: 'registered', skill: skill.id, strategy: skill.strategy }),
        }],
      };
    }
  );

  // ===== mgr_get_skill =====
  server.tool(
    'mgr_get_skill',
    'Get a single skill definition by ID, including its full prompt template and configuration.',
    {
      id: z.string().describe('Skill ID to retrieve'),
    },
    async ({ id }) => {
      const skill = skillStore.get(id);
      if (!skill) {
        return toolError('mgr_get_skill', `Skill not found: ${id}`);
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(skill, null, 2),
        }],
      };
    }
  );

  // ===== mgr_update_skill =====
  server.tool(
    'mgr_update_skill',
    'Partially update an existing skill definition. Only provided fields are changed; others are preserved. Version is auto-bumped.',
    {
      id: z.string().describe('Skill ID to update'),
      name: z.string().optional().describe('New human-readable name'),
      description: z.string().optional().describe('New description'),
      promptTemplate: z.string().optional().describe('New prompt template'),
      strategy: z.enum(['single', 'race', 'fan-out', 'consensus', 'fallback', 'cost-optimized'])
        .optional().describe('New routing strategy'),
      targetAgents: z.array(z.string()).optional().describe('New target agent IDs'),
      targetTags: z.array(z.string()).optional().describe('New target tags'),
      maxTokens: z.number().optional().describe('New max response tokens'),
      timeoutMs: z.number().optional().describe('New timeout override'),
      mergeResults: z.boolean().optional().describe('New merge results flag'),
      categories: z.array(z.string()).optional().describe('New categories'),
    },
    async (params) => {
      const existing = skillStore.get(params.id);
      if (!existing) {
        return toolError('mgr_update_skill', `Skill not found: ${params.id}`);
      }

      // Bump version
      const vParts = existing.version.split('.').map(Number);
      if (vParts.length === 3 && vParts.every(n => !isNaN(n))) {
        vParts[2]++;
      }

      const updated: SkillDefinition = {
        ...existing,
        ...(params.name !== undefined && { name: params.name }),
        ...(params.description !== undefined && { description: params.description }),
        ...(params.promptTemplate !== undefined && { promptTemplate: params.promptTemplate }),
        ...(params.strategy !== undefined && { strategy: params.strategy as RoutingStrategy }),
        ...(params.targetAgents !== undefined && { targetAgents: params.targetAgents }),
        ...(params.targetTags !== undefined && { targetTags: params.targetTags }),
        ...(params.maxTokens !== undefined && { maxTokens: params.maxTokens }),
        ...(params.timeoutMs !== undefined && { timeoutMs: params.timeoutMs }),
        ...(params.mergeResults !== undefined && { mergeResults: params.mergeResults }),
        ...(params.categories !== undefined && { categories: params.categories }),
        version: vParts.join('.'),
      };

      skillStore.register(updated);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ status: 'updated', skill: updated.id, version: updated.version }),
        }],
      };
    }
  );

  // ===== mgr_remove_skill =====
  server.tool(
    'mgr_remove_skill',
    'Remove a skill definition by ID.',
    {
      id: z.string().describe('Skill ID to remove'),
    },
    async ({ id }) => {
      const removed = skillStore.remove(id);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: removed, id, action: 'removed' }),
        }],
      };
    }
  );

  // ===== mgr_list_skills =====
  server.tool(
    'mgr_list_skills',
    'List all registered skills, optionally filtered by category.',
    {
      category: z.string().optional().describe('Filter by category'),
    },
    async ({ category }) => {
      const skills = skillStore.list(category);

      const summary = skills.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        strategy: s.strategy,
        categories: s.categories,
        targetTags: s.targetTags,
        targetAgents: s.targetAgents,
      }));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(summary, null, 2),
        }],
      };
    }
  );
}
