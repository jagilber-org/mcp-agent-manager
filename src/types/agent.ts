// mcp-agent-manager/src/types/agent.ts
// Agent domain types - configuration, instance state, and health

/** Supported LLM provider backends */
export type ProviderName = 'anthropic' | 'copilot' | 'openai' | 'custom';

/** Agent connection modes */
export type AgentTransport = 'stdio' | 'tcp' | 'http';

/** Agent lifecycle states */
export type AgentState = 'idle' | 'starting' | 'running' | 'busy' | 'error' | 'stopped';

/** Registered agent configuration */
export interface AgentConfig {
  id: string;
  name: string;
  provider: ProviderName;
  model: string;
  transport: AgentTransport;
  /** stdio command + args, or TCP host:port, or HTTP endpoint */
  endpoint: string;
  args?: string[];
  env?: Record<string, string>;
  /** Max concurrent tasks this agent handles */
  maxConcurrency: number;
  /** Cost multiplier relative to baseline (1x) */
  costMultiplier: number;
  /** Capabilities / tags for skill routing */
  tags: string[];
  /** Whether this agent can write/mutate (vs read-only investigation) */
  canMutate: boolean;
  /** Timeout in ms for a single request */
  timeoutMs: number;
  /** Optional: path to copilot.exe for ACP agents */
  binaryPath?: string;
  /** Optional: additional CLI args (e.g. --yolo, --model) */
  cliArgs?: string[];
  /** Optional: working directory override for process spawn (used by cross-repo dispatch) */
  cwd?: string;
}

/** Runtime agent instance state */
export interface AgentInstance {
  config: AgentConfig;
  state: AgentState;
  pid?: number;
  startedAt?: Date;
  lastActivityAt?: Date;
  tasksCompleted: number;
  tasksFailed: number;
  activeTasks: number;
  totalTokensUsed: number;
  /** True when token counts are heuristic-estimated (not from provider API) */
  tokensEstimated: boolean;
  /** Accumulated cost units */
  costAccumulated: number;
  /** Premium requests consumed (Copilot CLI billing: 1 per invocation) */
  premiumRequests: number;
  error?: string;
}

/** Health check result */
export interface AgentHealth {
  agentId: string;
  state: AgentState;
  uptime?: number;
  lastError?: string;
  tasksCompleted: number;
  tasksFailed: number;
  avgLatencyMs?: number;
}
