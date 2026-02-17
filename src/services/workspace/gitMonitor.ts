// mcp-agent-manager/src/services/workspace/gitMonitor.ts
// Git directory watching, remote fetch polling, and ref tracking

import { watch, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../logger.js';
import { eventBus } from '../events.js';
import type { MonitoredWorkspace } from './types.js';
import { MAX_RECENT, FETCH_INTERVAL_MS } from './types.js';

const execFileAsync = promisify(execFile);

// ── Git helpers ────────────────────────────────────────────────────────

export function readGitHead(gitDir: string): string {
  try {
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf-8').trim();
    if (head.startsWith('ref: refs/heads/')) {
      return head.replace('ref: refs/heads/', '');
    }
    return head.substring(0, 7); // detached HEAD
  } catch {
    return 'unknown';
  }
}

export function readGitRef(gitDir: string, branchName: string): string | null {
  try {
    const refPath = join(gitDir, 'refs', 'heads', branchName);
    if (existsSync(refPath)) {
      return readFileSync(refPath, 'utf-8').trim();
    }
  } catch { /* ignore */ }
  return null;
}

// ── Git directory watcher ──────────────────────────────────────────────

export function watchGit(ws: MonitoredWorkspace, gitDir: string): void {
  let lastHead = readGitHead(gitDir);
  let lastRef = readGitRef(gitDir, lastHead);

  const filesToWatch = ['HEAD', 'COMMIT_EDITMSG', 'MERGE_HEAD', 'REBASE_HEAD'];

  try {
    const watcher = watch(gitDir, { recursive: false }, (_eventType, filename) => {
      if (!filename || !filesToWatch.includes(filename)) return;

      const now = new Date().toISOString();
      let event = 'unknown';
      let detail = '';

      if (filename === 'HEAD') {
        const newHead = readGitHead(gitDir);
        if (newHead !== lastHead) {
          event = 'branch-switch';
          detail = `${lastHead} → ${newHead}`;
          lastHead = newHead;
        } else {
          const newRef = readGitRef(gitDir, newHead);
          if (newRef !== lastRef) {
            event = 'commit';
            detail = `${newHead}: ${lastRef?.substring(0, 7)} → ${newRef?.substring(0, 7)}`;
            lastRef = newRef;
          }
        }
      } else if (filename === 'COMMIT_EDITMSG') {
        event = 'commit-message';
        try {
          detail = readFileSync(join(gitDir, filename), 'utf-8').trim().substring(0, 120);
        } catch { detail = '(unreadable)'; }
      } else if (filename === 'MERGE_HEAD') {
        event = 'merge';
        detail = 'Merge in progress';
      } else if (filename === 'REBASE_HEAD') {
        event = 'rebase';
        detail = 'Rebase in progress';
      }

      if (event !== 'unknown') {
        const gitEvt = { ts: now, event, detail };
        ws.gitEvents.unshift(gitEvt);
        if (ws.gitEvents.length > MAX_RECENT) ws.gitEvents.pop();

        eventBus.emitEvent('workspace:git-event', {
          path: ws.path,
          event,
          detail,
        });
      }
    });

    ws.watchers.push(watcher);
    logger.debug(`Watching git: ${gitDir}`);
  } catch (err) {
    logger.warn(`Failed to watch git dir: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Watch refs/heads for commit updates
  const refsDir = join(gitDir, 'refs', 'heads');
  if (existsSync(refsDir)) {
    try {
      const refsWatcher = watch(refsDir, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        const now = new Date().toISOString();
        const newRef = readGitRef(gitDir, lastHead);
        if (newRef && newRef !== lastRef) {
          const gitEvt = {
            ts: now,
            event: 'commit',
            detail: `${lastHead}: ${lastRef?.substring(0, 7)} → ${newRef?.substring(0, 7)}`,
          };
          ws.gitEvents.unshift(gitEvt);
          if (ws.gitEvents.length > MAX_RECENT) ws.gitEvents.pop();

          eventBus.emitEvent('workspace:git-event', {
            path: ws.path,
            event: 'commit',
            detail: gitEvt.detail,
          });
          lastRef = newRef;
        }
      });

      ws.watchers.push(refsWatcher);
      logger.debug(`Watching git refs: ${refsDir}`);
    } catch (err) {
      logger.warn(`Failed to watch refs dir: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ── Remote fetch polling ───────────────────────────────────────────────

export function startRemoteFetch(ws: MonitoredWorkspace, gitDir: string): void {
  snapshotRemoteRefs(ws, gitDir);

  setTimeout(() => doRemoteFetch(ws, gitDir), 10_000);

  ws.fetchTimer = setInterval(() => {
    doRemoteFetch(ws, gitDir);
  }, FETCH_INTERVAL_MS);

  if (ws.fetchTimer && typeof ws.fetchTimer === 'object' && 'unref' in ws.fetchTimer) {
    ws.fetchTimer.unref();
  }

  logger.info(`Remote fetch polling started for ${ws.path} (every ${FETCH_INTERVAL_MS / 1000}s)`);
}

function snapshotRemoteRefs(ws: MonitoredWorkspace, gitDir: string): void {
  const remotesDir = join(gitDir, 'refs', 'remotes');
  if (!existsSync(remotesDir)) return;

  try {
    const remotes = readdirSync(remotesDir, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const remote of remotes) {
      const remoteDir = join(remotesDir, remote.name);
      readRemoteBranches(ws, remote.name, remoteDir);
    }
    logger.debug(`Snapshotted ${ws.remoteRefs.size} remote refs for ${ws.path}`);
  } catch (err) {
    logger.debug(`Failed to snapshot remote refs: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function readRemoteBranches(ws: MonitoredWorkspace, remoteName: string, remoteDir: string): void {
  try {
    const entries = readdirSync(remoteDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name !== 'HEAD') {
        try {
          const ref = readFileSync(join(remoteDir, entry.name), 'utf-8').trim();
          ws.remoteRefs.set(`${remoteName}/${entry.name}`, ref);
        } catch { /* ignore */ }
      } else if (entry.isDirectory()) {
        readRemoteBranches(ws, `${remoteName}/${entry.name}`, join(remoteDir, entry.name));
      }
    }
  } catch { /* ignore */ }
}

async function doRemoteFetch(ws: MonitoredWorkspace, gitDir: string): Promise<void> {
  try {
    logger.debug(`Running git fetch --all for ${ws.path}`);
    await execFileAsync('git', ['fetch', '--all', '--prune'], {
      cwd: ws.path,
      timeout: 30_000,
    });

    const oldRefs = new Map(ws.remoteRefs);
    ws.remoteRefs.clear();
    snapshotRemoteRefs(ws, gitDir);

    let changeCount = 0;

    // Detect changed refs
    for (const [key, newRef] of ws.remoteRefs) {
      const oldRef = oldRefs.get(key);
      if (oldRef && oldRef !== newRef) {
        changeCount++;
        const [remote, ...branchParts] = key.split('/');
        const branch = branchParts.join('/');
        const detail = `${key}: ${oldRef.substring(0, 7)} → ${newRef.substring(0, 7)}`;

        const gitEvt = { ts: new Date().toISOString(), event: 'remote-update', detail };
        ws.gitEvents.unshift(gitEvt);
        if (ws.gitEvents.length > MAX_RECENT) ws.gitEvents.pop();

        eventBus.emitEvent('workspace:remote-update', {
          path: ws.path, remote, branch, oldRef, newRef, detail,
        });
        logger.info(`[Remote] ${ws.path}: ${detail}`);
      }
    }

    // Detect new branches
    for (const [key, newRef] of ws.remoteRefs) {
      if (!oldRefs.has(key)) {
        changeCount++;
        const [remote, ...branchParts] = key.split('/');
        const branch = branchParts.join('/');
        const detail = `${key}: new branch (${newRef.substring(0, 7)})`;

        const gitEvt = { ts: new Date().toISOString(), event: 'remote-new-branch', detail };
        ws.gitEvents.unshift(gitEvt);
        if (ws.gitEvents.length > MAX_RECENT) ws.gitEvents.pop();

        eventBus.emitEvent('workspace:remote-update', {
          path: ws.path, remote, branch, oldRef: '', newRef, detail,
        });
        logger.info(`[Remote] ${ws.path}: ${detail}`);
      }
    }

    // Detect deleted branches
    for (const [key, oldRef] of oldRefs) {
      if (!ws.remoteRefs.has(key)) {
        changeCount++;
        const [remote, ...branchParts] = key.split('/');
        const branch = branchParts.join('/');
        const detail = `${key}: branch deleted (was ${oldRef.substring(0, 7)})`;

        const gitEvt = { ts: new Date().toISOString(), event: 'remote-branch-deleted', detail };
        ws.gitEvents.unshift(gitEvt);
        if (ws.gitEvents.length > MAX_RECENT) ws.gitEvents.pop();

        eventBus.emitEvent('workspace:remote-update', {
          path: ws.path, remote, branch, oldRef, newRef: '', detail,
        });
        logger.info(`[Remote] ${ws.path}: ${detail}`);
      }
    }

    if (changeCount === 0) {
      logger.debug(`git fetch complete for ${ws.path}: no remote changes`);
      const gitEvt = { ts: new Date().toISOString(), event: 'fetch-ok', detail: `no remote changes (${ws.remoteRefs.size} refs)` };
      ws.gitEvents.unshift(gitEvt);
      if (ws.gitEvents.length > MAX_RECENT) ws.gitEvents.pop();
    } else {
      logger.info(`git fetch complete for ${ws.path}: ${changeCount} remote change(s)`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`git fetch failed for ${ws.path}: ${msg}`);

    const gitEvt = { ts: new Date().toISOString(), event: 'fetch-failed', detail: msg };
    ws.gitEvents.unshift(gitEvt);
    if (ws.gitEvents.length > MAX_RECENT) ws.gitEvents.pop();

    eventBus.emitEvent('workspace:git-event', {
      path: ws.path, event: 'fetch-failed', detail: msg,
    });
  }
}
