// mcp-agent-manager/src/services/dashboard/sse.ts
// SSE client management and event bus → SSE broadcasting.

import { ServerResponse } from 'node:http';
import { ALL_EVENT_NAMES, eventBus, ManagerEvents } from '../events.js';
import { sseClients, eventCounts } from './state.js';
import { buildSnapshot } from './snapshot.js';

// ---------------------------------------------------------------------------
// Broadcast helper
// ---------------------------------------------------------------------------

export function broadcastSSE(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

// ---------------------------------------------------------------------------
// Wire all event bus events → SSE
// ---------------------------------------------------------------------------

for (const evt of ALL_EVENT_NAMES) {
  eventCounts[evt] = 0;
  eventBus.onEvent(evt, (data: ManagerEvents[typeof evt]) => {
    eventCounts[evt] = (eventCounts[evt] || 0) + 1;
    broadcastSSE(evt, data);
    broadcastSSE('snapshot', buildSnapshot());
  });
}
