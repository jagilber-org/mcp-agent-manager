// mcp-agent-manager/src/server/tools/monitorTools.ts
// Workspace monitoring tools: monitor, stop, status, get, mine, history

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { workspaceMonitor, workspaceHistory } from '../../services/workspace/index.js';
import { toolError } from './toolErrors.js';

export function registerMonitorTools(server: McpServer): void {
  // ===== mgr_monitor_workspace =====
  server.tool(
    'mgr_monitor_workspace',
    'Start monitoring a workspace/repo directory for agent activity. Watches VS Code chat sessions, git commits/branches, and .vscode config changes in real-time. Events appear in the dashboard and SSE stream.',
    {
      path: z.string().describe('Absolute path to the workspace/repo directory to monitor (e.g. C:\\github\\my-project)'),
    },
    async (params) => {
      try {
        const ws = workspaceMonitor.start(params.path);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: 'monitoring',
              path: ws.path,
              workspaceId: ws.workspaceId || 'not-discovered',
              chatSessionsPath: ws.chatSessionsPath || 'not-found',
              sessionCount: ws.knownSessions.length,
              watcherCount: ws.watchers.length,
              startedAt: ws.startedAt.toISOString(),
            }, null, 2),
          }],
        };
      } catch (err) {
        return toolError('mgr_monitor_workspace', `Failed to start monitoring: ${(err as Error).message}`);
      }
    }
  );

  // ===== mgr_stop_monitor =====
  server.tool(
    'mgr_stop_monitor',
    'Stop monitoring a workspace. Pass the workspace path, or use "all" to stop all monitors.',
    {
      path: z.string().describe('Workspace path to stop monitoring, or "all" to stop all monitors'),
    },
    async (params) => {
      if (params.path === 'all') {
        const count = workspaceMonitor.stopAll();
        return {
          content: [{ type: 'text' as const, text: `Stopped monitoring ${count} workspace(s).` }],
        };
      }

      const stopped = workspaceMonitor.stop(params.path);
      if (!stopped) {
        return toolError('mgr_stop_monitor', `Not monitoring: ${params.path}`);
      }

      return {
        content: [{ type: 'text' as const, text: `Stopped monitoring: ${params.path}` }],
      };
    }
  );

  // ===== mgr_monitor_status =====
  server.tool(
    'mgr_monitor_status',
    'Get the current workspace monitoring status - lists all monitored workspaces with their session counts, recent changes, and git events.',
    {},
    async () => {
      const status = workspaceMonitor.getStatus();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(status, null, 2),
        }],
      };
    }
  );

  // ===== mgr_mine_sessions =====
  server.tool(
    'mgr_mine_sessions',
    'Manually trigger session metadata mining for a monitored workspace (or all workspaces). Forces an immediate re-scan of chat session JSONL files to update request counts, token usage, errors, and other metrics.',
    {
      path: z.string().optional().describe('Workspace path to mine, or omit to mine all monitored workspaces'),
    },
    async (params) => {
      try {
        const results = await workspaceMonitor.mineNow(params.path);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(results, null, 2),
          }],
        };
      } catch (err) {
        return toolError('mgr_mine_sessions', `Mining failed: ${(err as Error).message}`);
      }
    }
  );

  // ===== mgr_get_workspace =====
  server.tool(
    'mgr_get_workspace',
    'Get detailed status for a single monitored workspace including sessions, git events, file changes, and memory files.',
    {
      path: z.string().describe('Absolute path to the workspace to query'),
    },
    async (params) => {
      const detail = workspaceMonitor.getDetail(params.path);
      if (!detail) {
        return toolError('mgr_get_workspace', `Not monitoring: ${params.path}`);
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(detail, null, 2),
        }],
      };
    }
  );

  // ===== mgr_list_workspace_history =====
  server.tool(
    'mgr_list_workspace_history',
    'Browse past workspace monitoring sessions. Shows start/stop times, duration, session counts, git events, and file changes from previous monitoring periods.',
    {
      path: z.string().optional().describe('Filter history to a specific workspace path'),
      limit: z.number().default(20).describe('Max entries to return'),
      offset: z.number().default(0).describe('Pagination offset'),
    },
    async (params) => {
      const entries = workspaceHistory.getHistory({
        path: params.path,
        limit: params.limit,
        offset: params.offset,
      });
      const total = workspaceHistory.getCount(params.path);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ count: entries.length, total, entries }, null, 2),
        }],
      };
    }
  );
}
