// tests/cross-repo.test.ts
// Cross-repo dispatcher - unit + integration tests covering dispatch,
// cancellation, history, copilot resolution, and CLI arg construction.

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
  cancelDispatch,
  getDispatchStatus,
  getDispatchHistory,
  getActiveDispatches,
  isCopilotAvailable,
  getCopilotPath,
  cancelAllDispatches,
} from '../src/services/crossRepoDispatcher.js';
import type { CrossRepoRequest } from '../src/types/index.js';

let persistSpies: MockInstance[];
beforeAll(() => { persistSpies = createPersistSpies(); });
afterAll(() => { restoreSpies(persistSpies); });

// Mock child_process.spawn so no real copilot is needed
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof child_process>('child_process');
  return { ...actual, spawn: vi.fn() };
});

const mockSpawn = vi.mocked(child_process.spawn);

/** Create a mock child process that completes with given output */
function createMockProcess(
  output: string,
  exitCode: number = 0,
  delayMs: number = 10,
): child_process.ChildProcess {
  const proc = new EventEmitter() as child_process.ChildProcess;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  (proc as any).stdout = stdout;
  (proc as any).stderr = stderr;
  (proc as any).pid = 12345;
  (proc as any).kill = vi.fn().mockReturnValue(true);
  (proc as any).stdin = { write: vi.fn(), end: vi.fn() };

  // Emit stdout data then close after delay
  setTimeout(() => {
    stdout.emit('data', Buffer.from(output));
    setTimeout(() => {
      proc.emit('close', exitCode);
    }, 5);
  }, delayMs);

  return proc;
}

/** Create a mock process that hangs (for timeout tests) */
function createHangingProcess(): child_process.ChildProcess {
  const proc = new EventEmitter() as child_process.ChildProcess;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  (proc as any).stdout = stdout;
  (proc as any).stderr = stderr;
  (proc as any).pid = 99999;
  (proc as any).kill = vi.fn().mockImplementation(() => {
    // On kill, emit close
    setTimeout(() => proc.emit('close', null), 10);
    return true;
  });
  (proc as any).stdin = { write: vi.fn(), end: vi.fn() };

  // Emit some partial content but never close
  setTimeout(() => {
    stdout.emit('data', Buffer.from('partial content from hanging process'));
  }, 5);

  return proc;
}

// Temp directory for test repos
const TEST_REPO_DIR = path.join(process.cwd(), '.test-cross-repo');

// Save original COPILOT_PATH
const originalCopilotPath = process.env.COPILOT_PATH;

beforeEach(() => {
  vi.clearAllMocks();

  // Ensure test repo directory exists
  if (!fs.existsSync(TEST_REPO_DIR)) {
    fs.mkdirSync(TEST_REPO_DIR, { recursive: true });
  }

  // Point COPILOT_PATH to a known executable so isCopilotAvailable() returns true
  // Use node.exe as a stand-in (it exists on all dev machines)
  process.env.COPILOT_PATH = process.execPath;
});

afterAll(() => {
  // Restore original env
  if (originalCopilotPath !== undefined) {
    process.env.COPILOT_PATH = originalCopilotPath;
  } else {
    delete process.env.COPILOT_PATH;
  }
  // Clean up test directory
  try { fs.rmSync(TEST_REPO_DIR, { recursive: true, force: true }); } catch { /* ok */ }
});

// ===========================================================================
// Dispatch ID Generation
// ===========================================================================

describe('Cross-Repo - Dispatch ID Generation', () => {
  it('generates unique IDs with xrepo prefix', () => {
    const id1 = generateDispatchId();
    const id2 = generateDispatchId();
    expect(id1).toMatch(/^xrepo-\d+-\d+$/);
    expect(id2).toMatch(/^xrepo-\d+-\d+$/);
    expect(id1).not.toBe(id2);
  });

  it('IDs have increasing counter', () => {
    const id1 = generateDispatchId();
    const id2 = generateDispatchId();
    const counter1 = parseInt(id1.split('-')[1]);
    const counter2 = parseInt(id2.split('-')[1]);
    expect(counter2).toBeGreaterThan(counter1);
  });
});

// ===========================================================================
// Dispatch Execution
// ===========================================================================

