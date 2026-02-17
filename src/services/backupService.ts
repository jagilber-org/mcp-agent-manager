// mcp-agent-manager/src/services/backupService.ts
// Backup and restore service for all persistent data stores.
// Supports creating timestamped zip-like backups and restoring from them.

import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger.js';
import {
  DATA_DIR,
  getAgentsDir,
  getSkillsDir,
  getAutomationDir,
  getConfigDir,
} from './dataDir.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupManifest {
  id: string;
  createdAt: string;
  dataDir: string;
  files: BackupFileEntry[];
  totalBytes: number;
  version: string;
}

export interface BackupFileEntry {
  relativePath: string;
  sizeBytes: number;
  hash: string; // simple checksum
}

export interface BackupListEntry {
  id: string;
  path: string;
  createdAt: string;
  totalBytes: number;
  fileCount: number;
}

export interface RestoreResult {
  restoredFiles: string[];
  skippedFiles: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKUP_SUBDIR = 'backups';
const MANIFEST_FILE = 'manifest.json';
const MAX_BACKUPS = 20;

// Files to back up (relative to DATA_DIR)
const BACKUP_TARGETS = [
  { dir: 'agents', file: 'agents.json' },
  { dir: 'skills', file: 'skills.json' },
  { dir: 'automation', file: 'rules.json' },
  { dir: 'config', file: 'monitors.json' },
  { dir: 'config', file: 'workspace-history.json' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBackupsDir(customPath?: string): string {
  if (customPath) return customPath;
  return path.join(DATA_DIR, BACKUP_SUBDIR);
}

function simpleChecksum(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0; // 32-bit int
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function generateBackupId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 6);
  return `backup-${ts}_${rand}`;
}

// ---------------------------------------------------------------------------
// Create backup
// ---------------------------------------------------------------------------

/**
 * Create a backup of all persistent data stores.
 * @param targetPath Optional custom directory; defaults to DATA_DIR/backups/<id>/
 * @returns The backup manifest
 */
export function createBackup(targetPath?: string): BackupManifest {
  const id = generateBackupId();
  const backupsRoot = getBackupsDir(targetPath);
  const backupDir = path.join(backupsRoot, id);

  if (!fs.existsSync(backupsRoot)) {
    fs.mkdirSync(backupsRoot, { recursive: true });
  }
  fs.mkdirSync(backupDir, { recursive: true });

  const files: BackupFileEntry[] = [];
  let totalBytes = 0;

  for (const target of BACKUP_TARGETS) {
    const srcFile = path.join(DATA_DIR, target.dir, target.file);
    if (!fs.existsSync(srcFile)) continue;

    try {
      const content = fs.readFileSync(srcFile, 'utf-8');
      // Skip empty arrays — nothing to back up
      if (content.trim() === '[]' || content.trim() === '') continue;

      const relPath = path.join(target.dir, target.file);
      const dstDir = path.join(backupDir, target.dir);
      if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });

      fs.writeFileSync(path.join(backupDir, relPath), content, 'utf-8');
      const sizeBytes = Buffer.byteLength(content, 'utf-8');
      totalBytes += sizeBytes;
      files.push({
        relativePath: relPath,
        sizeBytes,
        hash: simpleChecksum(content),
      });
    } catch (err: any) {
      logger.warn(`[Backup] Failed to copy ${target.dir}/${target.file}: ${err.message}`);
    }
  }

  const manifest: BackupManifest = {
    id,
    createdAt: new Date().toISOString(),
    dataDir: DATA_DIR,
    files,
    totalBytes,
    version: '1.0.0',
  };

  fs.writeFileSync(
    path.join(backupDir, MANIFEST_FILE),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );

  // Prune old backups
  pruneOldBackups(backupsRoot);

  logger.info(`[Backup] Created backup ${id}: ${files.length} files, ${totalBytes} bytes → ${backupDir}`);
  return manifest;
}

// ---------------------------------------------------------------------------
// List backups
// ---------------------------------------------------------------------------

/**
 * List available backups.
 * @param sourcePath Optional custom backups directory.
 */
export function listBackups(sourcePath?: string): BackupListEntry[] {
  const backupsRoot = getBackupsDir(sourcePath);
  if (!fs.existsSync(backupsRoot)) return [];

  const entries: BackupListEntry[] = [];
  const dirs = fs.readdirSync(backupsRoot).filter(d => d.startsWith('backup-'));

  for (const dir of dirs) {
    const manifestPath = path.join(backupsRoot, dir, MANIFEST_FILE);
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest: BackupManifest = JSON.parse(
        fs.readFileSync(manifestPath, 'utf-8'),
      );
      entries.push({
        id: manifest.id,
        path: path.join(backupsRoot, dir),
        createdAt: manifest.createdAt,
        totalBytes: manifest.totalBytes,
        fileCount: manifest.files.length,
      });
    } catch {
      // Corrupt manifest — skip
    }
  }

  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------------------------------------------------------------------
// Restore backup
// ---------------------------------------------------------------------------

/**
 * Restore a backup to the active DATA_DIR.
 * @param backupId The backup ID to restore
 * @param sourcePath Optional custom backups directory
 * @param selectedFiles Optional array of relative paths to restore (defaults to all)
 */
