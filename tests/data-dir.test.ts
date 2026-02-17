// tests/data-dir.test.ts
// Unit tests for the centralized data directory module

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// We need to test with different env vars, so we import lazily after setting env.
// The module reads env vars at import time, so we use dynamic import + resetModules.

describe('dataDir', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
    vi.resetModules();
  });

  describe('DATA_DIR resolution', () => {
    it('uses MCP_DATA_DIR env var when set', async () => {
      process.env.MCP_DATA_DIR = '/custom/data';
      const { DATA_DIR } = await import('../src/services/dataDir.js');
      expect(DATA_DIR).toBe(path.resolve('/custom/data'));
    });

    it('falls back to platform default when MCP_DATA_DIR is not set', async () => {
      delete process.env.MCP_DATA_DIR;
      const { DATA_DIR } = await import('../src/services/dataDir.js');
      // Should contain 'mcp-agent-manager'
      expect(DATA_DIR).toContain('mcp-agent-manager');
      expect(path.isAbsolute(DATA_DIR)).toBe(true);
    });
  });

  describe('subdirectory helpers', () => {
    beforeEach(() => {
      process.env.MCP_DATA_DIR = '/test/base';
      // Clear individual overrides
      delete process.env.AGENTS_DIR;
      delete process.env.SKILLS_DIR;
      delete process.env.AUTOMATION_RULES_DIR;
      delete process.env.CONFIG_DIR;
      delete process.env.EVENT_LOG_DIR;
    });

    it('getAgentsDir returns DATA_DIR/agents by default', async () => {
      const { getAgentsDir } = await import('../src/services/dataDir.js');
      const expected = path.resolve('/test/base', 'agents');
      expect(path.resolve(getAgentsDir())).toBe(expected);
    });

    it('getSkillsDir returns DATA_DIR/skills by default', async () => {
      const { getSkillsDir } = await import('../src/services/dataDir.js');
      const expected = path.resolve('/test/base', 'skills');
      expect(path.resolve(getSkillsDir())).toBe(expected);
    });

    it('getAutomationDir returns DATA_DIR/automation by default', async () => {
      const { getAutomationDir } = await import('../src/services/dataDir.js');
      const expected = path.resolve('/test/base', 'automation');
      expect(path.resolve(getAutomationDir())).toBe(expected);
    });

    it('getConfigDir returns DATA_DIR/config by default', async () => {
      const { getConfigDir } = await import('../src/services/dataDir.js');
      const expected = path.resolve('/test/base', 'config');
      expect(path.resolve(getConfigDir())).toBe(expected);
    });

    it('getLogsDir returns DATA_DIR/logs by default', async () => {
      const { getLogsDir } = await import('../src/services/dataDir.js');
      const expected = path.resolve('/test/base', 'logs');
      expect(path.resolve(getLogsDir())).toBe(expected);
    });

    it('respects env var overrides over DATA_DIR', async () => {
      process.env.AGENTS_DIR = '/override/agents';
      const { getAgentsDir } = await import('../src/services/dataDir.js');
      expect(getAgentsDir()).toBe('/override/agents');
    });
  });

  describe('ensureDataDirs', () => {
    it('creates directories without error', async () => {
      // Use a temp dir so we don't pollute real dirs
      const tmpDir = path.join(os.tmpdir(), `mcp-test-${Date.now()}`);
      process.env.MCP_DATA_DIR = tmpDir;
      const { ensureDataDirs } = await import('../src/services/dataDir.js');
      expect(() => ensureDataDirs()).not.toThrow();

      // Cleanup
      const fs = await import('fs');
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
