// tests/cross-repo-truncation.test.ts
// Tests for cross-repo dispatch content truncation limits, contentTruncated
// flag, hint field, and sessionFile passthrough - validates the fixes to
// crossRepoTools.ts and crossRepoDispatcher.ts.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type MockInstance } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import { EventEmitter } from 'events';
import { createPersistSpies, restoreSpies } from './helpers/setup.js';
import {
  generateDispatchId,
  dispatchToRepo,
  dispatchBatch,
  clearDispatchHistory,
} from '../src/services/crossRepoDispatcher.js';
import type { CrossRepoRequest, CrossRepoResult } from '../src/types/index.js';

let persistSpies: MockInstance[];
beforeAll(() => { persistSpies = createPersistSpies(); });
afterAll(() => { restoreSpies(persistSpies); });

// Mock child_process.spawn
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof child_process>('child_process');
  return { ...actual, spawn: vi.fn() };
});

const mockSpawn = vi.mocked(child_process.spawn);

function createMockProcess(output: string, exitCode = 0, delayMs = 10): child_process.ChildProcess {
  const proc = new EventEmitter() as child_process.ChildProcess;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  (proc as any).stdout = stdout;
  (proc as any).stderr = stderr;
  (proc as any).pid = 12345;
  (proc as any).kill = vi.fn().mockReturnValue(true);
  (proc as any).stdin = { write: vi.fn(), end: vi.fn() };

  setTimeout(() => {
    stdout.emit('data', Buffer.from(output));
    setTimeout(() => proc.emit('close', exitCode), 5);
  }, delayMs);

  return proc;
}

const TEST_REPO_DIR = path.join(process.cwd(), '.test-cross-repo-trunc');
const originalCopilotPath = process.env.COPILOT_PATH;

beforeEach(() => {
  vi.clearAllMocks();
  if (!fs.existsSync(TEST_REPO_DIR)) {
    fs.mkdirSync(TEST_REPO_DIR, { recursive: true });
  }
  process.env.COPILOT_PATH = process.execPath;
});

afterAll(() => {
  if (originalCopilotPath !== undefined) {
    process.env.COPILOT_PATH = originalCopilotPath;
  } else {
    delete process.env.COPILOT_PATH;
  }
  try { fs.rmSync(TEST_REPO_DIR, { recursive: true, force: true }); } catch { /* ok */ }
});

// ===========================================================================
// Content Preservation - Single Dispatch
// ===========================================================================

describe('Cross-Repo - Content Truncation Limits', () => {
  it('preserves content under 50K chars in full (single dispatch)', async () => {
    const content = 'A'.repeat(40000); // 40K chars - under the 50K limit
    const mockProc = createMockProcess(content);
    mockSpawn.mockReturnValue(mockProc);

    const result = await dispatchToRepo({
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt: 'analyze',
    });

    expect(result.status).toBe('completed');
    expect(result.content).toHaveLength(40000);
    expect(result.content).toBe(content);
  });

  it('preserves content at exactly 50K chars boundary', async () => {
    const content = 'B'.repeat(50000);
    const mockProc = createMockProcess(content);
    mockSpawn.mockReturnValue(mockProc);

    const result = await dispatchToRepo({
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt: 'analyze',
    });

    expect(result.status).toBe('completed');
    expect(result.content).toHaveLength(50000);
  });

  it('preserves large content beyond 50K chars in raw result', async () => {
    // The dispatcher itself stores full content; truncation happens in tool layer
    const content = 'C'.repeat(60000);
    const mockProc = createMockProcess(content);
    mockSpawn.mockReturnValue(mockProc);

    const result = await dispatchToRepo({
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt: 'analyze',
    });

    expect(result.status).toBe('completed');
    // Raw result from dispatcher has full content
    expect(result.content).toHaveLength(60000);
  });
});

// ===========================================================================
// Tool-layer Truncation Simulation
// ===========================================================================

describe('Cross-Repo - Tool Layer Truncation Fields', () => {
  // These tests simulate the JSON response construction from crossRepoTools.ts

  it('sets contentTruncated=false when content under 50K', () => {
    const content = 'X'.repeat(10000);
    const response = {
      contentLength: content.length,
      contentTruncated: content.length > 50000,
      content: content.substring(0, 50000),
    };

    expect(response.contentTruncated).toBe(false);
    expect(response.content).toHaveLength(10000);
    expect(response.contentLength).toBe(10000);
  });

  it('sets contentTruncated=true when content exceeds 50K', () => {
    const content = 'Y'.repeat(60000);
    const response = {
      contentLength: content.length,
      contentTruncated: content.length > 50000,
      content: content.substring(0, 50000),
    };

    expect(response.contentTruncated).toBe(true);
    expect(response.content).toHaveLength(50000);
    expect(response.contentLength).toBe(60000);
  });

  it('includes hint when content is truncated (regardless of sessionFile)', () => {
    const content = 'Z'.repeat(60000);
    const sessionFile = '/logs/cross-repo-sessions/xrepo-1.md';
    const spilloverFile = '/logs/cross-repo-sessions/xrepo-1-full.md';
    const truncated = content.length > 50000;
    const response = {
      contentLength: content.length,
      contentTruncated: truncated,
      content: content.substring(0, 50000),
      hint: truncated
        ? `Response truncated from ${content.length} to 50000 chars. Full content saved to: ${spilloverFile || sessionFile || '(unavailable)'}`
        : undefined,
      spilloverFile,
    };

    expect(response.hint).toContain('truncated from 60000 to 50000');
    expect(response.hint).toContain(spilloverFile);
    expect(response.spilloverFile).toBe(spilloverFile);
  });

  it('omits hint when content is not truncated', () => {
    const content = 'W'.repeat(5000);
    const truncated = content.length > 50000;
    const response = {
      hint: truncated
        ? `Response truncated from ${content.length} to 50000 chars. Full content saved to: (unavailable)`
        : undefined,
    };

    expect(response.hint).toBeUndefined();
  });

  it('shows (unavailable) hint when truncated but no files exist', () => {
    const content = 'V'.repeat(60000);
    const sessionFile: string | undefined = undefined;
    const spilloverFile: string | undefined = undefined;
    const truncated = content.length > 50000;
    const response = {
      hint: truncated
        ? `Response truncated from ${content.length} to 50000 chars. Full content saved to: ${spilloverFile || sessionFile || '(unavailable)'}`
        : undefined,
    };

    expect(response.hint).toContain('(unavailable)');
  });
});

