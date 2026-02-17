// mcp-agent-manager/src/server/resources.ts
// MCP resource registrations: agent roster and per-agent details

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { agentRegistry } from '../services/agentRegistry.js';

export function registerResources(server: McpServer): void {
  // ===== agents://status - Current agent roster =====
  server.resource(
    'agent-roster',
    'agents://status',
    { description: 'Current registered agents and their states', mimeType: 'application/json' },
    async () => {
      const agents = agentRegistry.getAll().map(i => ({
        id: i.config.id,
        provider: i.config.provider,
        model: i.config.model,
        state: i.state,
        tags: i.config.tags,
      }));

      return {
        contents: [{
          uri: 'agents://status',
          text: JSON.stringify(agents, null, 2),
          mimeType: 'application/json',
        }],
      };
    }
  );

  // ===== agents://{agentId}/details =====
  server.resource(
    'agent-details',
    new ResourceTemplate('agents://{agentId}/details', { list: undefined }),
    { description: 'Detailed information about a specific agent', mimeType: 'application/json' },
    async (uri, params) => {
      const agentId = params.agentId as string;
      const instance = agentRegistry.get(agentId);

      const data = instance
        ? { ...instance, config: { ...instance.config, env: undefined } }
        : { error: `Agent ${agentId} not found` };

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(data, null, 2),
          mimeType: 'application/json',
        }],
      };
    }
  );
}
