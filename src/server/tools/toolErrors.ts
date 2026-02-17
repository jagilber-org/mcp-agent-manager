// mcp-agent-manager/src/server/tools/toolErrors.ts
// Shared error response helper - returns schema hints on every failed tool call
// so agents can self-correct without guessing parameter shapes.

import path from 'path';

/** Default identity for this instance - the repo/directory name */
export const INSTANCE_ID = path.basename(process.cwd());

/** Schema hints keyed by tool name → param name → description */
const TOOL_SCHEMAS: Record<string, Record<string, string>> = {
  // ----- agentTools -----
  mgr_spawn_agent: {
    id: 'string (required) - unique agent identifier',
    name: 'string (required) - human-readable agent name',
    provider: 'enum (required) - "anthropic" | "copilot" | "openai" | "custom"',
    model: 'string (required) - model name e.g. "claude-sonnet-4-20250514"',
    transport: 'enum (default: "stdio") - "stdio" | "tcp" | "http"',
    endpoint: 'string (optional) - command, host:port, or URL',
    tags: 'string[] (default: []) - capability tags for routing',
    canMutate: 'boolean (default: false) - whether agent can write/mutate',
    costMultiplier: 'number (default: 1) - relative cost',
    maxConcurrency: 'number (default: 1) - max simultaneous tasks',
    timeoutMs: 'number (default: 60000) - request timeout in ms',
    binaryPath: 'string (optional) - path to CLI binary',
    cliArgs: 'string[] (optional) - additional CLI args',
    env: 'Record<string,string> (optional) - environment variables',
  },
  mgr_stop_agent: {
    agentId: 'string (required) - agent ID to stop',
  },
  mgr_list_agents: {
    filterTags: 'string[] (optional) - filter by capability tags',
    filterProvider: 'string (optional) - filter by provider name',
  },
  mgr_agent_status: {
    agentId: 'string (required) - agent ID to check',
  },
  mgr_get_agent: {
    agentId: 'string (required) - agent ID to retrieve',
  },
  mgr_update_agent: {
    agentId: 'string (required) - agent ID to update',
    name: 'string (optional) - new name',
    model: 'string (optional) - new model',
    tags: 'string[] (optional) - new capability tags',
    maxConcurrency: 'number (optional) - new max concurrent tasks',
    costMultiplier: 'number (optional) - new cost multiplier',
    canMutate: 'boolean (optional) - new mutation permission',
    timeoutMs: 'number (optional) - new timeout in ms',
    env: 'Record<string,string> (optional) - new env vars',
  },
  mgr_stop_all: {},

  // ----- automationTools -----
  mgr_create_automation: {
    id: 'string (required) - unique rule ID (kebab-case)',
    name: 'string (required) - human-readable rule name',
    description: 'string (required) - what this automation does',
    enabled: 'boolean (default: true) - whether the rule is active',
    priority: 'enum (default: "normal") - "critical" | "high" | "normal" | "low"',
    events: 'string[] (required, min:1) - event names (e.g. "workspace:*")',
    filters: 'Record<string,string> (optional) - event data filters (* wildcards)',
    requiredFields: 'string[] (optional) - event data fields that must be present',
    skillId: 'string (required) - skill to invoke when event matches',
    staticParams: 'Record<string,string> (optional) - static skill params',
    eventParams: 'Record<string,string> (optional) - map skill params to event fields',
    templateParams: 'Record<string,string> (optional) - template params with {event.field}',
    throttleIntervalMs: 'number (optional) - min interval between executions in ms',
    throttleMode: 'enum (optional) - "leading" | "trailing"',
    throttleGroupBy: 'string (optional) - event field to group throttling by',
    maxRetries: 'number (optional) - max retry attempts on failure',
    retryBaseDelayMs: 'number (optional) - base retry delay (doubles each retry)',
    maxConcurrent: 'number (default: 3) - max concurrent executions',
    conditions: 'array (optional) - [{type: "min-agents"|"skill-exists"|"cooldown"|"custom", value: string|number}]',
    tags: 'string[] (default: []) - tags for filtering',
  },
  mgr_get_automation: {
    id: 'string (required) - rule ID to retrieve',
  },
  mgr_update_automation: {
    id: 'string (required) - rule ID to update',
    _note: 'All other mgr_create_automation fields accepted as optional overrides',
  },
  mgr_list_automations: {
    tag: 'string (optional) - filter by tag',
    enabled: 'boolean (optional) - filter by enabled/disabled state',
  },
  mgr_remove_automation: {
    id: 'string (required) - rule ID to remove',
  },
  mgr_toggle_automation: {
    ruleId: 'string (optional) - rule ID to toggle. Omit to toggle entire engine.',
    enabled: 'boolean (required) - whether to enable or disable',
  },
  mgr_trigger_automation: {
    ruleId: 'string (required) - rule ID to trigger',
    testData: 'Record<string,unknown> (default: {}) - test event data',
    dryRun: 'boolean (default: false) - if true, shows what would happen without executing',
  },
  mgr_automation_status: {
    ruleId: 'string (optional) - filter by rule ID',
    limit: 'number (default: 20) - max recent executions to return',
  },

  // ----- crossRepoTools -----
  mgr_cross_repo_dispatch: {
    repoPath: 'string (required) - absolute path to the target repository',
    prompt: 'string (required) - the prompt/task to send',
    model: 'string (optional, default: "claude-sonnet-4") - model to use',
    timeoutMs: 'number (optional, default: 300000) - timeout in ms',
    allowMutations: 'boolean (default: false) - allow file writes (--yolo)',
    additionalDirs: 'string[] (optional) - extra --add-dir paths',
    additionalMcpConfig: 'string (optional) - path to additional MCP config JSON',
    priority: 'number (default: 0) - dispatch priority',
    callerContext: 'string (optional) - free-form tracking context',
    maxResponseChars: 'number (optional, default: 50000) - max inline response chars',
  },
  mgr_cross_repo_batch_dispatch: {
    dispatches: 'array (required, 1-10) - [{repoPath, prompt, model?, timeoutMs?, allowMutations, additionalDirs?, additionalMcpConfig?, callerContext?}]',
    maxResponseChars: 'number (optional, default: 20000) - max chars per result',
  },
  mgr_cross_repo_status: {
    dispatchId: 'string (optional) - specific dispatch ID. Omit to list all active.',
  },
  mgr_cross_repo_history: {
    limit: 'number (default: 20) - max items to return',
    status: 'enum (optional) - "queued"|"running"|"completed"|"failed"|"cancelled"|"timeout"',
    repoPath: 'string (optional) - filter by target repo path',
  },
  mgr_cross_repo_cancel: {
    dispatchId: 'string (required) - dispatch ID to cancel',
  },

  // ----- feedbackTools -----
  mgr_submit_feedback: {
    type: 'enum (required) - "issue"|"bug"|"feature-request"|"security"|"general"',
    title: 'string (required) - short title',
    body: 'string (required) - detailed description',
    metadata: 'Record<string,unknown> (optional) - key-value metadata',
  },
  mgr_list_feedback: {
    type: 'enum (optional) - "issue"|"bug"|"feature-request"|"security"|"general"',
    status: 'enum (optional) - "new"|"acknowledged"|"resolved"|"rejected"',
  },
  mgr_get_feedback: {
    id: 'string (required) - feedback entry ID',
  },
  mgr_update_feedback: {
    id: 'string (required) - feedback entry ID',
    status: 'enum (required) - "new"|"acknowledged"|"resolved"|"rejected"',
  },

  // ----- metaTools -----
  mgr_get_insights: {
    agentId: 'string (optional) - filter to a specific agent',
    skillId: 'string (optional) - filter to a specific skill',
    type: 'enum (default: "all") - "all"|"agents"|"skills"|"session"',
  },
  mgr_search_knowledge: {
    query: 'string (required) - search query',
    category: 'string (optional) - filter by knowledge category',
    limit: 'number (default: 10) - max results',
  },

  // ----- monitorTools -----
  mgr_monitor_workspace: {
    path: 'string (required) - absolute path to workspace directory',
  },
  mgr_stop_monitor: {
    path: 'string (required) - workspace path, or "all" to stop all monitors',
  },
  mgr_monitor_status: {},
  mgr_mine_sessions: {
    path: 'string (optional) - workspace path. Omit to mine all.',
  },
  mgr_get_workspace: {
    path: 'string (required) - absolute path to workspace',
  },
  mgr_list_workspace_history: {
    path: 'string (optional) - filter to a workspace path',
    limit: 'number (default: 20) - max entries',
    offset: 'number (default: 0) - pagination offset',
  },

  // ----- skillTools -----
  mgr_register_skill: {
    id: 'string (required) - unique skill identifier',
    name: 'string (required) - human-readable name',
    description: 'string (required) - what this skill does',
    promptTemplate: 'string (required) - prompt template with {param} placeholders',
    strategy: 'enum (default: "single") - "single"|"race"|"fan-out"|"consensus"|"fallback"|"cost-optimized"',
    targetAgents: 'string[] (optional) - specific agent IDs',
    targetTags: 'string[] (optional) - agent tags to match',
    maxTokens: 'number (optional) - max response tokens',
    timeoutMs: 'number (optional) - timeout override',
    mergeResults: 'boolean (default: false) - merge multi-agent results',
    categories: 'string[] (default: []) - categories for search/filtering',
  },
  mgr_get_skill: {
    id: 'string (required) - skill ID to retrieve',
  },
  mgr_update_skill: {
    id: 'string (required) - skill ID to update',
    _note: 'All other mgr_register_skill fields accepted as optional overrides',
  },
  mgr_remove_skill: {
    id: 'string (required) - skill ID to remove',
  },
  mgr_list_skills: {
    category: 'string (optional) - filter by category',
  },

  // ----- taskTools -----
  mgr_assign_task: {
    skillId: 'string (required) - skill ID to execute',
    params: 'Record<string,string> (default: {}) - template parameters',
    priority: 'number (default: 0) - task priority (higher = more important)',
  },
  mgr_send_prompt: {
    agentId: 'string (required) - target agent ID',
    prompt: 'string (required) - prompt text to send',
    maxTokens: 'number (default: 4000) - max response tokens',
  },
  mgr_list_task_history: {
    ruleId: 'string (optional) - filter by automation rule ID',
    status: 'enum (optional) - "pending"|"running"|"success"|"failed"|"skipped"',
    limit: 'number (default: 20) - max results',
  },
  mgr_get_metrics: {},

  // ----- messagingTools -----
  mgr_send_message: {
    channel: 'string (required) - channel name e.g. "general"',
    recipients: 'string[] (required) - agent IDs or ["*"] for broadcast',
    body: 'string (required) - message text',
    sender: `string (default: "${INSTANCE_ID}") - your agent ID`,
    ttlSeconds: 'number (default: 3600) - time-to-live; ignored when persistent=true',
    persistent: 'boolean (default: false) - true = survives TTL, stays until purged',
    payload: 'object (optional) - structured JSON data',
    searchStrategy: 'string (default: "auto") - "semantic-first"|"grep-first"|"auto"',
  },
  mgr_read_messages: {
    channel: 'string (required) - channel to read from',
    reader: `string (default: "${INSTANCE_ID}") - your agent ID`,
    unreadOnly: 'boolean (default: true) - set false to include read messages',
    includeRead: 'boolean (default: false) - set true to include previously read messages (overrides unreadOnly)',
    limit: 'number (default: 20)',
    markRead: 'boolean (default: false) - peek mode by default; set true to mark as read',
  },
  mgr_list_channels: {},
  mgr_ack_messages: {
    messageIds: 'string[] (required) - message IDs to acknowledge',
    reader: `string (default: "${INSTANCE_ID}") - your agent ID`,
  },
  mgr_message_stats: {
    reader: `string (default: "${INSTANCE_ID}") - your agent ID`,
    channel: 'string (optional) - limit to specific channel',
  },
  mgr_get_message: {
    messageId: 'string (required) - the message ID to retrieve',
  },
  mgr_update_message: {
    messageId: 'string (required) - the message ID to update',
    body: 'string (optional) - new message body text',
    recipients: 'string[] (optional) - new recipients list',
    payload: 'object (optional) - new structured JSON payload',
    persistent: 'boolean (optional) - set persistent flag',
  },
  mgr_purge_messages: {
    channel: 'string (optional) - purge all on this channel',
    messageIds: 'string[] (optional) - delete specific messages',
    all: 'boolean (optional) - true to purge ALL messages',
    _note: 'Provide exactly one of: channel, messageIds, or all=true',
  },
};

/**
 * Build a standardized error response with schema hints for self-correction.
 * Every failed tool call returns the expected parameter schema so agents can
 * fix their invocation without guessing.
 */
export function toolError(tool: string, message: string) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        error: message,
        tool,
        expectedSchema: TOOL_SCHEMAS[tool] || {},
      }, null, 2),
    }],
    isError: true as const,
  };
}
