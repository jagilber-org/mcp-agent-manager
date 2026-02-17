// dashboard-live.mjs - runs the MCP server, discovers dashboard port,
// performs operations with delays so you can watch the dashboard update live.
// Usage: node tests/dashboard-live.mjs
//
// The test keeps the server running at the end so you can interact with the dashboard.
// Press Ctrl+C to stop.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

const COPILOT_PATH = path.join(
  process.env.LOCALAPPDATA || '',
  'Microsoft', 'WinGet', 'Packages',
  'GitHub.Copilot.Prerelease_Microsoft.Winget.Source_8wekyb3d8bbwe',
  'copilot.exe'
);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const dashPort = process.env.MCP_AGENT_DASHBOARD_PORT || '3900';

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/server/index.js'],
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      MCP_AGENT_DASHBOARD_PORT: dashPort,
      MCP_LOG_LEVEL: 'info',
    },
    stderr: 'pipe',
  });

  // Capture stderr to detect dashboard port
  let detectedPort = null;
  const portPromise = new Promise(resolve => {
    const timeout = setTimeout(() => resolve(null), 15000);
    const stderrStream = transport._stderrStream;
    // _stderrStream won't exist until start(), so we hook after connect
    const checkStderr = () => {
      const stream = transport.stderr;
      if (stream) {
        stream.on('data', (chunk) => {
          const line = chunk.toString();
          process.stderr.write(line);
          const match = line.match(/Dashboard running at http:\/\/127\.0\.0\.1:(\d+)/);
          if (match && !detectedPort) {
            detectedPort = parseInt(match[1], 10);
            clearTimeout(timeout);
            resolve(detectedPort);
          }
        });
      } else {
        setTimeout(checkStderr, 100);
      }
    };
    checkStderr();
  });

  const client = new Client({ name: 'dashboard-live-test', version: '1.0.0' });
  await client.connect(transport);

  console.log('=== DASHBOARD LIVE TEST ===');
  console.log('Connected to MCP Agent Manager');

  // Wait for dashboard port detection
  const port = await portPromise;
  if (port) {
    console.log(`\n  >>> Dashboard: http://127.0.0.1:${port} <<<\n`);
    console.log('Open the dashboard now and watch it update in real-time.');
    console.log('Waiting 5 seconds before starting...\n');
    await sleep(5000);
  } else {
    console.log(`(Could not detect dashboard port - try http://127.0.0.1:${dashPort})\n`);
  }

  async function call(tool, args) {
    const r = await client.callTool({ name: tool, arguments: args });
    const txt = r.content.map(c => c.text || '').join('');
    try { return JSON.parse(txt); } catch { return { _raw: txt }; }
  }

  // ---- STEP 1: Spawn agents ----
  console.log('--- STEP 1: Spawning agents (watch Agents card & counters) ---');
  await sleep(1000);

  const spawn1 = await call('mgr_spawn_agent', {
    id: 'reviewer',
    name: 'Code Reviewer',
    provider: 'copilot',
    model: 'gpt-4.1',
    tags: ['code-review', 'security'],
    binaryPath: COPILOT_PATH,
  });
  console.log('  Spawned: reviewer (gpt-4.1) -', spawn1.status);
  await sleep(2000);

  const spawn2 = await call('mgr_spawn_agent', {
    id: 'analyst',
    name: 'Data Analyst',
    provider: 'copilot',
    model: 'gpt-4.1',
    tags: ['analysis', 'data'],
    binaryPath: COPILOT_PATH,
  });
  console.log('  Spawned: analyst (gpt-4.1) -', spawn2.status);
  await sleep(2000);

  // ---- STEP 2: Register a custom skill ----
  console.log('\n--- STEP 2: Register custom skill (watch Skills card) ---');
  await sleep(1000);
  const skillReg = await call('mgr_register_skill', {
    id: 'explain-code',
    name: 'Code Explainer',
    description: 'Explain code in plain English',
    promptTemplate: 'Explain this code: {code}',
    strategy: 'single',
    categories: ['code', 'education'],
  });
  console.log('  Registered skill: explain-code -', skillReg.status || 'ok');
  await sleep(2000);

  // ---- STEP 3: Send prompts ----
  console.log('\n--- STEP 3: Sending prompts (watch Tasks/Tokens/Events) ---');
  await sleep(1000);

  console.log('  Sending prompt to reviewer...');
  const p1 = await call('mgr_send_prompt', {
    agentId: 'reviewer',
    prompt: 'In one sentence, what is the purpose of a mutex?',
    maxTokens: 100,
    timeoutMs: 60000,
  });
  console.log(`  Response: ${p1.success ? 'OK' : 'FAIL'} ${p1.tokenCount || 0} tokens, ${p1.latencyMs || 0}ms`);
  console.log(`  > ${(p1.content || '').substring(0, 120)}...`);
  await sleep(3000);

  console.log('  Sending prompt to analyst...');
  const p2 = await call('mgr_send_prompt', {
    agentId: 'analyst',
    prompt: 'In one sentence, explain what a hash table is.',
    maxTokens: 100,
    timeoutMs: 60000,
  });
  console.log(`  Response: ${p2.success ? 'OK' : 'FAIL'} ${p2.tokenCount || 0} tokens, ${p2.latencyMs || 0}ms`);
  console.log(`  > ${(p2.content || '').substring(0, 120)}...`);
  await sleep(3000);

  // ---- STEP 4: Check metrics ----
  console.log('\n--- STEP 4: Metrics snapshot ---');
  const metrics = await call('mgr_get_metrics', {});
  console.log(`  Agents: ${metrics.totalAgents}, Active: ${metrics.activeAgents}`);
  console.log(`  Tasks: ${metrics.totalTasks}, Tokens: ${metrics.totalTokens}, Cost: $${metrics.totalCost}`);
  console.log(`  Skills: ${metrics.skillCount}, Uptime: ${(metrics.uptimeMs / 1000).toFixed(1)}s`);
  await sleep(2000);

  // ---- STEP 5: Stop one agent ----
  console.log('\n--- STEP 5: Stop analyst (watch agent disappear) ---');
  await sleep(1000);
  await call('mgr_stop_agent', { agentId: 'analyst' });
  console.log('  Stopped: analyst');
  await sleep(2000);

  // ---- STEP 6: One more prompt on remaining agent ----
  console.log('\n--- STEP 6: Another prompt to reviewer ---');
  const p3 = await call('mgr_send_prompt', {
    agentId: 'reviewer',
    prompt: 'In one sentence, what is a race condition?',
    maxTokens: 100,
    timeoutMs: 60000,
  });
  console.log(`  Response: ${p3.success ? 'OK' : 'FAIL'} ${p3.tokenCount || 0} tokens, ${p3.latencyMs || 0}ms`);
  console.log(`  > ${(p3.content || '').substring(0, 120)}...`);
  await sleep(2000);

  // ---- Final metrics ----
  console.log('\n--- Final Metrics ---');
  const finalMetrics = await call('mgr_get_metrics', {});
  console.log(`  Agents: ${finalMetrics.totalAgents}, Tasks: ${finalMetrics.totalTasks}`);
  console.log(`  Tokens: ${finalMetrics.totalTokens}, Uptime: ${(finalMetrics.uptimeMs / 1000).toFixed(1)}s`);

  // ---- Keep running ----
  console.log('\n=== TEST COMPLETE ===');
  if (port) {
    console.log(`Dashboard still live at http://127.0.0.1:${port}`);
  }
  console.log('Press Ctrl+C to stop.\n');

  // Keep alive
  await new Promise(() => {});
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
