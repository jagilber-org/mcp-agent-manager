// mcp-agent-manager/src/services/dashboard/index.ts
// Dashboard HTTP server start/stop. Re-exports for external consumers.

import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../logger.js';
import { handleAPI } from './api.js';
import { getDashboardHTML } from './html.js';
import { getDashboardHTMLV2 } from './htmlV2.js';
import {
  sseClients,
  recordRequest,
  setServerStartedAt,
  setActualPort,
} from './state.js';
import { getStateDir } from '../dataDir.js';
// Side-effect import: wires eventBus → SSE on first load
import './sse.js';

const DEFAULT_PORT = 3900;
const MAX_PORT_RETRIES = 10;
let serverInstance: ReturnType<typeof createHttpServer> | null = null;
let basePort = DEFAULT_PORT;

// ---------------------------------------------------------------------------
// Port file management - enables discovery of all active dashboard instances
// ---------------------------------------------------------------------------

interface PortFileEntry {
  pid: number;
  port: number;
  startedAt: string;
  cwd?: string;
}

function getPortFilePath(pid: number): string {
  return path.join(getStateDir(), `dashboard-${pid}.json`);
}

function writePortFile(port: number): void {
  try {
    const stateDir = getStateDir();
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    const entry: PortFileEntry = { pid: process.pid, port, startedAt: new Date().toISOString(), cwd: process.cwd() };
    fs.writeFileSync(getPortFilePath(process.pid), JSON.stringify(entry, null, 2));
  } catch (err: any) {
    logger.warn(`Failed to write dashboard port file: ${err.message}`);
  }
}

function removePortFile(): void {
  try {
    const fp = getPortFilePath(process.pid);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch { /* best-effort */ }
}

/** Clean up port files for processes that are no longer running */
function cleanStalePortFiles(): void {
  try {
    const stateDir = getStateDir();
    if (!fs.existsSync(stateDir)) return;
    const files = fs.readdirSync(stateDir).filter(f => f.startsWith('dashboard-') && f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(stateDir, file), 'utf-8');
        const entry: PortFileEntry = JSON.parse(raw);
        if (!isProcessAlive(entry.pid)) {
          fs.unlinkSync(path.join(stateDir, file));
          logger.info(`Cleaned stale dashboard port file for PID ${entry.pid}`);
        }
      } catch {
        // Corrupt file - remove it
        try { fs.unlinkSync(path.join(stateDir, file)); } catch { /* ignore */ }
      }
    }
  } catch { /* best-effort */ }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check, no kill
    return true;
  } catch {
    return false;
  }
}

/** Get all active dashboard instances from port files */
export function getActiveInstances(): PortFileEntry[] {
  const instances: PortFileEntry[] = [];
  try {
    const stateDir = getStateDir();
    if (!fs.existsSync(stateDir)) return instances;
    const files = fs.readdirSync(stateDir).filter(f => f.startsWith('dashboard-') && f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(stateDir, file), 'utf-8');
        const entry: PortFileEntry = JSON.parse(raw);
        if (isProcessAlive(entry.pid)) {
          instances.push(entry);
        }
      } catch { /* skip corrupt files */ }
    }
  } catch { /* best-effort */ }
  return instances.sort((a, b) => a.port - b.port);
}

// ---------------------------------------------------------------------------
// Dashboard HTTP server
// ---------------------------------------------------------------------------

/** Start the dashboard HTTP server */
export function startDashboard(port?: number): number {
  const dashboardPort = port
    ?? (parseInt(process.env.MCP_AGENT_DASHBOARD_PORT || '', 10) || DEFAULT_PORT);

  // Track the original base for retry cap
  if (!port) basePort = dashboardPort;

  // Cap retries
  if (dashboardPort - basePort >= MAX_PORT_RETRIES) {
    logger.error(`Dashboard failed to bind after ${MAX_PORT_RETRIES} port attempts (${basePort}–${dashboardPort - 1}). Giving up.`);
    return -1;
  }

  if (serverInstance) {
    logger.warn(`Dashboard already running on port ${dashboardPort}`);
    return dashboardPort;
  }

  // Clean stale port files from dead processes
  cleanStalePortFiles();

  // Expose start time for uptime calc
  (globalThis as any).__agentManagerStartTime = (globalThis as any).__agentManagerStartTime || Date.now();

  setServerStartedAt(new Date());

  serverInstance = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const reqStart = Date.now();
    const origEnd = res.end.bind(res);
    res.end = function (...args: any[]) {
      const ms = Date.now() - reqStart;
      recordRequest({
        ts: new Date().toISOString(),
        method: req.method || 'GET',
        url: req.url || '/',
        status: res.statusCode,
        ms,
      });
      return origEnd(...args);
    } as any;

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
        'Access-Control-Allow-Headers': '*',
      });
      res.end();
      return;
    }

    // API routes
    if (await handleAPI(req, res)) return;

    // Dashboard HTML - ?v=2 serves tabbed V2 layout for A/B testing
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html') {
      const html = parsedUrl.searchParams.get('v') === '2'
        ? getDashboardHTMLV2()
        : getDashboardHTML();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  serverInstance.listen(dashboardPort, '0.0.0.0', () => {
    setActualPort(dashboardPort);
    writePortFile(dashboardPort);
    logger.info(`Dashboard running at http://127.0.0.1:${dashboardPort} (PID ${process.pid})`);
  });

  serverInstance.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`Dashboard port ${dashboardPort} in use - trying ${dashboardPort + 1}`);
      serverInstance = null;
      startDashboard(dashboardPort + 1);
    } else {
      logger.error(`Dashboard error: ${err.message}`);
    }
  });

  return dashboardPort;
}

/** Stop the dashboard server */
export function stopDashboard(): void {
  if (serverInstance) {
    for (const client of sseClients) {
      try { client.end(); } catch { /* ignore */ }
    }
    sseClients.clear();
    serverInstance.close();
    serverInstance = null;
    removePortFile();
    logger.info('Dashboard stopped');
  }
}
