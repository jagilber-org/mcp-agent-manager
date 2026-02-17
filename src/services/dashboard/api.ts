// mcp-agent-manager/src/services/dashboard/api.ts
// REST API route handlers for the dashboard HTTP server.

import { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { logger } from '../logger.js';
import { agentRegistry } from '../agentRegistry.js';
import { getRouterMetrics, routeTask, clearTaskHistory } from '../taskRouter.js';
import { killSession, killAllSessions } from '../../providers/copilot.js';
import { workspaceMonitor, workspaceHistory } from '../workspace/index.js';
import { automationEngine } from '../automation/index.js';
import { skillStore } from '../skillStore.js';
import { createIssueFromReview, isAutoIssueEnabled } from '../githubIssues.js';
import { agentMailbox, MAX_TTL_SECONDS } from '../agentMailbox.js';
import type { AgentMessage } from '../agentMailbox.js';
import { buildSnapshot } from './snapshot.js';
import { broadcastSSE } from './sse.js';
import { DATA_DIR } from '../dataDir.js';
import type { SkillDefinition, TaskRequest } from '../../types/index.js';
import { getInsightsSummary, isMetaEnabled } from '../metaCollector.js';
import { clearEventLog } from '../eventLog.js';
import { indexClient } from '../indexClient.js';
import {
  createBackup,
  listBackups,
  restoreBackup,
  deleteBackup,
  getBackupDetails,
  exportBackup,
  importBackup,
} from '../backupService.js';
import {
  generateDispatchId,
  dispatchToRepo,
  cancelDispatch,
  getDispatchStatus,
  getDispatchHistory,
  getActiveDispatches,
  isCopilotAvailable,
  getCopilotPath,
  clearDispatchHistory,
} from '../crossRepoDispatcher.js';
import {
  sseClients,
  eventCounts,
  requestLog,
  totalRequests,
  serverStartedAt,
  actualPort,
} from './state.js';

// ---------------------------------------------------------------------------
// JSON helper
// ---------------------------------------------------------------------------

export function sendJSON(res: ServerResponse, data: unknown): void {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function send404(res: ServerResponse, msg: string): void {
  res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ error: msg }));
}

function send400(res: ServerResponse, msg: string): void {
  res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ error: msg }));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
  });
}

// ---------------------------------------------------------------------------
// Route handler - returns true if the request was handled
// ---------------------------------------------------------------------------

