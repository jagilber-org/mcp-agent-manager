// mcp-agent-manager/src/services/indexPromoter.ts
// Promotes local governance docs, architecture, and specs to mcp-index-server
// as searchable instructions. Uses content hashing to skip unchanged content.
//
// Usage:
//   import { indexPromoter } from './indexPromoter.js';
//   await indexPromoter.promote({ scope: 'all' });
//
// Reads promotion-map.json from .specify/config/ for content source → instruction metadata mapping.
// Tracks promoted content hashes in state/promoted-knowledge.json.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { logger } from './logger.js';
import { indexClient } from './indexClient.js';
import { getStateDir, getConfigDir } from './dataDir.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromotionSource {
  path: string;
  instructionId: string;
  title: string;
  category: string;
  priority: number;
  requirement: string;
  contentType: string;
  classification: string;
}

export interface PromotionMap {
  description: string;
  sources: PromotionSource[];
}

export interface PromotedEntry {
  id: string;
  sourceHash: string;
  promotedAt: string;
}

export interface PromotionTracking {
  lastPromotedAt: string;
  entries: PromotedEntry[];
}

export interface PromoteOptions {
  scope?: 'all' | 'governance' | 'specs' | 'docs' | 'instructions';
  force?: boolean;
}

export interface PromoteResult {
  promoted: string[];
  skipped: string[];
  failed: Array<{ id: string; error: string }>;
  total: number;
}

// ---------------------------------------------------------------------------
// Category → scope mapping
// ---------------------------------------------------------------------------

