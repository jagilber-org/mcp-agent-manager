// mcp-agent-manager/src/services/agentMailbox.ts
// Inter-agent messaging service - HTTP peer mesh for multi-instance messaging.

import path from 'path';
import { logger } from './logger.js';
import {
  appendMessageToLog,
  loadMessagesFromLog,
  rewriteMessageLog,
  broadcastToPeers,
  fanOutRead,
  getMessagesFilePath,
} from './mailboxPersistence.js';
import {
  MAX_TTL_SECONDS,
  DEFAULT_TTL_SECONDS,
  type AgentMessage,
  type SendMessageOptions,
  type ReadMessagesOptions,
} from './mailboxTypes.js';
import { watchConfigFile, type ConfigWatcher } from './configWatcher.js';

// Re-export types and constants for consumers
export type { AgentMessage, SendMessageOptions, ReadMessagesOptions };
export { MAX_TTL_SECONDS, DEFAULT_TTL_SECONDS };

const SWEEP_INTERVAL_MS = 60_000;

const localStore: Map<string, AgentMessage> = new Map();
let messageCounter = 0;
let loaded = false;
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let messageWatcher: ConfigWatcher | null = null;

/** Default sender identity - the repo/directory name */
const DEFAULT_SENDER = path.basename(process.cwd());

class AgentMailbox {
  /**
   * Load persisted messages from JSONL into localStore.
   * Called once on first access (lazy init).
   */
  private _ensureLoaded(): void {
    if (loaded) return;
    loaded = true;
    const messages = loadMessagesFromLog();
    let pruned = 0;
    const seenIds = new Set<string>();
    for (const msg of messages) {
      // Skip expired, empty-channel, and duplicate messages
      if (!msg.channel || !msg.id || seenIds.has(msg.id) || this._isExpired(msg)) {
        pruned++;
        continue;
      }
      seenIds.add(msg.id);
      const key = `msg/${msg.channel}/${new Date(msg.createdAt).getTime()}-${msg.id}`;
      localStore.set(key, msg);
    }
    if (pruned > 0) {
      // Rewrite log without expired/invalid/duplicate messages
      rewriteMessageLog(Array.from(localStore.values()));
    }
    if (messages.length > 0) {
      logger.info(`[Mailbox] Loaded ${localStore.size} messages from disk (pruned ${pruned} expired)`);
    }

    // Watch messages.jsonl for external changes (cross-instance sync)
    if (!messageWatcher) {
      try {
        messageWatcher = watchConfigFile(
          getMessagesFilePath(),
          () => this._reloadFromDisk(),
          'messages.jsonl',
        );
      } catch (err: any) {
        logger.warn(`[Mailbox] Failed to start file watcher: ${err.message}`);
      }
    }

    // Start periodic sweep on first load
    this.startSweep();
  }

  /**
   * Send a message to a channel.
   * Stores locally, persists to JSONL, broadcasts to all peers.
   * Returns the message ID.
   */
  async send(opts: SendMessageOptions): Promise<string> {
    this._ensureLoaded();

    const id = `msg-${++messageCounter}-${Date.now()}`;
    const now = new Date();
    const sender = opts.sender?.trim() || DEFAULT_SENDER;

    const ttl = Math.min(Math.max(1, opts.ttlSeconds ?? DEFAULT_TTL_SECONDS), MAX_TTL_SECONDS);

    const message: AgentMessage = {
      id,
      channel: opts.channel,
      sender,
      recipients: opts.recipients,
      body: opts.body,
      createdAt: now.toISOString(),
      ttlSeconds: opts.persistent ? 0 : ttl,
      persistent: opts.persistent || false,
      readBy: [],
      payload: opts.payload,
    };

    const key = `msg/${opts.channel}/${now.getTime()}-${id}`;

    // Store locally
    localStore.set(key, message);
    this._pruneExpired();

    // Persist to JSONL
    if (messageWatcher) messageWatcher.markSelfWrite();
    appendMessageToLog(message);

    logger.debug(`[Mailbox] Stored message ${id} on channel '${opts.channel}'`);

    // Broadcast to all peers (fire-and-forget)
    broadcastToPeers(message);

    return id;
  }

