// mcp-agent-manager/src/server/index.ts
// MCP Server entry point - assembles tools, resources, and wiring
// Individual registrations live in tools/, resources.ts, and eventWiring.ts

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { initializeProviders } from '../providers/index.js';
import { killAllSessions } from '../providers/copilot.js';
import { logger } from '../services/logger.js';
import { ensureDataDirs, DATA_DIR } from '../services/dataDir.js';
import { initializeEventLog } from '../services/eventLog.js';
import { startDashboard, stopDashboard } from '../services/dashboard/index.js';
import { workspaceMonitor } from '../services/workspace/index.js';
import { automationEngine } from '../services/automation/index.js';
import { agentRegistry } from '../services/agentRegistry.js';
import { skillStore } from '../services/skillStore.js';

// Tool registrations
import { registerAgentTools } from './tools/agentTools.js';
import { registerTaskTools } from './tools/taskTools.js';
import { registerSkillTools } from './tools/skillTools.js';
import { registerAutomationTools } from './tools/automationTools.js';
import { registerMonitorTools } from './tools/monitorTools.js';
import { registerFeedbackTools } from './tools/feedbackTools.js';
import { registerMetaTools } from './tools/metaTools.js';
import { registerCrossRepoTools } from './tools/crossRepoTools.js';
import { registerMessagingTools } from './tools/messagingTools.js';
import { registerBackupTools } from './tools/backupTools.js';
import { registerResources } from './resources.js';
import { wireEvents } from './eventWiring.js';
import { initFeedbackStore } from '../services/feedbackStore.js';
import { initMetaCollector, shutdownMetaCollector } from '../services/metaCollector.js';
import { cancelAllDispatches } from '../services/crossRepoDispatcher.js';
import { initSharedState } from '../services/sharedState.js';

/** Create and configure the MCP server */
function createServer(): McpServer {
  const server = new McpServer({
    name: 'mcp-agent-manager',
    version: '1.0.0',
  });

  // Register all tool groups
  registerAgentTools(server);
  registerTaskTools(server);
  registerSkillTools(server);
  registerAutomationTools(server);
  registerMonitorTools(server);
  registerFeedbackTools(server);
  registerMetaTools(server);
  registerCrossRepoTools(server);
  registerMessagingTools(server);
  registerBackupTools(server);

  // Register resources
  registerResources(server);

  return server;
}

/** Main entry point */
async function main(): Promise<void> {
  logger.info('mcp-agent-manager starting...');

  // Ensure central data dirs exist
  ensureDataDirs();
  logger.info(`Data directory: ${DATA_DIR}`);

  // Initialize shared state persistence (cross-process visibility)
  initSharedState();

  // Initialize subsystems
  skillStore.load();
  agentRegistry.load();
  initializeProviders();
  initializeEventLog();
  initFeedbackStore();

  // Initialize automation engine (must be after skillStore)
  automationEngine.initialize();

  // Initialize meta collector (after event log so events are wired)
  initMetaCollector();

  // Restore persisted workspace monitors
  workspaceMonitor.loadPersistedMonitors();

  // Start the dashboard HTTP server
  startDashboard();

  // Create and start MCP server
  const server = createServer();
  const transport = new StdioServerTransport();

  // Wire event bus → MCP logging/resource notifications
  wireEvents(server);

  await server.connect(transport);

  logger.info(`mcp-agent-manager running (${skillStore.list().length} skills loaded)`);

  // Graceful shutdown helper
  let shuttingDown = false;
  const keepAliveRaw = (process.env.MCP_KEEP_ALIVE || '').toLowerCase().trim();
  // 'persistent' = never exit on stdin close (explicit opt-in for daemon mode)
  // '1'/'true'   = stay alive after stdin close but monitor parent process
  // anything else = exit on stdin close (default)
  const keepAlivePersistent = keepAliveRaw === 'persistent';
  const keepAliveParent = keepAliveRaw === '1' || keepAliveRaw === 'true';
  let parentMonitorTimer: ReturnType<typeof setInterval> | null = null;

  function gracefulShutdown(reason: string): void {
    if (shuttingDown) return;

    // 'persistent' mode: truly ignore stdin close (daemon mode)
    if (keepAlivePersistent && reason === 'stdin closed') {
      logger.info('stdin closed but MCP_KEEP_ALIVE=persistent - running as daemon');
      return;
    }

    // Parent-aware keep-alive: stay alive on stdin close but start monitoring
    // the parent process. When parent exits, shut down after a grace period.
    if (keepAliveParent && reason === 'stdin closed') {
      logger.info('stdin closed - detaching from MCP, monitoring parent process for exit');
      startParentMonitor();
      return;
    }

    // When agents are actively running tasks, don't exit immediately on stdin
    // close - give them a grace period to finish.
    if (reason === 'stdin closed') {
      const active = agentRegistry.getAll().filter((a: { state: string }) => a.state === 'running' || a.state === 'busy');
      if (active.length > 0) {
        logger.info(`stdin closed but ${active.length} agent(s) still active - grace period 30s`);
        setTimeout(() => gracefulShutdown('agent grace period expired'), 30_000);
        return;
      }
    }

    shuttingDown = true;
    if (parentMonitorTimer) clearInterval(parentMonitorTimer);
    logger.info(`Shutting down (${reason})...`);
    shutdownMetaCollector();
    cancelAllDispatches();
    automationEngine.shutdown();
    workspaceMonitor.stopAll(true);
    stopDashboard();
    killAllSessions();
    process.exit(0);
  }

  /** Poll parent PID; shut down when parent is gone. */
  function startParentMonitor(): void {
    if (parentMonitorTimer) return; // already monitoring
    const parentPid = process.ppid;
    if (!parentPid || parentPid <= 1) {
      // No meaningful parent (init/systemd) - treat as daemon
      logger.info('No parent process to monitor (ppid=1), running as daemon');
      return;
    }
    logger.info(`Monitoring parent PID ${parentPid} - will exit when parent terminates`);
    parentMonitorTimer = setInterval(() => {
      if (!isParentAlive(parentPid)) {
        logger.info(`Parent PID ${parentPid} is gone - initiating shutdown`);
        // Give active agents a brief grace period
        const active = agentRegistry.getAll().filter((a: { state: string }) => a.state === 'running' || a.state === 'busy');
        if (active.length > 0) {
          logger.info(`${active.length} agent(s) active - waiting 10s before exit`);
          setTimeout(() => gracefulShutdown('parent exited + grace expired'), 10_000);
        } else {
          gracefulShutdown('parent exited');
        }
        if (parentMonitorTimer) clearInterval(parentMonitorTimer);
        parentMonitorTimer = null;
      }
    }, 5_000); // check every 5s
    parentMonitorTimer.unref(); // don't prevent natural exit
  }

  function isParentAlive(pid: number): boolean {
    try {
      process.kill(pid, 0); // signal 0 = existence check
      return true;
    } catch {
      return false;
    }
  }

  // Windows: VS Code kills stdio servers by closing stdin
  process.stdin.on('end', () => gracefulShutdown('stdin closed'));
  process.stdin.on('close', () => gracefulShutdown('stdin closed'));

  // POSIX signals
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
