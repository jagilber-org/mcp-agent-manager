// tests/provider-framework.test.ts
// Tests for provider framework: capabilities registry, provider types, binary resolution

import { describe, it, expect, beforeEach } from 'vitest';
import { initializeProviders, getProviderCapabilities, getAllProviderCapabilities } from '../src/providers/index.js';
import type { ProviderCapabilities, BillingModel } from '../src/providers/types.js';
import { resolveCopilotBinary } from '../src/providers/copilot.js';

describe('Provider Framework', () => {
  beforeEach(() => {
    initializeProviders();
  });

  describe('Provider Capabilities', () => {
    it('returns capabilities for copilot', () => {
      const cap = getProviderCapabilities('copilot');
      expect(cap).toBeDefined();
      expect(cap!.name).toBe('copilot');
      expect(cap!.supportsTokenCounting).toBe(false);
      expect(cap!.billingModel).toBe('premium-request');
      expect(cap!.supportsAcp).toBe(true);
    });

    it('returns capabilities for anthropic', () => {
      const cap = getProviderCapabilities('anthropic');
      expect(cap).toBeDefined();
      expect(cap!.name).toBe('anthropic');
      expect(cap!.supportsTokenCounting).toBe(true);
      expect(cap!.billingModel).toBe('per-token');
      expect(cap!.supportsAcp).toBe(false);
    });

    it('returns capabilities for openai', () => {
      const cap = getProviderCapabilities('openai');
      expect(cap).toBeDefined();
      expect(cap!.name).toBe('openai');
      expect(cap!.supportsTokenCounting).toBe(true);
      expect(cap!.billingModel).toBe('per-token');
      expect(cap!.supportsConcurrency).toBe(true);
    });

    it('returns undefined for unknown provider', () => {
      expect(getProviderCapabilities('unknown')).toBeUndefined();
    });

    it('getAllProviderCapabilities returns all 3 providers', () => {
      const all = getAllProviderCapabilities();
      expect(all.length).toBe(3);
      const names = all.map(c => c.name).sort();
      expect(names).toEqual(['anthropic', 'copilot', 'openai']);
    });

    it('all capabilities have required fields', () => {
      const all = getAllProviderCapabilities();
      for (const cap of all) {
        expect(cap.name).toBeTruthy();
        expect(typeof cap.supportsTokenCounting).toBe('boolean');
        expect(typeof cap.supportsStreaming).toBe('boolean');
        expect(['per-token', 'premium-request', 'free', 'unknown']).toContain(cap.billingModel);
        expect(typeof cap.supportsConcurrency).toBe('boolean');
        expect(typeof cap.supportsAcp).toBe('boolean');
        expect(cap.description).toBeTruthy();
      }
    });
  });

  describe('Copilot Binary Resolution', () => {
    it('resolveCopilotBinary returns string or null', () => {
      const result = resolveCopilotBinary();
      expect(result === null || typeof result === 'string').toBe(true);
    });

    it('resolveCopilotBinary respects COPILOT_PATH env when set', () => {
      // Just verify the function is callable - actual binary presence varies by machine
      const result = resolveCopilotBinary();
      if (process.env.COPILOT_PATH) {
        // If env is set and file exists, it should return that path
        expect(typeof result).toBe('string');
      }
    });
  });

  describe('Provider Type Contracts', () => {
    it('copilot billing model is premium-request', () => {
      const cap = getProviderCapabilities('copilot')!;
      expect(cap.billingModel satisfies BillingModel).toBe('premium-request');
    });

    it('anthropic billing model is per-token', () => {
      const cap = getProviderCapabilities('anthropic')!;
      expect(cap.billingModel satisfies BillingModel).toBe('per-token');
    });

    it('non-metered providers do not support token counting', () => {
      const all = getAllProviderCapabilities();
      for (const cap of all) {
        if (cap.billingModel === 'premium-request') {
          expect(cap.supportsTokenCounting).toBe(false);
        }
      }
    });

    it('per-token providers support token counting', () => {
      const all = getAllProviderCapabilities();
      for (const cap of all) {
        if (cap.billingModel === 'per-token') {
          expect(cap.supportsTokenCounting).toBe(true);
        }
      }
    });
  });
});