  /**
   * Receive a message from a peer instance (inbound HTTP push).
   * Returns true if the message was new, false if already known.
   */
  receiveFromPeer(message: AgentMessage): boolean {
    this._ensureLoaded();

    // Deduplicate by message ID
    for (const [, existing] of localStore) {
      if (existing.id === message.id) return false;
    }

    if (this._isExpired(message)) return false;

    // Ensure sender is populated
    if (!message.sender?.trim()) message.sender = DEFAULT_SENDER;

    // Clamp TTL to max
    message.ttlSeconds = Math.min(Math.max(1, message.ttlSeconds ?? DEFAULT_TTL_SECONDS), MAX_TTL_SECONDS);

    const key = `msg/${message.channel}/${new Date(message.createdAt).getTime()}-${message.id}`;
    localStore.set(key, message);

    // Persist to JSONL
    if (messageWatcher) messageWatcher.markSelfWrite();
    appendMessageToLog(message);

    logger.debug(`[Mailbox] Received peer message ${message.id} on channel '${message.channel}'`);
    return true;
  }

  /**
   * Read messages from a channel, optionally filtering by recipient and read status.
   * If local store has no results, fans out to all peers.
   */
  async read(opts: ReadMessagesOptions): Promise<AgentMessage[]> {
    this._ensureLoaded();
    this._pruneExpired();

    const prefix = `msg/${opts.channel}/`;
    const limit = opts.limit ?? 50;

    // includeRead=true overrides unreadOnly to false (intuitive alias)
    const skipRead = opts.includeRead ? false : (opts.unreadOnly ?? true);

    // Collect from local store
    let messages: AgentMessage[] = [];

    for (const [key, msg] of localStore) {
      if (!key.startsWith(prefix)) continue;
      if (!this._isRecipient(msg, opts.reader)) continue;
      if (skipRead && msg.readBy?.includes(opts.reader)) continue;
      messages.push(msg);
    }

    // If local store had nothing, fan-out read from peers
    if (messages.length === 0) {
      const peerMessages = await fanOutRead(opts);
      // Merge, deduplicating by ID
      const knownIds = new Set(messages.map(m => m.id));
      let cached = 0;
      for (const msg of peerMessages) {
        if (knownIds.has(msg.id)) continue;
        if (!this._isRecipient(msg, opts.reader)) continue;
        if (skipRead && msg.readBy?.includes(opts.reader)) continue;
        messages.push(msg);
        knownIds.add(msg.id);
        // Cache locally (Map deduplicates by key)
        const key = `msg/${msg.channel}/${new Date(msg.createdAt).getTime()}-${msg.id}`;
        if (!localStore.has(key)) {
          localStore.set(key, msg);
          cached++;
        }
      }
      // Batch-persist new peer messages (single rewrite instead of per-message append)
      if (cached > 0) {
        if (messageWatcher) messageWatcher.markSelfWrite();
        rewriteMessageLog(Array.from(localStore.values()));
      }
    }

    // Sort by createdAt ascending (oldest first)
    messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    messages = messages.slice(0, limit);

    // Mark as read if requested
    if (opts.markRead) {
      let changed = false;
      for (const msg of messages) {
        if (!msg.readBy) msg.readBy = [];
        if (!msg.readBy.includes(opts.reader)) {
          msg.readBy.push(opts.reader);
          changed = true;
        }
      }
      // Persist readBy changes to disk
      if (changed) {
        if (messageWatcher) messageWatcher.markSelfWrite();
        rewriteMessageLog(Array.from(localStore.values()));
      }
    }

    return messages;
  }

  /**
   * Peek at a channel's metadata without filtering by reader.
   * Returns senders, recipients, and message count — useful for diagnostics
   * when a read returns 0 results but the channel has messages.
   */
  peekChannel(channel: string): { messageCount: number; senders: string[]; recipients: string[] } | undefined {
    this._ensureLoaded();
    const prefix = `msg/${channel}/`;
    const senders = new Set<string>();
    const recipients = new Set<string>();
    let count = 0;

    for (const [key, msg] of localStore) {
      if (!key.startsWith(prefix)) continue;
      count++;
      senders.add(msg.sender);
      for (const r of msg.recipients) recipients.add(r);
    }

    if (count === 0) return undefined;
    return {
      messageCount: count,
      senders: Array.from(senders),
      recipients: Array.from(recipients),
    };
  }