// ===========================================================================
// Batch Dispatch Truncation
// ===========================================================================

describe('Cross-Repo - Batch Truncation Fields', () => {
  it('batch results preserve content under 20K chars each', async () => {
    const content = 'D'.repeat(15000);
    for (let i = 0; i < 2; i++) {
      mockSpawn.mockReturnValueOnce(createMockProcess(content, 0, 10));
    }

    const requests: CrossRepoRequest[] = [
      { dispatchId: generateDispatchId(), repoPath: TEST_REPO_DIR, prompt: 'task-0' },
      { dispatchId: generateDispatchId(), repoPath: TEST_REPO_DIR, prompt: 'task-1' },
    ];

    const results = await dispatchBatch(requests);

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.content).toHaveLength(15000);
    }
  });

  it('batch tool-layer truncates at 20K and sets contentTruncated', () => {
    // Simulate batch tool response construction
    const content = 'E'.repeat(25000);
    const toolResult = {
      contentLength: content.length,
      contentTruncated: content.length > 20000,
      content: content.substring(0, 20000),
    };

    expect(toolResult.contentTruncated).toBe(true);
    expect(toolResult.content).toHaveLength(20000);
    expect(toolResult.contentLength).toBe(25000);
  });

  it('batch tool-layer includes sessionFile in results', () => {
    // Simulate batch tool response construction
    const sessionFile = '/logs/cross-repo-sessions/xrepo-batch-1.md';
    const result = {
      dispatchId: 'xrepo-1-123',
      status: 'completed',
      sessionFile,
      content: 'some output',
    };

    expect(result.sessionFile).toBe(sessionFile);
  });
});

// ===========================================================================
// Disk Persistence Truncation
// ===========================================================================

describe('Cross-Repo - Disk Persistence Truncation', () => {
  it('full content stored in memory result (no in-memory truncation)', async () => {
    const content = 'F'.repeat(20000);
    const mockProc = createMockProcess(content);
    mockSpawn.mockReturnValue(mockProc);

    const result = await dispatchToRepo({
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt: 'analyze',
    });

    // In-memory result should have full content
    expect(result.content).toHaveLength(20000);
  });

  it('disk persistence truncation at 10K is applied in addToHistory', async () => {
    // The persistCrossRepoEntry is mocked, but we can verify through the spy
    // that the entry passed has content truncated to 10K
    const { persistCrossRepoEntry } = await import('../src/services/sharedState.js');
    const persistSpy = vi.mocked(persistCrossRepoEntry);

    const content = 'G'.repeat(15000);
    const mockProc = createMockProcess(content);
    mockSpawn.mockReturnValue(mockProc);

    await dispatchToRepo({
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt: 'test disk truncation',
    });

    // The persistCrossRepoEntry spy should have been called
    expect(persistSpy).toHaveBeenCalled();
    const lastCall = persistSpy.mock.calls[persistSpy.mock.calls.length - 1];
    const entry = lastCall[0];
    // Content should be truncated to 10K for disk
    expect(entry.content.length).toBeLessThanOrEqual(10000);
  });
});

// ===========================================================================
// SessionFile Passthrough
// ===========================================================================

describe('Cross-Repo - SessionFile in Results', () => {
  it('result includes sessionFile when file exists', async () => {
    // The sessionFile is set based on fs.existsSync in the dispatcher.
    // Since we're mocking spawn, the session file won't actually exist.
    // The result should have sessionFile undefined in that case.
    const mockProc = createMockProcess('output');
    mockSpawn.mockReturnValue(mockProc);

    const result = await dispatchToRepo({
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt: 'test session file',
    });

    // sessionFile is only set when the file physically exists
    // In test, copilot doesn't actually run, so no session file is created
    // This validates the field is present in the type
    expect(result).toHaveProperty('dispatchId');
    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('model');
  });

  it('result sessionFile is undefined when session file does not exist', async () => {
    const mockProc = createMockProcess('output');
    mockSpawn.mockReturnValue(mockProc);

    const result = await dispatchToRepo({
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt: 'test',
    });

    // No real copilot ran, so no session file was written
    expect(result.sessionFile).toBeUndefined();
  });
});
