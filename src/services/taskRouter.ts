// mcp-agent-manager/src/services/taskRouter.ts
// Core orchestration engine - routes tasks to agents via configured strategies

import {
  AgentConfig,
  AgentResponse,
  RoutingStrategy,
  SkillDefinition,
  TaskRequest,
  TaskResult,
} from '../types/index.js';
import { agentRegistry } from './agentRegistry.js';
import { skillStore } from './skillStore.js';
import { logger } from './logger.js';
import { eventBus } from './events.js';
import { persistTaskHistoryEntry, persistRouterMetrics, readTaskHistory, readRouterMetrics } from './sharedState.js';

/** Provider send function signature - providers implement this */
export type SendPromptFn = (
  agent: AgentConfig,
  prompt: string,
  maxTokens: number,
  timeoutMs: number
) => Promise<AgentResponse>;

/** Registry of provider send functions */
const providerFns: Map<string, SendPromptFn> = new Map();

/** Register a provider backend */
export function registerProvider(name: string, fn: SendPromptFn): void {
  providerFns.set(name, fn);
  logger.info(`Registered provider: ${name}`);
}

/** Global task metrics */
let totalTasks = 0;
let totalTokens = 0;
let totalCost = 0;
let totalPremiumRequests = 0;
let totalEstimatedTokens = 0;

/** Bounded task history ring buffer */
const MAX_TASK_HISTORY = 50;
export interface TaskHistoryEntry {
  taskId: string;
  skillId: string;
  strategy: RoutingStrategy;
  success: boolean;
  totalTokens: number;
  totalCost: number;
  totalLatencyMs: number;
  agentCount: number;
  agents: string[];
  contentPreview: string;
  error?: string;
  completedAt: string;
  /** Number of premium requests consumed (Copilot billing) */
  premiumRequests?: number;
  /** Whether token counts in this task are estimated */
  tokensEstimated?: boolean;
}
const taskHistory: TaskHistoryEntry[] = [];

/** Clear in-memory task history */
export function clearTaskHistory(): void {
  taskHistory.length = 0;
}

export function getRouterMetrics() {
  // Merge disk state when in-memory is empty (cross-process scenario)
  let tasks = totalTasks;
  let tokens = totalTokens;
  let cost = totalCost;
  let recent = taskHistory.slice();

  let premiumReqs = totalPremiumRequests;
  let estimatedTokens = totalEstimatedTokens;

  if (tasks === 0) {
    const diskMetrics = readRouterMetrics();
    if (diskMetrics) {
      tasks = diskMetrics.totalTasks;
      tokens = diskMetrics.totalTokens;
      cost = diskMetrics.totalCost;
      premiumReqs = diskMetrics.totalPremiumRequests || 0;
      estimatedTokens = diskMetrics.totalEstimatedTokens || 0;
    }
  }

  if (recent.length === 0) {
    recent = readTaskHistory(MAX_TASK_HISTORY);
  }

  return { totalTasks: tasks, totalTokens: tokens, totalCost: cost, totalPremiumRequests: premiumReqs, totalEstimatedTokens: estimatedTokens, recentTasks: recent };
}

