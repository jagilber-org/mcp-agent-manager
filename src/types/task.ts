// mcp-agent-manager/src/types/task.ts
// Task domain types - routing, requests, responses, and results

/** Orchestration strategies for multi-agent skill execution */
export type RoutingStrategy = 'single' | 'race' | 'fan-out' | 'consensus' | 'fallback' | 'cost-optimized' | 'evaluate';

/** Task: a single invocation of a skill against agent(s) */
export interface TaskRequest {
  taskId: string;
  skillId: string;
  params: Record<string, string>;
  /** Resolved prompt after template substitution */
  resolvedPrompt?: string;
  priority: number;
  createdAt: Date;
  /** Caller context for audit */
  callerContext?: string;
}

/** Result from a single agent response */
export interface AgentResponse {
  agentId: string;
  model: string;
  content: string;
  tokenCount: number;
  /** True when tokenCount is heuristic-estimated (e.g. Copilot CLI) vs real API data */
  tokenCountEstimated?: boolean;
  latencyMs: number;
  /** Provider-specific billing unit: dollars for per-token providers, 0 for subscription */
  costUnits: number;
  /** Premium requests consumed (Copilot CLI billing model: 1 per invocation) */
  premiumRequests?: number;
  success: boolean;
  error?: string;
  timestamp: Date;
}

/** Aggregated task result after routing strategy applied */
export interface TaskResult {
  taskId: string;
  skillId: string;
  strategy: RoutingStrategy;
  responses: AgentResponse[];
  /** Final merged/selected result */
  finalContent: string;
  totalTokens: number;
  totalCost: number;
  totalLatencyMs: number;
  success: boolean;
  completedAt: Date;
}