  /**
   * List available channels with message counts.
   */
  listChannels(): Array<{ channel: string; messageCount: number; latestAt: string }> {
    this._ensureLoaded();
    this._pruneExpired();

    const channelMap = new Map<string, { count: number; latestAt: string }>();

    for (const [, msg] of localStore) {
      const existing = channelMap.get(msg.channel);
      if (!existing) {
        channelMap.set(msg.channel, { count: 1, latestAt: msg.createdAt });
      } else {
        existing.count++;
        if (msg.createdAt > existing.latestAt) {
          existing.latestAt = msg.createdAt;
        }
      }
    }

    return Array.from(channelMap.entries())
      .map(([channel, info]) => ({ channel, messageCount: info.count, latestAt: info.latestAt }))
      .sort((a, b) => b.latestAt.localeCompare(a.latestAt));
  }

  /**
   * Acknowledge / mark specific messages as read by a reader.
   */
  ack(messageIds: string[], reader: string): number {
    this._ensureLoaded();
    let count = 0;
    for (const [, msg] of localStore) {
      if (messageIds.includes(msg.id)) {
        if (!msg.readBy) msg.readBy = [];
        if (!msg.readBy.includes(reader)) {
          msg.readBy.push(reader);
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Get message count for a reader (total and unread).
   */
  getStats(reader: string, channel?: string): { total: number; unread: number; channels: number } {
    this._ensureLoaded();
    this._pruneExpired();

    let total = 0;
    let unread = 0;
    const channels = new Set<string>();

    for (const [, msg] of localStore) {
      if (channel && msg.channel !== channel) continue;
      if (!this._isRecipient(msg, reader)) continue;
      total++;
      channels.add(msg.channel);
      if (!msg.readBy?.includes(reader)) {
        unread++;
      }
    }

    return { total, unread, channels: channels.size };
  }

  /**
   * Get a single message by its ID.
   */
  getById(id: string): AgentMessage | undefined {
    this._ensureLoaded();
    for (const [, msg] of localStore) {
      if (msg.id === id) return msg;
    }
    return undefined;
  }

  /**
   * Update a message in-place. Only body, recipients, payload, and persistent are mutable.
   * Returns the updated message, or undefined if not found.
   */
  updateMessage(id: string, patch: { body?: string; recipients?: string[]; payload?: Record<string, unknown>; persistent?: boolean }): AgentMessage | undefined {
    this._ensureLoaded();
    for (const [key, msg] of localStore) {
      if (msg.id === id) {
        if (patch.body !== undefined) msg.body = patch.body;
        if (patch.recipients !== undefined) msg.recipients = patch.recipients;
        if (patch.payload !== undefined) msg.payload = patch.payload;
        if (patch.persistent !== undefined) msg.persistent = patch.persistent;
        localStore.set(key, msg);
        if (messageWatcher) messageWatcher.markSelfWrite();
        rewriteMessageLog(Array.from(localStore.values()));
        logger.info(`[Mailbox] Updated message ${id}`);
        return msg;
      }
    }
    return undefined;
  }

  /**
   * Get all messages (used by API endpoint for peer fan-out reads).
   */
  getAll(): AgentMessage[] {
    this._ensureLoaded();
    this._pruneExpired();
    return Array.from(localStore.values());
  }

  /**
   * Purge all messages from this instance (local store + disk).
   * Returns the number of messages removed.
   */
  purgeAll(): number {
    this._ensureLoaded();
    const count = localStore.size;
    localStore.clear();
    if (messageWatcher) messageWatcher.markSelfWrite();
    rewriteMessageLog([]);
    logger.info(`[Mailbox] Purged all ${count} message(s)`);
    return count;
  }

  /**
   * Purge all messages on a specific channel.
   * Returns the number of messages removed.
   */
  purgeChannel(channel: string): number {
    this._ensureLoaded();
    const prefix = `msg/${channel}/`;
    const toDelete: string[] = [];
    for (const [key] of localStore) {
      if (key.startsWith(prefix)) toDelete.push(key);
    }
    for (const key of toDelete) localStore.delete(key);
    if (toDelete.length > 0) {
      if (messageWatcher) messageWatcher.markSelfWrite();
      rewriteMessageLog(Array.from(localStore.values()));
    }
    logger.info(`[Mailbox] Purged ${toDelete.length} message(s) from channel '${channel}'`);
    return toDelete.length;
  }

  /**
   * Delete specific messages by ID.
   * Returns the number of messages removed.
   */
  deleteMessages(ids: string[]): number {
    this._ensureLoaded();
    const idSet = new Set(ids);
    const toDelete: string[] = [];
    for (const [key, msg] of localStore) {
      if (idSet.has(msg.id)) toDelete.push(key);
    }
    for (const key of toDelete) localStore.delete(key);
    if (toDelete.length > 0) {
      if (messageWatcher) messageWatcher.markSelfWrite();
      rewriteMessageLog(Array.from(localStore.values()));
    }
    logger.info(`[Mailbox] Deleted ${toDelete.length} message(s)`);
    return toDelete.length;
  }

  // ---- TTL sweep ----

  /** Start periodic TTL sweep (called once on first load or by server startup) */
  startSweep(): void {
    if (sweepTimer) return;
    sweepTimer = setInterval(() => {
      this._pruneExpired();
    }, SWEEP_INTERVAL_MS);
    // Allow the process to exit even if timer is running
    if (sweepTimer && typeof sweepTimer === 'object' && 'unref' in sweepTimer) {
      sweepTimer.unref();
    }
    logger.debug('[Mailbox] TTL sweep started (every 60s)');
  }

  /** Stop periodic TTL sweep and close file watcher */
  stopSweep(): void {
    if (sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
      logger.debug('[Mailbox] TTL sweep stopped');
    }
    if (messageWatcher) {
      messageWatcher.close();
      messageWatcher = null;
    }
  }

  // ---- Internal helpers ----

  /**
   * Reload messages from disk when another instance writes to messages.jsonl.
   * Merges new messages into the in-memory store without duplicating existing ones.
   */
  _reloadFromDisk(): void {
    const diskMessages = loadMessagesFromLog();
    const existingIds = new Set<string>();
    for (const [, msg] of localStore) {
      existingIds.add(msg.id);
    }
    let added = 0;
    for (const msg of diskMessages) {
      if (!msg.channel || !msg.id || existingIds.has(msg.id) || this._isExpired(msg)) continue;
      const key = `msg/${msg.channel}/${new Date(msg.createdAt).getTime()}-${msg.id}`;
      localStore.set(key, msg);
      existingIds.add(msg.id);
      added++;
    }
    if (added > 0) {
      logger.info(`[Mailbox] Reloaded from disk: ${added} new message(s) merged`);
    }
    // Also update readBy / body changes for existing messages
    for (const msg of diskMessages) {
      if (!msg.id) continue;
      for (const [, existing] of localStore) {
        if (existing.id === msg.id) {
          // Merge readBy arrays
          if (msg.readBy) {
            if (!existing.readBy) existing.readBy = [];
            for (const r of msg.readBy) {
              if (!existing.readBy.includes(r)) existing.readBy.push(r);
            }
          }
          // Update mutable fields if changed externally
          if (msg.body !== undefined) existing.body = msg.body;
          if (msg.persistent !== undefined) existing.persistent = msg.persistent;
          break;
        }
      }
    }
  }

  _isRecipient(msg: AgentMessage, reader: string): boolean {
    // Wildcard reader sees all messages (dashboard / admin view)
    if (reader === '*') return true;
    // Broadcast messages are visible to everyone
    if (msg.recipients.includes('*')) return true;
    // Directed messages are visible to sender and all recipients
    if (msg.sender === reader) return true;
    return msg.recipients.includes(reader);
  }

  _isExpired(msg: AgentMessage): boolean {
    if (msg.persistent) return false;
    const age = (Date.now() - new Date(msg.createdAt).getTime()) / 1000;
    return age > (msg.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  }

  private _pruneExpired(): void {
    const toDelete: string[] = [];
    for (const [key, msg] of localStore) {
      if (this._isExpired(msg)) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) {
      localStore.delete(key);
    }
    if (toDelete.length > 0) {
      logger.debug(`[Mailbox] Pruned ${toDelete.length} expired messages`);
      // Rewrite log without expired messages
      if (messageWatcher) messageWatcher.markSelfWrite();
      rewriteMessageLog(Array.from(localStore.values()));
    }
  }
}

/** Singleton mailbox */
export const agentMailbox = new AgentMailbox();

// For testing: reset internal state
export function _resetMailboxForTest(): void {
  localStore.clear();
  messageCounter = 0;
  loaded = true; // skip disk loading in tests
  agentMailbox.stopSweep();
}
