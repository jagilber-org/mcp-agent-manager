// mcp-agent-manager/src/providers/copilot.ts
// Copilot CLI ACP provider - spawns copilot.exe --acp as stdio child process
// Communicates via JSON-RPC 2.0 (Agent Client Protocol)

import { spawn, ChildProcess } from 'child_process';
import { AgentConfig, AgentResponse } from '../types/index.js';
import { logger } from '../services/logger.js';
import * as path from 'path';
import * as fs from 'fs';
import { getLogsDir } from '../services/dataDir.js';
import * as readline from 'readline';

/** Active ACP sessions keyed by agent ID */
const sessions: Map<string, AcpSession> = new Map();

interface AcpSession {
  process: ChildProcess;
  sessionId: string | null;
  requestId: number;
  pendingRequests: Map<number, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer: NodeJS.Timeout;
  }>;
  rl: readline.Interface;
}

/** Default copilot binary path (winget install location) */
const DEFAULT_COPILOT_PATH = process.env.COPILOT_PATH ||
  `${process.env.LOCALAPPDATA || 'C:\\Users\\' + (process.env.USERNAME || 'user') + '\\AppData\\Local'}\\Microsoft\\WinGet\\Packages\\GitHub.Copilot.Prerelease_Microsoft.Winget.Source_8wekyb3d8bbwe\\copilot.exe`;

/** Resolve the copilot binary path. Checks COPILOT_PATH env, default WinGet location, then PATH. */
export function resolveCopilotBinary(): string | null {
  // 1. COPILOT_PATH env
  if (process.env.COPILOT_PATH && fs.existsSync(process.env.COPILOT_PATH)) {
    return process.env.COPILOT_PATH;
  }

  // 2. Default WinGet location
  if (fs.existsSync(DEFAULT_COPILOT_PATH)) {
    return DEFAULT_COPILOT_PATH;
  }

  // 3. Try PATH
  const pathExt = (process.env.PATHEXT || '.exe').split(';');
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of pathDirs) {
    for (const ext of pathExt) {
      const candidate = path.join(dir, `copilot${ext}`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    // Also check without extension on non-Windows
    const plain = path.join(dir, 'copilot');
    if (fs.existsSync(plain)) return plain;
  }

  return null;
}

/** JSON-RPC 2.0 message types */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

/** Spawn a copilot ACP process if not already running */
function ensureSession(agent: AgentConfig): AcpSession {
  let session = sessions.get(agent.id);
  if (session && session.process.exitCode === null) {
    return session;
  }

  const binaryPath = agent.binaryPath || DEFAULT_COPILOT_PATH;
  const args = ['--acp', ...(agent.cliArgs || [])];

  logger.info(`Spawning Copilot ACP: ${binaryPath} ${args.join(' ')}`);

  const proc = spawn(binaryPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...agent.env },
    ...(agent.cwd ? { cwd: agent.cwd } : {}),
  });

  const rl = readline.createInterface({ input: proc.stdout! });

  session = {
    process: proc,
    sessionId: null,
    requestId: 0,
    pendingRequests: new Map(),
    rl,
  };

  // Handle incoming JSON-RPC responses
  rl.on('line', (line: string) => {
    try {
      const msg: JsonRpcResponse = JSON.parse(line);
      if (msg.id !== undefined) {
        const pending = session!.pendingRequests.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          session!.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(`ACP error ${msg.error.code}: ${msg.error.message}`));
          } else {
            pending.resolve(msg.result);
          }
        }
      }
    } catch {
      // Not JSON - ignore (could be banner output)
      logger.debug(`Copilot ACP non-JSON: ${line.substring(0, 100)}`);
    }
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    logger.debug(`Copilot ACP stderr: ${chunk.toString().trim()}`);
  });

  proc.on('exit', (code) => {
    logger.warn(`Copilot ACP process exited: code=${code}`);
    sessions.delete(agent.id);
  });

  sessions.set(agent.id, session);
  return session;
}