export function restoreBackup(
  backupId: string,
  sourcePath?: string,
  selectedFiles?: string[],
): RestoreResult {
  const backupsRoot = getBackupsDir(sourcePath);
  const backupDir = path.join(backupsRoot, backupId);
  const manifestPath = path.join(backupDir, MANIFEST_FILE);

  if (!fs.existsSync(manifestPath)) {
    return { restoredFiles: [], skippedFiles: [], errors: [`Backup not found: ${backupId}`] };
  }

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (err: any) {
    return { restoredFiles: [], skippedFiles: [], errors: [`Corrupt manifest: ${err.message}`] };
  }

  const result: RestoreResult = { restoredFiles: [], skippedFiles: [], errors: [] };

  for (const entry of manifest.files) {
    // If selectedFiles is given, only restore those
    if (selectedFiles && selectedFiles.length > 0) {
      const match = selectedFiles.some(
        sf => entry.relativePath === sf || entry.relativePath.replace(/\\/g, '/') === sf,
      );
      if (!match) {
        result.skippedFiles.push(entry.relativePath);
        continue;
      }
    }

    const srcFile = path.join(backupDir, entry.relativePath);
    const dstFile = path.join(DATA_DIR, entry.relativePath);

    if (!fs.existsSync(srcFile)) {
      result.errors.push(`Missing in backup: ${entry.relativePath}`);
      continue;
    }

    try {
      const content = fs.readFileSync(srcFile, 'utf-8');

      // Verify checksum
      const actualHash = simpleChecksum(content);
      if (actualHash !== entry.hash) {
        logger.warn(`[Backup] Checksum mismatch for ${entry.relativePath}: expected ${entry.hash}, got ${actualHash}`);
      }

      // Back up current file before overwriting
      if (fs.existsSync(dstFile)) {
        try {
          fs.copyFileSync(dstFile, dstFile + '.pre-restore');
        } catch { /* best-effort */ }
      }

      // Ensure target directory exists
      const dstDir = path.dirname(dstFile);
      if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });

      fs.writeFileSync(dstFile, content, 'utf-8');
      result.restoredFiles.push(entry.relativePath);
    } catch (err: any) {
      result.errors.push(`Failed to restore ${entry.relativePath}: ${err.message}`);
    }
  }

  logger.info(
    `[Backup] Restored ${backupId}: ${result.restoredFiles.length} files restored, ` +
    `${result.skippedFiles.length} skipped, ${result.errors.length} errors`,
  );
  return result;
}

// ---------------------------------------------------------------------------
// Delete backup
// ---------------------------------------------------------------------------

export function deleteBackup(backupId: string, sourcePath?: string): boolean {
  const backupsRoot = getBackupsDir(sourcePath);
  const backupDir = path.join(backupsRoot, backupId);
  if (!fs.existsSync(backupDir)) return false;
  fs.rmSync(backupDir, { recursive: true, force: true });
  logger.info(`[Backup] Deleted backup ${backupId}`);
  return true;
}

// ---------------------------------------------------------------------------
// Get backup details (manifest)
// ---------------------------------------------------------------------------

export function getBackupDetails(
  backupId: string,
  sourcePath?: string,
): BackupManifest | null {
  const backupsRoot = getBackupsDir(sourcePath);
  const manifestPath = path.join(backupsRoot, backupId, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prune old backups — keep at most MAX_BACKUPS
// ---------------------------------------------------------------------------

function pruneOldBackups(backupsRoot: string): void {
  const all = listBackups(backupsRoot === path.join(DATA_DIR, BACKUP_SUBDIR) ? undefined : backupsRoot);
  if (all.length <= MAX_BACKUPS) return;

  const toRemove = all.slice(MAX_BACKUPS);
  for (const entry of toRemove) {
    try {
      fs.rmSync(entry.path, { recursive: true, force: true });
      logger.info(`[Backup] Pruned old backup ${entry.id}`);
    } catch { /* best-effort */ }
  }
}

// ---------------------------------------------------------------------------
// Export backup to a custom path (copy a backup to user-specified location)
// ---------------------------------------------------------------------------

export function exportBackup(backupId: string, exportPath: string, sourcePath?: string): string {
  const backupsRoot = getBackupsDir(sourcePath);
  const backupDir = path.join(backupsRoot, backupId);
  if (!fs.existsSync(backupDir)) {
    throw new Error(`Backup not found: ${backupId}`);
  }

  const destDir = path.join(exportPath, backupId);
  if (!fs.existsSync(exportPath)) {
    fs.mkdirSync(exportPath, { recursive: true });
  }

  copyDirRecursive(backupDir, destDir);
  logger.info(`[Backup] Exported ${backupId} → ${destDir}`);
  return destDir;
}

// ---------------------------------------------------------------------------
// Import backup from a custom path
// ---------------------------------------------------------------------------

export function importBackup(importPath: string, targetPath?: string): BackupManifest | null {
  const manifestPath = path.join(importPath, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No manifest.json found at ${importPath}`);
  }

  const manifest: BackupManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const backupsRoot = getBackupsDir(targetPath);
  const destDir = path.join(backupsRoot, manifest.id);

  if (fs.existsSync(destDir)) {
    throw new Error(`Backup ${manifest.id} already exists`);
  }

  if (!fs.existsSync(backupsRoot)) {
    fs.mkdirSync(backupsRoot, { recursive: true });
  }

  copyDirRecursive(importPath, destDir);
  logger.info(`[Backup] Imported ${manifest.id} from ${importPath}`);
  return manifest;
}

// ---------------------------------------------------------------------------
// Recursive copy helper
// ---------------------------------------------------------------------------

function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
