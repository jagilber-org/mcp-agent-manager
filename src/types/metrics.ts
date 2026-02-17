// mcp-agent-manager/src/types/metrics.ts
// Aggregate manager metrics

/** Metrics snapshot */
export interface ManagerMetrics {
  totalAgents: number;
  activeAgents: number;
  totalTasks: number;
  totalTokens: number;
  /** Total estimated tokens (from providers that don't report real counts) */
  totalEstimatedTokens: number;
  totalCost: number;
  /** Total premium requests consumed (Copilot CLI billing) */
  totalPremiumRequests: number;
  skillCount: number;
  uptimeMs: number;
  agentMetrics: Record<string, {
    tasks: number;
    tokens: number;
    /** True when token counts are estimated (not from API) */
    tokensEstimated: boolean;
    cost: number;
    /** Premium requests consumed (Copilot billing) */
    premiumRequests: number;
    avgLatencyMs: number;
    errorRate: number;
  }>;
}
