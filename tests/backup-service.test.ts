// tests/backup-service.test.ts
// Integration tests for the backup/restore service.
// Uses real file I/O against temp directories via DATA_DIR env override.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Helpers — we need to override DATA_DIR before importing backupService,
// so each test gets a fresh temp dir via vi.resetModules().
// ---------------------------------------------------------------------------

let tmpRoot: string;
let dataDir: string;

function setupTempDataDir(): void {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
  dataDir = path.join(tmpRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  // Seed the DATA_DIR subdirectories the backup service expects
  const dirs = ['agents', 'skills', 'automation', 'config'];
  for (const d of dirs) {
    fs.mkdirSync(path.join(dataDir, d), { recursive: true });
  }

  // Seed sample data files
  fs.writeFileSync(
    path.join(dataDir, 'agents', 'agents.json'),
    JSON.stringify([{ id: 'agent-1', name: 'Test Agent' }], null, 2),
  );
  fs.writeFileSync(
    path.join(dataDir, 'skills', 'skills.json'),
    JSON.stringify([{ id: 'skill-1', name: 'Test Skill' }], null, 2),
  );
  fs.writeFileSync(
    path.join(dataDir, 'automation', 'rules.json'),
    JSON.stringify([{ id: 'rule-1', name: 'Test Rule' }], null, 2),
  );
  fs.writeFileSync(
    path.join(dataDir, 'config', 'monitors.json'),
    JSON.stringify({ monitors: [] }, null, 2),
  );
  // workspace-history.json — empty array should be skipped
  fs.writeFileSync(
    path.join(dataDir, 'config', 'workspace-history.json'),
    '[]',
  );
}

function cleanupTemp(): void {
  try {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// Dynamic import helper — resets modules to pick up fresh DATA_DIR
// ---------------------------------------------------------------------------

async function loadBackupService() {
  vi.resetModules();
  // Override DATA_DIR env before importing
  process.env.MCP_DATA_DIR = dataDir;
  const mod = await import('../src/services/backupService.js');
  return mod;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('backupService', () => {
  beforeEach(() => {
    setupTempDataDir();
  });

  afterEach(() => {
    cleanupTemp();
    delete process.env.MCP_DATA_DIR;
    vi.resetModules();
  });

  // ── createBackup ────────────────────────────────────────────────────

  describe('createBackup', () => {
    it('creates a backup with manifest in default location', async () => {
      const svc = await loadBackupService();
      const manifest = svc.createBackup();

      expect(manifest.id).toMatch(/^backup-/);
      expect(manifest.files.length).toBeGreaterThanOrEqual(3); // agents, skills, rules (monitors too)
      expect(manifest.totalBytes).toBeGreaterThan(0);
      expect(manifest.version).toBe('1.0.0');

      // Verify manifest file exists on disk
      const backupsDir = path.join(dataDir, 'backups');
      const backupDir = path.join(backupsDir, manifest.id);
      expect(fs.existsSync(path.join(backupDir, 'manifest.json'))).toBe(true);

      // Verify backed-up files exist
      for (const f of manifest.files) {
        expect(fs.existsSync(path.join(backupDir, f.relativePath))).toBe(true);
      }
    });

    it('creates backup in custom path', async () => {
      const svc = await loadBackupService();
      const customDir = path.join(tmpRoot, 'custom-backups');
      const manifest = svc.createBackup(customDir);

      expect(fs.existsSync(path.join(customDir, manifest.id, 'manifest.json'))).toBe(true);
    });

    it('skips empty array files (workspace-history.json)', async () => {
      const svc = await loadBackupService();
      const manifest = svc.createBackup();

      const paths = manifest.files.map(f => f.relativePath);
      const hasWorkspaceHistory = paths.some(p => p.includes('workspace-history'));
      expect(hasWorkspaceHistory).toBe(false);
    });

    it('skips missing files gracefully', async () => {
      // Remove skills.json
      fs.unlinkSync(path.join(dataDir, 'skills', 'skills.json'));

      const svc = await loadBackupService();
      const manifest = svc.createBackup();

      const paths = manifest.files.map(f => f.relativePath);
      expect(paths.some(p => p.includes('skills.json'))).toBe(false);
      // Should still have agents and rules
      expect(paths.some(p => p.includes('agents.json'))).toBe(true);
    });

    it('generates unique backup IDs', async () => {
      const svc = await loadBackupService();
      const m1 = svc.createBackup();
      const m2 = svc.createBackup();
      expect(m1.id).not.toBe(m2.id);
    });

    it('includes file checksums', async () => {
      const svc = await loadBackupService();
      const manifest = svc.createBackup();

      for (const f of manifest.files) {
        expect(f.hash).toMatch(/^[0-9a-f]+$/);
        expect(f.sizeBytes).toBeGreaterThan(0);
      }
    });
  });

  // ── listBackups ─────────────────────────────────────────────────────

  describe('listBackups', () => {
    it('lists backups sorted newest first', async () => {
      const svc = await loadBackupService();
      svc.createBackup();
      // Small delay to ensure different timestamps
      await new Promise(r => setTimeout(r, 50));
      svc.createBackup();

      const list = svc.listBackups();
      expect(list.length).toBe(2);
      // Newest first
      expect(list[0].createdAt >= list[1].createdAt).toBe(true);
    });

    it('returns empty array when no backups exist', async () => {
      const svc = await loadBackupService();
      const list = svc.listBackups();
      expect(list).toEqual([]);
    });

    it('lists from custom path', async () => {
      const svc = await loadBackupService();
      const customDir = path.join(tmpRoot, 'custom');
      svc.createBackup(customDir);

      const list = svc.listBackups(customDir);
      expect(list.length).toBe(1);
    });

    it('includes path, fileCount, totalBytes', async () => {
      const svc = await loadBackupService();
      svc.createBackup();

      const list = svc.listBackups();
      expect(list[0].path).toBeTruthy();
      expect(list[0].fileCount).toBeGreaterThanOrEqual(3);
      expect(list[0].totalBytes).toBeGreaterThan(0);
    });
  });

  // ── restoreBackup ───────────────────────────────────────────────────

  describe('restoreBackup', () => {
    it('restores all files from backup', async () => {
      const svc = await loadBackupService();
      const manifest = svc.createBackup();

      // Modify source files to verify restore overwrites them
      fs.writeFileSync(
        path.join(dataDir, 'agents', 'agents.json'),
        JSON.stringify([{ id: 'MODIFIED', name: 'Modified' }]),
      );

      const result = svc.restoreBackup(manifest.id);
      expect(result.restoredFiles.length).toBe(manifest.files.length);
      expect(result.errors.length).toBe(0);

      // Original data should be restored
      const restored = JSON.parse(
        fs.readFileSync(path.join(dataDir, 'agents', 'agents.json'), 'utf-8'),
      );
      expect(restored[0].id).toBe('agent-1');
    });

    it('creates .pre-restore backups', async () => {
      const svc = await loadBackupService();
      const manifest = svc.createBackup();

      // Restore overwrites current files
      svc.restoreBackup(manifest.id);

      // Check that .pre-restore files were created
      expect(fs.existsSync(path.join(dataDir, 'agents', 'agents.json.pre-restore'))).toBe(true);
    });

    it('restores only selected files', async () => {
      const svc = await loadBackupService();
      const manifest = svc.createBackup();

      // Modify agents
      fs.writeFileSync(
        path.join(dataDir, 'agents', 'agents.json'),
        '"MODIFIED"',
      );

      // Restore only agents.json
      const agentsRelPath = manifest.files.find(f => f.relativePath.includes('agents'))!.relativePath;
      const result = svc.restoreBackup(manifest.id, undefined, [agentsRelPath]);
      expect(result.restoredFiles.length).toBe(1);
      expect(result.skippedFiles.length).toBe(manifest.files.length - 1);

      // Agents should be restored
      const restored = JSON.parse(
        fs.readFileSync(path.join(dataDir, 'agents', 'agents.json'), 'utf-8'),
      );
      expect(restored[0].id).toBe('agent-1');
    });

    it('returns error for missing backup', async () => {
      const svc = await loadBackupService();
      const result = svc.restoreBackup('nonexistent-backup');
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain('not found');
    });
  });

  // ── deleteBackup ────────────────────────────────────────────────────

  describe('deleteBackup', () => {
    it('deletes a backup and its files', async () => {
      const svc = await loadBackupService();
      const manifest = svc.createBackup();

      const backupDir = path.join(dataDir, 'backups', manifest.id);
      expect(fs.existsSync(backupDir)).toBe(true);

      const deleted = svc.deleteBackup(manifest.id);
      expect(deleted).toBe(true);
      expect(fs.existsSync(backupDir)).toBe(false);
    });

    it('returns false for nonexistent backup', async () => {
      const svc = await loadBackupService();
      expect(svc.deleteBackup('does-not-exist')).toBe(false);
    });
  });

  // ── getBackupDetails ────────────────────────────────────────────────

  describe('getBackupDetails', () => {
    it('returns manifest for existing backup', async () => {
      const svc = await loadBackupService();
      const created = svc.createBackup();

      const details = svc.getBackupDetails(created.id);
      expect(details).not.toBeNull();
      expect(details!.id).toBe(created.id);
      expect(details!.files.length).toBe(created.files.length);
    });

    it('returns null for missing backup', async () => {
      const svc = await loadBackupService();
      expect(svc.getBackupDetails('missing')).toBeNull();
    });
  });

  // ── exportBackup ────────────────────────────────────────────────────

  describe('exportBackup', () => {
    it('exports backup to custom path', async () => {
      const svc = await loadBackupService();
      const manifest = svc.createBackup();

      const exportDir = path.join(tmpRoot, 'exported');
      const result = svc.exportBackup(manifest.id, exportDir);

      expect(result).toBe(path.join(exportDir, manifest.id));
      expect(fs.existsSync(path.join(exportDir, manifest.id, 'manifest.json'))).toBe(true);

      // Verify files were copied
      for (const f of manifest.files) {
        expect(fs.existsSync(path.join(exportDir, manifest.id, f.relativePath))).toBe(true);
      }
    });

    it('throws for nonexistent backup', async () => {
      const svc = await loadBackupService();
      expect(() => svc.exportBackup('missing', path.join(tmpRoot, 'x'))).toThrow('not found');
    });
  });

  // ── importBackup ────────────────────────────────────────────────────

  describe('importBackup', () => {
    it('imports backup from external path', async () => {
      const svc = await loadBackupService();
      // Create a backup, export it, delete original, import
      const manifest = svc.createBackup();
      const exportDir = path.join(tmpRoot, 'exported');
      const exportedPath = svc.exportBackup(manifest.id, exportDir);

      svc.deleteBackup(manifest.id);
      expect(svc.getBackupDetails(manifest.id)).toBeNull();

      const imported = svc.importBackup(exportedPath);
      expect(imported).not.toBeNull();
      expect(imported!.id).toBe(manifest.id);

      // Should now appear in list
      const list = svc.listBackups();
      expect(list.some(b => b.id === manifest.id)).toBe(true);
    });

    it('throws when manifest.json missing', async () => {
      const svc = await loadBackupService();
      const emptyDir = path.join(tmpRoot, 'empty-import');
      fs.mkdirSync(emptyDir, { recursive: true });

      expect(() => svc.importBackup(emptyDir)).toThrow('No manifest.json');
    });

    it('throws when backup already exists', async () => {
      const svc = await loadBackupService();
      const manifest = svc.createBackup();
      const exportDir = path.join(tmpRoot, 'exported');
      const exportedPath = svc.exportBackup(manifest.id, exportDir);

      // Don't delete — duplicate should fail
      expect(() => svc.importBackup(exportedPath)).toThrow('already exists');
    });
  });

  // ── pruning ─────────────────────────────────────────────────────────

  describe('auto-pruning', () => {
    it('prunes backups beyond MAX_BACKUPS (20)', async () => {
      const svc = await loadBackupService();

      // Create 22 backups
      for (let i = 0; i < 22; i++) {
        svc.createBackup();
      }

      const list = svc.listBackups();
      expect(list.length).toBeLessThanOrEqual(20);
    });
  });

  // ── round-trip integrity ────────────────────────────────────────────

  describe('round-trip integrity', () => {
    it('backup → modify → restore produces original data', async () => {
      const svc = await loadBackupService();

      const originalAgents = fs.readFileSync(path.join(dataDir, 'agents', 'agents.json'), 'utf-8');
      const originalRules = fs.readFileSync(path.join(dataDir, 'automation', 'rules.json'), 'utf-8');

      const manifest = svc.createBackup();

      // Corrupt data
      fs.writeFileSync(path.join(dataDir, 'agents', 'agents.json'), '{"corrupted": true}');
      fs.writeFileSync(path.join(dataDir, 'automation', 'rules.json'), '[]');

      // Restore
      const result = svc.restoreBackup(manifest.id);
      expect(result.errors.length).toBe(0);

      // Verify round-trip
      const restoredAgents = fs.readFileSync(path.join(dataDir, 'agents', 'agents.json'), 'utf-8');
      const restoredRules = fs.readFileSync(path.join(dataDir, 'automation', 'rules.json'), 'utf-8');
      expect(restoredAgents).toBe(originalAgents);
      expect(restoredRules).toBe(originalRules);
    });
  });
});
