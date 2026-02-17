// mcp-agent-manager/src/services/dashboard/state.ts
// Shared mutable state for all dashboard modules.

import { ServerResponse } from 'node:http';

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

export const sseClients = new Set<ServerResponse>();

// ---------------------------------------------------------------------------
// Event counts (debug view)
// ---------------------------------------------------------------------------

export const eventCounts: Record<string, number> = {};

// ---------------------------------------------------------------------------
// Request tracking (debug view)
// ---------------------------------------------------------------------------

export const MAX_REQUEST_LOG = 200;
export const requestLog: Array<{
  ts: string;
  method: string;
  url: string;
  status: number;
  ms: number;
}> = [];
export let totalRequests = 0;
export let serverStartedAt: Date | null = null;
export let actualPort = 3900;

export function recordRequest(entry: (typeof requestLog)[0]): void {
  totalRequests++;
  requestLog.unshift(entry);
  if (requestLog.length > MAX_REQUEST_LOG) requestLog.length = MAX_REQUEST_LOG;
}

export function setServerStartedAt(d: Date): void {
  serverStartedAt = d;
}

export function setActualPort(p: number): void {
  actualPort = p;
}