/** Route a task according to its skill's strategy */
export async function routeTask(request: TaskRequest): Promise<TaskResult> {
  const startTime = Date.now();
  totalTasks++;

  const skill = skillStore.get(request.skillId);
  if (!skill) {
    throw new Error(`Skill not found: ${request.skillId}`);
  }

  // Resolve prompt template
  const prompt = request.resolvedPrompt || skillStore.resolvePrompt(skill, request.params);

  // Find candidate agents
  const agents = resolveCandidateAgents(skill);
  if (agents.length === 0) {
    throw new Error(`No available agents for skill: ${skill.id} (tags: ${skill.targetTags?.join(',')})`);
  }

  logger.info(`Routing task ${request.taskId} via strategy=${skill.strategy} to ${agents.length} agent(s)`);
  eventBus.emitEvent('task:started', {
    taskId: request.taskId,
    skillId: skill.id,
    strategy: skill.strategy,
    agentCount: agents.length,
  });

  let responses: AgentResponse[];

  switch (skill.strategy) {
    case 'single':
      responses = await strategySingle(agents, prompt, skill);
      break;
    case 'race':
      responses = await strategyRace(agents, prompt, skill);
      break;
    case 'fan-out':
      responses = await strategyFanOut(agents, prompt, skill);
      break;
    case 'consensus':
      responses = await strategyConsensus(agents, prompt, skill);
      break;
    case 'fallback':
      responses = await strategyFallback(agents, prompt, skill);
      break;
    case 'cost-optimized':
      responses = await strategyCostOptimized(agents, prompt, skill);
      break;
    case 'evaluate':
      responses = await strategyEvaluate(agents, prompt, skill);
      break;
    default:
      throw new Error(`Unknown routing strategy: ${skill.strategy}`);
  }

  const successResponses = responses.filter(r => r.success);
  const finalContent = skill.mergeResults && successResponses.length > 1
    ? mergeResponses(successResponses)
    : successResponses[0]?.content || '';

  const taskTokens = responses.reduce((sum, r) => sum + r.tokenCount, 0);
  const taskCost = responses.reduce((sum, r) => sum + r.costUnits, 0);
  const taskPremiumRequests = responses.reduce((sum, r) => sum + (r.premiumRequests || 0), 0);
  const anyEstimated = responses.some(r => r.tokenCountEstimated);
  const estimatedTokensInTask = responses.filter(r => r.tokenCountEstimated).reduce((sum, r) => sum + r.tokenCount, 0);

  totalTokens += taskTokens;
  totalCost += taskCost;
  totalPremiumRequests += taskPremiumRequests;
  totalEstimatedTokens += estimatedTokensInTask;

  // Record completions in registry
  for (const r of responses) {
    if (r.success) {
      agentRegistry.recordTaskComplete(r.agentId, r.tokenCount, r.costUnits, true, r.premiumRequests || 0);
    } else {
      agentRegistry.recordTaskComplete(r.agentId, r.tokenCount, r.costUnits, false, r.premiumRequests || 0);
    }
  }

  const result: TaskResult = {
    taskId: request.taskId,
    skillId: skill.id,
    strategy: skill.strategy,
    responses,
    finalContent,
    totalTokens: taskTokens,
    totalCost: taskCost,
    totalLatencyMs: Date.now() - startTime,
    success: successResponses.length > 0,
    completedAt: new Date(),
  };

  // Record in task history
  const historyEntry: TaskHistoryEntry = {
    taskId: request.taskId,
    skillId: skill.id,
    strategy: skill.strategy,
    success: result.success,
    totalTokens: taskTokens,
    totalCost: taskCost,
    totalLatencyMs: result.totalLatencyMs,
    agentCount: responses.length,
    agents: responses.map(r => r.agentId),
    contentPreview: finalContent.substring(0, 200),
    error: successResponses.length === 0 ? responses.map(r => r.error).filter(Boolean).join('; ').substring(0, 200) : undefined,
    completedAt: new Date().toISOString(),
    premiumRequests: taskPremiumRequests,
    tokensEstimated: anyEstimated,
  };
  taskHistory.unshift(historyEntry);
  if (taskHistory.length > MAX_TASK_HISTORY) taskHistory.pop();

  // Persist to disk for cross-process visibility
  persistTaskHistoryEntry(historyEntry);
  persistRouterMetrics({ totalTasks, totalTokens, totalCost, totalPremiumRequests, totalEstimatedTokens });

  logger.info(
    `Task ${request.taskId} completed: ${result.success ? 'OK' : 'FAIL'} ` +
    `${taskTokens} tokens, ${result.totalLatencyMs}ms`
  );

  eventBus.emitEvent('task:completed', {
    taskId: request.taskId,
    skillId: skill.id,
    strategy: skill.strategy,
    success: result.success,
    totalTokens: taskTokens,
    totalCost: taskCost,
    totalLatencyMs: result.totalLatencyMs,
    agentCount: responses.length,
  });

  return result;
}

// --- Strategy implementations ---

/** Pick best single agent and send */
async function strategySingle(
  agents: AgentConfig[],
  prompt: string,
  skill: SkillDefinition
): Promise<AgentResponse[]> {
  const agent = pickBestAgent(agents);
  const response = await sendToAgent(agent, prompt, skill);
  return [response];
}

/** Race all agents, return first success */
async function strategyRace(
  agents: AgentConfig[],
  prompt: string,
  skill: SkillDefinition
): Promise<AgentResponse[]> {
  const timeout = skill.timeoutMs || 30000;

  const promises = agents.map(agent =>
    sendToAgent(agent, prompt, skill).then(r => {
      if (r.success) return r;
      throw new Error(r.error || 'Agent failed');
    })
  );

  try {
    const winner = await Promise.any(promises);
    logger.info(`Race won by agent: ${winner.agentId} in ${winner.latencyMs}ms`);
    return [winner];
  } catch {
    // All failed - collect all errors
    const results = await Promise.allSettled(
      agents.map(agent => sendToAgent(agent, prompt, skill))
    );
    return results
      .filter((r): r is PromiseFulfilledResult<AgentResponse> => r.status === 'fulfilled')
      .map(r => r.value);
  }
}

