// tests/smoke-startup.test.ts
// Regression test for ESM startup failures (TS-9).
//
// Spawns the *built* server as a real Node.js process — not through vitest's
// module loader — so we catch issues vitest shims over:
//   - __dirname / __filename in ESM
//   - require() in ESM context
//   - Missing/broken imports in transpiled output
//   - Any fatal crash during initialization

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

const ENTRY = path.resolve('dist', 'server', 'index.js');

describe('smoke: server startup', () => {
  it('built server starts without fatal errors', { timeout: 15_000 }, async () => {
    // Guard: the build must exist
    expect(fs.existsSync(ENTRY), `dist entry not found: ${ENTRY}`).toBe(true);

    const { stdout, stderr, code } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((resolve) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn(process.execPath, [ENTRY], {
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      // Give the server time to initialize, then kill it.
      // We only care about the startup — not long-running behavior.
      const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS) || 10_000;
      const timer = setTimeout(() => { proc.kill('SIGTERM'); }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
    });

    const combined = stdout + stderr;

    // The server MUST emit the starting banner
    expect(combined).toContain('mcp-agent-manager starting');

    // The server MUST NOT have a fatal error
    expect(combined).not.toContain('Fatal error');
    expect(combined).not.toContain('Cannot find module');
    expect(combined).not.toContain('is not defined');
    expect(combined).not.toContain('ERR_REQUIRE_ESM');
    expect(combined).not.toContain('SyntaxError');

    // If the process exited on its own (before our SIGTERM), it shouldn't
    // have exited with an error code — unless we killed it (null or SIGTERM).
    if (code !== null && code !== 0) {
      // Process crashed — fail with output for debugging
      expect.fail(`Server exited with code ${code}:\n${combined}`);
    }
  });
});
