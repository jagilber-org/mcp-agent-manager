// mcp-agent-manager/src/providers/anthropic.ts
// Anthropic Claude provider - sends prompts via @anthropic-ai/sdk

import Anthropic from '@anthropic-ai/sdk';
import { AgentConfig, AgentResponse } from '../types/index.js';
import { logger } from '../services/logger.js';

/** Cached Anthropic client instances keyed by API key */
const clients: Map<string, Anthropic> = new Map();

function getClient(apiKey?: string): Anthropic {
  const key = apiKey || process.env.ANTHROPIC_API_KEY || '';
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY not set and no apiKey provided in agent config');
  }

  let client = clients.get(key);
  if (!client) {
    client = new Anthropic({ apiKey: key });
    clients.set(key, client);
  }
  return client;
}

/** Model cost multipliers (input $/Mtok, output $/Mtok) */
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
};

/** Send a prompt to an Anthropic Claude model */
export async function sendAnthropicPrompt(
  agent: AgentConfig,
  prompt: string,
  maxTokens: number,
  timeoutMs: number
): Promise<AgentResponse> {
  const startTime = Date.now();

  try {
    const apiKey = agent.env?.['ANTHROPIC_API_KEY'];
    const client = getClient(apiKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const message = await client.messages.create(
      {
        model: agent.model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal }
    );

    clearTimeout(timer);

    const content = message.content
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
      .join('\n');

    const inputTokens = message.usage?.input_tokens || 0;
    const outputTokens = message.usage?.output_tokens || 0;
    const totalTokens = inputTokens + outputTokens;

    // Calculate cost units (in microdollars)
    const costs = MODEL_COSTS[agent.model] || { input: 3, output: 15 };
    const costUnits = (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;

    logger.debug(`Anthropic ${agent.model}: ${totalTokens} tokens, ${Date.now() - startTime}ms`);

    return {
      agentId: agent.id,
      model: agent.model,
      content,
      tokenCount: totalTokens,
      tokenCountEstimated: false,
      latencyMs: Date.now() - startTime,
      costUnits,
      premiumRequests: 0,
      success: true,
      timestamp: new Date(),
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    logger.error(`Anthropic error for ${agent.id}: ${err.message}`, { latencyMs });

    return {
      agentId: agent.id,
      model: agent.model,
      content: '',
      tokenCount: 0,
      tokenCountEstimated: false,
      latencyMs,
      costUnits: 0,
      premiumRequests: 0,
      success: false,
      error: err.message || String(err),
      timestamp: new Date(),
    };
  }
}
