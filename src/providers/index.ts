// mcp-agent-manager/src/providers/index.ts
// Provider factory - registers all provider backends, capabilities, and exposes initialization

import { registerProvider } from '../services/taskRouter.js';
import { sendAnthropicPrompt } from './anthropic.js';
import { sendCopilotPrompt } from './copilot.js';
import { sendOpenAIPrompt } from './openai.js';
import { logger } from '../services/logger.js';
import type { ProviderCapabilities } from './types.js';

/** Registry of provider capabilities */
const capabilities: Map<string, ProviderCapabilities> = new Map();

/** Provider capability declarations */
const PROVIDER_CAPABILITIES: ProviderCapabilities[] = [
  {
    name: 'copilot',
    supportsTokenCounting: false,
    supportsStreaming: false,
    billingModel: 'premium-request',
    supportsConcurrency: true,
    supportsAcp: true,
    description: 'GitHub Copilot CLI - premium-request billing, estimated tokens',
  },
  {
    name: 'anthropic',
    supportsTokenCounting: true,
    supportsStreaming: true,
    billingModel: 'per-token',
    supportsConcurrency: true,
    supportsAcp: false,
    description: 'Anthropic Claude API - real token counts, per-token billing',
  },
  {
    name: 'openai',
    supportsTokenCounting: true,
    supportsStreaming: true,
    billingModel: 'per-token',
    supportsConcurrency: true,
    supportsAcp: false,
    description: 'OpenAI-compatible API - OpenAI, Azure OpenAI, Ollama, LM Studio',
  },
];

/** Initialize all provider backends */
export function initializeProviders(): void {
  registerProvider('anthropic', sendAnthropicPrompt);
  registerProvider('copilot', sendCopilotPrompt);
  registerProvider('openai', sendOpenAIPrompt);

  // Register capabilities
  for (const cap of PROVIDER_CAPABILITIES) {
    capabilities.set(cap.name, cap);
  }

  logger.info('All providers initialized');
}

/** Get capabilities for a specific provider */
export function getProviderCapabilities(name: string): ProviderCapabilities | undefined {
  return capabilities.get(name);
}

/** Get all registered provider capabilities */
export function getAllProviderCapabilities(): ProviderCapabilities[] {
  return Array.from(capabilities.values());
}

export { sendAnthropicPrompt } from './anthropic.js';
export { sendCopilotPrompt, killSession, killAllSessions, resolveCopilotBinary } from './copilot.js';
export { sendOpenAIPrompt } from './openai.js';
export type { ProviderCapabilities, BillingModel } from './types.js';
