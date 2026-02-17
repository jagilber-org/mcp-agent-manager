// mcp-agent-manager/src/server/tools/messagingTools.ts
// Inter-agent messaging tools - send, read, list channels, acknowledge, stats

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { agentMailbox } from '../../services/agentMailbox.js';
import { toolError, INSTANCE_ID } from './toolErrors.js';

/** Search strategy prefixes - prepended to message body so VS Code session receivers
 *  use the right code discovery approach. Only effective when the receiver is in
 *  a VS Code session (has semantic_search). NOT used for cross_repo_dispatch
 *  because copilot CLI only has grep/glob/view. */
const SEARCH_STRATEGY_PREFIXES: Record<string, string> = {
  'semantic-first': [
    'IMPORTANT - Code Discovery Strategy: This is a large repository.',
    'Use semantic_search as your PRIMARY tool for code discovery, architecture questions, and finding relevant files.',
    'Only use grep_search as a follow-up for exact symbol or string lookups after semantic_search narrows the search space.',
    'Do NOT start with grep_search and regex pattern guessing - it is slow and often misses relevant code in large repos.',
    '',
  ].join('\n'),
  'grep-first': [
    'IMPORTANT - Code Discovery Strategy: Use grep_search with targeted regex patterns as your PRIMARY tool.',
    'Use semantic_search only for broad conceptual questions when grep patterns are unclear.',
    '',
  ].join('\n'),
};

function buildProgressFn(extra: Record<string, unknown>) {
  const progressToken = (extra?._meta as Record<string, unknown> | undefined)?.progressToken as string | number | undefined;
  if (!progressToken) return undefined;
  return (progress: number, total: number | undefined, message: string) => {
    (extra.sendNotification as (n: ServerNotification) => Promise<void>)({
      method: 'notifications/progress',
      params: { progressToken, progress, total, message },
    } as ServerNotification).catch(() => {});
  };
}

