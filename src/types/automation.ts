// mcp-agent-manager/src/types/automation.ts
// Type definitions for the Automation Engine - event-driven skill triggers

import { ManagerEventName } from '../services/events.js';
import { RoutingStrategy } from './index.js';

// ---------------------------------------------------------------------------
// Automation Rule - maps event patterns to skill invocations
// ---------------------------------------------------------------------------

/** How to match incoming events against a rule */
export interface EventMatcher {
  /** Event name(s) to trigger on. Supports wildcards via '*' suffix (e.g. 'workspace:*') */
  events: string[];
  /** Optional: only match when event data field values match (supports regex strings) */
  filters?: Record<string, string | RegExp>;
  /** Optional: only match when event data contains these fields */
  requiredFields?: string[];
}

/** How to build the skill parameters from event data */
export interface ParamMapping {
  /** Static parameters - always included */
  static?: Record<string, string>;
  /** Dynamic parameters - maps skill param name → event data field path (dot notation) */
  fromEvent?: Record<string, string>;
  /** Template parameters - interpolates event data into template strings.
   *  Uses {event.fieldName} placeholders */
  templates?: Record<string, string>;
}

/** Throttle/debounce configuration */
export interface ThrottleConfig {
  /** Minimum interval between rule executions in ms */
  intervalMs: number;
  /** Debounce mode: 'leading' fires immediately then ignores,
   *  'trailing' waits until quiet period ends */
  mode: 'leading' | 'trailing';
  /** Group key for throttling - event data field to group by (e.g. 'path' for per-workspace throttling) */
  groupBy?: string;
}

/** Retry configuration for failed skill executions */
export interface RetryConfig {
  /** Max retry attempts */
  maxRetries: number;
  /** Base delay between retries in ms (doubles each retry) */
  baseDelayMs: number;
  /** Max delay cap in ms */
  maxDelayMs: number;
}

/** Condition evaluated at runtime to gate rule execution */
export interface RuntimeCondition {
  /** Type of condition check */
  type: 'min-agents' | 'skill-exists' | 'cooldown' | 'custom';
  /** Condition-specific value */
  value: string | number;
}

/** Priority level for automation rules */
export type RulePriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * AutomationRule - a declarative mapping from a workspace/system event
 * to an automated skill invocation.
 */
export interface AutomationRule {
  /** Unique rule identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this automation does */
  description: string;
  /** Whether the rule is currently active */
  enabled: boolean;
  /** Rule priority - higher priority rules execute first */
  priority: RulePriority;
  /** Event matching criteria */
  matcher: EventMatcher;
  /** Skill to invoke when matched */
  skillId: string;
  /** How to build skill parameters from event data */
  paramMapping: ParamMapping;
  /** Throttle/debounce config to prevent flooding */
  throttle?: ThrottleConfig;
  /** Retry config for resilience */
  retry?: RetryConfig;
  /** Runtime conditions that must be met for rule to fire */
  conditions?: RuntimeCondition[];
  /** Max concurrent executions of this rule (0 = unlimited) */
  maxConcurrent: number;
  /** Tags for filtering and categorization */
  tags: string[];
  /** Version for governance */
  version: string;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last modification */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Automation Execution Records
// ---------------------------------------------------------------------------

/** Status of an automation execution */
export type ExecutionStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'throttled';

/** Record of a single automation execution */
export interface AutomationExecution {
  /** Unique execution ID */
  executionId: string;
  /** Rule that triggered this execution */
  ruleId: string;
  /** Skill that was invoked */
  skillId: string;
  /** Event that triggered the execution */
  triggerEvent: string;
  /** Event data snapshot */
  triggerData: Record<string, unknown>;
  /** Resolved parameters sent to the skill */
  resolvedParams: Record<string, string>;
  /** Execution status */
  status: ExecutionStatus;
  /** Task ID from TaskRouter (if executed) */
  taskId?: string;
  /** Result summary (truncated) */
  resultSummary?: string;
  /** Error message if failed */
  error?: string;
  /** Retry attempt number (0 = first attempt) */
  retryAttempt: number;
  /** Duration in ms */
  durationMs?: number;
  /** ISO timestamps */
  startedAt: string;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Review Queue - human-in-the-loop feedback on task results
// ---------------------------------------------------------------------------

export type ReviewStatus = 'pending' | 'approved' | 'dismissed' | 'flagged';

export interface ReviewItem {
  /** Unique review item ID */
  reviewId: string;
  /** Linked execution ID */
  executionId: string;
  /** Rule that produced this result */
  ruleId: string;
  /** Skill that was invoked */
  skillId: string;
  /** Agent that executed the task */
  agentId?: string;
  /** Task result summary */
  resultSummary: string;
  /** Error if failed */
  error?: string;
  /** Original execution status */
  executionStatus: ExecutionStatus;
  /** Review status */
  status: ReviewStatus;
  /** Duration of the task */
  durationMs?: number;
  /** Reviewer notes (set by user) */
  notes?: string;
  /** When the review item was created */
  createdAt: string;
  /** When the review was acted on */
  reviewedAt?: string;
  /** GitHub issue URL if created */
  githubIssueUrl?: string;
}

// ---------------------------------------------------------------------------
// Automation Engine Status
// ---------------------------------------------------------------------------

/** Per-rule runtime statistics */
export interface RuleStats {
  ruleId: string;
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  throttledCount: number;
  avgDurationMs: number;
  lastExecutedAt?: string;
  lastStatus?: ExecutionStatus;
  activeExecutions: number;
}

/** Overall automation engine status */
export interface AutomationEngineStatus {
  enabled: boolean;
  ruleCount: number;
  activeRules: number;
  totalExecutions: number;
  recentExecutions: AutomationExecution[];
  ruleStats: RuleStats[];
  startedAt: string;
}

// ---------------------------------------------------------------------------
// Input types for MCP tools
// ---------------------------------------------------------------------------

/** Input for creating/updating an automation rule */
export interface AutomationRuleInput {
  id: string;
  name: string;
  description: string;
  enabled?: boolean;
  priority?: RulePriority;
  events: string[];
  filters?: Record<string, string>;
  requiredFields?: string[];
  skillId: string;
  staticParams?: Record<string, string>;
  eventParams?: Record<string, string>;
  templateParams?: Record<string, string>;
  throttleIntervalMs?: number;
  throttleMode?: 'leading' | 'trailing';
  throttleGroupBy?: string;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  maxConcurrent?: number;
  conditions?: RuntimeCondition[];
  tags?: string[];
}
