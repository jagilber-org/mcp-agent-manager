// mcp-agent-manager/src/services/dashboard/snapshot.ts
// Builds a point-in-time snapshot of the entire agent-manager state
// for the REST API and SSE broadcasts.

import { agentRegistry } from '../agentRegistry.js';
import { skillStore } from '../skillStore.js';
import { getRouterMetrics } from '../taskRouter.js';
import { workspaceMonitor } from '../workspace/index.js';
import { automationEngine } from '../automation/index.js';
import { getInsightsSummary, isMetaEnabled } from '../metaCollector.js';
import { getDispatchHistory, getActiveDispatches } from '../crossRepoDispatcher.js';
import { agentMailbox } from '../agentMailbox.js';
import { persistAgentStats, readAgentStats, type AgentStatsSnapshot } from '../sharedState.js';
import { getRecentEvents } from '../eventLog.js';

export function buildSnapshot() {
  const registryAgents = agentRegistry.getAll();

  // Persist agent stats to disk for cross-process visibility
  if (registryAgents.length > 0) {
    const statsSnapshot: AgentStatsSnapshot = {
      agents: registryAgents.map(a => ({
        id: a.config.id,
        tasksCompleted: a.tasksCompleted,
        tasksFailed: a.tasksFailed,
        totalTokensUsed: a.totalTokensUsed,
        costAccumulated: a.costAccumulated,
        state: a.state,
        activeTasks: a.activeTasks,
        lastActivityAt: a.lastActivityAt?.toISOString(),
        premiumRequests: a.premiumRequests,
        tokensEstimated: a.tokensEstimated,
      })),
      lastUpdated: new Date().toISOString(),
      pid: process.pid,
    };
    persistAgentStats(statsSnapshot);
  }

  // Build agent list - merge disk stats when in-memory is empty
  let agents = registryAgents.map(a => ({
    id: a.config.id,
    name: a.config.name,
    provider: a.config.provider,
    model: a.config.model,
    state: a.state,
    tags: a.config.tags,
    canMutate: a.config.canMutate,
    maxConcurrency: a.config.maxConcurrency,
    costMultiplier: a.config.costMultiplier,
    timeoutMs: a.config.timeoutMs,
    tasksCompleted: a.tasksCompleted,
    tasksFailed: a.tasksFailed,
    activeTasks: a.activeTasks,
    totalTokens: a.totalTokensUsed,
    costAccumulated: a.costAccumulated,
    startedAt: a.startedAt,
    error: a.error,
    premiumRequests: a.premiumRequests,
    tokensEstimated: a.tokensEstimated,
  }));

  // If no agents in memory, try disk
  if (agents.length === 0) {
    const diskStats = readAgentStats();
    if (diskStats) {
      agents = diskStats.agents.map(a => ({
        id: a.id,
        name: a.id,
        provider: 'copilot' as const,
        model: '',
        state: a.state as any,
        tags: [] as string[],
        canMutate: false,
        maxConcurrency: 1,
        costMultiplier: 1,
        timeoutMs: 180000,
        tasksCompleted: a.tasksCompleted,
        tasksFailed: a.tasksFailed,
        activeTasks: a.activeTasks,
        totalTokens: a.totalTokensUsed,
        costAccumulated: a.costAccumulated,
        startedAt: undefined as Date | undefined,
        error: undefined as string | undefined,
        premiumRequests: a.premiumRequests || 0,
        tokensEstimated: a.tokensEstimated ?? true,
      }));
    }
  }

  const skills = skillStore.list().map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    promptTemplate: s.promptTemplate,
    strategy: s.strategy,
    targetAgents: s.targetAgents,
    targetTags: s.targetTags,
    categories: s.categories,
    version: s.version,
    maxTokens: s.maxTokens,
    timeoutMs: s.timeoutMs,
    mergeResults: s.mergeResults,
  }));

  const router = getRouterMetrics();
  const startTime = (globalThis as any).__agentManagerStartTime || Date.now();

  return {
    timestamp: new Date().toISOString(),
    uptimeMs: Date.now() - startTime,
    pid: process.pid,
    agents,
    skills,
    router,
    agentCount: agents.length,
    activeAgents: agents.filter(a => a.state === 'idle' || a.state === 'running' || a.state === 'busy').length,
    skillCount: skills.length,
    workspaces: workspaceMonitor.getAll().map(ws => ({
      path: ws.path,
      workspaceId: ws.workspaceId,
      chatSessionsPath: ws.chatSessionsPath,
      sessionCount: ws.knownSessions.length,
      watcherCount: ws.watchers.length,
      startedAt: ws.startedAt.toISOString(),
      monitoringMs: Date.now() - ws.startedAt.getTime(),
      recentChanges: ws.recentChanges.slice(0, 10),
      gitEvents: ws.gitEvents.slice(0, 10),
      knownSessions: ws.knownSessions,
      sessionMetas: ws.sessionMetas ? [...ws.sessionMetas.values()] : [],
      memoryCount: ws.memories?.length ?? 0,
    })),
    automation: {
      enabled: automationEngine.isEnabled(),
      rules: automationEngine.listRules().map(r => {
        const stats = automationEngine.getRuleStats(r.id);
        return {
          id: r.id,
          name: r.name,
          description: r.description,
          enabled: r.enabled,
          priority: r.priority,
          events: r.matcher.events,
          filters: r.matcher.filters ? Object.entries(r.matcher.filters).map(([k, v]) => k + '=' + String(v)).join(', ') : null,
          skillId: r.skillId,
          tags: r.tags,
          conditions: r.conditions?.map(c => c.type + ':' + c.value) || [],
          throttle: r.throttle ? r.throttle.intervalMs + 'ms' : null,
          maxConcurrent: r.maxConcurrent,
          totalExec: stats?.totalExecutions ?? 0,
          successCount: stats?.successCount ?? 0,
          failureCount: stats?.failureCount ?? 0,
          throttledCount: stats?.throttledCount ?? 0,
          avgDurationMs: Math.round(stats?.avgDurationMs ?? 0),
          lastExecutedAt: stats?.lastExecutedAt,
          lastStatus: stats?.lastStatus,
          skippedCount: stats?.skippedCount ?? 0,
          activeExec: stats?.activeExecutions ?? 0,
        };
      }),
      recentExecutions: automationEngine.getExecutions({ limit: 20 }).map(e => ({
        executionId: e.executionId,
        ruleId: e.ruleId,
        skillId: e.skillId,
        triggerEvent: e.triggerEvent,
        status: e.status,
        durationMs: e.durationMs,
        startedAt: e.startedAt,
        completedAt: e.completedAt,
        error: e.error,
        taskId: e.taskId,
        retryAttempt: e.retryAttempt,
        resultSummary: e.resultSummary,
        resolvedParams: e.resolvedParams,
        triggerData: Object.fromEntries(
          Object.entries(e.triggerData || {}).map(([k, v]) => [k, typeof v === 'string' && v.length > 80 ? v.substring(0, 80) + '...' : v])
        ),
      })),
    },
    reviewQueue: {
      stats: automationEngine.getReviewStats(),
      items: automationEngine.getReviewQueue({ limit: 30 }).map(r => ({
        reviewId: r.reviewId,
        executionId: r.executionId,
        ruleId: r.ruleId,
        skillId: r.skillId,
        agentId: r.agentId,
        resultSummary: r.resultSummary,
        error: r.error,
        executionStatus: r.executionStatus,
        status: r.status,
        durationMs: r.durationMs,
        notes: r.notes,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
      })),
    },
    meta: isMetaEnabled() ? getInsightsSummary() : null,
    crossRepo: {
      active: getActiveDispatches(),
      history: getDispatchHistory({ limit: 20 }),
    },
    messaging: {
      channels: agentMailbox.listChannels(),
      totalMessages: agentMailbox.getAll().length,
    },
    events: getRecentEvents(100),
  };
}
