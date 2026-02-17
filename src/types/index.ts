// mcp-agent-manager/src/types/index.ts
// Barrel re-export - all domain types

export * from './agent.js';
export * from './skill.js';
export * from './task.js';
export * from './metrics.js';
export * from './crossRepo.js';

/** Feedback submission types */
export type FeedbackType = 'issue' | 'bug' | 'feature-request' | 'security' | 'general';
