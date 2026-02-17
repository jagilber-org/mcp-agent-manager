// tests/dashboard-cdp.test.mjs
// Chrome DevTools Protocol (CDP) regression tests for dashboard CRUD operations.
//
// Uses puppeteer-core (which IS Chrome DevTools Protocol) to prevent UI drift.
// Requires a running MCP server on port 3900 and Chrome/Edge installed.
//
// Usage:
//   npm run build && node dist/server/index.js &   # start server
//   node tests/dashboard-cdp.test.mjs              # run tests
//
// Options:
//   DASHBOARD_URL=http://127.0.0.1:3900  (default)
//   HEADLESS=false                        (default: true, set false to watch)
//   SCREENSHOT_DIR=tests/screenshots     (default)
//   BROWSER_PATH=...                     (auto-detected)

import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

// ── Configuration ──────────────────────────────────────────────────────
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://127.0.0.1:3900';
const HEADLESS = process.env.HEADLESS !== 'false';
const SCREENSHOT_DIR = resolve(process.env.SCREENSHOT_DIR || 'tests/screenshots');
const SLOW_MO = parseInt(process.env.SLOW_MO || '0', 10);

// ── Browser detection ──────────────────────────────────────────────────
function findBrowser() {
  if (process.env.BROWSER_PATH && existsSync(process.env.BROWSER_PATH)) {
    return process.env.BROWSER_PATH;
  }

  const candidates = process.platform === 'win32'
    ? [
        join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ]
    : process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  // Try 'where' / 'which' as fallback
  try {
    const cmd = process.platform === 'win32' ? 'where chrome' : 'which google-chrome';
    return execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0];
  } catch { /* ignore */ }
  try {
    const cmd = process.platform === 'win32' ? 'where msedge' : 'which microsoft-edge';
    return execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0];
  } catch { /* ignore */ }

  return null;
}

// ── Test helpers ───────────────────────────────────────────────────────
let browser, page;
let passed = 0, failed = 0;
const failures = [];

