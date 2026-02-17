// mcp-agent-manager/src/services/mailboxPersistence.ts
// JSONL persistence, peer discovery, and HTTP helpers for AgentMailbox.
// Now delegates to the StorageManager for dual-backend (disk / mcp-index / both).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from './logger.js';
import { getStateDir } from './dataDir.js';
import { getStorageManager } from './storage/index.js';
import type { AgentMessage, ReadMessagesOptions } from './mailboxTypes.js';

// ---------------------------------------------------------------------------
// Storage-backed persistence (delegates to StorageManager)
// ---------------------------------------------------------------------------

export function appendMessageToLog(message: AgentMessage): void {
  const mgr = getStorageManager();
  mgr.appendMessage(message).catch((err: any) => {
    logger.warn(`[Mailbox] Failed to persist message: ${err.message}`);
  });
}

export function loadMessagesFromLog(): AgentMessage[] {
  // Synchronous load - start async load but also do sync disk fallback
  // for backwards compatibility with the synchronous _ensureLoaded() call path.
  const mgr = getStorageManager();
  const backend = mgr.getBackend();

  // For disk-only, load synchronously from disk for compat
  if (backend === 'disk') {
    return _loadMessagesFromDiskSync();
  }

  // For mcp-index or both: attempt async load with disk sync fallback
  // We kick off the async load but return sync disk result immediately.
  // The async result will be merged once the mailbox starts operating.
  const diskMessages = _loadMessagesFromDiskSync();

  // Fire async load (merged by caller later if needed)
  _asyncLoadFromStorage().catch(() => {});

  return diskMessages;
}

/** Async load from StorageManager - call this for non-blocking index load */
export async function loadMessagesAsync(): Promise<AgentMessage[]> {
  return getStorageManager().loadMessages();
}

export function rewriteMessageLog(messages: AgentMessage[]): void {
  const mgr = getStorageManager();
  mgr.rewriteMessages(messages).catch((err: any) => {
    logger.warn(`[Mailbox] Failed to rewrite message log: ${err.message}`);
  });
}

// ---------------------------------------------------------------------------
// Sync disk fallback (for backwards compat with synchronous load path)
// ---------------------------------------------------------------------------

function _getMessagesFile(): string {
  return path.join(getStateDir(), 'messages.jsonl');
}

/** Public accessor for the messages JSONL file path (used by ConfigWatcher) */
export function getMessagesFilePath(): string {
  return _getMessagesFile();
}

function _loadMessagesFromDiskSync(): AgentMessage[] {
  try {
    const file = _getMessagesFile();
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf-8');
    const lines = raw.trim().split('\n').filter(l => l.trim());
    const messages: AgentMessage[] = [];
    for (const line of lines) {
      try {
        messages.push(JSON.parse(line));
      } catch { /* skip corrupt lines */ }
    }
    return messages;
  } catch {
    return [];
  }
}

let _asyncLoadPromise: Promise<void> | null = null;
let _asyncLoadedMessages: AgentMessage[] | null = null;

async function _asyncLoadFromStorage(): Promise<void> {
  if (_asyncLoadPromise) return _asyncLoadPromise;
  _asyncLoadPromise = (async () => {
    try {
      _asyncLoadedMessages = await getStorageManager().loadMessages();
      logger.debug(`[Mailbox] Async storage load: ${_asyncLoadedMessages.length} messages`);
    } catch (err: any) {
      logger.warn(`[Mailbox] Async storage load failed: ${err.message}`);
    }
  })();
  return _asyncLoadPromise;
}

/** Get messages from the async storage load (returns null if not ready) */
export function getAsyncLoadedMessages(): AgentMessage[] | null {
  return _asyncLoadedMessages;
}

/** Reset async load state (for testing) */
export function _resetAsyncLoad(): void {
  _asyncLoadPromise = null;
  _asyncLoadedMessages = null;
}

// ---------------------------------------------------------------------------
// Peer discovery - reads dashboard port files from shared state dir
// ---------------------------------------------------------------------------

export interface PeerInstance {
  pid: number;
  port: number;
  startedAt: string;
  cwd?: string;
}

export function discoverPeers(): PeerInstance[] {
  const peers: PeerInstance[] = [];
  try {
    const stateDir = getStateDir();
    if (!fs.existsSync(stateDir)) return peers;
    const files = fs.readdirSync(stateDir).filter(f => f.startsWith('dashboard-') && f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(stateDir, file), 'utf-8');
        const entry: PeerInstance = JSON.parse(raw);
        if (entry.pid === process.pid) continue;
        try { process.kill(entry.pid, 0); } catch { continue; }
        peers.push(entry);
      } catch { /* skip corrupt files */ }
    }
  } catch { /* best-effort */ }
  return peers;
}

// ---------------------------------------------------------------------------
// HTTP helpers for peer communication
// ---------------------------------------------------------------------------

export async function postToPeer(port: number, urlPath: string, body: unknown): Promise<boolean> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function getFromPeer<T>(port: number, urlPath: string): Promise<T | null> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return null;
    return await resp.json() as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Peer messaging helpers
// ---------------------------------------------------------------------------

/** Broadcast a message to all discovered peer instances (fire-and-forget) */
export function broadcastToPeers(message: AgentMessage): void {
  const peers = discoverPeers();
  if (peers.length === 0) return;
  logger.debug(`[Mailbox] Broadcasting message ${message.id} to ${peers.length} peer(s)`);
  for (const peer of peers) {
    postToPeer(peer.port, '/api/messages/inbound', message).catch(() => {});
  }
}

/** Fan-out read: query all peers for messages on a channel */
export async function fanOutRead(opts: ReadMessagesOptions): Promise<AgentMessage[]> {
  const peers = discoverPeers();
  if (peers.length === 0) return [];
  const params = new URLSearchParams({
    reader: opts.reader,
    unreadOnly: String(opts.unreadOnly ?? true),
    limit: String(opts.limit ?? 50),
  });
  const results = await Promise.allSettled(
    peers.map(peer =>
      getFromPeer<{ messages: AgentMessage[] }>(
        peer.port,
        `/api/messages/${encodeURIComponent(opts.channel)}?${params}`
      )
    )
  );
  const messages: AgentMessage[] = [];
  const seenIds = new Set<string>();
  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value?.messages) continue;
    for (const msg of result.value.messages) {
      if (seenIds.has(msg.id)) continue;
      seenIds.add(msg.id);
      messages.push(msg);
    }
  }
  return messages;
}
