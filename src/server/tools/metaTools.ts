// mcp-agent-manager/src/server/tools/metaTools.ts
// MCP tools for querying agent/skill performance insights and index-server.
// Env-gated: only registered when MCP_META_TOOLS=true (default: false)
// to avoid cluttering the tool list when not needed.
//
// Index-server is auto-discovered from VS Code's mcp.json, or via MCP_INDEX_URL override.
// Circuit breaker prevents impact when the server is unreachable.
//
// Tools (when enabled):
//   mgr_get_insights     - query accumulated agent/skill performance trends
//   mgr_search_knowledge - search cross-repo knowledge via index-server

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getInsightsSummary, getAgentInsights, getSkillInsights, isMetaEnabled } from '../../services/metaCollector.js';
import { indexClient } from '../../services/indexClient.js';
import { indexPromoter } from '../../services/indexPromoter.js';
import { toolError } from './toolErrors.js';

/** Whether meta tools should be registered */
export function isMetaToolsEnabled(): boolean {
  const val = process.env.MCP_META_TOOLS;
  return val === '1' || val?.toLowerCase() === 'true';
}

export function registerMetaTools(server: McpServer): void {
  if (!isMetaToolsEnabled()) {
    return; // Skip registration - don't clutter tool list
  }

  // ===== mgr_get_insights =====
  server.tool(
    'mgr_get_insights',
    'Get accumulated agent and skill performance insights. Shows success rates, token usage, latency trends, and cost breakdown across sessions. Data persists across restarts.',
    {
      agentId: z.string().optional().describe('Filter to a specific agent ID'),
      skillId: z.string().optional().describe('Filter to a specific skill ID'),
      type: z.enum(['all', 'agents', 'skills', 'session']).default('all').describe('What to return'),
    },
    async (params) => {
      if (!isMetaEnabled()) {
        return toolError('mgr_get_insights', 'Meta collection is disabled. Set MCP_META_ENABLED=true to enable.');
      }

      const summary = getInsightsSummary();

      // Apply filters
      let result: Record<string, unknown> = {};

      if (params.type === 'all' || params.type === 'agents') {
        let agents = summary.agents;
        if (params.agentId) {
          agents = agents.filter(a => a.agentId === params.agentId);
        }
        result.agents = agents;
      }

      if (params.type === 'all' || params.type === 'skills') {
        let skills = summary.skills;
        if (params.skillId) {
          skills = skills.filter(s => s.skillId === params.skillId);
        }
        result.skills = skills;
      }

      if (params.type === 'all' || params.type === 'session') {
        result.session = summary.session;
      }

      result.indexServer = summary.indexServer;

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    }
  );

  // ===== mgr_search_knowledge =====
  server.tool(
    'mgr_search_knowledge',
    'Search cross-repo knowledge stored in mcp-index-server. Finds agent performance data, skill effectiveness, and learned insights shared across all connected repos. Auto-discovers index-server from VS Code mcp.json, or use MCP_INDEX_URL to override.',
    {
      query: z.string().describe('Search query (e.g. "code-review performance", "agent failure patterns")'),
      category: z.string().optional().describe('Filter by knowledge category (e.g. agent-performance, skill-performance)'),
      limit: z.number().default(10).describe('Max results'),
    },
    async ({ query, category, limit }) => {
      if (!indexClient.isConfigured()) {
        return toolError('mgr_search_knowledge', 'Index-server not found. Auto-discovery checked VS Code mcp.json but found no mcp-index-server entry. Either install mcp-index-server in VS Code, or set MCP_INDEX_URL=http://localhost:8787');
      }

      if (indexClient.isCircuitOpen()) {
        return toolError('mgr_search_knowledge', `Index-server circuit breaker is open (server unreachable). Circuit state: ${indexClient.circuitState}. Will retry automatically after cooldown.`);
      }

      try {
        const results = await indexClient.searchKnowledge(query, { category, limit });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              query,
              category: category || 'all',
              resultCount: results.length,
              results,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return toolError('mgr_search_knowledge', err.message);
      }
    }
  );

  // ===== mgr_promote_knowledge =====
  server.tool(
    'mgr_promote_knowledge',
    'Promote local governance docs, architecture, specs, and runbook instructions to mcp-index-server as searchable instructions. Uses content hashing to skip unchanged content. Reads promotion-map.json for source→instruction metadata mapping.',
    {
      scope: z.enum(['all', 'governance', 'specs', 'docs', 'instructions']).default('all').describe('Which content category to promote'),
      force: z.boolean().default(false).describe('Force re-promotion even if content hash matches'),
    },
    async ({ scope, force }) => {
      if (!indexClient.isConfigured()) {
        return toolError('mgr_promote_knowledge', 'Index-server not configured. Auto-discovery checked VS Code mcp.json but found no mcp-index-server entry. Set MCP_INDEX_URL=http://localhost:8787');
      }

      if (indexClient.isCircuitOpen()) {
        return toolError('mgr_promote_knowledge', `Index-server circuit breaker is open. State: ${JSON.stringify(indexClient.circuitState)}. Will retry after cooldown.`);
      }

      try {
        const result = await indexPromoter.promote({ scope, force });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              scope,
              force,
              ...result,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return toolError('mgr_promote_knowledge', err.message);
      }
    }
  );
}
