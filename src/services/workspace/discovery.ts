// mcp-agent-manager/src/services/workspace/discovery.ts
// VS Code workspace storage discovery

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface WorkspaceDiscovery {
  id: string;
  chatPath?: string;
  jsonlPath?: string;
  memoryPath?: string;
}

/**
 * Find the VS Code workspace storage directory for a given repo path.
 * Scans both Code and Code - Insiders workspaceStorage directories.
 */
export function findWorkspaceId(repoPath: string): WorkspaceDiscovery | null {
  const appdata = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  const storageDirs = [
    join(appdata, 'Code - Insiders', 'User', 'workspaceStorage'),
    join(appdata, 'Code', 'User', 'workspaceStorage'),
  ];

  const normalizedRepo = repoPath.replace(/\\/g, '/').toLowerCase();

  for (const storageDir of storageDirs) {
    if (!existsSync(storageDir)) continue;

    try {
      const entries = readdirSync(storageDir, { withFileTypes: true })
        .filter(d => d.isDirectory());

      for (const entry of entries) {
        const workspaceJsonPath = join(storageDir, entry.name, 'workspace.json');
        if (!existsSync(workspaceJsonPath)) continue;

        try {
          const raw = readFileSync(workspaceJsonPath, 'utf-8');
          const wsData = JSON.parse(raw);
          const folder = wsData.folder || '';
          const folderPath = decodeURIComponent(folder.replace('file:///', ''))
            .replace(/\\/g, '/')
            .toLowerCase()
            .replace(/\/$/, '');

          if (folderPath === normalizedRepo || normalizedRepo.endsWith(folderPath)) {
            const chatPath = join(storageDir, entry.name, 'chatEditingSessions');
            const jsonlPath = join(storageDir, entry.name, 'chatSessions');
            const memoryPath = join(
              storageDir, entry.name, 'GitHub.copilot-chat', 'memory-tool', 'memories', 'repo',
            );
            return {
              id: entry.name,
              chatPath: existsSync(chatPath) ? chatPath : undefined,
              jsonlPath: existsSync(jsonlPath) ? jsonlPath : undefined,
              memoryPath: existsSync(memoryPath) ? memoryPath : undefined,
            };
          }
        } catch { /* skip invalid workspace.json */ }
      }
    } catch { /* skip unreadable dirs */ }
  }

  return null;
}