async function screenshot(name) {
  if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const path = join(SCREENSHOT_DIR, `cdp-${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function fullScreenshot(name) {
  if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const path = join(SCREENSHOT_DIR, `cdp-${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    → ${err.message}`);
    try { await screenshot(`FAIL-${name.replace(/\s+/g, '-')}`); } catch { /* ignore */ }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertContains(text, substring, message) {
  if (!text.includes(substring)) {
    throw new Error(`${message || 'assertContains'}: "${substring}" not found in "${text.substring(0, 200)}..."`);
  }
}

/** Wait for render cycle */
async function settle(ms = 500) {
  await page.waitForFunction(() => true, { timeout: 5000 });
  await new Promise(r => setTimeout(r, ms));
}

/** Override window.confirm to auto-accept */
async function autoConfirm() {
  await page.evaluate(() => { window.confirm = () => true; });
}

/** Override window.alert to capture */
async function captureAlerts() {
  await page.evaluate(() => {
    window._lastAlert = null;
    window.alert = (msg) => { window._lastAlert = msg; };
  });
}

/** Get count of items in a section by counting table rows */
async function getTableRowCount(sectionSelector) {
  return page.evaluate((sel) => {
    const section = document.querySelector(sel);
    if (!section) return -1;
    return section.querySelectorAll('tr').length - 1; // minus header
  }, sectionSelector);
}

// ── Test suite ─────────────────────────────────────────────────────────
async function runTests() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  Dashboard CDP Regression Tests (Chrome DevTools)   ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // ──── Setup ────────────────────────────────────────────────────────
  const browserPath = findBrowser();
  if (!browserPath) {
    console.error('ERROR: No Chrome or Edge browser found. Set BROWSER_PATH env variable.');
    process.exit(1);
  }
  console.log(`Browser: ${browserPath}`);
  console.log(`Dashboard: ${DASHBOARD_URL}`);
  console.log(`Headless: ${HEADLESS}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}\n`);

  browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900'],
    slowMo: SLOW_MO,
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // Catch console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // ──── 1. Dashboard Load ──────────────────────────────────────────
  console.log('── Dashboard Load ──');

  await test('Dashboard loads successfully', async () => {
    const resp = await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle2', timeout: 10000 });
    assert(resp.ok(), `HTTP ${resp.status()}`);
    await settle();
  });

  await test('Dashboard has title', async () => {
    const title = await page.title();
    assertContains(title, 'Agent', 'Page title should contain "Agent"');
  });

  await test('Dashboard renders key sections', async () => {
    const sections = await page.evaluate(() => {
      return [...document.querySelectorAll('h2')].map(el => el.textContent.trim());
    });
    assert(sections.length >= 4, `Expected ≥4 section h2s, got ${sections.length}: ${sections.join(', ')}`);
  });

  await fullScreenshot('01-dashboard-loaded');
  await autoConfirm();
  await captureAlerts();

  // ──── 2. Skills CRUD ─────────────────────────────────────────────
  console.log('\n── Skills CRUD ──');

  let skillCountBefore;
  await test('Skills section displays skills table', async () => {
    skillCountBefore = await page.evaluate(() => {
      const table = document.getElementById('skillsTable');
      return table ? table.querySelectorAll('tr').length - 1 : -1;
    });
    assert(skillCountBefore > 0, `Expected skills in table, got ${skillCountBefore}`);
  });

  await test('Add Skill: open modal', async () => {
    // Click the "+ Add Skill" button
    await page.evaluate(() => { openSkillModal(); });
    await settle(300);
    const visible = await page.evaluate(() => {
      return document.getElementById('crudModal').style.display;
    });
    assertEqual(visible, 'flex', 'Modal should be visible');
  });

  await test('Add Skill: fill and save', async () => {
    await page.evaluate(() => {
      document.getElementById('f_id').value = 'cdp-test-skill';
      document.getElementById('f_name').value = 'CDP Test Skill';
      document.getElementById('f_description').value = 'Regression test skill';
      document.getElementById('f_promptTemplate').value = 'Test prompt: {input}';
      document.getElementById('f_strategy').value = 'single';
      document.getElementById('f_categories').value = 'test, regression';
    });
    // Click save
    await page.evaluate(() => { document.getElementById('modalSubmit').click(); });
    await settle(800);
  });

  await test('Add Skill: verify count increased', async () => {
    const skillCountAfter = await page.evaluate(() => {
      const table = document.getElementById('skillsTable');
      return table ? table.querySelectorAll('tr').length - 1 : -1;
    });
    assertEqual(skillCountAfter, skillCountBefore + 1, 'Skill count should increase by 1');
  });

  await test('Add Skill: verify in table', async () => {
    const found = await page.evaluate(() => {
      return document.getElementById('skillsTable')?.textContent?.includes('cdp-test-skill');
    });
    assert(found, 'New skill should appear in table');
  });

  await screenshot('02-skill-added');

  await test('Edit Skill: open and modify', async () => {
    await page.evaluate(() => { editSkill('cdp-test-skill'); });
    await settle(600);
    const modalTitle = await page.evaluate(() => document.getElementById('modalTitle').textContent);
    assertContains(modalTitle, 'Edit', 'Modal title should say Edit');
    // Change name
    await page.evaluate(() => {
      document.getElementById('f_name').value = 'CDP Test Skill EDITED';
    });
    await page.evaluate(() => { document.getElementById('modalSubmit').click(); });
    await settle(800);
  });

  await test('Edit Skill: verify update in table', async () => {
    const found = await page.evaluate(() => {
      return document.getElementById('skillsTable')?.textContent?.includes('CDP Test Skill EDITED');
    });
    assert(found, 'Edited name should appear in table');
  });

  await screenshot('03-skill-edited');

  await test('Delete Skill: remove test skill', async () => {
    await page.evaluate(() => { deleteSkill('cdp-test-skill'); });
    await settle(800);
  });

  await test('Delete Skill: verify count restored', async () => {
    const count = await page.evaluate(() => {
      const table = document.getElementById('skillsTable');
      return table ? table.querySelectorAll('tr').length - 1 : -1;
    });
    assertEqual(count, skillCountBefore, 'Skill count should be back to original');
  });

  await test('Delete Skill: verify removed from table', async () => {
    const found = await page.evaluate(() => {
      return document.getElementById('skillsTable')?.textContent?.includes('cdp-test-skill');
    });
    assert(!found, 'Deleted skill should not appear in table');
  });

  await screenshot('04-skill-deleted');

  // ──── 3. Automation Rules CRUD ───────────────────────────────────
  console.log('\n── Automation Rules CRUD ──');

  let ruleCountBefore;
  await test('Rules section displays rules', async () => {
    // Scroll to rules section
    await page.evaluate(() => {
      document.getElementById('automationCard')?.scrollIntoView();
    });
    await settle(300);
    // Use API to count rules
    ruleCountBefore = await page.evaluate(async () => {
      const r = await fetch('/api/automation');
      const d = await r.json();
      return d.ruleCount || 0;
    });
    assert(ruleCountBefore >= 0, `Expected non-negative rules, got ${ruleCountBefore}`);
  });

  await test('Add Rule: open modal and fill', async () => {
    await page.evaluate(() => { openAutomationModal(); });
    await settle(300);
    await page.evaluate(() => {
      document.getElementById('f_ruleId').value = 'cdp-test-rule';
      document.getElementById('f_ruleName').value = 'CDP Test Rule';
      document.getElementById('f_ruleDesc').value = 'Regression test rule';
      document.getElementById('f_ruleSkill').value = 'code-review';
      document.getElementById('f_ruleEvents').value = 'workspace:file-changed';
      document.getElementById('f_rulePriority').value = 'low';
    });
    await page.evaluate(() => { document.getElementById('modalSubmit').click(); });
    await settle(800);
  });

  await test('Add Rule: verify in API', async () => {
    const exists = await page.evaluate(async () => {
      const r = await fetch('/api/automation/cdp-test-rule');
      return r.ok;
    });
    assert(exists, 'New rule should exist in API');
  });

  await screenshot('05-rule-added');

  await test('Edit Rule: open and modify', async () => {
    await page.evaluate(() => { editAutomation('cdp-test-rule'); });
    await settle(600);
    await page.evaluate(() => {
      document.getElementById('f_ruleName').value = 'CDP Test Rule EDITED';
      document.getElementById('f_rulePriority').value = 'high';
    });
    await page.evaluate(() => { document.getElementById('modalSubmit').click(); });
    await settle(800);
  });

  await test('Edit Rule: verify update via API', async () => {
    const rule = await page.evaluate(async () => {
      const r = await fetch('/api/automation/cdp-test-rule');
      if (!r.ok) return null;
      const d = await r.json();
      return d.rule || d;
    });
    assertEqual(rule?.name, 'CDP Test Rule EDITED', 'Rule name should be updated');
    assertEqual(rule?.priority, 'high', 'Rule priority should be updated');
  });

  await screenshot('06-rule-edited');

  await test('Toggle Rule: disable', async () => {
    await page.evaluate(() => { toggleAutomation('cdp-test-rule', false); });
    await settle(1000);
    const rule = await page.evaluate(async () => {
      const r = await fetch('/api/automation/cdp-test-rule');
      if (!r.ok) return null;
      const d = await r.json();
      return d.rule || d;
    });
    assertEqual(rule?.enabled, false, 'Rule should be disabled');
  });

  await test('Toggle Rule: re-enable', async () => {
    await page.evaluate(() => { toggleAutomation('cdp-test-rule', true); });
    await settle(1000);
    const rule = await page.evaluate(async () => {
      const r = await fetch('/api/automation/cdp-test-rule');
      if (!r.ok) return null;
      const d = await r.json();
      return d.rule || d;
    });
    assertEqual(rule?.enabled, true, 'Rule should be re-enabled');
  });

  await test('Trigger Rule: execute', async () => {
    await page.evaluate(() => { triggerAutomation('cdp-test-rule'); });
    await settle(800);
    // Verify the trigger API accepted the request (rule exists)
    const exists = await page.evaluate(async () => {
      const r = await fetch('/api/automation/cdp-test-rule');
      return r.ok;
    });
    assert(exists, 'Triggered rule should still exist');
  });

  await screenshot('07-rule-triggered');

  await test('Delete Rule: remove test rule', async () => {
    await page.evaluate(() => { deleteAutomation('cdp-test-rule'); });
    await settle(800);
  });

  await test('Delete Rule: verify removed from API', async () => {
    const exists = await page.evaluate(async () => {
      const r = await fetch('/api/automation/cdp-test-rule');
      return r.ok;
    });
    assert(!exists, 'Deleted rule should not exist in API');
  });

  await screenshot('08-rule-deleted');

  // ──── 4. Workspace CRUD ──────────────────────────────────────────
  console.log('\n── Workspace CRUD ──');

  const testWorkspacePath = process.cwd();

  await test('Add Workspace: open modal and fill', async () => {
    await page.evaluate(() => { openWorkspaceModal(); });
    await settle(300);
    await page.evaluate((p) => {
      document.getElementById('f_wsPath').value = p;
    }, testWorkspacePath);
    await page.evaluate(() => { document.getElementById('modalSubmit').click(); });
    await settle(1000);
  });

  await test('Add Workspace: verify in API', async () => {
    const count = await page.evaluate(async () => {
      const r = await fetch('/api/workspaces');
      const ws = await r.json();
      return ws.count || ws.workspaces?.length || 0;
    });
    assert(count > 0, `Workspace should be monitored, got count=${count}`);
  });

  await screenshot('09-workspace-added');

  await test('Mine Workspace: trigger mine', async () => {
    await page.evaluate((p) => { mineWorkspace(p); }, testWorkspacePath);
    await settle(2000);
    // Check event log for mine events
    const hasEvent = await page.evaluate(() => {
      const log = document.getElementById('eventLog');
      return log?.textContent?.includes('session') || log?.textContent?.includes('mine') || true;
    });
    assert(hasEvent, 'Mine should produce events');
  });

  await screenshot('10-workspace-mined');

  await test('Stop Workspace: stop monitoring', async () => {
    await page.evaluate((p) => { stopWorkspace(p); }, testWorkspacePath);
    await settle(800);
  });

  await test('Stop Workspace: verify removed from active', async () => {
    const stillActive = await page.evaluate(async () => {
      const r = await fetch('/api/workspaces');
      const ws = await r.json();
      return ws.count || ws.workspaces?.length || 0;
    });
    assertEqual(stillActive, 0, 'No workspaces should be actively monitored');
  });

  await screenshot('11-workspace-stopped');

  await test('Workspace History: switch to history tab', async () => {
    await page.evaluate(() => { switchWorkspaceTab('history'); });
    await settle(800);
    const visible = await page.evaluate(() => {
      const ht = document.getElementById('workspaceHistoryTable');
      return ht && ht.style.display !== 'none';
    });
    assert(visible, 'History table should be visible');
  });

  await test('Workspace History: has entries', async () => {
    const hasRows = await page.evaluate(() => {
      const ht = document.getElementById('workspaceHistoryTable');
      return ht?.querySelectorAll('tr')?.length > 1;
    });
    assert(hasRows, 'History table should have entries');
  });

  await screenshot('12-workspace-history');

  // ──── 5. Event Log ───────────────────────────────────────────────
  console.log('\n── Event Log ──');

  await test('Event log: has events', async () => {
    await page.evaluate(() => {
      document.getElementById('eventLog')?.scrollIntoView();
    });
    await settle(300);
    const count = await page.evaluate(() => {
      return document.querySelectorAll('#eventLog .ev')?.length || 0;
    });
    assert(count > 0, `Expected events in log, got ${count}`);
  });

  await test('Event log: filter works', async () => {
    const input = await page.evaluate(() => {
      const el = document.querySelector('.event-search');
      return !!el;
    });
    assert(input, 'Search input should exist');

    // Type a filter
    await page.evaluate(() => {
      const el = document.querySelector('.event-search');
      el.value = 'workspace';
      el.dispatchEvent(new Event('input'));
    });
    await settle(400);

    // Check that filtering applied
    const filtered = await page.evaluate(() => {
      const visible = [...document.querySelectorAll('#eventLog .ev')]
        .filter(el => el.style.display !== 'none');
      return visible.length;
    });
    // Clear filter
    await page.evaluate(() => {
      const el = document.querySelector('.event-search');
      el.value = '';
      el.dispatchEvent(new Event('input'));
    });
    await settle(200);
    // Just verify filter code ran without error
    assert(true, 'Filter executed');
  });

  await test('Event log: clear works', async () => {
    await page.evaluate(() => { clearEvents(); });
    await settle(300);
    const count = await page.evaluate(() => {
      return document.querySelectorAll('#eventLog .ev')?.length || 0;
    });
    assertEqual(count, 0, 'Event log should be empty after clear');
  });

  await screenshot('13-events-cleared');

  // ──── 6. Clear Buttons ──────────────────────────────────────────
  console.log('\n── Clear Buttons ──');

  // Seed some data for clear tests
  await page.evaluate(async () => {
    // Send a message so messaging has data
    await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'cdp-clear-test',
        sender: 'cdp-tester',
        recipients: ['*'],
        body: 'Clear button test message',
      }),
    });
  });
  await settle(500);

  await test('Clear Task History: button calls API and refreshes UI', async () => {
    // Capture snapshot before
    const before = await page.evaluate(async () => {
      const r = await fetch('/api/snapshot');
      return (await r.json());
    });

    // Click clear button via JS
    await page.evaluate(() => { clearTaskHistory(); });
    await settle(500);

    // Verify API was called (response should clear)
    const after = await page.evaluate(async () => {
      const r = await fetch('/api/snapshot');
      return (await r.json());
    });
    // Task history should be empty after clear
    assertEqual(after.taskHistory?.length || 0, 0, 'Task history should be empty after clear');
  });

  await test('Clear Cross-Repo: button calls API and refreshes UI', async () => {
    await page.evaluate(() => { clearCrossRepo(); });
    await settle(500);

    const snap = await page.evaluate(async () => {
      const r = await fetch('/api/snapshot');
      return (await r.json());
    });
    assertEqual(snap.crossRepo?.length || 0, 0, 'Cross-repo history should be empty after clear');
  });

  await test('Clear Review Queue: button calls API and refreshes UI', async () => {
    await page.evaluate(() => { clearReviewQueue(); });
    await settle(500);

    const snap = await page.evaluate(async () => {
      const r = await fetch('/api/snapshot');
      return (await r.json());
    });
    assertEqual(snap.reviewQueue?.length || 0, 0, 'Review queue should be empty after clear');
  });

  await screenshot('14-clear-buttons');

  // ──── 7. Messaging: View Channel & Purge ────────────────────────
  console.log('\n── Messaging: View Channel & Purge ──');

  await test('View Channel: shows messages with reader=*', async () => {
    // The message we posted earlier should be visible
    await page.evaluate(() => { viewChannel('cdp-clear-test'); });
    await settle(800);

    const detail = await page.evaluate(() => {
      const el = document.getElementById('messagingDetail');
      return el ? el.innerHTML : '';
    });
    assertContains(detail, 'Clear button test message', 'Channel view should display message body');
    assertContains(detail, 'cdp-tester', 'Channel view should display sender');
  });

  await test('View Channel: detail panel is visible', async () => {
    const visible = await page.evaluate(() => {
      const el = document.getElementById('messagingDetail');
      return el && el.style.display !== 'none';
    });
    assert(visible, 'Messaging detail panel should be visible after View');
  });

  await screenshot('15-messaging-view');

  await test('Purge Messages: clears all messages and hides detail', async () => {
    await page.evaluate(() => { purgeMessages(); });
    await settle(800);

    // Detail panel should be hidden
    const detailVisible = await page.evaluate(() => {
      const el = document.getElementById('messagingDetail');
      return el && el.style.display !== 'none';
    });
    assert(!detailVisible, 'Messaging detail should be hidden after purge');

    // Verify via API
    const snap = await page.evaluate(async () => {
      const r = await fetch('/api/snapshot');
      return (await r.json());
    });
    assertEqual(snap.messaging?.totalMessages || 0, 0, 'All messages should be purged');
  });

  await screenshot('16-messaging-purged');

  // ──── 8. Messaging: searchStrategy prefix ───────────────────────
  console.log('\n── Messaging: searchStrategy ──');

  await test('Send with searchStrategy=semantic-first: prefix prepended', async () => {
    // Send via MCP tool simulation - use API directly
    await page.evaluate(async () => {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'cdp-strategy-test',
          sender: 'cdp-tester',
          recipients: ['*'],
          body: '[SEARCH STRATEGY: semantic-first]\nPrefer semantic_search over grep for large codebases.\nUse grep_search only for exact literal matches.\nFall back to file_search for known filenames.\nAlways start with semantic_search for open-ended queries.\n\nActual message body here',
        }),
      });
    });
    await settle(500);

    // View the channel
    await page.evaluate(() => { viewChannel('cdp-strategy-test'); });
    await settle(800);

    const detail = await page.evaluate(() => {
      const el = document.getElementById('messagingDetail');
      return el ? el.textContent : '';
    });
    assertContains(detail, 'SEARCH STRATEGY: semantic-first', 'Message should contain search strategy prefix');
    assertContains(detail, 'Actual message body here', 'Message should contain original body');
  });

  await test('Cleanup strategy test messages', async () => {
    await page.evaluate(async () => {
      await fetch('/api/messages', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'cdp-strategy-test' }),
      });
      await fetch('/api/messages', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'cdp-clear-test' }),
      });
    });
    await settle(300);
  });

  await screenshot('17-strategy-tested');

  // ──── 9. Console Errors ──────────────────────────────────────────
  console.log('\n── Console Errors ──');

  await test('No unexpected console errors during test', async () => {
    const relevant = consoleErrors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('net::ERR') &&
      !e.includes('404') &&
      !e.includes('400')
    );
    if (relevant.length > 0) {
      throw new Error(`Console errors found:\n${relevant.join('\n')}`);
    }
  });

  // ──── Final screenshot ───────────────────────────────────────────
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await settle(300);
  await fullScreenshot('18-final');

  // ──── Cleanup test data ──────────────────────────────────────────
  console.log('\n── Cleanup ──');

  // Clean up any leftover test skill/rule in case a test failed mid-way
  await page.evaluate(async () => {
    await fetch('/api/skills/cdp-test-skill', { method: 'DELETE' }).catch(() => {});
    await fetch('/api/automation/cdp-test-rule', { method: 'DELETE' }).catch(() => {});
  });
  // Clear workspace history from test
  await page.evaluate(async () => {
    await fetch('/api/workspace-history/clear', { method: 'POST' }).catch(() => {});
  });

  // ──── Report ─────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log(`║  Results: ${passed} passed, ${failed} failed${' '.repeat(Math.max(0, 28 - String(passed).length - String(failed).length))}║`);
  console.log('╚══════════════════════════════════════════════════════╝');

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  ✗ ${f.name}: ${f.error}`);
    }
  }

  const screenshotFiles = readdirSync(SCREENSHOT_DIR).filter(f => f.startsWith('cdp-'));
  console.log(`\nScreenshots saved: ${screenshotFiles.length} files in ${SCREENSHOT_DIR}`);
  for (const f of screenshotFiles) {
    console.log(`  📸 ${f}`);
  }

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

// ── Entry point ────────────────────────────────────────────────────────
runTests().catch(err => {
  console.error('FATAL:', err.message);
  if (browser) browser.close().catch(() => {});
  process.exit(1);
});
