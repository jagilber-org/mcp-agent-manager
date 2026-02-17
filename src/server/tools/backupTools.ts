// mcp-agent-manager/src/server/tools/backupTools.ts
// MCP tool registrations for backup/restore functionality.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  createBackup,
  listBackups,
  restoreBackup,
  deleteBackup,
  getBackupDetails,
  exportBackup,
  importBackup,
} from '../../services/backupService.js';
import { toolError } from './toolErrors.js';

export function registerBackupTools(server: McpServer): void {
  // -----------------------------------------------------------------------
  // mgr_create_backup - create a backup of all data stores
  // -----------------------------------------------------------------------
  server.tool(
    'mgr_create_backup',
    'Create a backup of all persistent data (agents, skills, rules, config). ' +
    'Optionally specify a custom path to store the backup.',
    {
      path: z
        .string()
        .optional()
        .describe('Custom directory path for backups (default: APPDATA/mcp-agent-manager/backups/)'),
    },
    async ({ path: customPath }) => {
      try {
        const manifest = createBackup(customPath);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: 'created',
              backupId: manifest.id,
              createdAt: manifest.createdAt,
              files: manifest.files.map(f => f.relativePath),
              totalBytes: manifest.totalBytes,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return toolError('mgr_create_backup', err.message);
      }
    },
  );

  // -----------------------------------------------------------------------
  // mgr_list_backups - list available backups
  // -----------------------------------------------------------------------
  server.tool(
    'mgr_list_backups',
    'List all available backups with timestamps and file counts',
    {
      path: z
        .string()
        .optional()
        .describe('Custom directory path to search for backups'),
    },
    async ({ path: customPath }) => {
      const backups = listBackups(customPath);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: backups.length,
            backups: backups.map(b => ({
              id: b.id,
              createdAt: b.createdAt,
              fileCount: b.fileCount,
              totalBytes: b.totalBytes,
              path: b.path,
            })),
          }, null, 2),
        }],
      };
    },
  );

  // -----------------------------------------------------------------------
  // mgr_restore_backup - restore from a backup
  // -----------------------------------------------------------------------
  server.tool(
    'mgr_restore_backup',
    'Restore data from a backup. Optionally restore only specific files. ' +
    'Current files are saved as .pre-restore before overwriting.',
    {
      backupId: z.string().describe('Backup ID to restore from'),
      path: z
        .string()
        .optional()
        .describe('Custom backups directory path (default: APPDATA/mcp-agent-manager/backups/)'),
      files: z
        .array(z.string())
        .optional()
        .describe('Specific files to restore (e.g. ["automation/rules.json"]). Omit to restore all.'),
    },
    async ({ backupId, path: customPath, files }) => {
      try {
        const result = restoreBackup(backupId, customPath, files);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: result.errors.length === 0 ? 'success' : 'partial',
              restoredFiles: result.restoredFiles,
              skippedFiles: result.skippedFiles,
              errors: result.errors,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return toolError('mgr_restore_backup', err.message);
      }
    },
  );

  // -----------------------------------------------------------------------
  // mgr_backup_details - get details of a specific backup
  // -----------------------------------------------------------------------
  server.tool(
    'mgr_backup_details',
    'Get detailed manifest of a specific backup including all files and checksums',
    {
      backupId: z.string().describe('Backup ID'),
      path: z.string().optional().describe('Custom backups directory path'),
    },
    async ({ backupId, path: customPath }) => {
      const manifest = getBackupDetails(backupId, customPath);
      if (!manifest) {
        return toolError('mgr_backup_details', `Backup not found: ${backupId}`);
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(manifest, null, 2) }],
      };
    },
  );

  // -----------------------------------------------------------------------
  // mgr_delete_backup - delete a backup
  // -----------------------------------------------------------------------
  server.tool(
    'mgr_delete_backup',
    'Delete a specific backup by ID',
    {
      backupId: z.string().describe('Backup ID to delete'),
      path: z.string().optional().describe('Custom backups directory path'),
    },
    async ({ backupId, path: customPath }) => {
      const deleted = deleteBackup(backupId, customPath);
      if (!deleted) {
        return toolError('mgr_delete_backup', `Backup not found: ${backupId}`);
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ deleted: true, backupId }, null, 2) }],
      };
    },
  );

  // -----------------------------------------------------------------------
  // mgr_export_backup - copy a backup to a custom location
  // -----------------------------------------------------------------------
  server.tool(
    'mgr_export_backup',
    'Export (copy) a backup to a custom directory path for safekeeping or transfer',
    {
      backupId: z.string().describe('Backup ID to export'),
      exportPath: z.string().describe('Destination directory path'),
    },
    async ({ backupId, exportPath }) => {
      try {
        const destDir = exportBackup(backupId, exportPath);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ exported: true, backupId, path: destDir }, null, 2),
          }],
        };
      } catch (err: any) {
        return toolError('mgr_export_backup', err.message);
      }
    },
  );

  // -----------------------------------------------------------------------
  // mgr_import_backup - import a backup from a custom location
  // -----------------------------------------------------------------------
  server.tool(
    'mgr_import_backup',
    'Import a backup from a directory (must contain manifest.json)',
    {
      importPath: z.string().describe('Path to the backup directory to import'),
    },
    async ({ importPath }) => {
      try {
        const manifest = importBackup(importPath);
        if (!manifest) {
          return toolError('mgr_import_backup', 'Import failed: no manifest returned');
        }
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              imported: true,
              backupId: manifest.id,
              files: manifest.files.map(f => f.relativePath),
              totalBytes: manifest.totalBytes,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return toolError('mgr_import_backup', err.message);
      }
    },
  );
}
