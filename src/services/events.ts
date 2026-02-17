// mcp-agent-manager/src/services/events.ts
// Central event bus for agent-manager lifecycle events.
// Components emit events here; the server layer subscribes to push
// MCP notifications, write to the JSONL log, etc.

import { EventEmitter } from 'node:events';

/** Event types emitted by agent-manager subsystems */
export interface ManagerEvents {
  'agent:registered': { agentId: string; provider: string; model: string; tags: string[] };
  'agent:unregistered': { agentId: string };
  'agent:state-changed': { agentId: string; previousState: string; newState: string; error?: string; configUpdated?: boolean };
  'task:started': { taskId: string; skillId: string; strategy: string; agentCount: number };
  'task:completed': {
    taskId: string;
    skillId: string;
    strategy: string;
    success: boolean;
    totalTokens: number;
    totalCost: number;
    totalLatencyMs: number;
    agentCount: number;
  };
  'skill:registered': { skillId: string; name: string; strategy: string };
  'skill:removed': { skillId: string };
  'workspace:monitoring': { path: string; workspaceId?: string; sessionCount: number };
  'workspace:stopped': { path: string };
  'workspace:file-changed': { path: string; file: string; kind: string; detail?: string };
  'workspace:session-updated': { path: string; sessionId: string; file: string; sizeBytes: number };
  'workspace:git-event': { path: string; event: string; detail: string };
  'workspace:remote-update': { path: string; remote: string; branch: string; oldRef: string; newRef: string; detail: string };
  'crossrepo:dispatched': { dispatchId: string; repoPath: string; model: string; prompt: string };
  'crossrepo:completed': { dispatchId: string; status: string; durationMs?: number; estimatedTokens?: number; exitCode?: number | null; error?: string };
  'message:received': { messageId: string; channel: string; sender: string; recipients: string[] };
}

export type ManagerEventName = keyof ManagerEvents;

/** Canonical list of all event names - single source of truth (DRY) */
export const ALL_EVENT_NAMES: ManagerEventName[] = [
  'agent:registered', 'agent:unregistered', 'agent:state-changed',
  'task:started', 'task:completed',
  'skill:registered', 'skill:removed',
  'workspace:monitoring', 'workspace:stopped',
  'workspace:file-changed', 'workspace:session-updated', 'workspace:git-event',
  'workspace:remote-update',
  'crossrepo:dispatched', 'crossrepo:completed',
  'message:received',
];

class ManagerEventBus extends EventEmitter {
  /** Type-safe emit */
  emitEvent<K extends ManagerEventName>(event: K, data: ManagerEvents[K]): void {
    this.emit(event, data);
  }

  /** Type-safe subscribe */
  onEvent<K extends ManagerEventName>(event: K, handler: (data: ManagerEvents[K]) => void): void {
    this.on(event, handler);
  }
}

/** Singleton event bus */
export const eventBus = new ManagerEventBus();
