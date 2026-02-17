// mcp-agent-manager/src/services/indexClient.ts
// Optional HTTP client for mcp-index-server dashboard APIs.
// Resilient: auto-discovers index-server URL from VS Code's mcp.json,
// uses a circuit breaker to stop retrying when the server is unreachable,
// and gracefully degrades on 404 for endpoints not yet added.
//
// Priority for base URL:
//   1. MCP_INDEX_URL env var (explicit override)
//   2. Auto-discover from VS Code Insiders mcp.json → MCP_DASHBOARD_PORT
//   3. Auto-discover from VS Code stable mcp.json → MCP_DASHBOARD_PORT
//   4. Not configured - all operations silently return empty/false
//
// Env flags:
//   MCP_INDEX_URL             - explicit base URL override (e.g. http://localhost:8787)
//   MCP_META_SYNC_INTERVAL    - sync interval ms (default: 300000 = 5min)

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export function getSyncIntervalMs(): number {
  return parseInt(process.env.MCP_META_SYNC_INTERVAL || '300000', 10) || 300000;
}

// ---------------------------------------------------------------------------
// Auto-discovery: parse VS Code mcp.json for index-server dashboard port
// ---------------------------------------------------------------------------

/**
 * Attempt to discover the index-server dashboard URL by reading
 * VS Code's MCP server configuration file (mcp.json).
 * Checks Insiders first, then stable.
 */
