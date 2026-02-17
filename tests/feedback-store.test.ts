// tests/feedback-store.test.ts
// Feedback store - submit, list, get, update, persistence, cross-instance reload.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  initFeedbackStore,
  addFeedback,
  listFeedback,
  getFeedback,
  updateFeedbackStatus,
  feedbackStats,
} from '../src/services/feedbackStore.js';
import type { FeedbackEntry } from '../src/services/feedbackStore.js';

// Use a temp directory for each test to isolate disk state
let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(process.cwd(), `.test-feedback-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  initFeedbackStore(tmpDir);
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
});

// ===========================================================================
// Submit & Retrieve
// ===========================================================================

describe('Feedback Store - Submit & Retrieve', () => {
  it('submits feedback and returns entry with generated ID', async () => {
    const entry = await addFeedback('bug', 'Test Bug', 'Something broke');
    expect(entry.id).toMatch(/^fb-\d+-\d+$/);
    expect(entry.type).toBe('bug');
    expect(entry.title).toBe('Test Bug');
    expect(entry.body).toBe('Something broke');
    expect(entry.status).toBe('new');
    expect(entry.createdAt).toBeTruthy();
    expect(entry.updatedAt).toBeTruthy();
  });

  it('generates unique IDs for each submission', async () => {
    const e1 = await addFeedback('bug', 'Bug 1', 'body 1');
    const e2 = await addFeedback('bug', 'Bug 2', 'body 2');
    expect(e1.id).not.toBe(e2.id);
  });

  it('getFeedback retrieves by ID', async () => {
    const entry = await addFeedback('feature-request', 'Add X', 'Please add X');
    const retrieved = getFeedback(entry.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(entry.id);
    expect(retrieved!.title).toBe('Add X');
  });

  it('getFeedback returns undefined for unknown ID', () => {
    const result = getFeedback('fb-nonexistent-0');
    expect(result).toBeUndefined();
  });

  it('preserves metadata on submission', async () => {
    const meta = { tool: 'cross_repo_dispatch', project: 'test' };
    const entry = await addFeedback('general', 'With Meta', 'body', meta);
    const retrieved = getFeedback(entry.id);
    expect(retrieved!.metadata).toEqual(meta);
  });

  it('supports all feedback types', async () => {
    const types = ['issue', 'bug', 'feature-request', 'security', 'general'] as const;
    for (const type of types) {
      const entry = await addFeedback(type, `${type} title`, `${type} body`);
      expect(entry.type).toBe(type);
    }
    const all = listFeedback();
    expect(all).toHaveLength(5);
  });
});

// ===========================================================================
// List & Filter
// ===========================================================================

describe('Feedback Store - List & Filter', () => {
  beforeEach(async () => {
    await addFeedback('bug', 'Bug A', 'body');
    await addFeedback('feature-request', 'Feature B', 'body');
    await addFeedback('bug', 'Bug C', 'body');
    await addFeedback('security', 'Security D', 'body');
  });

  it('listFeedback returns all entries when no filter', () => {
    const all = listFeedback();
    expect(all).toHaveLength(4);
  });

  it('filters by type', () => {
    const bugs = listFeedback({ type: 'bug' });
    expect(bugs).toHaveLength(2);
    expect(bugs.every(e => e.type === 'bug')).toBe(true);
  });

  it('filters by status', async () => {
    const all = listFeedback();
    await updateFeedbackStatus(all[0].id, 'acknowledged');

    const newOnly = listFeedback({ status: 'new' });
    const ackOnly = listFeedback({ status: 'acknowledged' });
    expect(newOnly).toHaveLength(3);
    expect(ackOnly).toHaveLength(1);
  });

  it('filters by both type and status', async () => {
    const bugs = listFeedback({ type: 'bug' });
    await updateFeedbackStatus(bugs[0].id, 'resolved');

    const resolvedBugs = listFeedback({ type: 'bug', status: 'resolved' });
    expect(resolvedBugs).toHaveLength(1);

    const newBugs = listFeedback({ type: 'bug', status: 'new' });
    expect(newBugs).toHaveLength(1);
  });

  it('returns entries sorted by createdAt descending (newest first)', async () => {
    const all = listFeedback();
    for (let i = 1; i < all.length; i++) {
      expect(new Date(all[i - 1].createdAt).getTime())
        .toBeGreaterThanOrEqual(new Date(all[i].createdAt).getTime());
    }
  });

  it('returns empty array for no-match filter', () => {
    const general = listFeedback({ type: 'general' });
    expect(general).toHaveLength(0);
  });
});

// ===========================================================================
// Update Status
// ===========================================================================

describe('Feedback Store - Update Status', () => {
  it('updates status and updatedAt timestamp', async () => {
    const entry = await addFeedback('bug', 'Status Test', 'body');
    const originalUpdatedAt = entry.updatedAt;

    // Small delay to ensure different timestamp
    await new Promise(r => setTimeout(r, 10));

    const updated = updateFeedbackStatus(entry.id, 'acknowledged');
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('acknowledged');
    expect(new Date(updated!.updatedAt).getTime())
      .toBeGreaterThanOrEqual(new Date(originalUpdatedAt).getTime());
  });

  it('returns undefined for unknown ID', () => {
    const result = updateFeedbackStatus('fb-nonexistent-0', 'resolved');
    expect(result).toBeUndefined();
  });

  it('supports all status transitions', async () => {
    const entry = await addFeedback('bug', 'Transition Test', 'body');
    const statuses = ['acknowledged', 'resolved', 'rejected', 'new'] as const;
    for (const status of statuses) {
      const updated = updateFeedbackStatus(entry.id, status);
      expect(updated!.status).toBe(status);
    }
  });
});

// ===========================================================================
// Stats
// ===========================================================================

describe('Feedback Store - Stats', () => {
  it('returns correct counts by status', async () => {
    await addFeedback('bug', 'B1', 'body');
    await addFeedback('bug', 'B2', 'body');
    await addFeedback('feature-request', 'F1', 'body');

    const all = listFeedback();
    updateFeedbackStatus(all[0].id, 'acknowledged');
    updateFeedbackStatus(all[1].id, 'resolved');

    const stats = feedbackStats();
    expect(stats.total).toBe(3);
    expect(stats.new).toBe(1);
    expect(stats.acknowledged).toBe(1);
    expect(stats.resolved).toBe(1);
  });

  it('returns total=0 when empty', () => {
    const stats = feedbackStats();
    expect(stats.total).toBe(0);
  });
});

// ===========================================================================
// Disk Persistence
// ===========================================================================

describe('Feedback Store - Disk Persistence', () => {
  it('persists entries to feedback.jsonl', async () => {
    await addFeedback('bug', 'Persist Test', 'body');
    await addFeedback('feature-request', 'Feature Test', 'body');

    const filePath = path.join(tmpDir, 'feedback.jsonl');
    expect(fs.existsSync(filePath)).toBe(true);

    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);

    const parsed0: FeedbackEntry = JSON.parse(lines[0]);
    expect(parsed0.title).toBe('Persist Test');
    expect(parsed0.type).toBe('bug');
  });

  it('reload from disk recovers entries', async () => {
    const e1 = await addFeedback('bug', 'Recover 1', 'body');
    const e2 = await addFeedback('security', 'Recover 2', 'body');

    // Re-initialize to force reload from disk
    initFeedbackStore(tmpDir);

    const all = listFeedback();
    expect(all).toHaveLength(2);
    expect(getFeedback(e1.id)).toBeDefined();
    expect(getFeedback(e2.id)).toBeDefined();
  });

  it('update appends new line to JSONL (append-only log)', async () => {
    const entry = await addFeedback('bug', 'Update Persist', 'body');
    updateFeedbackStatus(entry.id, 'resolved');

    const filePath = path.join(tmpDir, 'feedback.jsonl');
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    // 1 for create + 1 for update = 2 lines
    expect(lines).toHaveLength(2);

    // On reload, latest status wins
    initFeedbackStore(tmpDir);
    const reloaded = getFeedback(entry.id);
    expect(reloaded!.status).toBe('resolved');
  });
});

// ===========================================================================
// Cross-Instance Reload (ensureFresh)
// ===========================================================================

describe('Feedback Store - Cross-Instance Reload', () => {
  it('picks up entries written directly to JSONL by another process', async () => {
    // Submit one entry through the normal API
    await addFeedback('bug', 'Local Entry', 'from this instance');

    // Simulate another MCP instance writing directly to the JSONL file
    const externalEntry: FeedbackEntry = {
      id: 'fb-external-1',
      type: 'feature-request',
      title: 'External Entry',
      body: 'written by another instance',
      status: 'new',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const filePath = path.join(tmpDir, 'feedback.jsonl');
    fs.appendFileSync(filePath, JSON.stringify(externalEntry) + '\n');

    // Force the reload interval to expire by re-init
    initFeedbackStore(tmpDir);

    // Both entries should be visible
    const all = listFeedback();
    expect(all).toHaveLength(2);

    const ext = getFeedback('fb-external-1');
    expect(ext).toBeDefined();
    expect(ext!.title).toBe('External Entry');
    expect(ext!.type).toBe('feature-request');
  });

  it('update works on entry loaded from external write', async () => {
    // Write entry directly to disk (simulating external instance)
    const externalEntry: FeedbackEntry = {
      id: 'fb-external-2',
      type: 'security',
      title: 'External Security Alert',
      body: 'found a vulnerability',
      status: 'new',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const filePath = path.join(tmpDir, 'feedback.jsonl');
    fs.writeFileSync(filePath, JSON.stringify(externalEntry) + '\n');

    // Re-init to load from disk
    initFeedbackStore(tmpDir);

    // Update the externally-created entry
    const updated = updateFeedbackStatus('fb-external-2', 'acknowledged');
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('acknowledged');
  });

  it('stats reflect external entries after reload', async () => {
    // Write 3 entries directly to disk
    const filePath = path.join(tmpDir, 'feedback.jsonl');
    for (let i = 0; i < 3; i++) {
      const entry: FeedbackEntry = {
        id: `fb-ext-${i}`,
        type: 'bug',
        title: `External Bug ${i}`,
        body: 'body',
        status: i === 0 ? 'resolved' : 'new',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
    }

    // Re-init to load
    initFeedbackStore(tmpDir);

    const stats = feedbackStats();
    expect(stats.total).toBe(3);
    expect(stats.new).toBe(2);
    expect(stats.resolved).toBe(1);
  });
});