const SCOPE_CATEGORIES: Record<string, string[]> = {
  governance: ['governance', 'constitution', 'coding-standards'],
  docs: ['architecture', 'onboarding'],
  specs: ['spec'],
  instructions: ['bootstrap', 'speckit', 'runbook'],
  all: [], // empty = all sources
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

// ---------------------------------------------------------------------------
// IndexPromoter
// ---------------------------------------------------------------------------

export class IndexPromoter {
  private _repoRoot: string;
  private _trackingPath: string;
  private _promotionMapPath: string;

  constructor(repoRoot?: string) {
    // Default: look for config relative to cwd or DATA_DIR
    this._repoRoot = repoRoot || process.cwd();
    this._trackingPath = join(getStateDir(), 'promoted-knowledge.json');

    // Try repo-local .specify/config first, then DATA_DIR config
    const localMap = join(this._repoRoot, '.specify', 'config', 'promotion-map.json');
    const dataDirMap = join(getConfigDir(), 'promotion-map.json');
    this._promotionMapPath = existsSync(localMap) ? localMap : dataDirMap;
  }

  /** Load the promotion mapping config */
  loadPromotionMap(): PromotionMap | null {
    try {
      if (!existsSync(this._promotionMapPath)) {
        logger.debug(`[IndexPromoter] No promotion-map.json found at ${this._promotionMapPath}`);
        return null;
      }
      const raw = readFileSync(this._promotionMapPath, 'utf-8');
      return JSON.parse(raw);
    } catch (err: any) {
      logger.warn(`[IndexPromoter] Failed to load promotion-map.json: ${err.message}`);
      return null;
    }
  }

  /** Load previously promoted content hashes */
  loadTracking(): PromotionTracking {
    try {
      if (!existsSync(this._trackingPath)) {
        return { lastPromotedAt: '', entries: [] };
      }
      const raw = readFileSync(this._trackingPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { lastPromotedAt: '', entries: [] };
    }
  }

  /** Save updated tracking state */
  saveTracking(tracking: PromotionTracking): void {
    try {
      const dir = join(this._trackingPath, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this._trackingPath, JSON.stringify(tracking, null, 2));
    } catch (err: any) {
      logger.warn(`[IndexPromoter] Failed to save tracking: ${err.message}`);
    }
  }

  /** Scan local content sources and build instruction entries */
  scanSources(map: PromotionMap, scope: string): Array<{ source: PromotionSource; content: string; hash: string }> {
    const scopeCategories = SCOPE_CATEGORIES[scope] || [];
    const results: Array<{ source: PromotionSource; content: string; hash: string }> = [];

    for (const source of map.sources) {
      // Scope filter (empty = all)
      if (scopeCategories.length > 0 && !scopeCategories.includes(source.category)) {
        continue;
      }

      const filePath = join(this._repoRoot, source.path);
      if (!existsSync(filePath)) {
        logger.debug(`[IndexPromoter] Source file not found: ${source.path}`);
        continue;
      }

      try {
        const content = readFileSync(filePath, 'utf-8');
        const hash = sha256(content);
        results.push({ source, content, hash });
      } catch (err: any) {
        logger.warn(`[IndexPromoter] Failed to read ${source.path}: ${err.message}`);
      }
    }

    return results;
  }

  /** Also scan instruction JSON files from instructions/ directory */
  scanInstructions(): Array<{ source: PromotionSource; content: string; hash: string }> {
    const instrDir = join(this._repoRoot, 'instructions');
    if (!existsSync(instrDir)) return [];

    const results: Array<{ source: PromotionSource; content: string; hash: string }> = [];

    try {
      const files = require('node:fs').readdirSync(instrDir) as string[];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = join(instrDir, file);
        try {
          const raw = readFileSync(filePath, 'utf-8');
          const instr = JSON.parse(raw);

          // These are already in instruction format — promote as-is
          const hash = sha256(raw);
          results.push({
            source: {
              path: `instructions/${file}`,
              instructionId: instr.id || file.replace('.json', ''),
              title: instr.title || file,
              category: instr.primaryCategory || (instr.categories?.[0] || 'general'),
              priority: instr.priority || 50,
              requirement: instr.requirement || 'recommended',
              contentType: instr.contentType || 'instruction',
              classification: instr.classification || 'internal',
            },
            content: raw,
            hash,
          });
        } catch { /* skip malformed */ }
      }
    } catch { /* skip */ }

    return results;
  }

  /**
   * Promote content to mcp-index-server.
   * Reads promotion-map.json for content sources, computes content hashes,
   * and only promotes changed content (unless force=true).
   */
  async promote(options: PromoteOptions = {}): Promise<PromoteResult> {
    const { scope = 'all', force = false } = options;
    const result: PromoteResult = { promoted: [], skipped: [], failed: [], total: 0 };

    // Check index-server availability
    if (!indexClient.isConfigured()) {
      return { ...result, failed: [{ id: '*', error: 'Index-server not configured' }] };
    }
    if (indexClient.isCircuitOpen()) {
      return { ...result, failed: [{ id: '*', error: 'Index-server circuit breaker open' }] };
    }

    // Load config and tracking
    const map = this.loadPromotionMap();
    const tracking = this.loadTracking();
    const trackedHashes = new Map(tracking.entries.map(e => [e.id, e.sourceHash]));

    // Scan sources
    let sources = map ? this.scanSources(map, scope) : [];

    // Also scan instruction files if scope includes them
    if (scope === 'all' || scope === 'instructions') {
      sources = [...sources, ...this.scanInstructions()];
    }

    result.total = sources.length;

    for (const { source, content, hash } of sources) {
      // Skip unchanged content unless forced
      if (!force && trackedHashes.get(source.instructionId) === hash) {
        result.skipped.push(source.instructionId);
        continue;
      }

      // Build instruction entry
      let entry: Record<string, unknown>;

      // Check if source is a pre-formatted instruction JSON
      if (source.path.startsWith('instructions/') && content.startsWith('{')) {
        try {
          entry = JSON.parse(content);
        } catch {
          entry = this._buildEntry(source, content);
        }
      } else {
        entry = this._buildEntry(source, content);
      }

      // Promote to index-server
      const res = await indexClient.dispatchInstruction('add', {
        entry,
        lax: true,
        overwrite: true,
      });

      if (res.ok) {
        result.promoted.push(source.instructionId);
        // Update tracking
        const existing = tracking.entries.findIndex(e => e.id === source.instructionId);
        const trackEntry: PromotedEntry = {
          id: source.instructionId,
          sourceHash: hash,
          promotedAt: new Date().toISOString(),
        };
        if (existing >= 0) {
          tracking.entries[existing] = trackEntry;
        } else {
          tracking.entries.push(trackEntry);
        }
      } else {
        result.failed.push({ id: source.instructionId, error: res.error || 'Unknown error' });
      }
    }

    // Save updated tracking
    tracking.lastPromotedAt = new Date().toISOString();
    this.saveTracking(tracking);

    logger.info(`[IndexPromoter] Promotion complete: ${result.promoted.length} promoted, ${result.skipped.length} skipped, ${result.failed.length} failed`);
    return result;
  }

  /** Build an instruction entry from a source mapping and file content */
  private _buildEntry(source: PromotionSource, content: string): Record<string, unknown> {
    return {
      id: source.instructionId,
      title: source.title,
      body: content,
      priority: source.priority,
      audience: 'all',
      requirement: source.requirement,
      categories: [source.category, 'mcp-agent-manager'],
      primaryCategory: source.category,
      contentType: source.contentType,
      schemaVersion: '3',
      version: '1.0.0',
      status: 'approved',
      owner: 'system',
      classification: source.classification,
      semanticSummary: `${source.title} — promoted from mcp-agent-manager repository`,
    };
  }
}

/** Singleton promoter (uses cwd as repo root) */
export const indexPromoter = new IndexPromoter();