export function discoverIndexUrl(): string | null {
  // 1. Explicit env override always wins
  if (process.env.MCP_INDEX_URL) {
    return process.env.MCP_INDEX_URL;
  }

  // 2. Try auto-discovery from VS Code mcp.json
  const appData = process.env.APPDATA;
  if (!appData) return null;

  const mcpJsonPaths = [
    join(appData, 'Code - Insiders', 'User', 'mcp.json'),
    join(appData, 'Code', 'User', 'mcp.json'),
  ];

  for (const mcpPath of mcpJsonPaths) {
    try {
      if (!existsSync(mcpPath)) continue;

      const raw = readFileSync(mcpPath, 'utf-8');
      const config = JSON.parse(raw);
      const servers = config?.servers;
      if (!servers || typeof servers !== 'object') continue;

      // Look for any server entry whose key or cwd contains "mcp-index-server"
      for (const [key, def] of Object.entries(servers) as [string, any][]) {
        const isIndexServer =
          key.includes('index-server') ||
          (def?.cwd && String(def.cwd).includes('mcp-index-server'));

        if (!isIndexServer) continue;

        // Extract dashboard port from env
        const env = def?.env;
        if (env && env.MCP_DASHBOARD_PORT) {
          const port = parseInt(env.MCP_DASHBOARD_PORT, 10);
          if (port > 0 && port < 65536) {
            const url = `http://localhost:${port}`;
            logger.debug(`Index-server auto-discovered from ${mcpPath}: ${url}`);
            return url;
          }
        }

        // If no explicit port but dashboard is enabled, try default 8787
        if (env && (env.MCP_DASHBOARD === '1' || env.MCP_DASHBOARD === 'true')) {
          const url = 'http://localhost:8787';
          logger.debug(`Index-server auto-discovered (default port) from ${mcpPath}: ${url}`);
          return url;
        }
      }
    } catch {
      // Silently skip - file might be malformed or inaccessible
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Auto-start: extract spawn config from mcp.json for recovery
// ---------------------------------------------------------------------------

export interface IndexServerSpawnConfig {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

/**
 * Extract the index-server spawn configuration from VS Code mcp.json.
 * Returns null if the entry can't be found.
 */
export function discoverIndexServerConfig(): IndexServerSpawnConfig | null {
  const appData = process.env.APPDATA;
  if (!appData) return null;

  const mcpJsonPaths = [
    join(appData, 'Code - Insiders', 'User', 'mcp.json'),
    join(appData, 'Code', 'User', 'mcp.json'),
  ];

  for (const mcpPath of mcpJsonPaths) {
    try {
      if (!existsSync(mcpPath)) continue;
      const raw = readFileSync(mcpPath, 'utf-8');
      const config = JSON.parse(raw);
      const servers = config?.servers;
      if (!servers || typeof servers !== 'object') continue;

      for (const [key, def] of Object.entries(servers) as [string, any][]) {
        const isIndexServer =
          key.includes('index-server') ||
          (def?.cwd && String(def.cwd).includes('mcp-index-server'));
        if (!isIndexServer) continue;

        const command = def?.command;
        const args = Array.isArray(def?.args) ? def.args : [];
        const cwd = def?.cwd ? String(def.cwd) : '';
        const env = def?.env && typeof def.env === 'object' ? def.env : {};

        if (command && cwd) {
          return { command, args, cwd, env };
        }
      }
    } catch {
      // skip
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Circuit breaker - avoid hammering unreachable server
// ---------------------------------------------------------------------------

export interface CircuitBreakerState {
  /** Number of consecutive failures */
  failures: number;
  /** Timestamp when circuit was opened (ms since epoch), or 0 if closed */
  openedAt: number;
  /** Total requests attempted */
  totalAttempts: number;
  /** Total successful requests */
  totalSuccesses: number;
}

const FAILURE_THRESHOLD = 3;       // Open circuit after N consecutive failures
const COOLDOWN_MS = 60_000;        // Wait 60s before trying again (half-open)

// ---------------------------------------------------------------------------
// HTTP helpers (native fetch - Node 18+)
// ---------------------------------------------------------------------------

async function post(url: string, body: unknown, timeoutMs = 5000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    return await response.json().catch(() => ({}));
  } finally {
    clearTimeout(timer);
  }
}

async function get(url: string, timeoutMs = 5000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    return await response.json().catch(() => ({}));
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// IndexClient - resilient HTTP client to index-server dashboard
// ---------------------------------------------------------------------------

export class IndexClient {
  private _baseUrl: string | null;
  private _circuit: CircuitBreakerState;
  private _discoverySource: 'env' | 'auto' | 'none';

  constructor() {
    this._circuit = { failures: 0, openedAt: 0, totalAttempts: 0, totalSuccesses: 0 };
    this._discoverySource = 'none';
    this._baseUrl = null;
    this._discover();
  }

  /** (Re-)discover config from env + mcp.json */
  reload(): void {
    this._discover();
  }

  private _discover(): void {
    if (process.env.MCP_INDEX_URL) {
      this._baseUrl = process.env.MCP_INDEX_URL;
      this._discoverySource = 'env';
    } else {
      const discovered = discoverIndexUrl();
      this._baseUrl = discovered;
      this._discoverySource = discovered ? 'auto' : 'none';
    }
  }

  /** Whether index-server integration is configured (env or auto-discovered) */
  isConfigured(): boolean {
    return !!this._baseUrl;
  }

  /** The resolved base URL (or null) */
  get baseUrl(): string | null {
    return this._baseUrl;
  }

  /** How the URL was resolved */
  get discoverySource(): 'env' | 'auto' | 'none' {
    return this._discoverySource;
  }

  // ---- Circuit breaker ----

  /** Current circuit breaker state */
  get circuitState(): CircuitBreakerState {
    return { ...this._circuit };
  }

  /** Whether the circuit is open (server presumed down) */
  isCircuitOpen(): boolean {
    if (this._circuit.failures < FAILURE_THRESHOLD) return false;
    // Check if cooldown has elapsed → half-open
    if (this._circuit.openedAt > 0 && Date.now() - this._circuit.openedAt >= COOLDOWN_MS) {
      return false; // Half-open: allow one probe
    }
    return true;
  }

  /** Record a successful call - reset circuit */
  private _recordSuccess(): void {
    this._circuit.failures = 0;
    this._circuit.openedAt = 0;
    this._circuit.totalSuccesses++;
  }

  /** Record a failed call - may open circuit and trigger auto-start */
  private _recordFailure(): void {
    this._circuit.failures++;
    this._circuit.totalAttempts++;
    if (this._circuit.failures >= FAILURE_THRESHOLD && this._circuit.openedAt === 0) {
      this._circuit.openedAt = Date.now();
      logger.info(`Index-server circuit breaker OPEN after ${this._circuit.failures} consecutive failures (cooldown ${COOLDOWN_MS / 1000}s)`);
      // Attempt to auto-start the server
      this.ensureRunning().catch(() => {});
    }
  }

  /** Reset circuit breaker (e.g. after manual config change) */
  resetCircuit(): void {
    this._circuit = { failures: 0, openedAt: 0, totalAttempts: this._circuit.totalAttempts, totalSuccesses: this._circuit.totalSuccesses };
  }

  // ---- Knowledge operations ----

  /**
   * Store a knowledge entry in the index-server.
   * Uses POST /api/knowledge - gracefully handles 404 if endpoint not yet added.
   */
  async storeKnowledge(
    key: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<boolean> {
    if (!this._baseUrl || this.isCircuitOpen()) return false;

    this._circuit.totalAttempts++;
    try {
      await post(`${this._baseUrl}/api/knowledge`, {
        key,
        content,
        metadata: {
          ...metadata,
          source: 'mcp-agent-manager',
          updatedAt: new Date().toISOString(),
        },
      });
      this._recordSuccess();
      return true;
    } catch (err: any) {
      // 404 means endpoint not added yet - don't count as failure
      if (err.message?.includes('404')) {
        logger.debug(`Index /api/knowledge not available yet (404) - skipping store`);
        return false;
      }
      this._recordFailure();
      logger.debug(`Index store failed for ${key}: ${err.message}`);
      return false;
    }
  }

  /**
   * Search knowledge in the index-server.
   * Tries /api/knowledge/search first, falls back to /api/instructions/search.
   */
  async searchKnowledge(
    query: string,
    options?: { category?: string; limit?: number }
  ): Promise<Array<{ key: string; content: string; metadata?: Record<string, unknown>; score?: number }>> {
    if (!this._baseUrl || this.isCircuitOpen()) return [];

    this._circuit.totalAttempts++;
    const params = new URLSearchParams({ q: query });
    if (options?.category) params.set('category', options.category);
    if (options?.limit) params.set('limit', String(options.limit));

    // Try /api/knowledge/search first (may not exist yet)
    try {
      const result = await get(`${this._baseUrl}/api/knowledge/search?${params}`);
      this._recordSuccess();
      return result.results || result.entries || [];
    } catch (err: any) {
      // If 404, fall back to /api/instructions/search which exists today
      if (err.message?.includes('404')) {
        try {
          const fallback = await get(`${this._baseUrl}/api/instructions/search?${params}`);
          this._recordSuccess();
          // Normalize instructions response to knowledge format
          const items = fallback.results || fallback.instructions || [];
          return items.map((item: any) => ({
            key: item.name || item.id || item.key || '',
            content: item.description || item.content || JSON.stringify(item),
            metadata: item.metadata || { source: 'instructions' },
            score: item.score,
          }));
        } catch (fallbackErr: any) {
          if (!fallbackErr.message?.includes('404')) {
            this._recordFailure();
          }
          logger.debug(`Index search failed (both endpoints): ${fallbackErr.message}`);
          return [];
        }
      }
      this._recordFailure();
      logger.debug(`Index search failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Get a specific knowledge entry by key.
   * Gracefully returns null if /api/knowledge/:key is not available.
   */
  async getKnowledge(key: string): Promise<{ key: string; content: string; metadata?: Record<string, unknown> } | null> {
    if (!this._baseUrl || this.isCircuitOpen()) return null;

    this._circuit.totalAttempts++;
    try {
      const result = await get(`${this._baseUrl}/api/knowledge/${encodeURIComponent(key)}`);
      this._recordSuccess();
      return result || null;
    } catch (err: any) {
      if (!err.message?.includes('404')) {
        this._recordFailure();
      }
      return null;
    }
  }

  /**
   * Verify the index-server is running. If a health check fails and spawn
   * config is discoverable from mcp.json, start the server process.
   * Resets the circuit breaker on successful probe.
   */
  async ensureRunning(): Promise<boolean> {
    if (!this._baseUrl) {
      this._discover();
      if (!this._baseUrl) return false;
    }

    // Quick health probe
    try {
      await get(`${this._baseUrl}/api/health`, 3000);
      this._recordSuccess();
      logger.debug('[IndexClient] ensureRunning: server is healthy');
      return true;
    } catch {
      // Server not responding - try to start it
    }

    const spawnConfig = discoverIndexServerConfig();
    if (!spawnConfig) {
      logger.info('[IndexClient] ensureRunning: server unreachable and no spawn config found in mcp.json');
      return false;
    }

    if (!existsSync(spawnConfig.cwd)) {
      logger.info(`[IndexClient] ensureRunning: cwd does not exist: ${spawnConfig.cwd}`);
      return false;
    }

    logger.info(`[IndexClient] ensureRunning: starting index-server from ${spawnConfig.cwd}`);

    try {
      const proc = spawn(spawnConfig.command, spawnConfig.args, {
        cwd: spawnConfig.cwd,
        env: { ...process.env, ...spawnConfig.env },
        stdio: 'ignore',
        detached: true,
      });
      proc.unref();

      // Wait up to 10s for the server to come up
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          await get(`${this._baseUrl}/api/health`, 2000);
          this.resetCircuit();
          logger.info('[IndexClient] ensureRunning: index-server started successfully');
          return true;
        } catch {
          // not up yet
        }
      }

      logger.info('[IndexClient] ensureRunning: index-server started but not responding after 10s');
      return false;
    } catch (err: any) {
      logger.info(`[IndexClient] ensureRunning: failed to spawn index-server: ${err.message}`);
      return false;
    }
  }

  /**
   * Dispatch an instruction operation to the index-server.
   * Wraps POST /api/instructions with the instructions_dispatch action pattern.
   * Used by the IndexPromoter to add/update instructions in the shared catalog.
   */
  async dispatchInstruction(
    action: string,
    params: Record<string, unknown>
  ): Promise<{ ok: boolean; data?: any; error?: string }> {
    if (!this._baseUrl || this.isCircuitOpen()) {
      return { ok: false, error: 'Index-server not available' };
    }

    this._circuit.totalAttempts++;
    try {
      const result = await post(`${this._baseUrl}/api/instructions`, {
        action,
        ...params,
      });
      this._recordSuccess();
      return { ok: true, data: result };
    } catch (err: any) {
      if (!err.message?.includes('404')) {
        this._recordFailure();
      }
      return { ok: false, error: err.message };
    }
  }

  /**
   * Check index-server health.
   * Uses /api/health - the most reliable endpoint. Also probes the circuit.
   */
  async healthCheck(): Promise<{
    ok: boolean;
    version?: string;
    error?: string;
    circuit: CircuitBreakerState;
    discoverySource: string;
  }> {
    const base = {
      circuit: this.circuitState,
      discoverySource: this._discoverySource,
    };

    if (!this._baseUrl) {
      return { ...base, ok: false, error: 'Index-server not configured (no MCP_INDEX_URL, auto-discovery found nothing)' };
    }

    try {
      const result = await get(`${this._baseUrl}/api/health`, 3000);
      this._recordSuccess();
      return { ...base, ok: true, version: result.version || result.serverVersion, circuit: this.circuitState };
    } catch (err: any) {
      this._recordFailure();
      return { ...base, ok: false, error: err.message, circuit: this.circuitState };
    }
  }
}

/** Singleton index client */
export const indexClient = new IndexClient();
