// mcp-agent-manager/src/server/tools/crossRepoTools.ts
// Cross-repo dispatch tools: dispatch prompts to other repos via copilot CLI

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { getLogsDir } from '../../services/dataDir.js';
import {
  generateDispatchId,
  dispatchToRepo,
  dispatchBatch,
  cancelDispatch,
  getDispatchStatus,
  getDispatchHistory,
  getActiveDispatches,
  isCopilotAvailable,
  getCopilotPath,
} from '../../services/crossRepoDispatcher.js';
import type { CrossRepoRequest, DispatchStatus } from '../../types/index.js';
import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { toolError } from './toolErrors.js';

const DEFAULT_SINGLE_LIMIT = 50_000;
const DEFAULT_BATCH_LIMIT = 20_000;

function writeSpilloverFile(dispatchId: string, content: string): string {
  const dir = path.join(getLogsDir(), 'cross-repo-sessions');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${dispatchId}-full.md`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

export function registerCrossRepoTools(server: McpServer): void {
  // ===== mgr_cross_repo_dispatch =====
  server.tool(
    'mgr_cross_repo_dispatch',
    'Dispatch a prompt to another repository via copilot CLI. Spawns a copilot process in the target repo with full workspace context.',
    {
      repoPath: z.string().describe('Absolute path to the target repository'),
      prompt: z.string().describe('The prompt/task to send to the target repo'),
      model: z.string().optional().describe('Model to use (default: claude-sonnet-4). Options: claude-sonnet-4, claude-opus-4, gpt-5.1, etc.'),
      timeoutMs: z.number().optional().describe('Timeout in ms (default: 300000 / 5 min)'),
      allowMutations: z.boolean().default(false).describe('Allow copilot to write/modify files (--yolo). Default: read-only'),
      additionalDirs: z.array(z.string()).optional().describe('Extra directories to grant access to via --add-dir'),
      additionalMcpConfig: z.string().optional().describe('Path to additional MCP config JSON for the spawned process'),
      priority: z.number().default(0).describe('Dispatch priority (higher = more important)'),
      callerContext: z.string().optional().describe('Free-form context from the caller for tracking'),
      maxResponseChars: z.number().optional().describe('Max chars to return inline (default: 50000). Full content is always saved to a spillover file when truncated.'),
    },
    async (params, extra) => {
      // Check copilot availability
      if (!isCopilotAvailable()) {
        return toolError('mgr_cross_repo_dispatch', `Copilot CLI not found. Install via: winget install GitHub.Copilot.Prerelease, or set COPILOT_PATH env var. Searched: ${getCopilotPath()}`);
      }

      const dispatchId = generateDispatchId();

      // Build progress callback if the client provided a progressToken
      const progressToken = extra?._meta?.progressToken;
      const onProgress = progressToken
        ? (progress: number, total: number | undefined, message: string) => {
            extra.sendNotification({
              method: 'notifications/progress',
              params: { progressToken, progress, total, message },
            } as ServerNotification).catch(() => { /* client may have disconnected */ });
          }
        : undefined;

      const request: CrossRepoRequest = {
        dispatchId,
        repoPath: params.repoPath,
        prompt: params.prompt,
        model: params.model,
        timeoutMs: params.timeoutMs,
        allowMutations: params.allowMutations,
        additionalDirs: params.additionalDirs,
        additionalMcpConfig: params.additionalMcpConfig,
        priority: params.priority,
        callerContext: params.callerContext,
        onProgress,
      };

      const result = await dispatchToRepo(request);

      const limit = params.maxResponseChars ?? DEFAULT_SINGLE_LIMIT;
      const truncated = result.content.length > limit;

      // Write full content to spillover file when truncated
      let spilloverFile: string | undefined;
      if (truncated) {
        try { spilloverFile = writeSpilloverFile(result.dispatchId, result.content); } catch { /* best-effort */ }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            dispatchId: result.dispatchId,
            repoPath: result.repoPath,
            status: result.status,
            model: result.model,
            durationMs: result.durationMs,
            estimatedTokens: result.estimatedTokens,
            exitCode: result.exitCode,
            error: result.error,
            sessionFile: result.sessionFile,
            contentLength: result.content.length,
            contentTruncated: truncated,
            content: result.content.substring(0, limit),
            hint: truncated
              ? `Response truncated from ${result.content.length} to ${limit} chars. Full content saved to: ${spilloverFile || result.sessionFile || '(unavailable)'}`
              : undefined,
            spilloverFile,
          }, null, 2),
        }],
      };
    }
  );

  // ===== mgr_cross_repo_batch_dispatch =====
  server.tool(
    'mgr_cross_repo_batch_dispatch',
    'Dispatch multiple prompts concurrently to one or more repositories. All dispatches run in parallel via Promise.all, up to the MAX_CONCURRENT limit.',
    {
      dispatches: z.array(z.object({
        repoPath: z.string().describe('Absolute path to the target repository'),
        prompt: z.string().describe('The prompt/task to send to the target repo'),
        model: z.string().optional().describe('Model override'),
        timeoutMs: z.number().optional().describe('Timeout in ms (default: 300000)'),
        allowMutations: z.boolean().default(false).describe('Allow file writes'),
        additionalDirs: z.array(z.string()).optional().describe('Extra --add-dir paths'),
        additionalMcpConfig: z.string().optional().describe('Additional MCP config path'),
        callerContext: z.string().optional().describe('Tracking context'),
      })).min(1).max(10).describe('Array of dispatch requests (1-10)'),
      maxResponseChars: z.number().optional().describe('Max chars per result inline (default: 20000). Full content saved to spillover file when truncated.'),
    },
    async (params) => {
      if (!isCopilotAvailable()) {
        return toolError('mgr_cross_repo_batch_dispatch', 'Copilot CLI not found. Install via: winget install GitHub.Copilot.Prerelease, or set COPILOT_PATH env var.');
      }

      const requests: CrossRepoRequest[] = params.dispatches.map(d => ({
        dispatchId: generateDispatchId(),
        repoPath: d.repoPath,
        prompt: d.prompt,
        model: d.model,
        timeoutMs: d.timeoutMs,
        allowMutations: d.allowMutations,
        additionalDirs: d.additionalDirs,
        additionalMcpConfig: d.additionalMcpConfig,
        callerContext: d.callerContext,
      }));

      const results = await dispatchBatch(requests);

      const summary = {
        total: results.length,
        completed: results.filter(r => r.status === 'completed').length,
        failed: results.filter(r => r.status === 'failed').length,
        timedOut: results.filter(r => r.status === 'timeout').length,
        totalDurationMs: Math.max(...results.map(r => r.durationMs), 0),
        totalEstimatedTokens: results.reduce((s, r) => s + (r.estimatedTokens || 0), 0),
      };

      const batchLimit = params.maxResponseChars ?? DEFAULT_BATCH_LIMIT;

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            summary,
            results: results.map(r => {
              const trunc = r.content.length > batchLimit;
              let spillover: string | undefined;
              if (trunc) {
                try { spillover = writeSpilloverFile(r.dispatchId, r.content); } catch { /* best-effort */ }
              }
              return {
                dispatchId: r.dispatchId,
                repoPath: r.repoPath,
                status: r.status,
                model: r.model,
                durationMs: r.durationMs,
                estimatedTokens: r.estimatedTokens,
                error: r.error,
                sessionFile: r.sessionFile,
                contentLength: r.content.length,
                contentTruncated: trunc,
                content: r.content.substring(0, batchLimit),
                hint: trunc
                  ? `Truncated from ${r.content.length} to ${batchLimit} chars. Full content: ${spillover || r.sessionFile || '(unavailable)'}`
                  : undefined,
                spilloverFile: spillover,
              };
            }),
          }, null, 2),
        }],
      };
    }
  );

  // ===== mgr_cross_repo_status =====
  server.tool(
    'mgr_cross_repo_status',
    'Check the status of a cross-repo dispatch by ID, or list all active dispatches.',
    {
      dispatchId: z.string().optional().describe('Specific dispatch ID to check. Omit to list all active dispatches.'),
    },
    async (params) => {
      if (params.dispatchId) {
        const status = getDispatchStatus(params.dispatchId);
        if (!status) {
          return toolError('mgr_cross_repo_status', `Dispatch not found: ${params.dispatchId}`);
        }
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(status, null, 2),
          }],
        };
      }

      // List all active dispatches
      const active = getActiveDispatches();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            activeCount: active.length,
            dispatches: active,
            copilotAvailable: isCopilotAvailable(),
            copilotPath: getCopilotPath(),
          }, null, 2),
        }],
      };
    }
  );

  // ===== mgr_cross_repo_history =====
  server.tool(
    'mgr_cross_repo_history',
    'List cross-repo dispatch history with optional filters.',
    {
      limit: z.number().default(20).describe('Max items to return (default: 20)'),
      status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'timeout']).optional().describe('Filter by status'),
      repoPath: z.string().optional().describe('Filter by target repo path'),
    },
    async (params) => {
      const items = getDispatchHistory({
        limit: params.limit,
        status: params.status as DispatchStatus | undefined,
        repoPath: params.repoPath,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: items.length,
            dispatches: items,
          }, null, 2),
        }],
      };
    }
  );

  // ===== mgr_cross_repo_cancel =====
  server.tool(
    'mgr_cross_repo_cancel',
    'Cancel a running cross-repo dispatch.',
    {
      dispatchId: z.string().describe('Dispatch ID to cancel'),
    },
    async (params) => {
      const cancelled = cancelDispatch(params.dispatchId);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            dispatchId: params.dispatchId,
            cancelled,
            message: cancelled
              ? `Dispatch ${params.dispatchId} cancelled successfully.`
              : `Dispatch ${params.dispatchId} not found or already completed.`,
          }, null, 2),
        }],
      };
    }
  );
}
