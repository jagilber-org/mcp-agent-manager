// mcp-agent-manager/src/services/crossRepoDispatcher.ts
// Cross-repo dispatch service - spawns copilot CLI in target repos to execute
// prompts with full workspace context. Enables multi-repo agent orchestration
// without requiring multiple VS Code windows.

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from './logger.js';
import { eventBus } from './events.js';
import { agentRegistry } from './agentRegistry.js';
import { sendCopilotPrompt, resolveCopilotBinary } from '../providers/copilot.js';
import { persistCrossRepoEntry, readCrossRepoHistory, type CrossRepoHistoryEntry } from './sharedState.js';
import { getStateDir, getLogsDir } from './dataDir.js';
import type {
  CrossRepoRequest,
  CrossRepoResult,
  DispatchStatus,
  DispatchSummary,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const DEFAULT_MODEL = 'claude-sonnet-4';
const MAX_HISTORY = 100;
const MAX_CONCURRENT = parseInt(process.env.MCP_CROSS_REPO_CONCURRENCY || '5', 10);

// ---------------------------------------------------------------------------
// Auto-inject MCP config - gives spawned copilot processes access to
// mcp-agent-manager tools (messaging, agents, skills, etc.)
// ---------------------------------------------------------------------------

let _mcpConfigPath: string | null = null;

function getAutoMcpConfigPath(): string {
  if (_mcpConfigPath && fs.existsSync(_mcpConfigPath)) return `@${_mcpConfigPath}`;

  const configPath = path.join(getStateDir(), 'dispatch-mcp-config.json');
  const serverEntry = path.resolve(process.cwd(), 'dist', 'server', 'index.js');

  const config = {
    mcpServers: {
      'mcp-agent-manager': {
        type: 'stdio',
        command: 'node',
        args: [serverEntry],
        cwd: process.cwd(),
        env: {
          MCP_LOG_LEVEL: process.env.MCP_LOG_LEVEL || 'warn',
          MCP_KEEP_ALIVE: '0',
        },
      },
    },
  };

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    _mcpConfigPath = configPath;
    logger.debug(`[CrossRepo] Wrote auto MCP config to ${configPath}`);
  } catch (err: any) {
    logger.warn(`[CrossRepo] Failed to write auto MCP config: ${err.message}`);
  }

  return `@${configPath}`;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ActiveDispatch {
  request: CrossRepoRequest;
  process: ChildProcess;
  stdout: string;
  stderr: string;
  startedAt: Date;
  queuedAt: Date;
}

const activeDispatches: Map<string, ActiveDispatch> = new Map();
const history: CrossRepoResult[] = [];
let dispatchCounter = 0;

/** Clear in-memory dispatch history (does not affect active dispatches) */
export function clearDispatchHistory(): void {
  history.length = 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Generate a unique dispatch ID */
export function generateDispatchId(): string {
  return `xrepo-${++dispatchCounter}-${Date.now()}`;
}

/** Dispatch a prompt to a target repo via copilot CLI */
export async function dispatchToRepo(request: CrossRepoRequest): Promise<CrossRepoResult> {
  const queuedAt = new Date();

  // Validate repo path
  if (!fs.existsSync(request.repoPath)) {
    const result = makeResult(request, 'failed', '', 0, queuedAt);
    result.error = `Repository path does not exist: ${request.repoPath}`;
    addToHistory(result);
    return result;
  }

  // Check concurrency
  if (activeDispatches.size >= MAX_CONCURRENT) {
    const result = makeResult(request, 'failed', '', 0, queuedAt);
    result.error = `Concurrency limit reached (${MAX_CONCURRENT}). ${activeDispatches.size} dispatches already running.`;
    addToHistory(result);
    return result;
  }

  // --- Try agent-routed dispatch first (unified metrics) ---
  const agentResult = await tryDispatchViaAgent(request, queuedAt);
  if (agentResult) {
    return agentResult;
  }

  // --- Fallback: direct spawn (no agent in registry) ---
  return dispatchDirect(request, queuedAt);
}

// ---------------------------------------------------------------------------
// Agent-routed dispatch - uses a registered copilot agent for unified metrics
// ---------------------------------------------------------------------------

async function tryDispatchViaAgent(
  request: CrossRepoRequest,
  queuedAt: Date,
): Promise<CrossRepoResult | null> {
  // Find an available copilot agent
  const copilotAgents = agentRegistry.findByProvider('copilot');
  const available = copilotAgents.filter(inst => {
    const stateOk = inst.state === 'idle' || inst.state === 'running';
    const capacityOk = inst.activeTasks < inst.config.maxConcurrency;
    return stateOk && capacityOk;
  });

  if (available.length === 0) {
    logger.info(`[CrossRepo] No available copilot agents - falling back to direct spawn`);
    return null; // caller will use dispatchDirect
  }

  // Pick the agent with the lowest load
  available.sort((a, b) => a.activeTasks - b.activeTasks);
  const agent = available[0];

  const model = request.model || DEFAULT_MODEL;
  const timeoutMs = request.timeoutMs || DEFAULT_TIMEOUT_MS;
  const allowMutations = request.allowMutations ?? false;

  // Clone agent config with cross-repo overrides
  const crossRepoConfig = {
    ...agent.config,
    model,
    cwd: request.repoPath,
    cliArgs: [
      ...(agent.config.cliArgs || []).filter(a => a !== '--acp' && a !== '--yolo'),
      '--no-auto-update',
      '--no-custom-instructions',
      '--no-ask-user',
      '--add-dir', request.repoPath,
      ...(allowMutations ? ['--yolo'] : ['--allow-all-tools']),
      ...(request.additionalDirs?.flatMap(d => ['--add-dir', d]) || []),
      ...(['--additional-mcp-config', request.additionalMcpConfig || getAutoMcpConfigPath()]),
    ],
  };

  logger.info(`[CrossRepo] Routing ${request.dispatchId} via agent ${agent.config.id} to ${request.repoPath}`);
  eventBus.emitEvent('crossrepo:dispatched', {
    dispatchId: request.dispatchId,
    repoPath: request.repoPath,
    model,
    prompt: request.prompt.substring(0, 200),
  });

  const startedAt = new Date();
  agentRegistry.recordTaskStart(agent.config.id);

  try {
    const response = await sendCopilotPrompt(crossRepoConfig, request.prompt, 4000, timeoutMs);

    const durationMs = Date.now() - startedAt.getTime();
    const success = response.success && response.content.length > 0;

    agentRegistry.recordTaskComplete(
      agent.config.id,
      response.tokenCount,
      response.costUnits,
      success,
    );

    const result = makeResult(
      request,
      success ? 'completed' : 'failed',
      response.content,
      durationMs,
      queuedAt,
      startedAt,
    );
    result.model = model;
    result.estimatedTokens = response.tokenCount;
    if (!success) {
      result.error = response.error || 'Agent returned empty response';
    }

    logger.info(
      `[CrossRepo] ${request.dispatchId} via agent ${agent.config.id}: ` +
      `${result.status} ${result.estimatedTokens} tokens, ${durationMs}ms`
    );

    eventBus.emitEvent('crossrepo:completed', {
      dispatchId: request.dispatchId,
      status: result.status,
      durationMs,
      estimatedTokens: result.estimatedTokens,
    });

    addToHistory(result);
    return result;
  } catch (err: any) {
    const durationMs = Date.now() - startedAt.getTime();
    agentRegistry.recordTaskComplete(agent.config.id, 0, 0, false);

    logger.warn(`[CrossRepo] Agent-routed dispatch failed: ${err.message} - falling back to direct spawn`);
    return null; // fall back to direct
  }
}

// ---------------------------------------------------------------------------
// Direct dispatch - spawns copilot.exe directly (fallback when no agent)
// ---------------------------------------------------------------------------

async function dispatchDirect(
  request: CrossRepoRequest,
  queuedAt: Date,
): Promise<CrossRepoResult> {
  const copilotPath = resolveCopilotBinary();
  if (!copilotPath) {
    const result = makeResult(request, 'failed', '', 0, queuedAt);
    result.error = 'Copilot CLI not found. Set COPILOT_PATH or install via winget.';
    addToHistory(result);
    return result;
  }

  const model = request.model || DEFAULT_MODEL;
  const timeoutMs = request.timeoutMs || DEFAULT_TIMEOUT_MS;
  const allowMutations = request.allowMutations ?? false;

  // Session file for --share output
  const sessionDir = path.join(getLogsDir(), 'cross-repo-sessions');
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  const sessionFile = path.join(sessionDir, `${request.dispatchId}.md`);

  // Build CLI args
  const args = buildCliArgs({
    prompt: request.prompt,
    model,
    allowMutations,
    sessionFile,
    repoPath: request.repoPath,
    additionalDirs: request.additionalDirs,
    additionalMcpConfig: request.additionalMcpConfig,
  });

  logger.info(`[CrossRepo] Direct dispatch ${request.dispatchId} to ${request.repoPath} (model: ${model})`);
  eventBus.emitEvent('crossrepo:dispatched', {
    dispatchId: request.dispatchId,
    repoPath: request.repoPath,
    model,
    prompt: request.prompt.substring(0, 200),
  });

  return new Promise<CrossRepoResult>((resolve) => {
    const startedAt = new Date();
    let stdout = '';
    let stderr = '';

    const proc = spawn(copilotPath, args, {
      cwd: request.repoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const active: ActiveDispatch = {
      request,
      process: proc,
      stdout: '',
      stderr: '',
      startedAt,
      queuedAt,
    };
    activeDispatches.set(request.dispatchId, active);

    let progressCount = 0;

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      active.stdout = stdout;

      // Emit progress callback if provided
      if (request.onProgress) {
        progressCount++;
        const snippet = text.trim().substring(0, 120);
        request.onProgress(progressCount, undefined, snippet || `Processing... (${stdout.length} chars received)`);
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      active.stderr = stderr;
    });

    // Timeout handler
    const timer = setTimeout(() => {
      logger.warn(`[CrossRepo] ${request.dispatchId} timed out after ${timeoutMs}ms`);
      proc.kill('SIGTERM');
      // Give it 5s to die gracefully, then SIGKILL
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      }, 5000);

      const content = stdout.trim();
      const durationMs = Date.now() - startedAt.getTime();
      const hasPartialContent = content.length > 20;

      const result = makeResult(
        request,
        hasPartialContent ? 'completed' : 'timeout',
        content,
        durationMs,
        queuedAt,
        startedAt,
      );
      result.model = model;
      result.sessionFile = fs.existsSync(sessionFile) ? sessionFile : undefined;
      result.error = hasPartialContent
        ? `Timed out after ${timeoutMs}ms (partial content returned)`
        : `Timed out after ${timeoutMs}ms`;
      result.estimatedTokens = Math.ceil((request.prompt.length + content.length) / 4);

      activeDispatches.delete(request.dispatchId);
      addToHistory(result);

      eventBus.emitEvent('crossrepo:completed', {
        dispatchId: request.dispatchId,
        status: result.status,
        durationMs,
        estimatedTokens: result.estimatedTokens,
      });

      resolve(result);
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      activeDispatches.delete(request.dispatchId);

      const content = stdout.trim();
      const durationMs = Date.now() - startedAt.getTime();
      const success = code === 0 || content.length > 20;

      const result = makeResult(
        request,
        success ? 'completed' : 'failed',
        content,
        durationMs,
        queuedAt,
        startedAt,
      );
      result.model = model;
      result.exitCode = code ?? undefined;
      result.sessionFile = fs.existsSync(sessionFile) ? sessionFile : undefined;
      result.estimatedTokens = Math.ceil((request.prompt.length + content.length) / 4);

      if (!success) {
        result.error = `Copilot CLI exited with code ${code}: ${stderr.trim().substring(0, 300)}`;
      }

      logger.info(
        `[CrossRepo] ${request.dispatchId} ${result.status}: ` +
        `${result.estimatedTokens} tokens, ${durationMs}ms, exit=${code}`
      );

      eventBus.emitEvent('crossrepo:completed', {
        dispatchId: request.dispatchId,
        status: result.status,
        durationMs,
        estimatedTokens: result.estimatedTokens,
        exitCode: code,
      });

      addToHistory(result);
      resolve(result);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      activeDispatches.delete(request.dispatchId);

      const durationMs = Date.now() - startedAt.getTime();
      const result = makeResult(request, 'failed', '', durationMs, queuedAt, startedAt);
      result.model = model;
      result.error = `Process spawn error: ${err.message}`;

      logger.error(`[CrossRepo] ${request.dispatchId} spawn error: ${err.message}`);

      eventBus.emitEvent('crossrepo:completed', {
        dispatchId: request.dispatchId,
        status: 'failed',
        error: err.message,
      });

      addToHistory(result);
      resolve(result);
    });
  });
}

/** Dispatch multiple requests concurrently, respecting MAX_CONCURRENT */
export async function dispatchBatch(requests: CrossRepoRequest[]): Promise<CrossRepoResult[]> {
  if (requests.length === 0) return [];

  // Cap at MAX_CONCURRENT minus already-active dispatches
  const available = Math.max(0, MAX_CONCURRENT - activeDispatches.size);
  const toRun = requests.slice(0, available);
  const rejected = requests.slice(available);

  // Fire all within the allowed window concurrently
  const runningPromises = toRun.map(req => dispatchToRepo(req));

  // Immediately fail any that exceed concurrency
  const rejectedResults: CrossRepoResult[] = rejected.map(req => {
    const result = makeResult(req, 'failed', '', 0, new Date());
    result.error = `Concurrency limit reached (${MAX_CONCURRENT}). Request rejected from batch.`;
    addToHistory(result);
    return result;
  });

  const completedResults = await Promise.all(runningPromises);
  return [...completedResults, ...rejectedResults];
}

/** Cancel a running dispatch */
export function cancelDispatch(dispatchId: string): boolean {
  const active = activeDispatches.get(dispatchId);
  if (!active) return false;

  try {
    active.process.kill('SIGTERM');
    setTimeout(() => {
      try { active.process.kill('SIGKILL'); } catch { /* already dead */ }
    }, 3000);
  } catch { /* ignore */ }

  activeDispatches.delete(dispatchId);
  logger.info(`[CrossRepo] Cancelled dispatch: ${dispatchId}`);

  const result = makeResult(
    active.request,
    'cancelled',
    active.stdout.trim(),
    Date.now() - active.startedAt.getTime(),
    active.queuedAt,
    active.startedAt,
  );
  addToHistory(result);

  return true;
}

/** Get status of a specific dispatch */
export function getDispatchStatus(dispatchId: string): CrossRepoResult | DispatchSummary | undefined {
  // Check active first
  const active = activeDispatches.get(dispatchId);
  if (active) {
    return {
      dispatchId,
      repoPath: active.request.repoPath,
      status: 'running' as DispatchStatus,
      model: active.request.model || DEFAULT_MODEL,
      prompt: active.request.prompt.substring(0, 200),
      durationMs: Date.now() - active.startedAt.getTime(),
      queuedAt: active.queuedAt.toISOString(),
    };
  }

  // Check history
  return history.find(r => r.dispatchId === dispatchId);
}

/** List dispatch history */
export function getDispatchHistory(options?: {
  limit?: number;
  status?: DispatchStatus;
  repoPath?: string;
}): DispatchSummary[] {
  let items = history.slice();

  // Merge from disk when in-memory is empty (cross-process scenario)
  if (items.length === 0) {
    const diskEntries = readCrossRepoHistory(MAX_HISTORY);
    items = diskEntries.map(e => ({
      dispatchId: e.dispatchId,
      repoPath: e.repoPath,
      status: e.status as DispatchStatus,
      content: e.content,
      estimatedTokens: e.estimatedTokens,
      durationMs: e.durationMs,
      model: e.model,
      error: e.error,
      queuedAt: e.queuedAt,
      startedAt: e.startedAt,
      completedAt: e.completedAt,
      exitCode: e.exitCode,
      sessionFile: e.sessionFile,
    } as CrossRepoResult));
  }

  if (options?.status) {
    items = items.filter(r => r.status === options.status);
  }
  if (options?.repoPath) {
    items = items.filter(r => r.repoPath === options.repoPath);
  }

  const limit = options?.limit || 20;
  return items.slice(-limit).reverse().map(r => ({
    dispatchId: r.dispatchId,
    repoPath: r.repoPath,
    status: r.status,
    model: r.model,
    prompt: r.content.substring(0, 100) || '(no output)',
    durationMs: r.durationMs,
    estimatedTokens: r.estimatedTokens,
    queuedAt: r.queuedAt,
    completedAt: r.completedAt,
    error: r.error,
  }));
}

/** Get active dispatches */
export function getActiveDispatches(): DispatchSummary[] {
  return Array.from(activeDispatches.entries()).map(([id, d]) => ({
    dispatchId: id,
    repoPath: d.request.repoPath,
    status: 'running' as DispatchStatus,
    model: d.request.model || DEFAULT_MODEL,
    prompt: d.request.prompt.substring(0, 200),
    durationMs: Date.now() - d.startedAt.getTime(),
    queuedAt: d.queuedAt.toISOString(),
  }));
}

/** Cancel all active dispatches (for shutdown) */
export function cancelAllDispatches(): number {
  let count = 0;
  for (const [id] of activeDispatches) {
    if (cancelDispatch(id)) count++;
  }
  return count;
}

/** Check if copilot CLI is available */
export function isCopilotAvailable(): boolean {
  return resolveCopilotBinary() !== null;
}

/** Get the resolved copilot binary path */
export function getCopilotPath(): string | null {
  return resolveCopilotBinary();
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildCliArgs(opts: {
  prompt: string;
  model: string;
  allowMutations: boolean;
  sessionFile: string;
  repoPath: string;
  additionalDirs?: string[];
  additionalMcpConfig?: string;
}): string[] {
  const args: string[] = [
    '-p', opts.prompt,
    '--silent',
    '--no-auto-update',
    '--no-custom-instructions',
    '--no-ask-user',
    '--model', opts.model,
    '--share', opts.sessionFile,
  ];

  if (opts.allowMutations) {
    args.push('--yolo');
  } else {
    // Read-only: allow all tools but don't auto-approve file writes
    args.push('--allow-all-tools');
  }

  // Add repo path as allowed directory
  args.push('--add-dir', opts.repoPath);

  // Additional directories
  if (opts.additionalDirs) {
    for (const dir of opts.additionalDirs) {
      args.push('--add-dir', dir);
    }
  }

  // Additional MCP config - auto-inject agent-manager if none provided
  const mcpConfig = opts.additionalMcpConfig || getAutoMcpConfigPath();
  if (mcpConfig) {
    args.push('--additional-mcp-config', mcpConfig);
  }

  return args;
}

function makeResult(
  request: CrossRepoRequest,
  status: DispatchStatus,
  content: string,
  durationMs: number,
  queuedAt: Date,
  startedAt?: Date,
): CrossRepoResult {
  return {
    dispatchId: request.dispatchId,
    repoPath: request.repoPath,
    status,
    content,
    estimatedTokens: Math.ceil((request.prompt.length + content.length) / 4),
    durationMs,
    model: request.model || DEFAULT_MODEL,
    queuedAt: queuedAt.toISOString(),
    startedAt: startedAt?.toISOString(),
    completedAt: status !== 'running' && status !== 'queued'
      ? new Date().toISOString()
      : undefined,
  };
}

function addToHistory(result: CrossRepoResult): void {
  history.push(result);
  // Trim to keep bounded
  while (history.length > MAX_HISTORY) {
    history.shift();
  }

  // Persist to disk for cross-process visibility
  const entry: CrossRepoHistoryEntry = {
    dispatchId: result.dispatchId,
    repoPath: result.repoPath,
    status: result.status,
    content: result.content.substring(0, 10000), // truncate for disk
    estimatedTokens: result.estimatedTokens,
    durationMs: result.durationMs,
    model: result.model,
    error: result.error,
    queuedAt: result.queuedAt,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    exitCode: result.exitCode,
    sessionFile: result.sessionFile,
  };
  persistCrossRepoEntry(entry);
}