describe('Cross-Repo - Dispatch Execution', () => {
  it('successfully dispatches to a valid repo path', async () => {
    const mockProc = createMockProcess('Analysis complete: no issues found.');
    mockSpawn.mockReturnValue(mockProc);

    const request: CrossRepoRequest = {
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt: 'Analyze the codebase for security issues',
    };

    const result = await dispatchToRepo(request);

    expect(result.status).toBe('completed');
    expect(result.content).toBe('Analysis complete: no issues found.');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.repoPath).toBe(TEST_REPO_DIR);
    expect(result.dispatchId).toBe(request.dispatchId);
  });

  it('spawns copilot with correct args (read-only)', async () => {
    const mockProc = createMockProcess('done');
    mockSpawn.mockReturnValue(mockProc);

    const request: CrossRepoRequest = {
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt: 'check things',
      model: 'claude-opus-4',
      allowMutations: false,
    };

    await dispatchToRepo(request);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [, args, opts] = mockSpawn.mock.calls[0];
    expect(args).toContain('-p');
    expect(args).toContain('check things');
    expect(args).toContain('--silent');
    expect(args).toContain('--model');
    expect(args).toContain('claude-opus-4');
    expect(args).toContain('--add-dir');
    expect(args).toContain(TEST_REPO_DIR);
    expect(args).not.toContain('--yolo');
    expect(args).toContain('--allow-all-tools');
    expect(opts).toHaveProperty('cwd', TEST_REPO_DIR);
  });

  it('spawns copilot with --yolo when allowMutations=true', async () => {
    const mockProc = createMockProcess('wrote files');
    mockSpawn.mockReturnValue(mockProc);

    const request: CrossRepoRequest = {
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt: 'Add README.md',
      allowMutations: true,
    };

    await dispatchToRepo(request);

    const [, args] = mockSpawn.mock.calls[0];
    expect(args).toContain('--yolo');
    expect(args).not.toContain('--allow-all-tools');
  });

  it('includes additionalDirs and additionalMcpConfig', async () => {
    const mockProc = createMockProcess('done');
    mockSpawn.mockReturnValue(mockProc);

    const request: CrossRepoRequest = {
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt: 'test',
      additionalDirs: ['/extra/dir1', '/extra/dir2'],
      additionalMcpConfig: '/path/to/mcp-config.json',
    };

    await dispatchToRepo(request);

    const [, args] = mockSpawn.mock.calls[0];
    expect(args).toContain('/extra/dir1');
    expect(args).toContain('/extra/dir2');
    expect(args).toContain('--additional-mcp-config');
    expect(args).toContain('/path/to/mcp-config.json');
  });

  it('fails when repo path does not exist', async () => {
    const request: CrossRepoRequest = {
      dispatchId: generateDispatchId(),
      repoPath: '/nonexistent/path/that/does/not/exist',
      prompt: 'analyze',
    };

    const result = await dispatchToRepo(request);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('does not exist');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('handles process exit with non-zero code', async () => {
    const mockProc = createMockProcess('', 1, 5);
    // Also emit some stderr
    setTimeout(() => {
      (mockProc as any).stderr.emit('data', Buffer.from('Error: model not found'));
    }, 3);
    mockSpawn.mockReturnValue(mockProc);

    const request: CrossRepoRequest = {
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt: 'test',
    };

    const result = await dispatchToRepo(request);

    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('exited with code 1');
  });

  it('treats partial content on non-zero exit as success', async () => {
    const mockProc = createMockProcess('Here is a full analysis of your code...', 1, 5);
    mockSpawn.mockReturnValue(mockProc);

    const request: CrossRepoRequest = {
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt: 'analyze',
    };

    const result = await dispatchToRepo(request);

    // Content > 20 chars → treated as success despite exit code
    expect(result.status).toBe('completed');
    expect(result.content.length).toBeGreaterThan(20);
  });

  it('handles spawn error', async () => {
    const proc = new EventEmitter() as child_process.ChildProcess;
    (proc as any).stdout = new EventEmitter();
    (proc as any).stderr = new EventEmitter();
    (proc as any).pid = undefined;
    (proc as any).kill = vi.fn();
    (proc as any).stdin = { write: vi.fn(), end: vi.fn() };
    mockSpawn.mockReturnValue(proc);

    const request: CrossRepoRequest = {
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt: 'test',
    };

    // Trigger error shortly after
    setTimeout(() => proc.emit('error', new Error('ENOENT: copilot not found')), 5);

    const result = await dispatchToRepo(request);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('spawn error');
    expect(result.error).toContain('ENOENT');
  });

  it('uses default model when none specified', async () => {
    const mockProc = createMockProcess('done');
    mockSpawn.mockReturnValue(mockProc);

    const request: CrossRepoRequest = {
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt: 'test',
    };

    const result = await dispatchToRepo(request);

    expect(result.model).toBe('claude-sonnet-4');
  });
});

// ===========================================================================
// Status & History
// ===========================================================================

describe('Cross-Repo - Status & History', () => {
  it('stores completed dispatches in history', async () => {
    const mockProc = createMockProcess('result here');
    mockSpawn.mockReturnValue(mockProc);

    const request: CrossRepoRequest = {
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt: 'check',
    };

    await dispatchToRepo(request);

    const status = getDispatchStatus(request.dispatchId);
    expect(status).toBeDefined();
    expect((status as any).status).toBe('completed');
  });

  it('returns undefined for unknown dispatch ID', () => {
    expect(getDispatchStatus('xrepo-nonexistent-0')).toBeUndefined();
  });

  it('history supports limit parameter', async () => {
    // Dispatch 3 tasks
    for (let i = 0; i < 3; i++) {
      const proc = createMockProcess(`result-${i}`);
      mockSpawn.mockReturnValueOnce(proc);
      await dispatchToRepo({
        dispatchId: generateDispatchId(),
        repoPath: TEST_REPO_DIR,
        prompt: `task-${i}`,
      });
    }

    const limited = getDispatchHistory({ limit: 2 });
    expect(limited.length).toBeLessThanOrEqual(2);
  });

  it('history supports status filter', async () => {
    // One success
    const goodProc = createMockProcess('good');
    mockSpawn.mockReturnValueOnce(goodProc);
    await dispatchToRepo({
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt: 'good task',
    });

    // One fail (bad repo path)
    await dispatchToRepo({
      dispatchId: generateDispatchId(),
      repoPath: '/nonexistent/bad/path',
      prompt: 'fail task',
    });

    const completedOnly = getDispatchHistory({ status: 'completed' });
    const failedOnly = getDispatchHistory({ status: 'failed' });

    expect(completedOnly.every(d => d.status === 'completed')).toBe(true);
    expect(failedOnly.every(d => d.status === 'failed')).toBe(true);
  });

  it('history items include all expected fields', async () => {
    const mockProc = createMockProcess('detailed result');
    mockSpawn.mockReturnValue(mockProc);

    await dispatchToRepo({
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt: 'detail test',
    });

    const items = getDispatchHistory({ limit: 1 });
    expect(items.length).toBeGreaterThan(0);
    const item = items[0];
    expect(item).toHaveProperty('dispatchId');
    expect(item).toHaveProperty('repoPath');
    expect(item).toHaveProperty('status');
    expect(item).toHaveProperty('model');
    expect(item).toHaveProperty('queuedAt');
  });
});

// ===========================================================================
// Cancellation
// ===========================================================================

describe('Cross-Repo - Cancellation', () => {
  it('returns false for unknown dispatch ID', () => {
    expect(cancelDispatch('xrepo-unknown-0')).toBe(false);
  });

  it('cancelAllDispatches returns 0 when nothing active', () => {
    expect(cancelAllDispatches()).toBe(0);
  });
});

// ===========================================================================
// Active Dispatches
// ===========================================================================

describe('Cross-Repo - Active Dispatches', () => {
  it('getActiveDispatches returns empty array when none running', () => {
    const active = getActiveDispatches();
    expect(active).toEqual([]);
  });
});

// ===========================================================================
// Copilot Detection
// ===========================================================================

describe('Cross-Repo - Copilot Detection', () => {
  it('isCopilotAvailable returns boolean', () => {
    const result = isCopilotAvailable();
    expect(typeof result).toBe('boolean');
  });

  it('getCopilotPath returns string or null', () => {
    const path = getCopilotPath();
    expect(path === null || typeof path === 'string').toBe(true);
  });
});

// ===========================================================================
// Token Estimation
// ===========================================================================

describe('Cross-Repo - Token Estimation', () => {
  it('estimates tokens from prompt + content lengths', async () => {
    const prompt = 'A'.repeat(400); // 400 chars
    const output = 'B'.repeat(600); // 600 chars
    const mockProc = createMockProcess(output);
    mockSpawn.mockReturnValue(mockProc);

    const result = await dispatchToRepo({
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt,
    });

    // Expected: ceil((400 + 600) / 4) = 250
    expect(result.estimatedTokens).toBe(250);
  });
});

// ===========================================================================
// Batch Dispatch
// ===========================================================================

describe('Cross-Repo - Batch Dispatch', () => {
  it('dispatches multiple requests concurrently', async () => {
    // Each call to spawn returns a distinct mock process
    for (let i = 0; i < 3; i++) {
      mockSpawn.mockReturnValueOnce(createMockProcess(`result-${i}`, 0, 10));
    }

    const requests: CrossRepoRequest[] = [
      { dispatchId: generateDispatchId(), repoPath: TEST_REPO_DIR, prompt: 'task-0' },
      { dispatchId: generateDispatchId(), repoPath: TEST_REPO_DIR, prompt: 'task-1' },
      { dispatchId: generateDispatchId(), repoPath: TEST_REPO_DIR, prompt: 'task-2' },
    ];

    const results = await dispatchBatch(requests);

    expect(results).toHaveLength(3);
    expect(results.every(r => r.status === 'completed')).toBe(true);
    // All 3 should have spawned concurrently (not sequentially)
    expect(mockSpawn).toHaveBeenCalledTimes(3);
  });

  it('returns results matching input order', async () => {
    // Process 0 takes longer than process 1 to ensure ordering is preserved
    mockSpawn.mockReturnValueOnce(createMockProcess('slow-result', 0, 30));
    mockSpawn.mockReturnValueOnce(createMockProcess('fast-result', 0, 5));

    const requests: CrossRepoRequest[] = [
      { dispatchId: generateDispatchId(), repoPath: TEST_REPO_DIR, prompt: 'slow' },
      { dispatchId: generateDispatchId(), repoPath: TEST_REPO_DIR, prompt: 'fast' },
    ];

    const results = await dispatchBatch(requests);

    expect(results).toHaveLength(2);
    expect(results[0].content).toBe('slow-result');
    expect(results[1].content).toBe('fast-result');
  });

  it('returns empty array for empty input', async () => {
    const results = await dispatchBatch([]);
    expect(results).toEqual([]);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('handles mixed success and failure in batch', async () => {
    // First succeeds, second targets a non-existent path (fails before spawn)
    mockSpawn.mockReturnValueOnce(createMockProcess('ok', 0, 10));

    const requests: CrossRepoRequest[] = [
      { dispatchId: generateDispatchId(), repoPath: TEST_REPO_DIR, prompt: 'good' },
      { dispatchId: generateDispatchId(), repoPath: '/nonexistent/batch/path', prompt: 'bad' },
    ];

    const results = await dispatchBatch(requests);

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('completed');
    expect(results[1].status).toBe('failed');
    expect(results[1].error).toContain('does not exist');
  });

  it('each result has a unique dispatchId', async () => {
    for (let i = 0; i < 3; i++) {
      mockSpawn.mockReturnValueOnce(createMockProcess(`r-${i}`, 0, 5));
    }

    const requests: CrossRepoRequest[] = Array.from({ length: 3 }, () => ({
      dispatchId: generateDispatchId(),
      repoPath: TEST_REPO_DIR,
      prompt: 'test',
    }));

    const results = await dispatchBatch(requests);
    const ids = results.map(r => r.dispatchId);
    expect(new Set(ids).size).toBe(3);
  });

  it('all batch results appear in history', async () => {
    for (let i = 0; i < 2; i++) {
      mockSpawn.mockReturnValueOnce(createMockProcess(`hist-${i}`, 0, 5));
    }

    const requests: CrossRepoRequest[] = [
      { dispatchId: generateDispatchId(), repoPath: TEST_REPO_DIR, prompt: 'h-0' },
      { dispatchId: generateDispatchId(), repoPath: TEST_REPO_DIR, prompt: 'h-1' },
    ];

    const results = await dispatchBatch(requests);

    for (const r of results) {
      const status = getDispatchStatus(r.dispatchId);
      expect(status).toBeDefined();
    }
  });

  it('single-item batch behaves like single dispatch', async () => {
    mockSpawn.mockReturnValueOnce(createMockProcess('single-batch', 0, 5));

    const requests: CrossRepoRequest[] = [
      { dispatchId: generateDispatchId(), repoPath: TEST_REPO_DIR, prompt: 'only-one' },
    ];

    const results = await dispatchBatch(requests);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('completed');
    expect(results[0].content).toBe('single-batch');
  });
});
