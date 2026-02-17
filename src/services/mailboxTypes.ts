// mcp-agent-manager/src/services/mailboxTypes.ts
// Shared types and constants for the agent mailbox subsystem.

/** Maximum TTL any message is allowed (24 hours) */
export const MAX_TTL_SECONDS = 86_400;
/** Default TTL when none specified (1 hour) */
export const DEFAULT_TTL_SECONDS = 3_600;

export interface AgentMessage {
  id: string;
  channel: string;
  sender: string;
  recipients: string[];
  body: string;
  createdAt: string;
  ttlSeconds: number;
  persistent?: boolean;
  readBy?: string[];
  payload?: Record<string, unknown>;
}

export interface SendMessageOptions {
  channel: string;
  sender: string;
  recipients: string[];
  body: string;
  ttlSeconds?: number;
  persistent?: boolean;
  payload?: Record<string, unknown>;
}

export interface ReadMessagesOptions {
  channel: string;
  reader: string;
  unreadOnly?: boolean;
  includeRead?: boolean;
  limit?: number;
  markRead?: boolean;
}
