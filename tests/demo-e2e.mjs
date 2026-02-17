// End-to-end demo: spawn a real Copilot agent, send a prompt, get a response
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

const COPILOT_PATH = path.join(
  process.env.LOCALAPPDATA || '',
  'Microsoft', 'WinGet', 'Packages',
  'GitHub.Copilot.Prerelease_Microsoft.Winget.Source_8wekyb3d8bbwe',
  'copilot.exe'
);

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/server/index.js'],
    cwd: path.resolve('.'),
  });
  const client = new Client({ name: 'demo', version: '1.0.0' });
  await client.connect(transport);
  console.log('=== CONNECTED TO MCP AGENT MANAGER ===\n');

  async function call(tool, args) {
    const r = await client.callTool({ name: tool, arguments: args });
    const txt = r.content.map(c => c.text || '').join('');
    try { return JSON.parse(txt); } catch { return { _raw: txt }; }
  }

  // 1. Spawn a copilot agent using CLI mode (no --acp flag)
  console.log('--- STEP 1: Spawn Copilot Agent (gpt-4.1, CLI mode) ---');
  const spawn1 = await call('mgr_spawn_agent', {
    id: 'reviewer',
    name: 'Code Reviewer',
    provider: 'copilot',
    model: 'gpt-4.1',
    tags: ['code-review'],
    binaryPath: COPILOT_PATH,
  });
  console.log('Spawn result:', JSON.stringify(spawn1, null, 2));

  // 2. List agents
  console.log('\n--- STEP 2: List Agents ---');
  const agents = await call('mgr_list_agents', {});
  console.log('Agents:', JSON.stringify(agents, null, 2));

  // 3. Send a real prompt - copilot.exe -p "..." --silent will run and return
  console.log('\n--- STEP 3: Send Prompt ---');
  console.log('  Prompt: "In exactly 2 sentences, explain what dependency injection is."');
  console.log('  Waiting for copilot.exe to respond (~10-30 seconds)...\n');
  const promptResult = await call('mgr_send_prompt', {
    agentId: 'reviewer',
    prompt: 'In exactly 2 sentences, explain what dependency injection is.',
    maxTokens: 200,
    timeoutMs: 60000,
  });
  console.log('  Success:', promptResult.success);
  console.log('  Model:', promptResult.model);
  console.log('  Tokens:', promptResult.tokenCount);
  console.log('  Latency:', promptResult.latencyMs + 'ms');
  if (promptResult.error) console.log('  Error:', promptResult.error);
  console.log('\n  === AGENT RESPONSE ===');
  console.log('  ' + (promptResult.content || '(empty)'));
  console.log('  ======================\n');

  // 4. Check metrics
  console.log('--- STEP 4: Agent Metrics ---');
  const metrics = await call('mgr_get_metrics', {});
  console.log('Metrics:', JSON.stringify(metrics, null, 2));

  // 5. Stop agent
  console.log('\n--- STEP 5: Stop Agent ---');
  const stop = await call('mgr_stop_agent', { agentId: 'reviewer' });
  console.log('Stop:', JSON.stringify(stop, null, 2));

  console.log('\n=== DEMO COMPLETE ===');
  await client.close();
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