export function registerMessagingTools(server: McpServer): void {
  // ===== mgr_send_message =====
  server.tool(
    'mgr_send_message',
    'Send a message to other agents via a named channel. Use recipients=["*"] to broadcast (any reader can see it), or specify exact agent IDs/repo names for directed messages (only those recipients + sender can read). Channels are created automatically on first message. Default sender is your repo directory name.',
    {
      channel: z.string().describe('Channel / topic name (e.g. "general", "build-status", "code-review")'),
      sender: z.string().default(INSTANCE_ID).describe('Your agent ID or identifier (defaults to repo name)'),
      recipients: z.array(z.string()).min(1).describe('Recipient agent IDs, or ["*"] for broadcast to everyone'),
      body: z.string().describe('Message body text'),
      ttlSeconds: z.number().default(3600).describe('Time-to-live in seconds (default: 3600, max: 86400 = 24h). Clamped to max. Ignored when persistent=true.'),
      persistent: z.boolean().default(false).describe('When true, message survives TTL sweep and stays until explicitly purged. Use for queuing messages to offline workspaces.'),
      payload: z.record(z.unknown()).optional().describe('Optional structured JSON payload'),
      searchStrategy: z.enum(['semantic-first', 'grep-first', 'auto']).default('auto').describe('Code discovery strategy hint prepended to message body. Effective when receiver is in a VS Code session with semantic_search. Use semantic-first for large repos.'),
    },
    async (params, extra) => {
      try {
        const notify = buildProgressFn(extra);
        notify?.(0, 3, `Sending message to channel "${params.channel}"…`);

        // Prepend search strategy guidance if specified
        const prefix = SEARCH_STRATEGY_PREFIXES[params.searchStrategy] || '';
        const body = prefix ? `${prefix}${params.body}` : params.body;

        const messageId = await agentMailbox.send({
          channel: params.channel,
          sender: params.sender,
          recipients: params.recipients,
          body,
          ttlSeconds: params.ttlSeconds,
          persistent: params.persistent,
          payload: params.payload,
        });

        notify?.(2, 3, `Broadcasting to peers…`);
        notify?.(3, 3, `Message ${messageId} sent`);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              messageId,
              channel: params.channel,
              sender: params.sender,
              recipients: params.recipients,
              status: 'sent',
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return toolError('mgr_send_message', err.message);
      }
    }
  );

  // ===== mgr_read_messages =====
  server.tool(
    'mgr_read_messages',
    'Read messages from a channel (non-destructive peek by default). Messages are RETAINED after reading — they are never deleted on read. For broadcast messages (recipients=["*"]), any reader sees them. For directed messages, only the sender and listed recipients can read. Default reader is your repo name. To re-read messages you already saw, set includeRead=true. To mark messages as consumed, set markRead=true.',
    {
      channel: z.string().describe('Channel to read from'),
      reader: z.string().default(INSTANCE_ID).describe('Your agent ID - defaults to repo name. Used to filter directed messages and track read status'),
      unreadOnly: z.boolean().default(true).describe('When true (default), only returns messages not yet read by this reader. Set to false to include previously read messages. Equivalent to includeRead=true.'),
      includeRead: z.boolean().default(false).describe('When true, returns ALL messages including previously read ones (overrides unreadOnly). Use this to re-read messages.'),
      limit: z.number().default(20).describe('Max messages to return (default: 20)'),
      markRead: z.boolean().default(false).describe('When true, marks returned messages as read by this reader (default: false — peek mode). Set to true to consume/acknowledge messages on read.'),
    },
    async (params, extra) => {
      try {
        const notify = buildProgressFn(extra);
        notify?.(0, 3, `Reading channel "${params.channel}" for ${params.reader}…`);

        const messages = await agentMailbox.read({
          channel: params.channel,
          reader: params.reader,
          unreadOnly: params.unreadOnly,
          includeRead: params.includeRead,
          limit: params.limit,
          markRead: params.markRead,
        });

        notify?.(2, 3, `Checking peers for missed messages…`);
        notify?.(3, 3, `${messages.length} message(s) returned`);

        // When 0 results but channel has messages, include diagnostic hint
        let hint: string | undefined;
        if (messages.length === 0) {
          const peek = agentMailbox.peekChannel(params.channel);
          if (peek && peek.messageCount > 0) {
            hint = `Channel "${params.channel}" has ${peek.messageCount} message(s) but none match reader "${params.reader}". `
              + `Messages are addressed to: [${peek.recipients.join(', ')}] from senders: [${peek.senders.join(', ')}]. `
              + `To see all messages, re-read with reader set to one of these identities, or use reader="*" for admin view.`;
            if (params.unreadOnly && !params.includeRead) {
              hint += ` Also try includeRead=true in case messages were already marked as read.`;
            }
          }
        }

        const result: Record<string, unknown> = {
          channel: params.channel,
          reader: params.reader,
          count: messages.length,
          messages: messages.map(m => ({
            id: m.id,
            sender: m.sender,
            recipients: m.recipients,
            body: m.body,
            createdAt: m.createdAt,
            payload: m.payload,
          })),
        };
        if (hint) result.hint = hint;

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err: any) {
        return toolError('mgr_read_messages', err.message);
      }
    }
  );

  // ===== mgr_list_channels =====
  server.tool(
    'mgr_list_channels',
    'List all active message channels with message counts and latest activity. Channels are created implicitly when the first message is sent to them and removed when all messages expire (TTL).',
    {},
    async (_params, extra) => {
      const notify = buildProgressFn(extra);
      notify?.(0, 2, 'Listing channels…');

      const channels = agentMailbox.listChannels();

      notify?.(2, 2, `${channels.length} channel(s) found`);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: channels.length,
            channels,
          }, null, 2),
        }],
      };
    }
  );

  // ===== mgr_ack_messages =====
  server.tool(
    'mgr_ack_messages',
    'Mark specific messages as read by your reader ID, without re-reading the channel. This updates read tracking only - messages are NOT deleted. Use purge to remove messages.',
    {
      messageIds: z.array(z.string()).min(1).describe('Message IDs to acknowledge'),
      reader: z.string().default(INSTANCE_ID).describe('Your agent ID (defaults to repo name)'),
    },
    async (params, extra) => {
      try {
        const notify = buildProgressFn(extra);
        notify?.(0, 2, `Acknowledging ${params.messageIds.length} message(s)…`);

        const count = agentMailbox.ack(params.messageIds, params.reader);

        notify?.(2, 2, `${count} message(s) acknowledged`);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              acknowledged: count,
              reader: params.reader,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return toolError('mgr_ack_messages', err.message);
      }
    }
  );

  // ===== mgr_message_stats =====
  server.tool(
    'mgr_message_stats',
    'Get message statistics - total messages visible to you, unread count, and number of channels. For directed messages, only counts messages where you are a recipient or sender.',
    {
      reader: z.string().default(INSTANCE_ID).describe('Your agent ID (defaults to repo name)'),
      channel: z.string().optional().describe('Optional: limit stats to a specific channel'),
    },
    async (params, extra) => {
      try {
        const notify = buildProgressFn(extra);
        notify?.(0, 2, `Fetching stats for ${params.reader}…`);

        const stats = agentMailbox.getStats(params.reader, params.channel);

        notify?.(2, 2, `Stats: ${stats.total} total, ${stats.unread} unread`);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              reader: params.reader,
              channel: params.channel || '(all)',
              ...stats,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return toolError('mgr_message_stats', err.message);
      }
    }
  );

  // ===== mgr_get_message =====
  server.tool(
    'mgr_get_message',
    'Get a single message by its ID.',
    {
      messageId: z.string().describe('The message ID to retrieve'),
    },
    async (params, extra) => {
      try {
        const notify = buildProgressFn(extra);
        notify?.(0, 2, `Looking up message ${params.messageId}…`);
        const msg = agentMailbox.getById(params.messageId);
        if (!msg) {
          return toolError('mgr_get_message', `Message not found: ${params.messageId}`);
        }
        notify?.(2, 2, 'Found');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(msg, null, 2) }],
        };
      } catch (err: any) {
        return toolError('mgr_get_message', err.message);
      }
    }
  );

  // ===== mgr_update_message =====
  server.tool(
    'mgr_update_message',
    'Update a message by ID. Mutable fields: body, recipients, payload, persistent.',
    {
      messageId: z.string().describe('The message ID to update'),
      body: z.string().optional().describe('New message body text'),
      recipients: z.array(z.string()).optional().describe('New recipients list'),
      payload: z.record(z.unknown()).optional().describe('New structured JSON payload'),
      persistent: z.boolean().optional().describe('Set persistent flag'),
    },
    async (params, extra) => {
      try {
        const notify = buildProgressFn(extra);
        notify?.(0, 2, `Updating message ${params.messageId}…`);
        const updated = agentMailbox.updateMessage(params.messageId, {
          body: params.body,
          recipients: params.recipients,
          payload: params.payload,
          persistent: params.persistent,
        });
        if (!updated) {
          return toolError('mgr_update_message', `Message not found: ${params.messageId}`);
        }
        notify?.(2, 2, 'Updated');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(updated, null, 2) }],
        };
      } catch (err: any) {
        return toolError('mgr_update_message', err.message);
      }
    }
  );

  // ===== mgr_purge_messages =====
  server.tool(
    'mgr_purge_messages',
    'Delete messages - purge an entire channel, delete specific message IDs, or purge ALL messages. Exactly one of channel/messageIds/all must be provided.',
    {
      channel: z.string().optional().describe('Purge all messages on this channel'),
      messageIds: z.array(z.string()).optional().describe('Delete specific messages by ID'),
      all: z.boolean().optional().describe('Set true to purge ALL messages on this instance'),
    },
    async (params, extra) => {
      try {
        const notify = buildProgressFn(extra);
        let count = 0;
        let action = '';

        if (params.all) {
          notify?.(0, 2, 'Purging all messages…');
          count = agentMailbox.purgeAll();
          action = 'purged all';
        } else if (params.channel) {
          notify?.(0, 2, `Purging channel "${params.channel}"…`);
          count = agentMailbox.purgeChannel(params.channel);
          action = `purged channel "${params.channel}"`;
        } else if (params.messageIds?.length) {
          notify?.(0, 2, `Deleting ${params.messageIds.length} message(s)…`);
          count = agentMailbox.deleteMessages(params.messageIds);
          action = `deleted ${params.messageIds.length} message ID(s)`;
        } else {
          return toolError('mgr_purge_messages', 'Provide exactly one of: channel, messageIds, or all=true');
        }

        notify?.(2, 2, `${count} message(s) removed`);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ action, removed: count }, null, 2),
          }],
        };
      } catch (err: any) {
        return toolError('mgr_purge_messages', err.message);
      }
    }
  );
}
