// mcp-agent-manager/src/types/crossRepo.ts
// Cross-repo dispatch types - copilot CLI orchestration across repos

/** Status of a cross-repo dispatch */
export type DispatchStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';

/** Callback for progress updates during cross-repo dispatch */
export type ProgressCallback = (progress: number, total: number | undefined, message: string) => void;

/** A request to execute a prompt in another repository via copilot CLI */
export interface CrossRepoRequest {
  /** Unique dispatch ID */
  dispatchId: string;
  /** Absolute path to the target repository root */
  repoPath: string;
  /** The prompt to execute in the target repo context */
  prompt: string;
  /** Optional model override (defaults to claude-sonnet-4) */
  model?: string;
  /** Timeout in ms (default 300000 = 5 min) */
  timeoutMs?: number;
  /** Whether copilot can write files in the target repo */
  allowMutations?: boolean;
  /** Additional directories to allow access to */
  additionalDirs?: string[];
  /** Additional MCP server config JSON or @filepath */
  additionalMcpConfig?: string;
  /** Priority for queue ordering (higher = sooner) */
  priority?: number;
  /** Caller context for audit trail */
  callerContext?: string;
  /** Optional progress callback - called as stdout chunks arrive */
  onProgress?: ProgressCallback;
}

/** Result of a cross-repo dispatch */
export interface CrossRepoResult {
  /** The dispatch ID */
  dispatchId: string;
  /** Target repo path */
  repoPath: string;
  /** Execution status */
  status: DispatchStatus;
  /** Copilot's response text */
  content: string;
  /** Path to the session markdown file (--share output) */
  sessionFile?: string;
  /** Approximate token count (estimated from char lengths) */
  estimatedTokens: number;
  /** Duration in ms */
  durationMs: number;
  /** Model used */
  model: string;
  /** Error message if failed */
  error?: string;
  /** Process exit code */
  exitCode?: number;
  /** When the dispatch was queued */
  queuedAt: string;
  /** When execution started */
  startedAt?: string;
  /** When execution completed */
  completedAt?: string;
}

/** Summary of a dispatch for listing */
export interface DispatchSummary {
  dispatchId: string;
  repoPath: string;
  status: DispatchStatus;
  model: string;
  prompt: string;
  durationMs?: number;
  estimatedTokens?: number;
  queuedAt: string;
  completedAt?: string;
  error?: string;
}