/** Send to all agents in parallel, collect all responses */
async function strategyFanOut(
  agents: AgentConfig[],
  prompt: string,
  skill: SkillDefinition
): Promise<AgentResponse[]> {
  const results = await Promise.allSettled(
    agents.map(agent => sendToAgent(agent, prompt, skill))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<AgentResponse> => r.status === 'fulfilled')
    .map(r => r.value);
}

/** Fan out, then synthesize via a second-pass agent that compares responses */
async function strategyConsensus(
  agents: AgentConfig[],
  prompt: string,
  skill: SkillDefinition
): Promise<AgentResponse[]> {
  // Need at least 2 for consensus
  const candidateAgents = agents.slice(0, Math.max(2, agents.length));
  const responses = await strategyFanOut(candidateAgents, prompt, skill);

  const successful = responses.filter(r => r.success);
  if (successful.length <= 1) return responses;

  // Build a synthesis prompt for a second-pass evaluation
  const responseSummaries = successful.map((r, i) =>
    `--- Response ${i + 1} (Agent: ${r.agentId}, Model: ${r.model}) ---\n${r.content}`
  ).join('\n\n');

  const synthesisPrompt =
    `You are evaluating multiple agent responses to the same question.\n\n` +
    `ORIGINAL QUESTION:\n${prompt}\n\n` +
    `RESPONSES:\n${responseSummaries}\n\n` +
    `INSTRUCTIONS:\n` +
    `1. Identify points of AGREEMENT across responses.\n` +
    `2. Identify points of DISAGREEMENT or unique insights.\n` +
    `3. Produce a FINAL SYNTHESIZED ANSWER that combines the best parts.\n` +
    `4. Note confidence level (high/medium/low) based on agreement.\n\n` +
    `Format:\n## Consensus Analysis\n**Agreement:** ...\n**Disagreements:** ...\n**Confidence:** ...\n\n## Synthesized Answer\n...`;

  // Pick a synthesizer agent - prefer agents tagged with synthesizerTags, else use pickBestAgent
  let synthAgent: AgentConfig;
  if (skill.synthesizerTags && skill.synthesizerTags.length > 0) {
    const synthCandidates = agentRegistry.findByTags(skill.synthesizerTags).map(i => i.config);
    const available = synthCandidates.filter(a => {
      const inst = agentRegistry.get(a.id);
      return inst && (inst.state === 'idle' || inst.state === 'running') && inst.activeTasks < a.maxConcurrency;
    });
    synthAgent = available.length > 0 ? available[0] : pickBestAgent(candidateAgents);
  } else {
    synthAgent = pickBestAgent(candidateAgents);
  }

  const synthResponse = await sendToAgent(synthAgent, synthesisPrompt, skill);
  if (synthResponse.success) {
    synthResponse.content = `[Consensus from ${successful.length} agents, synthesized by ${synthAgent.id}]\n\n${synthResponse.content}`;
    responses.push(synthResponse);
    // The synthesis response becomes the primary content
    // Move it to be the first successful response for finalContent selection
    const synthIdx = responses.indexOf(synthResponse);
    responses.splice(synthIdx, 1);
    responses.unshift(synthResponse);
  }

  return responses;
}

/** Try agents in order, return first success (optionally also fall back on empty responses) */
async function strategyFallback(
  agents: AgentConfig[],
  prompt: string,
  skill: SkillDefinition
): Promise<AgentResponse[]> {
  const sorted = [...agents].sort((a, b) => a.costMultiplier - b.costMultiplier);
  const allResponses: AgentResponse[] = [];
  const minContentLength = 20; // minimum substantive response length

  for (const agent of sorted) {
    const response = await sendToAgent(agent, prompt, skill);
    allResponses.push(response);

    if (response.success) {
      // Also fall back when response is empty/too short if fallbackOnEmpty is set
      if (skill.fallbackOnEmpty && response.content.trim().length < minContentLength) {
        logger.warn(`Fallback: agent ${agent.id} returned near-empty response (${response.content.trim().length} chars), trying next...`);
        continue;
      }
      return allResponses;
    }
    logger.warn(`Fallback: agent ${agent.id} failed, trying next...`);
  }

  return allResponses;
}