export async function handleAPI(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url || '/';

  if (url === '/api/snapshot') {
    sendJSON(res, buildSnapshot());
    return true;
  }

  if (url === '/api/agents' && req.method === 'GET') {
    sendJSON(res, buildSnapshot().agents);
    return true;
  }

  // Register a new agent via REST
  if (url === '/api/agents' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const params = JSON.parse(body);
        const config = {
          id: params.id,
          name: params.name || params.id,
          provider: params.provider || 'copilot',
          model: params.model || 'gpt-4o',
          transport: params.transport || 'stdio',
          endpoint: params.endpoint || params.binaryPath || '',
          maxConcurrency: params.maxConcurrency || 1,
          costMultiplier: params.costMultiplier || 1,
          tags: params.tags || [],
          canMutate: params.canMutate || false,
          timeoutMs: params.timeoutMs || 60000,
          binaryPath: params.binaryPath,
          cliArgs: params.cliArgs,
          args: params.cliArgs,
          env: params.env,
        };
        agentRegistry.register(config as any);
        sendJSON(res, { status: 'registered', agent: config.id, provider: config.provider, model: config.model });
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  // Get single agent by ID
  if (req.method === 'GET' && url.startsWith('/api/agents/') && !url.endsWith('/kill') && url !== '/api/agents/kill-all') {
    const agentId = decodeURIComponent(url.slice('/api/agents/'.length));
    const instance = agentRegistry.get(agentId);
    if (!instance) {
      send404(res, `Agent not found: ${agentId}`);
      return true;
    }
    sendJSON(res, {
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
    });
    return true;
  }

  // Update agent (partial merge)
  if (req.method === 'PUT' && url.startsWith('/api/agents/')) {
    const agentId = decodeURIComponent(url.slice('/api/agents/'.length));
    const existing = agentRegistry.get(agentId);
    if (!existing) {
      send404(res, `Agent not found: ${agentId}`);
      return true;
    }
    const body = await readBody(req);
    try {
      const updates = JSON.parse(body);
      delete updates.id; // id is immutable
      const updated = agentRegistry.update(agentId, updates);
      if (!updated) {
        send404(res, `Agent not found: ${agentId}`);
        return true;
      }
      sendJSON(res, { status: 'updated', agent: agentId, updatedFields: Object.keys(updates) });
      broadcastSSE('snapshot', buildSnapshot());
    } catch (err: any) {
      send400(res, err.message);
    }
    return true;
  }

  if (url === '/api/skills' && req.method === 'GET') {
    sendJSON(res, buildSnapshot().skills);
    return true;
  }

  // Create skill via REST
  if (url === '/api/skills' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const params = JSON.parse(body);
      if (!params.id || !params.name || !params.promptTemplate) {
        send400(res, 'Missing required fields: id, name, promptTemplate');
        return true;
      }
      skillStore.register({
        id: params.id,
        name: params.name,
        description: params.description || '',
        promptTemplate: params.promptTemplate,
        strategy: params.strategy || 'single',
        targetAgents: params.targetAgents,
        targetTags: params.targetTags,
        maxTokens: params.maxTokens,
        timeoutMs: params.timeoutMs,
        mergeResults: params.mergeResults ?? false,
        version: '1.0.0',
        categories: params.categories || [],
      });
      sendJSON(res, { status: 'registered', skill: params.id });
      broadcastSSE('snapshot', buildSnapshot());
    } catch (err: any) {
      send400(res, err.message);
    }
    return true;
  }

  // Get single skill by ID
  if (req.method === 'GET' && url.startsWith('/api/skills/') && !url.includes('/api/skills//')) {
    const skillId = decodeURIComponent(url.slice('/api/skills/'.length));
    const skill = skillStore.get(skillId);
    if (!skill) {
      send404(res, `Skill not found: ${skillId}`);
      return true;
    }
    sendJSON(res, skill);
    return true;
  }

  // Update skill (partial merge)
  if (req.method === 'PUT' && url.startsWith('/api/skills/')) {
    const skillId = decodeURIComponent(url.slice('/api/skills/'.length));
    const existing = skillStore.get(skillId);
    if (!existing) {
      send404(res, `Skill not found: ${skillId}`);
      return true;
    }
    const body = await readBody(req);
    try {
      const updates = JSON.parse(body);
      const vParts = existing.version.split('.').map(Number);
      if (vParts.length === 3 && vParts.every(n => !isNaN(n))) vParts[2]++;
      const updated = { ...existing, ...updates, id: skillId, version: vParts.join('.') };
      skillStore.register(updated);
      sendJSON(res, { status: 'updated', skill: updated });
      broadcastSSE('snapshot', buildSnapshot());
    } catch (err: any) {
      send400(res, err.message);
    }
    return true;
  }

  // Delete skill
  if (req.method === 'DELETE' && url.startsWith('/api/skills/')) {
    const skillId = decodeURIComponent(url.slice('/api/skills/'.length));
    const removed = skillStore.remove(skillId);
    if (!removed) {
      send404(res, `Skill not found: ${skillId}`);
      return true;
    }
    sendJSON(res, { deleted: true, id: skillId });
    broadcastSSE('snapshot', buildSnapshot());
    return true;
  }

  if (url === '/api/metrics') {
    sendJSON(res, getRouterMetrics());
    return true;
  }

  // Kill a specific agent
  if (req.method === 'POST' && url.startsWith('/api/agents/') && url.endsWith('/kill')) {
    const agentId = decodeURIComponent(url.slice('/api/agents/'.length, url.length - '/kill'.length));
    const agent = agentRegistry.get(agentId);
    if (!agent) {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: `Agent '${agentId}' not found` }));
      return true;
    }
    const existed = agentRegistry.unregister(agentId);
    killSession(agentId);
    logger.info(`Dashboard: killed agent ${agentId}`);
    sendJSON(res, { killed: true, agentId, existed });
    return true;
  }

  // Kill all agents
  if (req.method === 'POST' && url === '/api/agents/kill-all') {
    const agents = agentRegistry.getAll();
    const ids = agents.map(a => a.config.id);
    for (const inst of agents) {
      agentRegistry.unregister(inst.config.id);
    }
    killAllSessions();
    logger.info(`Dashboard: killed all ${ids.length} agents`);
    sendJSON(res, { killed: true, count: ids.length, agents: ids });
    return true;
  }

  if (url === '/api/workspaces' && req.method === 'GET') {
    sendJSON(res, workspaceMonitor.getStatus());
    return true;
  }

  // Start monitoring a workspace
  if (url === '/api/workspaces' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const params = JSON.parse(body);
      if (!params.path) {
        send400(res, 'Missing required field: path');
        return true;
      }
      const ws = workspaceMonitor.start(params.path);
      sendJSON(res, {
        status: 'monitoring',
        path: ws.path,
        workspaceId: ws.workspaceId || 'not-discovered',
        sessionCount: ws.knownSessions.length,
        startedAt: ws.startedAt.toISOString(),
      });
      broadcastSSE('snapshot', buildSnapshot());
    } catch (err: any) {
      send400(res, err.message);
    }
    return true;
  }

  // Workspace history endpoints
  if (req.method === 'GET' && url.startsWith('/api/workspace-history')) {
    const histPath = url.slice('/api/workspace-history'.length);
    if (!histPath || histPath === '/') {
      // List all history (with query params for pagination)
      const urlObj = new URL(url, 'http://localhost');
      const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);
      const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);
      const entries = workspaceHistory.getHistory({ limit, offset });
      const total = workspaceHistory.getCount();
      sendJSON(res, { count: entries.length, total, entries });
    } else {
      // Filter by specific path
      const filterPath = decodeURIComponent(histPath.slice(1));
      const entries = workspaceHistory.getHistory({ path: filterPath });
      const total = workspaceHistory.getCount(filterPath);
      sendJSON(res, { count: entries.length, total, path: filterPath, entries });
    }
    return true;
  }

  // Single workspace detail, stop, mine
  if (url.startsWith('/api/workspaces/') && url !== '/api/workspaces/') {
    const rest = url.slice('/api/workspaces/'.length);
    const slashIdx = rest.indexOf('/');
    const encodedPath = slashIdx >= 0 ? rest.slice(0, slashIdx) : rest;
    const action = slashIdx >= 0 ? rest.slice(slashIdx + 1) : '';
    const wsPath = decodeURIComponent(encodedPath);

    // GET /api/workspaces/:encodedPath - detail
    if (req.method === 'GET' && !action) {
      const detail = workspaceMonitor.getDetail(wsPath);
      if (!detail) {
        send404(res, `Not monitoring: ${wsPath}`);
        return true;
      }
      sendJSON(res, detail);
      return true;
    }

    // DELETE /api/workspaces/:encodedPath - stop
    if (req.method === 'DELETE' && !action) {
      const stopped = workspaceMonitor.stop(wsPath);
      if (!stopped) {
        send404(res, `Not monitoring: ${wsPath}`);
        return true;
      }
      sendJSON(res, { stopped: true, path: wsPath });
      broadcastSSE('snapshot', buildSnapshot());
      return true;
    }

    // POST /api/workspaces/:encodedPath/mine - trigger mining
    if (req.method === 'POST' && action === 'mine') {
      try {
        const results = await workspaceMonitor.mineNow(wsPath);
        sendJSON(res, results);
      } catch (err: any) {
        send404(res, err.message);
      }
      return true;
    }
  }

  // Automation - list / status
  if (url === '/api/automation' && req.method === 'GET') {
    sendJSON(res, automationEngine.getStatus());
    return true;
  }

  // Create automation rule
  if (url === '/api/automation' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const params = JSON.parse(body);
      if (!params.id || !params.name || !params.skillId || !params.events?.length) {
        send400(res, 'Missing required fields: id, name, skillId, events');
        return true;
      }
      const rule = automationEngine.registerRule(params);
      sendJSON(res, { status: 'created', rule: { id: rule.id, name: rule.name, version: rule.version } });
      broadcastSSE('snapshot', buildSnapshot());
    } catch (err: any) {
      send400(res, err.message);
    }
    return true;
  }

  // Single automation rule CRUD + actions
  if (url.startsWith('/api/automation/') && url !== '/api/automation/') {
    const rest = url.slice('/api/automation/'.length);
    const slashIdx = rest.indexOf('/');
    const ruleId = decodeURIComponent(slashIdx >= 0 ? rest.slice(0, slashIdx) : rest);
    const action = slashIdx >= 0 ? rest.slice(slashIdx + 1) : '';

    // GET /api/automation/:id - single rule + stats
    if (req.method === 'GET' && !action) {
      const rule = automationEngine.getRule(ruleId);
      if (!rule) {
        send404(res, `Automation rule not found: ${ruleId}`);
        return true;
      }
      const stats = automationEngine.getRuleStats(ruleId);
      sendJSON(res, { rule, stats });
      return true;
    }

    // PUT /api/automation/:id - partial update
    if (req.method === 'PUT' && !action) {
      const body = await readBody(req);
      try {
        const updates = JSON.parse(body);
        const updated = automationEngine.updateRule(ruleId, updates);
        if (!updated) {
          send404(res, `Automation rule not found: ${ruleId}`);
          return true;
        }
        sendJSON(res, { status: 'updated', rule: { id: updated.id, name: updated.name, version: updated.version } });
        broadcastSSE('snapshot', buildSnapshot());
      } catch (err: any) {
        send400(res, err.message);
      }
      return true;
    }

    // DELETE /api/automation/:id - remove
    if (req.method === 'DELETE' && !action) {
      const removed = automationEngine.removeRule(ruleId);
      if (!removed) {
        send404(res, `Automation rule not found: ${ruleId}`);
        return true;
      }
      sendJSON(res, { deleted: true, id: ruleId });
      broadcastSSE('snapshot', buildSnapshot());
      return true;
    }

    // POST /api/automation/:id/toggle - enable/disable
    if (req.method === 'POST' && action === 'toggle') {
      const body = await readBody(req);
      try {
        const { enabled } = JSON.parse(body);
        if (typeof enabled !== 'boolean') {
          send400(res, 'Missing required boolean field: enabled');
          return true;
        }
        const ok = automationEngine.setRuleEnabled(ruleId, enabled);
        if (!ok) {
          send404(res, `Automation rule not found: ${ruleId}`);
          return true;
        }
        sendJSON(res, { toggled: true, id: ruleId, enabled });
        broadcastSSE('snapshot', buildSnapshot());
      } catch (err: any) {
        send400(res, err.message);
      }
      return true;
    }

    // POST /api/automation/:id/trigger - manual trigger
    if (req.method === 'POST' && action === 'trigger') {
      const body = await readBody(req);
      try {
        const { testData = {}, dryRun = false } = JSON.parse(body || '{}');
        const execution = await automationEngine.triggerRule(ruleId, testData, dryRun);
        sendJSON(res, execution);
      } catch (err: any) {
        if (err.message.includes('not found')) {
          send404(res, err.message);
        } else {
          send400(res, err.message);
        }
      }
      return true;
    }
  }

  // Review queue endpoints
  if (url === '/api/review-queue' && req.method === 'GET') {
    sendJSON(res, {
      stats: automationEngine.getReviewStats(),
      items: automationEngine.getReviewQueue({ limit: 50 }),
    });
    return true;
  }

  if (req.method === 'POST' && url.startsWith('/api/review-queue/') && url.includes('/')) {
    // Parse: /api/review-queue/{reviewId}/{action}
    const parts = url.slice('/api/review-queue/'.length).split('/');
    const reviewId = decodeURIComponent(parts[0]);
    const action = parts[1];
    const validActions: Record<string, import('../../types/automation.js').ReviewStatus> = {
      approve: 'approved', dismiss: 'dismissed', flag: 'flagged', pending: 'pending',
    };
    const newStatus = validActions[action];
    if (!newStatus) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: `Invalid action: ${action}. Use: approve, dismiss, flag, pending` }));
      return true;
    }
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      let notes: string | undefined;
      if (body) {
        try { notes = JSON.parse(body).notes; } catch { /* ignore */ }
      }
      const result = automationEngine.updateReview(reviewId, newStatus, notes);
      if (!result) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: `Review item not found: ${reviewId}` }));
      } else {
        sendJSON(res, result);
        broadcastSSE('snapshot', buildSnapshot());
      }
    });
    return true;
  }

  // Create GitHub issue from review item
  if (req.method === 'POST' && url.match(/^\/api\/review-queue\/[^/]+\/create-issue$/)) {
    const reviewId = decodeURIComponent(url.split('/')[3]);
    const item = automationEngine.getReviewQueue().find(i => i.reviewId === reviewId);
    if (!item) {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: `Review item not found: ${reviewId}` }));
      return true;
    }
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', async () => {
      let opts: { repo?: string; workspacePath?: string } = {};
      if (body) {
        try { opts = JSON.parse(body); } catch { /* ignore */ }
      }
      const result = await createIssueFromReview(item, opts);
      if (result.success && result.issueUrl) {
        const existing = item.notes || '';
        item.notes = (existing ? existing + '\n' : '') + `GitHub: ${result.issueUrl}`;
        item.githubIssueUrl = result.issueUrl;
        item.reviewedAt = new Date().toISOString();
      }
      sendJSON(res, result);
      if (result.success) broadcastSSE('snapshot', buildSnapshot());
    });
    return true;
  }

  // Ask Agent - send form data to an active agent for refinement suggestions
  if (url === '/api/ask-agent' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const params = JSON.parse(body);
      if (!params.prompt) {
        send400(res, 'Missing required field: prompt');
        return true;
      }

      // Find target agent: use specified agentId, or first available agent
      let agentId = params.agentId;
      if (!agentId) {
        const available = agentRegistry.findAvailable();
        if (available.length === 0) {
          const all = agentRegistry.getAll();
          if (all.length === 0) {
            send400(res, 'No agents registered. Add an agent first.');
            return true;
          }
          // Use first non-stopped agent even if busy
          const candidate = all.find(a => a.state !== 'stopped' && a.state !== 'error') || all[0];
          agentId = candidate.config.id;
        } else {
          agentId = available[0].config.id;
        }
      } else {
        const instance = agentRegistry.get(agentId);
        if (!instance) {
          send404(res, `Agent not found: ${agentId}`);
          return true;
        }
      }

      // Create ephemeral skill → routeTask → clean up (same pattern as mgr_send_prompt)
      const taskId = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const skill: SkillDefinition = {
        id: `_ask_${taskId}`,
        name: 'Ask Agent',
        description: 'Dashboard ask-agent refinement prompt',
        promptTemplate: '{prompt}',
        targetAgents: [agentId],
        strategy: 'single',
        maxTokens: params.maxTokens || 4000,
        version: '0',
        categories: [],
      };

      skillStore.register(skill);
      try {
        const request: TaskRequest = {
          taskId,
          skillId: skill.id,
          params: { prompt: params.prompt },
          priority: 0,
          createdAt: new Date(),
        };
        const result = await routeTask(request);
        const primary = result.responses[0];
        sendJSON(res, {
          success: primary?.success ?? false,
          agentId: primary?.agentId ?? agentId,
          content: result.finalContent || primary?.content || '',
          tokenCount: primary?.tokenCount ?? 0,
          latencyMs: primary?.latencyMs ?? 0,
          error: primary?.error,
        });
      } finally {
        skillStore.remove(skill.id);
      }
    } catch (err: any) {
      send400(res, err.message);
    }
    return true;
  }

  // Meta insights endpoint
  if (url === '/api/insights' && req.method === 'GET') {
    if (!isMetaEnabled()) {
      sendJSON(res, { error: 'Meta collection disabled. Set MCP_META_ENABLED=true.' });
      return true;
    }
    sendJSON(res, getInsightsSummary());
    return true;
  }

  // Index-server health check
  if (url === '/api/index-health' && req.method === 'GET') {
    const health = await indexClient.healthCheck();
    sendJSON(res, health);
    return true;
  }

  // Index-server knowledge search
  if (url.startsWith('/api/knowledge/search') && req.method === 'GET') {
    if (!indexClient.isConfigured()) {
      sendJSON(res, { error: 'Index-server not configured (auto-discovery found nothing, MCP_INDEX_URL not set)' });
      return true;
    }
    if (indexClient.isCircuitOpen()) {
      sendJSON(res, { error: 'Index-server circuit breaker open (server unreachable)', circuit: indexClient.circuitState });
      return true;
    }
    const urlObj = new URL(url, 'http://localhost');
    const query = urlObj.searchParams.get('q') || '';
    const category = urlObj.searchParams.get('category') || undefined;
    const limit = parseInt(urlObj.searchParams.get('limit') || '10', 10);
    const results = await indexClient.searchKnowledge(query, { category, limit });
    sendJSON(res, { query, results });
    return true;
  }

  // =========================================================================
  // Cross-repo dispatch endpoints
  // =========================================================================

  // POST /api/cross-repo - dispatch a task to another repo
  if (url === '/api/cross-repo' && req.method === 'POST') {
    if (!isCopilotAvailable()) {
      send400(res, 'Copilot CLI not found. Install via: winget install GitHub.Copilot.Prerelease, or set COPILOT_PATH.');
      return true;
    }
    const body = await readBody(req);
    try {
      const params = JSON.parse(body);
      if (!params.repoPath || !params.prompt) {
        send400(res, 'Missing required fields: repoPath, prompt');
        return true;
      }
      const dispatchId = generateDispatchId();
      const result = await dispatchToRepo({
        dispatchId,
        repoPath: params.repoPath,
        prompt: params.prompt,
        model: params.model,
        timeoutMs: params.timeoutMs,
        allowMutations: params.allowMutations ?? false,
        additionalDirs: params.additionalDirs,
        additionalMcpConfig: params.additionalMcpConfig,
        priority: params.priority ?? 0,
        callerContext: params.callerContext,
      });
      sendJSON(res, result);
      broadcastSSE('snapshot', buildSnapshot());
    } catch (err: any) {
      send400(res, err.message);
    }
    return true;
  }

  // GET /api/cross-repo - list active dispatches + history summary
  if (url === '/api/cross-repo' && req.method === 'GET') {
    const active = getActiveDispatches();
    const history = getDispatchHistory({ limit: 20 });
    sendJSON(res, {
      copilotAvailable: isCopilotAvailable(),
      copilotPath: getCopilotPath(),
      active,
      history,
    });
    return true;
  }

  // GET /api/cross-repo/history - filtered history
  if (url.startsWith('/api/cross-repo/history') && req.method === 'GET') {
    const urlObj = new URL(url, 'http://localhost');
    const limit = parseInt(urlObj.searchParams.get('limit') || '20', 10);
    const status = urlObj.searchParams.get('status') || undefined;
    const repoPath = urlObj.searchParams.get('repoPath') || undefined;
    const items = getDispatchHistory({ limit, status: status as any, repoPath });
    sendJSON(res, { count: items.length, dispatches: items });
    return true;
  }

  // GET /api/cross-repo/:dispatchId - single dispatch status/result
  if (req.method === 'GET' && url.startsWith('/api/cross-repo/') && !url.includes('/history') && url !== '/api/cross-repo/') {
    const dispatchId = decodeURIComponent(url.slice('/api/cross-repo/'.length));
    const status = getDispatchStatus(dispatchId);
    if (!status) {
      send404(res, `Dispatch not found: ${dispatchId}`);
      return true;
    }
    sendJSON(res, status);
    return true;
  }

  // DELETE /api/cross-repo/:dispatchId - cancel a running dispatch
  if (req.method === 'DELETE' && url.startsWith('/api/cross-repo/') && url !== '/api/cross-repo/') {
    const dispatchId = decodeURIComponent(url.slice('/api/cross-repo/'.length));
    const cancelled = cancelDispatch(dispatchId);
    if (!cancelled) {
      send404(res, `Dispatch not found or already completed: ${dispatchId}`);
      return true;
    }
    sendJSON(res, { cancelled: true, dispatchId });
    broadcastSSE('snapshot', buildSnapshot());
    return true;
  }

  // DELETE /api/task-history - clear task history
  if (url === '/api/task-history' && req.method === 'DELETE') {
    clearTaskHistory();
    sendJSON(res, { cleared: true });
    broadcastSSE('snapshot', buildSnapshot());
    return true;
  }

  // DELETE /api/cross-repo - clear dispatch history
  if (url === '/api/cross-repo' && req.method === 'DELETE') {
    clearDispatchHistory();
    sendJSON(res, { cleared: true });
    broadcastSSE('snapshot', buildSnapshot());
    return true;
  }

  // DELETE /api/review-queue - clear review queue
  if (url === '/api/review-queue' && req.method === 'DELETE') {
    automationEngine.clearReviewQueue();
    sendJSON(res, { cleared: true });
    broadcastSSE('snapshot', buildSnapshot());
    return true;
  }

  // =========================================================================
  // Messaging endpoints - HTTP peer mesh for multi-instance messaging
  // =========================================================================

  // POST /api/messages - send a message (same as mgr_send_message MCP tool)
  if (url === '/api/messages' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const params = JSON.parse(body);
      if (!params.channel || !params.sender || !params.body || !params.recipients?.length) {
        send400(res, 'Missing required fields: channel, sender, body, recipients');
        return true;
      }
      if (params.ttlSeconds !== undefined && (typeof params.ttlSeconds !== 'number' || params.ttlSeconds < 1)) {
        send400(res, `Invalid ttlSeconds: must be a positive number (max ${MAX_TTL_SECONDS})`);
        return true;
      }
      const messageId = await agentMailbox.send({
        channel: params.channel,
        sender: params.sender,
        recipients: params.recipients,
        body: params.body,
        ttlSeconds: params.ttlSeconds,
        payload: params.payload,
      });
      sendJSON(res, { messageId, channel: params.channel, status: 'sent', ttlCapped: params.ttlSeconds > MAX_TTL_SECONDS });
    } catch (err: any) {
      send400(res, err.message);
    }
    return true;
  }

  // POST /api/messages/inbound - receive a message from a peer instance
  if (url === '/api/messages/inbound' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const message: AgentMessage = JSON.parse(body);
      if (!message.id || !message.channel || !message.sender) {
        send400(res, 'Invalid message: missing id, channel, or sender');
        return true;
      }
      const isNew = agentMailbox.receiveFromPeer(message);
      if (isNew) {
        broadcastSSE('message:received', {
          messageId: message.id,
          channel: message.channel,
          sender: message.sender,
          recipients: message.recipients,
        });
      }
      sendJSON(res, { received: isNew, messageId: message.id });
    } catch (err: any) {
      send400(res, err.message);
    }
    return true;
  }

  // GET /api/messages/channels - list all channels
  if (url === '/api/messages/channels' && req.method === 'GET') {
    const channels = agentMailbox.listChannels();
    sendJSON(res, { count: channels.length, channels });
    return true;
  }

  // GET /api/messages/stats - get stats for a reader
  if (url.startsWith('/api/messages/stats') && req.method === 'GET') {
    const urlObj = new URL(url, 'http://localhost');
    const reader = urlObj.searchParams.get('reader');
    if (!reader) {
      send400(res, 'Missing required query param: reader');
      return true;
    }
    const channel = urlObj.searchParams.get('channel') || undefined;
    const stats = agentMailbox.getStats(reader, channel);
    sendJSON(res, { reader, channel: channel || '(all)', ...stats });
    return true;
  }

  // DELETE /api/messages - purge messages (all, by channel, or by IDs)
  if (url === '/api/messages' && req.method === 'DELETE') {
    const body = await readBody(req);
    let purged = 0;
    try {
      const params = body ? JSON.parse(body) : {};
      if (params.channel) {
        purged = agentMailbox.purgeChannel(params.channel);
      } else if (params.messageIds?.length) {
        purged = agentMailbox.deleteMessages(params.messageIds);
      } else {
        purged = agentMailbox.purgeAll();
      }
    } catch {
      purged = agentMailbox.purgeAll();
    }
    sendJSON(res, { purged });
    return true;
  }

  // POST /api/messages/ack - acknowledge messages
  if (url === '/api/messages/ack' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const params = JSON.parse(body);
      if (!params.messageIds?.length || !params.reader) {
        send400(res, 'Missing required fields: messageIds, reader');
        return true;
      }
      const count = agentMailbox.ack(params.messageIds, params.reader);
      sendJSON(res, { acknowledged: count, reader: params.reader });
    } catch (err: any) {
      send400(res, err.message);
    }
    return true;
  }

  // GET /api/messages/by-id/:id - get a single message by ID
  if (req.method === 'GET' && url.startsWith('/api/messages/by-id/')) {
    const msgId = decodeURIComponent(url.slice('/api/messages/by-id/'.length));
    if (!msgId) {
      send400(res, 'Missing message ID');
      return true;
    }
    const msg = agentMailbox.getById(msgId);
    if (!msg) {
      send404(res, `Message not found: ${msgId}`);
      return true;
    }
    sendJSON(res, msg);
    return true;
  }

  // PUT /api/messages/by-id/:id - update a single message
  if (req.method === 'PUT' && url.startsWith('/api/messages/by-id/')) {
    const msgId = decodeURIComponent(url.slice('/api/messages/by-id/'.length));
    if (!msgId) {
      send400(res, 'Missing message ID');
      return true;
    }
    const body = await readBody(req);
    try {
      const patch = JSON.parse(body);
      const updated = agentMailbox.updateMessage(msgId, patch);
      if (!updated) {
        send404(res, `Message not found: ${msgId}`);
        return true;
      }
      sendJSON(res, updated);
    } catch (err: any) {
      send400(res, err.message);
    }
    return true;
  }

  // GET /api/messages/:channel - read messages from a channel (used by peer fan-out)
  if (req.method === 'GET' && url.startsWith('/api/messages/') && !url.startsWith('/api/messages/channels') && !url.startsWith('/api/messages/stats') && !url.startsWith('/api/messages/ack') && !url.startsWith('/api/messages/inbound') && !url.startsWith('/api/messages/by-id/')) {
    const channelAndQuery = url.slice('/api/messages/'.length);
    const qIdx = channelAndQuery.indexOf('?');
    const channel = decodeURIComponent(qIdx >= 0 ? channelAndQuery.slice(0, qIdx) : channelAndQuery);
    if (!channel) {
      send400(res, 'Missing channel in URL');
      return true;
    }
    const urlObj = new URL(url, 'http://localhost');
    const reader = urlObj.searchParams.get('reader') || '*';
    const unreadOnly = urlObj.searchParams.get('unreadOnly') !== 'false';
    const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);

    // Direct local read - no peer fan-out (this IS the peer being queried)
    const allMessages = agentMailbox.getAll();
    let messages = allMessages.filter(m => {
      if (m.channel !== channel) return false;
      // reader=* means "show all messages" (dashboard view); otherwise filter by recipient
      if (reader !== '*' && !agentMailbox._isRecipient(m, reader)) return false;
      if (unreadOnly && reader !== '*' && m.readBy?.includes(reader)) return false;
      return true;
    });
    messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    messages = messages.slice(0, limit);

    sendJSON(res, {
      channel,
      reader,
      count: messages.length,
      messages: messages.map(m => ({
        id: m.id,
        sender: m.sender,
        recipients: m.recipients,
        body: m.body,
        createdAt: m.createdAt,
        payload: m.payload,
        readBy: m.readBy,
      })),
    });
    return true;
  }

  // Serve screenshot images from docs/screenshots/
  if (req.method === 'GET' && url.startsWith('/api/screenshots/')) {
    const fileName = decodeURIComponent(url.slice('/api/screenshots/'.length)).replace(/[^a-z0-9._-]/gi, '');
    if (!fileName || !fileName.endsWith('.png')) {
      send404(res, 'Invalid screenshot name');
      return true;
    }
    const screenshotsDir = resolve(process.cwd(), 'docs', 'screenshots');
    const filePath = join(screenshotsDir, fileName);
    if (!filePath.startsWith(screenshotsDir)) {
      send404(res, 'Invalid path');
      return true;
    }
    try {
      const data = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' });
      res.end(data);
    } catch {
      send404(res, `Screenshot not found: ${fileName}`);
    }
    return true;
  }

  // Serve panel documentation as styled HTML
  if (req.method === 'GET' && url.startsWith('/api/docs/')) {
    const docName = decodeURIComponent(url.slice('/api/docs/'.length)).replace(/[^a-z0-9-]/gi, '');
    if (!docName) {
      send404(res, 'Missing doc name');
      return true;
    }
    const docsDir = resolve(process.cwd(), 'docs', 'panels');
    const filePath = join(docsDir, `${docName}.md`);
    // Prevent path traversal
    if (!filePath.startsWith(docsDir)) {
      send404(res, 'Invalid doc name');
      return true;
    }
    try {
      const md = await readFile(filePath, 'utf-8');
      const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${docName} - MCP Agent Manager Docs</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"><\/script>
<style>
  body{font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;background:#0d1117;color:#e6edf3;max-width:900px;margin:0 auto;padding:24px;line-height:1.6;}
  a{color:#58a6ff;}h1,h2,h3{color:#58a6ff;border-bottom:1px solid #30363d;padding-bottom:6px;}
  table{width:100%;border-collapse:collapse;margin:12px 0;}th,td{text-align:left;padding:6px 12px;border:1px solid #30363d;}
  th{background:#161b22;color:#8b949e;font-size:12px;text-transform:uppercase;}
  code{background:#161b22;padding:2px 6px;border-radius:4px;font-size:13px;}
  pre{background:#161b22;padding:12px;border-radius:6px;overflow-x:auto;}
  pre code{background:none;padding:0;}
  img{max-width:100%;border-radius:6px;border:1px solid #30363d;}
  .back{display:inline-block;margin-bottom:16px;color:#58a6ff;text-decoration:none;font-size:13px;}
  .back:hover{text-decoration:underline;}
  .mermaid{background:#161b22;padding:16px;border-radius:6px;text-align:center;}
</style>
</head><body>
<a class="back" href="/">&larr; Back to Dashboard</a>
<div id="content"></div>
<script>
  mermaid.initialize({startOnLoad:false,theme:'dark'});
  const md = ${JSON.stringify(md)};
  document.getElementById('content').innerHTML = marked.parse(md);
  document.querySelectorAll('pre code.language-mermaid').forEach(function(el){
    var div=document.createElement('div');div.className='mermaid';div.textContent=el.textContent;
    el.parentElement.replaceWith(div);
  });
  mermaid.run();
<\/script>
</body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(html);
    } catch {
      send404(res, `Documentation not found: ${docName}`);
    }
    return true;
  }

  if (url === '/api/instances') {
    const { getActiveInstances } = await import('./index.js');
    const instances = getActiveInstances();
    sendJSON(res, {
      current: { pid: process.pid, port: actualPort },
      instances,
    });
    return true;
  }

  // =========================================================================
  // Backup / Restore endpoints
  // =========================================================================

  // POST /api/backups - create a new backup
  if (url === '/api/backups' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const params = body ? JSON.parse(body) : {};
      const manifest = createBackup(params.path);
      sendJSON(res, {
        status: 'created',
        backup: {
          id: manifest.id,
          createdAt: manifest.createdAt,
          files: manifest.files.map(f => f.relativePath),
          totalBytes: manifest.totalBytes,
        },
      });
    } catch (err: any) {
      send400(res, err.message);
    }
    return true;
  }

  // GET /api/backups - list backups
  if (url.startsWith('/api/backups') && req.method === 'GET' && (url === '/api/backups' || url.startsWith('/api/backups?'))) {
    const urlObj = new URL(url, 'http://localhost');
    const customPath = urlObj.searchParams.get('path') || undefined;
    const backups = listBackups(customPath);
    sendJSON(res, { count: backups.length, backups });
    return true;
  }

  // GET /api/backups/:id - get backup details
  if (req.method === 'GET' && url.startsWith('/api/backups/') && url !== '/api/backups/' && !url.includes('/restore') && !url.includes('/export')) {
    const backupId = decodeURIComponent(url.slice('/api/backups/'.length));
    const manifest = getBackupDetails(backupId);
    if (!manifest) {
      send404(res, `Backup not found: ${backupId}`);
      return true;
    }
    sendJSON(res, manifest);
    return true;
  }

  // POST /api/backups/:id/restore - restore a backup
  if (req.method === 'POST' && url.match(/^\/api\/backups\/[^/]+\/restore$/)) {
    const parts = url.split('/');
    const backupId = decodeURIComponent(parts[3]);
    const body = await readBody(req);
    try {
      const params = body ? JSON.parse(body) : {};
      const result = restoreBackup(backupId, params.path, params.files);
      sendJSON(res, {
        status: result.errors.length === 0 ? 'success' : 'partial',
        ...result,
      });
      broadcastSSE('snapshot', buildSnapshot());
    } catch (err: any) {
      send400(res, err.message);
    }
    return true;
  }

  // POST /api/backups/:id/export - export a backup to custom path
  if (req.method === 'POST' && url.match(/^\/api\/backups\/[^/]+\/export$/)) {
    const parts = url.split('/');
    const backupId = decodeURIComponent(parts[3]);
    const body = await readBody(req);
    try {
      const params = JSON.parse(body);
      if (!params.exportPath) {
        send400(res, 'Missing required field: exportPath');
        return true;
      }
      const destDir = exportBackup(backupId, params.exportPath);
      sendJSON(res, { exported: true, backupId, path: destDir });
    } catch (err: any) {
      send400(res, err.message);
    }
    return true;
  }

  // POST /api/backups/import - import a backup from custom path
  if (url === '/api/backups/import' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const params = JSON.parse(body);
      if (!params.importPath) {
        send400(res, 'Missing required field: importPath');
        return true;
      }
      const manifest = importBackup(params.importPath);
      sendJSON(res, {
        imported: true,
        backup: manifest ? {
          id: manifest.id,
          createdAt: manifest.createdAt,
          files: manifest.files.map(f => f.relativePath),
          totalBytes: manifest.totalBytes,
        } : null,
      });
    } catch (err: any) {
      send400(res, err.message);
    }
    return true;
  }

  // DELETE /api/backups/:id - delete a backup
  if (req.method === 'DELETE' && url.startsWith('/api/backups/') && url !== '/api/backups/') {
    const backupId = decodeURIComponent(url.slice('/api/backups/'.length));
    const deleted = deleteBackup(backupId);
    if (!deleted) {
      send404(res, `Backup not found: ${backupId}`);
      return true;
    }
    sendJSON(res, { deleted: true, backupId });
    return true;
  }

  if (url === '/api/debug') {
    const mem = process.memoryUsage();
    sendJSON(res, {
      server: {
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        cwd: process.cwd(),
        dataDir: DATA_DIR,
        dashboardPort: actualPort,
        serverStartedAt: serverStartedAt?.toISOString(),
        uptimeMs: serverStartedAt ? Date.now() - serverStartedAt.getTime() : 0,
      },
      memory: {
        rss: (mem.rss / 1048576).toFixed(1) + ' MB',
        heapUsed: (mem.heapUsed / 1048576).toFixed(1) + ' MB',
        heapTotal: (mem.heapTotal / 1048576).toFixed(1) + ' MB',
        external: (mem.external / 1048576).toFixed(1) + ' MB',
      },
      sse: {
        connectedClients: sseClients.size,
      },
      events: { ...eventCounts },
      env: Object.fromEntries(
        Object.entries(process.env)
          .filter(([k]) => k.startsWith('MCP_') || k.startsWith('GITHUB_'))
          .sort(([a], [b]) => a.localeCompare(b))
      ),
      requests: {
        total: totalRequests,
        recentCount: requestLog.length,
        recent: requestLog.slice(0, 20),
      },
    });
    return true;
  }

  // DELETE /api/events/clear - clear event log (in-memory + disk)
  if (url === '/api/events/clear' && req.method === 'DELETE') {
    clearEventLog();
    sendJSON(res, { cleared: true });
    broadcastSSE('snapshot', buildSnapshot());
    return true;
  }

  if (url === '/api/events') {
    // SSE endpoint
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`event: snapshot\ndata: ${JSON.stringify(buildSnapshot())}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return true;
  }

  return false;
}
