// mcp-agent-manager/src/services/dataDir.ts
// Centralized data directory resolution.
//
// Default: %APPDATA%/mcp-agent-manager  (Windows)
//          ~/Library/Application Support/mcp-agent-manager  (macOS)
//          $XDG_CONFIG_HOME/mcp-agent-manager  or  ~/.config/mcp-agent-manager  (Linux)
//
// Override: set MCP_DATA_DIR env var.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Base data directory
// ---------------------------------------------------------------------------

function resolveBaseDir(): string {
  if (process.env.MCP_DATA_DIR) {
    return path.resolve(process.env.MCP_DATA_DIR);
  }

  const platform = os.platform();
  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'mcp-agent-manager');
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'mcp-agent-manager');
  }
  // Linux / other
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'mcp-agent-manager');
}

/** The resolved base data directory (absolute path). */
export const DATA_DIR = resolveBaseDir();

// ---------------------------------------------------------------------------
// Subdirectory helpers - each service calls these
// ---------------------------------------------------------------------------

export function getAgentsDir(): string {
  return process.env.AGENTS_DIR || path.join(DATA_DIR, 'agents');
}

export function getSkillsDir(): string {
  return process.env.SKILLS_DIR || path.join(DATA_DIR, 'skills');
}

export function getAutomationDir(): string {
  return process.env.AUTOMATION_RULES_DIR || path.join(DATA_DIR, 'automation');
}

export function getConfigDir(): string {
  return process.env.CONFIG_DIR || path.join(DATA_DIR, 'config');
}

export function getLogsDir(): string {
  return process.env.EVENT_LOG_DIR || path.join(DATA_DIR, 'logs');
}

export function getMetaDir(): string {
  return process.env.META_DIR || path.join(DATA_DIR, 'meta');
}

export function getStateDir(): string {
  return process.env.STATE_DIR || path.join(DATA_DIR, 'state');
}

export function getBackupsDir(): string {
  return process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
}

// ---------------------------------------------------------------------------
// Seed data — copy defaults from repo seed/ into DATA_DIR on first run
// ---------------------------------------------------------------------------

/** Mapping of seed files to their target subdirectory getter + filename. */
const SEED_FILES: Array<{ seedFile: string; getDir: () => string; target: string }> = [
  { seedFile: 'agents.json', getDir: getAgentsDir, target: 'agents.json' },
  { seedFile: 'skills.json', getDir: getSkillsDir, target: 'skills.json' },
  { seedFile: 'rules.json', getDir: getAutomationDir, target: 'rules.json' },
];

/**
 * Copy seed defaults into DATA_DIR subdirectories when target files are missing.
 * The seed/ folder lives at the repo root (resolved via __dirname at build time).
 */
function seedDefaults(): void {
  // Resolve repo root: dist/server/../../ → repo root
  const repoRoot = path.resolve(__dirname, '..', '..');
  const seedDir = path.join(repoRoot, 'seed');
  if (!fs.existsSync(seedDir)) return;

  for (const entry of SEED_FILES) {
    const src = path.join(seedDir, entry.seedFile);
    const dest = path.join(entry.getDir(), entry.target);
    if (!fs.existsSync(dest) && fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }
}

// ---------------------------------------------------------------------------
// Directory initialization
// ---------------------------------------------------------------------------

/** Ensure the base data directory and all subdirectories exist, then seed defaults. */
export function ensureDataDirs(): void {
  const dirs = [DATA_DIR, getAgentsDir(), getSkillsDir(), getAutomationDir(), getConfigDir(), getLogsDir(), getMetaDir(), getStateDir(), getBackupsDir()];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  seedDefaults();
}