/** Start with cheapest model, escalate if response quality is insufficient */
async function strategyCostOptimized(
  agents: AgentConfig[],
  prompt: string,
  skill: SkillDefinition
): Promise<AgentResponse[]> {
  const sorted = [...agents].sort((a, b) => a.costMultiplier - b.costMultiplier);
  const allResponses: AgentResponse[] = [];
  const threshold = skill.qualityThreshold || 0.5;

  for (const agent of sorted) {
    const response = await sendToAgent(agent, prompt, skill);
    allResponses.push(response);

    if (response.success) {
      const quality = evaluateResponseQuality(response, prompt, threshold);
      if (quality.pass) {
        logger.info(`Cost-optimized: agent ${agent.id} passed quality check (score=${quality.score.toFixed(2)})`);
        return allResponses;
      }
      logger.info(`Cost-optimized: agent ${agent.id} quality too low (score=${quality.score.toFixed(2)}, threshold=${threshold}), escalating...`);
    } else {
      logger.info(`Cost-optimized: escalating from ${agent.id} (cost ${agent.costMultiplier}x)`);
    }
  }

  return allResponses;
}

/** Heuristic quality evaluation for cost-optimized strategy */
function evaluateResponseQuality(
  response: AgentResponse,
  prompt: string,
  threshold: number
): { pass: boolean; score: number } {
  const content = response.content.trim();
  let score = 0;

  // 1. Non-empty check (0.2)
  if (content.length > 0) score += 0.1;
  if (content.length > 50) score += 0.1;

  // 2. Length proportionality - response should be proportional to prompt complexity (0.2)
  const promptWords = prompt.split(/\s+/).length;
  const responseWords = content.split(/\s+/).length;
  if (responseWords > Math.min(10, promptWords * 0.5)) score += 0.1;
  if (responseWords > Math.min(50, promptWords)) score += 0.1;

  // 3. Prompt-relevance - check keyword overlap (0.3)
  const promptKeywords = extractKeywords(prompt);
  const responseKeywords = extractKeywords(content);
  const overlap = promptKeywords.filter(k => responseKeywords.includes(k)).length;
  const relevancy = promptKeywords.length > 0 ? overlap / promptKeywords.length : 0;
  score += Math.min(0.3, relevancy * 0.3);

  // 4. Structure indicators - code blocks, headings, lists suggest effort (0.2)
  if (/```/.test(content)) score += 0.05;
  if (/^#+\s/m.test(content)) score += 0.05;
  if (/^[-*]\s/m.test(content) || /^\d+\.\s/m.test(content)) score += 0.05;
  if (content.includes('\n')) score += 0.05;

  // 5. No error indicators (0.1)
  const errorPatterns = /\b(error|sorry|cannot|unable|don't know|i'm not sure)\b/i;
  if (!errorPatterns.test(content)) score += 0.1;

  return { pass: score >= threshold, score };
}

/** Extract meaningful keywords from text for relevance checking */
function extractKeywords(text: string): string[] {
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for', 'on', 'with',
    'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after',
    'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither',
    'this', 'that', 'these', 'those', 'it', 'its', 'i', 'you', 'he', 'she', 'we', 'they',
    'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why']);

  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 30); // limit for performance
}

/** Send to first agent, then have second agent evaluate/critique the response */
async function strategyEvaluate(
  agents: AgentConfig[],
  prompt: string,
  skill: SkillDefinition
): Promise<AgentResponse[]> {
  if (agents.length < 2) {
    // Not enough agents - fall back to single
    return strategySingle(agents, prompt, skill);
  }

  const allResponses: AgentResponse[] = [];

  // Step 1: Send to first agent (the doer)
  const doer = agents[0];
  const doerResponse = await sendToAgent(doer, prompt, skill);
  allResponses.push(doerResponse);

  if (!doerResponse.success) {
    return allResponses;
  }

  // Step 2: Have second agent evaluate/critique
  const evaluator = agents.length > 1 ? agents[1] : agents[0];
  const evalPrompt =
    `You are evaluating another AI agent's response. Be critical but constructive.\n\n` +
    `ORIGINAL QUESTION:\n${prompt}\n\n` +
    `AGENT RESPONSE:\n${doerResponse.content}\n\n` +
    `INSTRUCTIONS:\n` +
    `1. Rate the response quality (1-10)\n` +
    `2. Identify any errors, omissions, or inaccuracies\n` +
    `3. Suggest specific improvements\n` +
    `4. Provide a final improved answer if the original has issues\n\n` +
    `Format:\n## Evaluation\n**Quality:** X/10\n**Issues:** ...\n**Improvements:** ...\n\n## Revised Answer (if needed)\n...`;

  const evalResponse = await sendToAgent(evaluator, evalPrompt, skill);
  allResponses.push(evalResponse);

  if (evalResponse.success) {
    // Combine: original + evaluation
    evalResponse.content =
      `## Original Response (${doer.id})\n${doerResponse.content}\n\n` +
      `## Evaluation (${evaluator.id})\n${evalResponse.content}`;
    // Move evaluation to front so it becomes the finalContent
    allResponses.splice(allResponses.indexOf(evalResponse), 1);
    allResponses.unshift(evalResponse);
  }

  return allResponses;
}

// --- Helpers ---

/** Send prompt to a specific agent via its provider */
async function sendToAgent(
  agent: AgentConfig,
  prompt: string,
  skill: SkillDefinition
): Promise<AgentResponse> {
  const startTime = Date.now();
  const sendFn = providerFns.get(agent.provider);

  if (!sendFn) {
    return {
      agentId: agent.id,
      model: agent.model,
      content: '',
      tokenCount: 0,
      latencyMs: Date.now() - startTime,
      costUnits: 0,
      success: false,
      error: `No provider registered for: ${agent.provider}`,
      timestamp: new Date(),
    };
  }

  agentRegistry.recordTaskStart(agent.id);

  try {
    const maxTokens = skill.maxTokens || 4000;
    // Default 180s for copilot --yolo mode (tool execution takes longer)
    const timeout = skill.timeoutMs || agent.timeoutMs || 180000;
    return await sendFn(agent, prompt, maxTokens, timeout);
  } catch (err) {
    return {
      agentId: agent.id,
      model: agent.model,
      content: '',
      tokenCount: 0,
      latencyMs: Date.now() - startTime,
      costUnits: 0,
      success: false,
      error: String(err),
      timestamp: new Date(),
    };
  }
}

/** Pick the best available agent (lowest load, highest capacity) */
function pickBestAgent(agents: AgentConfig[]): AgentConfig {
  // Sort by: active tasks ascending, then cost ascending
  const instances = agents.map(a => ({
    config: a,
    instance: agentRegistry.get(a.id),
  }));

  instances.sort((a, b) => {
    const aLoad = a.instance?.activeTasks || 0;
    const bLoad = b.instance?.activeTasks || 0;
    if (aLoad !== bLoad) return aLoad - bLoad;
    return a.config.costMultiplier - b.config.costMultiplier;
  });

  return instances[0].config;
}

/** Merge multiple agent responses into a combined view */
function mergeResponses(responses: AgentResponse[]): string {
  if (responses.length === 1) return responses[0].content;

  const sections = responses.map((r, i) =>
    `--- Agent: ${r.agentId} (${r.model}) [${r.latencyMs}ms] ---\n${r.content}`
  );

  return sections.join('\n\n');
}

/** Resolve which agents should handle this skill */
function resolveCandidateAgents(skill: SkillDefinition): AgentConfig[] {
  let agents: AgentConfig[] = [];

  // Explicit agent IDs first
  if (skill.targetAgents && skill.targetAgents.length > 0) {
    for (const agentId of skill.targetAgents) {
      const instance = agentRegistry.get(agentId);
      if (instance) agents.push(instance.config);
    }
  }

  // Then by tags
  if (skill.targetTags && skill.targetTags.length > 0) {
    const byTag = agentRegistry.findByTags(skill.targetTags);
    for (const instance of byTag) {
      if (!agents.find(a => a.id === instance.config.id)) {
        agents.push(instance.config);
      }
    }
  }

  // If neither specified, use all available
  if (agents.length === 0) {
    agents = agentRegistry.findAvailable().map(i => i.config);
  }

  // Filter to only available agents (not stopped/error, under concurrency)
  agents = agents.filter(a => {
    const inst = agentRegistry.get(a.id);
    if (!inst) return false;
    const stateOk = inst.state === 'idle' || inst.state === 'running' || inst.state === 'busy';
    const capacityOk = inst.activeTasks < inst.config.maxConcurrency;
    return stateOk && capacityOk;
  });

  return agents;
}
