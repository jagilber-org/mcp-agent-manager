// mcp-agent-manager/src/types/skill.ts
// Skill domain types - definitions and routing

import type { RoutingStrategy } from './task.js';

/** Skill definition - a reusable prompt template with routing config */
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  /** Prompt template with {param} placeholders */
  promptTemplate: string;
  /** Which agents or agent tags to route to */
  targetAgents?: string[];
  targetTags?: string[];
  /** How to route when multiple agents match */
  strategy: RoutingStrategy;
  /** Model preferences per strategy leg */
  modelPreferences?: string[];
  /** Max tokens for the response */
  maxTokens?: number;
  /** Timeout override for this skill */
  timeoutMs?: number;
  /** Whether results from multiple agents should be merged */
  mergeResults?: boolean;
  /** Version for governance */
  version: string;
  /** Categories for filtering and organization */
  categories: string[];
  /** Tags to identify the synthesizer agent for consensus strategy */
  synthesizerTags?: string[];
  /** Minimum quality threshold (0-1) for cost-optimized strategy */
  qualityThreshold?: number;
  /** Also fall back when response is empty/too short, not just on errors */
  fallbackOnEmpty?: boolean;
}