/** Send a JSON-RPC request and wait for response */
function rpcCall(session: AcpSession, method: string, params: any, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++session.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const timer = setTimeout(() => {
      session.pendingRequests.delete(id);
      reject(new Error(`ACP request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    session.pendingRequests.set(id, { resolve, reject, timer });

    const line = JSON.stringify(request) + '\n';
    session.process.stdin!.write(line);
  });
}

/** Initialize an ACP session if not already initialized */
async function initializeSession(session: AcpSession, agent: AgentConfig, timeoutMs: number): Promise<void> {
  if (session.sessionId) return;

  // ACP initialize
  await rpcCall(session, 'initialize', {
    protocolVersion: '2025-01-01',
    capabilities: {},
    clientInfo: { name: 'mcp-agent-manager', version: '1.0.0' },
  }, timeoutMs);

  // Create session
  const sessionResult = await rpcCall(session, 'session/create', {}, timeoutMs);
  session.sessionId = sessionResult?.sessionId || 'default';

  logger.info(`ACP session initialized for ${agent.id}: ${session.sessionId}`);
}

/** Send a prompt to Copilot CLI via ACP */
export async function sendCopilotPrompt(
  agent: AgentConfig,
  prompt: string,
  maxTokens: number,
  timeoutMs: number
): Promise<AgentResponse> {
  const startTime = Date.now();

  try {
    // Use non-interactive CLI mode (-p --silent) for reliability.
    // ACP mode (--acp) can be used by setting cliArgs: ['--acp'] on the agent.
    const useAcp = agent.cliArgs?.includes('--acp');

    if (useAcp) {
      return await sendViaAcp(agent, prompt, maxTokens, timeoutMs);
    } else {
      return await sendViaCli(agent, prompt, maxTokens, timeoutMs, startTime);
    }
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    logger.error(`Copilot error for ${agent.id}: ${err.message}`, { latencyMs });

    return {
      agentId: agent.id,
      model: agent.model || 'copilot',
      content: '',
      tokenCount: 0,
      latencyMs,
      costUnits: 0,
      success: false,
      error: err.message || String(err),
      timestamp: new Date(),
    };
  }
}

/** Send prompt via copilot.exe -p --silent (non-interactive, one-shot) */
async function sendViaCli(
  agent: AgentConfig,
  prompt: string,
  maxTokens: number,
  timeoutMs: number,
  startTime: number
): Promise<AgentResponse> {
  const binaryPath = agent.binaryPath || DEFAULT_COPILOT_PATH;

  // Ensure session log directory exists
  const sessionDir = path.join(getLogsDir(), 'copilot-sessions');
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  const sessionFile = path.join(sessionDir, `${agent.id}-${Date.now()}.md`);

  const baseArgs = [
    '-p', prompt,
    '--silent',
    '--no-auto-update',
    '--no-custom-instructions',
    '--no-ask-user',
    '--yolo',
    '--share', sessionFile,
  ];
  if (agent.model) baseArgs.push('--model', agent.model);
  // Add any extra CLI args (except --acp which is handled separately)
  const extraArgs = (agent.cliArgs || []).filter(a => a !== '--acp');
  const args = [...baseArgs, ...extraArgs];

  logger.debug(`Copilot CLI: ${binaryPath} -p "..." --silent --model ${agent.model}`);
  logger.info(`[Copilot] REQUEST agent=${agent.id} model=${agent.model} prompt=${prompt.substring(0, 200)}${prompt.length > 200 ? '...' : ''} (${prompt.length} chars)`);

  return new Promise<AgentResponse>((resolve) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn(binaryPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...agent.env },
      ...(agent.cwd ? { cwd: agent.cwd } : {}),
    });

    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      const partialContent = stdout.trim();
      const stderrContent = stderr.trim();
      if (stderrContent) {
        logger.warn(`Copilot CLI ${agent.id} stderr on timeout: ${stderrContent.substring(0, 300)}`);
      }
      logger.warn(`Copilot CLI ${agent.id} timed out after ${timeoutMs}ms (partial output: ${partialContent.length} chars)`);
      proc.kill('SIGTERM');

      // Return partial content if available - partial success is better than nothing
      const hasContent = partialContent.length > 20;
      resolve({
        agentId: agent.id,
        model: agent.model || 'copilot',
        content: partialContent,
        tokenCount: hasContent ? Math.ceil((prompt.length + partialContent.length) / 4) : 0,
        tokenCountEstimated: true,
        latencyMs: Date.now() - startTime,
        costUnits: 0,
        premiumRequests: 1,
        success: hasContent,
        error: hasContent ? undefined : `Copilot CLI timed out after ${timeoutMs}ms`,
        timestamp: new Date(),
      });
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      const content = stdout.trim();
      const latencyMs = Date.now() - startTime;
      const estimatedTokens = Math.ceil((prompt.length + content.length) / 4);

      if (code !== 0 && !content) {
        logger.warn(`Copilot CLI exited ${code}: ${stderr.trim().substring(0, 200)}`);
        resolve({
          agentId: agent.id,
          model: agent.model || 'copilot',
          content: '',
          tokenCount: 0,
          tokenCountEstimated: true,
          latencyMs,
          costUnits: 0,
          premiumRequests: 1,
          success: false,
          error: `Copilot CLI exited with code ${code}: ${stderr.trim().substring(0, 200)}`,
          timestamp: new Date(),
        });
        return;
      }

      logger.debug(`Copilot CLI ${agent.model}: ~${estimatedTokens} tokens, ${latencyMs}ms`);
      logger.info(`[Copilot] RESPONSE agent=${agent.id} model=${agent.model} success=true tokens=${estimatedTokens} latency=${latencyMs}ms content=${content.substring(0, 200)}${content.length > 200 ? '...' : ''}`);

      resolve({
        agentId: agent.id,
        model: agent.model || 'copilot',
        content,
        tokenCount: estimatedTokens,
        tokenCountEstimated: true,
        latencyMs,
        costUnits: 0,
        premiumRequests: 1,
        success: true,
        timestamp: new Date(),
      });
    });
  });
}

/** Send prompt via ACP protocol (--acp mode, persistent session) */
async function sendViaAcp(
  agent: AgentConfig,
  prompt: string,
  maxTokens: number,
  timeoutMs: number
): Promise<AgentResponse> {
  const startTime = Date.now();

  try {
    const session = ensureSession(agent);
    await initializeSession(session, agent, timeoutMs);

    // Send message via session/message
    const result = await rpcCall(session, 'session/message', {
      sessionId: session.sessionId,
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: prompt },
        },
      ],
    }, timeoutMs);

    // Extract text content from response
    let content = '';
    if (result?.messages) {
      content = result.messages
        .filter((m: any) => m.role === 'assistant')
        .map((m: any) => {
          if (typeof m.content === 'string') return m.content;
          if (m.content?.text) return m.content.text;
          return JSON.stringify(m.content);
        })
        .join('\n');
    } else if (typeof result === 'string') {
      content = result;
    } else if (result?.content) {
      content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    }

    // Copilot doesn't report tokens natively - estimate
    const estimatedTokens = Math.ceil((prompt.length + content.length) / 4);

    logger.debug(`Copilot ACP ${agent.model}: ~${estimatedTokens} tokens, ${Date.now() - startTime}ms`);

    return {
      agentId: agent.id,
      model: agent.model || 'copilot',
      content,
      tokenCount: estimatedTokens,
      tokenCountEstimated: true,
      latencyMs: Date.now() - startTime,
      costUnits: 0, // Copilot uses premium requests, not per-token billing
      premiumRequests: 1,
      success: true,
      timestamp: new Date(),
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    logger.error(`Copilot ACP error for ${agent.id}: ${err.message}`, { latencyMs });

    return {
      agentId: agent.id,
      model: agent.model || 'copilot',
      content: '',
      tokenCount: 0,
      tokenCountEstimated: true,
      latencyMs,
      costUnits: 0,
      premiumRequests: 0,
      success: false,
      error: err.message || String(err),
      timestamp: new Date(),
    };
  }
}

/** Kill a specific ACP session */
export function killSession(agentId: string): boolean {
  const session = sessions.get(agentId);
  if (!session) return false;

  session.process.kill('SIGTERM');
  sessions.delete(agentId);
  logger.info(`Killed ACP session for ${agentId}`);
  return true;
}

/** Kill all ACP sessions */
export function killAllSessions(): void {
  for (const [id, session] of sessions) {
    session.process.kill('SIGTERM');
    logger.info(`Killed ACP session: ${id}`);
  }
  sessions.clear();
}
