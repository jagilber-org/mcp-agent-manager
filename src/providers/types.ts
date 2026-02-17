// mcp-agent-manager/src/providers/types.ts
// Provider capability declarations.
// Each provider declares what it supports so the router, metrics, and dashboard
// can make informed decisions without hardcoded provider name checks.

/** Billing model for the provider */
export type BillingModel = 'per-token' | 'premium-request' | 'free' | 'unknown';

/** Capabilities declared by a provider backend */
export interface ProviderCapabilities {
  /** Unique provider name (matches ProviderName in types/agent.ts) */
  name: string;
  /** Whether the provider returns real token counts from the API */
  supportsTokenCounting: boolean;
  /** Whether the provider supports streaming responses */
  supportsStreaming: boolean;
  /** How the provider bills usage */
  billingModel: BillingModel;
  /** Whether the provider can handle concurrent requests to the same model */
  supportsConcurrency: boolean;
  /** Whether the provider uses the Agent Client Protocol (ACP) */
  supportsAcp: boolean;
  /** Human-readable description */
  description: string;
}
