// mcp-agent-manager/src/providers/openai.ts
// OpenAI-compatible provider stub - supports OpenAI, Azure OpenAI, Ollama, LM Studio, etc.
// Skeleton implementation: wired for registration but requires configuration to use.

import { AgentConfig, AgentResponse } from '../types/index.js';
import { logger } from '../services/logger.js';

/** Send a prompt to an OpenAI-compatible API endpoint */
export async function sendOpenAIPrompt(
  agent: AgentConfig,
  prompt: string,
  maxTokens: number,
  timeoutMs: number
): Promise<AgentResponse> {
  const startTime = Date.now();
  const endpoint = agent.endpoint || process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
  const apiKey = agent.env?.['OPENAI_API_KEY'] || process.env.OPENAI_API_KEY || '';

  if (!apiKey && !endpoint.includes('localhost') && !endpoint.includes('127.0.0.1')) {
    return {
      agentId: agent.id,
      model: agent.model,
      content: '',
      tokenCount: 0,
      tokenCountEstimated: false,
      latencyMs: Date.now() - startTime,
      costUnits: 0,
      premiumRequests: 0,
      success: false,
      error: 'OPENAI_API_KEY not set and endpoint is not local',
      timestamp: new Date(),
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const url = `${endpoint.replace(/\/$/, '')}/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: agent.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const content = data.choices?.[0]?.message?.content || '';
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    const totalTokens = data.usage?.total_tokens || (inputTokens + outputTokens);
    const hasRealTokens = totalTokens > 0;

    logger.debug(`OpenAI ${agent.model}: ${totalTokens} tokens, ${Date.now() - startTime}ms`);

    return {
      agentId: agent.id,
      model: agent.model,
      content,
      tokenCount: hasRealTokens ? totalTokens : Math.ceil((prompt.length + content.length) / 4),
      tokenCountEstimated: !hasRealTokens,
      latencyMs: Date.now() - startTime,
      costUnits: agent.costMultiplier * totalTokens / 1_000_000,
      premiumRequests: 0,
      success: true,
      timestamp: new Date(),
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    logger.error(`OpenAI error for ${agent.id}: ${err.message}`, { latencyMs });

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
