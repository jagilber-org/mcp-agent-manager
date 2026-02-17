// mcp-agent-manager/src/services/dashboard/htmlV2.ts
// V2 dashboard HTML - tabbed layout with enriched overview.
// Serves at /?v=2 for A/B testing alongside V1.

import { DASHBOARD_CSS_V2 } from './htmlStylesV2.js';
import { DASHBOARD_RENDER_SCRIPT_V2 } from './htmlRenderScriptV2.js';
import { DASHBOARD_ACTION_SCRIPT_V2 } from './htmlActionScriptV2.js';

export function getDashboardHTMLV2(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MCP Agent Manager</title>
<style>${DASHBOARD_CSS_V2}</style>
</head>
<body>
<div class="header">
  <h1>&#x1F916; MCP Agent Manager</h1>
  <div class="status">
    <span class="dot" id="sseDot"></span>
    <span id="sseStatus">Connecting...</span>
    &nbsp;&middot;&nbsp; Uptime: <span id="uptime">-</span>
    &nbsp;&middot;&nbsp; PID: <span id="hdrPid">-</span>
    &nbsp;&middot;&nbsp; <span id="hdrInstances" style="cursor:pointer;position:relative" onclick="toggleInstanceDropdown()" title="Click to see all instances"></span>
    <div id="instanceDropdown" style="display:none;position:absolute;right:120px;top:40px;background:#1e1e2e;border:1px solid #444;border-radius:6px;padding:8px 12px;z-index:999;min-width:280px;box-shadow:0 4px 12px rgba(0,0,0,0.5)"></div>
    &nbsp;&middot;&nbsp; <button class="debug-toggle" onclick="toggleDebug()">Debug</button>
    &nbsp;&middot;&nbsp; <a class="v-toggle" href="/">Classic View</a>
  </div>
</div>
<div class="tab-bar">
  <button class="tab-btn active" data-tab="overview" onclick="switchTab('overview')">Overview</button>
  <button class="tab-btn" data-tab="agents" onclick="switchTab('agents')">Agents <span class="tab-badge" id="badge-agents"></span></button>
  <button class="tab-btn" data-tab="skills" onclick="switchTab('skills')">Skills</button>
  <button class="tab-btn" data-tab="workspaces" onclick="switchTab('workspaces')">Workspaces</button>
  <button class="tab-btn" data-tab="automation" onclick="switchTab('automation')">Automation <span class="tab-badge" id="badge-automation"></span></button>
  <button class="tab-btn" data-tab="tasks" onclick="switchTab('tasks')">Tasks</button>
  <button class="tab-btn" data-tab="crossrepo" onclick="switchTab('crossrepo')">Cross-Repo <span class="tab-badge" id="badge-crossrepo"></span></button>
  <button class="tab-btn" data-tab="review" onclick="switchTab('review')">Review <span class="tab-badge" id="badge-review"></span></button>
  <button class="tab-btn" data-tab="messaging" onclick="switchTab('messaging')">Messaging <span class="tab-badge" id="badge-messaging"></span></button>
  <button class="tab-btn" data-tab="events" onclick="switchTab('events')">Events <span class="tab-badge" id="badge-events"></span></button>
  <button class="tab-btn" data-tab="backups" onclick="switchTab('backups')">Backups</button>
</div>
<div class="grid">

  <!-- ═══ Overview Tab ═══ -->
  <div class="tab-panel active" id="tab-overview">
    <div class="card full">
      <h2>Overview <a class="doc-link" href="/api/docs/overview" target="_blank" title="Panel documentation">?</a></h2>
      <div class="metrics">
        <div class="metric"><div class="value accent" id="mAgents">0</div><div class="label">Agents</div></div>
        <div class="metric"><div class="value green" id="mActive">0</div><div class="label">Active</div></div>
        <div class="metric"><div class="value purple" id="mSkills">0</div><div class="label">Skills</div></div>
        <div class="metric"><div class="value yellow" id="mTasks">0</div><div class="label">Tasks</div></div>
        <div class="metric"><div class="value accent" id="mTokens">0</div><div class="label">Tokens</div></div>
        <div class="metric"><div class="value" id="mCost">$0</div><div class="label">Cost</div></div>
      </div>
      <div id="healthStrip" class="health-strip"></div>
      <div class="overview-extras">
        <div id="summaryCards" class="summary-cards"></div>
        <div id="activityFeed" class="activity-feed"></div>
      </div>
    </div>
  </div>

  <!-- ═══ Agents Tab ═══ -->
  <div class="tab-panel" id="tab-agents">
    <div class="card full">
      <h2>Agents <a class="doc-link" href="/api/docs/agents" target="_blank" title="Panel documentation">?</a> <span id="killAllBtn"></span>
        <button class="btn-add" onclick="openAgentModal()">+ Add Agent</button>
      </h2>
      <div id="agentsTable"><div class="empty">No agents registered</div></div>
    </div>
  </div>

  <!-- ═══ Skills Tab ═══ -->
  <div class="tab-panel" id="tab-skills">
    <div class="card full">
      <h2>Skills <a class="doc-link" href="/api/docs/skills" target="_blank" title="Panel documentation">?</a> <span id="skillFilter" style="font-size:12px;font-weight:normal;margin-left:12px"></span>
        <button class="btn-add" onclick="openSkillModal()">+ Add Skill</button>
      </h2>
      <div id="skillsTable" style="max-height:600px;overflow-y:auto;overflow-x:hidden"><div class="empty">No skills loaded</div></div>
    </div>
  </div>

  <!-- ═══ Workspaces Tab ═══ -->
  <div class="tab-panel" id="tab-workspaces">
    <div class="card full monitor-card" id="monitorCard">
      <h2>Monitored Workspaces <a class="doc-link" href="/api/docs/workspaces" target="_blank" title="Panel documentation">?</a> <span class="monitor-count" id="monitorCount"></span>
        <button class="btn-add" onclick="openWorkspaceModal()">+ Add Workspace</button>
      </h2>
      <div id="workspaceTabs" style="margin-bottom:8px">
        <span class="filter-btn active" data-tab="active" onclick="switchWorkspaceTab('active')">Active</span>
        <span class="filter-btn" data-tab="history" onclick="switchWorkspaceTab('history')">History</span>
      </div>
      <div id="workspacesTable"><div class="empty">No workspaces monitored - use mgr_monitor_workspace tool to start</div></div>
      <div id="workspaceHistoryTable" style="display:none"><div class="empty">Loading history...</div></div>
    </div>
  </div>

  <!-- ═══ Automation Tab ═══ -->
  <div class="tab-panel" id="tab-automation">
    <div class="card full" id="automationCard">
      <h2>Automation Rules <a class="doc-link" href="/api/docs/automation" target="_blank" title="Panel documentation">?</a> <span style="font-size:12px;font-weight:normal;margin-left:8px" id="automationStatus"></span>
        <button class="btn-add" onclick="openAutomationModal()">+ Add Rule</button>
      </h2>
      <div id="automationTable"><div class="empty">No automation rules - use mgr_create_automation tool to add event-driven skill triggers</div></div>
      <div id="automationExecLog" style="margin-top:12px"></div>
    </div>
  </div>

  <!-- ═══ Tasks Tab ═══ -->
  <div class="tab-panel" id="tab-tasks">
    <div class="card full" id="taskHistoryCard" style="border-left: 3px solid var(--yellow)">
      <h2>Task History <a class="doc-link" href="/api/docs/task-history" target="_blank" title="Panel documentation">?</a> <span style="font-size:12px;font-weight:normal;margin-left:8px" id="taskHistoryStatus"></span>
        <button class="btn-action danger" onclick="clearTaskHistory()" style="float:right;margin-top:-2px">Clear</button>
      </h2>
      <div id="taskHistoryTable" style="max-height:600px;overflow-y:auto;overflow-x:hidden"><div class="empty">No tasks executed yet - results appear here when skills are invoked via assign_task or automation</div></div>
    </div>
  </div>

  <!-- ═══ Cross-Repo Tab ═══ -->
  <div class="tab-panel" id="tab-crossrepo">
    <div class="card full" id="crossRepoCard" style="border-left: 3px solid var(--accent)">
      <h2>Cross-Repo Dispatches <a class="doc-link" href="/api/docs/cross-repo" target="_blank" title="Panel documentation">?</a> <span style="font-size:12px;font-weight:normal;margin-left:8px" id="crossRepoStatus"></span>
        <button class="btn-action danger" onclick="clearCrossRepo()" style="float:right;margin-top:-2px">Clear</button>
      </h2>
      <div id="crossRepoTable" style="max-height:600px;overflow-y:auto;overflow-x:hidden"><div class="empty">No cross-repo dispatches yet - use mgr_cross_repo_dispatch to send tasks to other repos</div></div>
    </div>
  </div>

  <!-- ═══ Review Tab ═══ -->
  <div class="tab-panel" id="tab-review">
    <div class="card full" id="reviewCard" style="border-left: 3px solid var(--purple)">
      <h2>Task Results & Review Queue <a class="doc-link" href="/api/docs/review-queue" target="_blank" title="Panel documentation">?</a> <span style="font-size:12px;font-weight:normal;margin-left:8px" id="reviewStatus"></span>
        <button class="btn-action danger" onclick="clearReviewQueue()" style="float:right;margin-top:-2px">Clear</button>
      </h2>
      <div id="reviewFilters" style="margin-bottom:8px"></div>
      <div id="reviewTable" style="max-height:600px;overflow-y:auto;overflow-x:hidden"><div class="empty">No task results yet - results appear here when automation rules complete</div></div>
    </div>
  </div>

  <!-- ═══ Messaging Tab ═══ -->
  <div class="tab-panel" id="tab-messaging">
    <div class="card full" id="messagingCard" style="border-left: 3px solid var(--green)">
      <h2>Messaging <a class="doc-link" href="/api/docs/messaging" target="_blank" title="Panel documentation">?</a> <span style="font-size:12px;font-weight:normal;margin-left:8px" id="messagingStatus"></span>
        <button class="btn-add" onclick="openComposeModal()">+ Compose</button>
        <button class="btn-action danger" onclick="purgeMessages()" style="float:right;margin-top:-2px">Purge All</button>
      </h2>
      <div class="metrics" style="margin-bottom:12px">
        <div class="metric"><div class="value green" id="mMsgTotal">0</div><div class="label">Messages</div></div>
        <div class="metric"><div class="value accent" id="mMsgChannels">0</div><div class="label">Channels</div></div>
      </div>
      <div id="messagingChannels"><div class="empty">No messages yet \u2014 use mgr_send_message tool or Compose button to send</div></div>
      <div id="messagingDetail" style="display:none;margin-top:12px"></div>
    </div>
  </div>

  <!-- ═══ Events Tab ═══ -->
  <div class="tab-panel" id="tab-events">
    <div class="card full">
      <h2>Event Log <a class="doc-link" href="/api/docs/event-log" target="_blank" title="Panel documentation">?</a> <span class="event-count" id="eventCount"></span>
        <span class="event-controls">
          <input type="text" id="eventSearch" class="event-search" placeholder="Filter events..." oninput="filterEvents()">
          <button class="btn-action danger" onclick="clearEvents()">Clear</button>
        </span>
      </h2>
      <div class="events" id="eventLog"><div class="empty">Waiting for events...</div></div>
    </div>
  </div>

  <!-- ═══ Backups Tab ═══ -->
  <div class="tab-panel" id="tab-backups">
    <div class="card full" style="border-left: 3px solid var(--yellow)">
      <h2>Backup &amp; Restore
        <button class="btn-add" onclick="createBackup()">+ Create Backup</button>
        <button class="btn-action" onclick="openImportModal()" style="float:right;margin-top:-2px;margin-right:8px">Import</button>
      </h2>
      <div class="backup-controls" style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
        <label style="font-size:12px;color:var(--muted)">Custom path:</label>
        <input type="text" id="backupCustomPath" style="flex:1;max-width:400px;background:#161b22;border:1px solid #30363d;color:#e6edf3;padding:4px 8px;border-radius:4px;font-size:12px" placeholder="Leave empty for default (APPDATA/mcp-agent-manager/backups/)">
        <button class="btn-action" onclick="refreshBackups()">Refresh</button>
      </div>
      <div id="backupsTable"><div class="empty">Loading backups...</div></div>
    </div>
  </div>

  <!-- ═══ Debug Panel (toggle, not a tab) ═══ -->
  <div class="card full debug-panel" id="debugPanel">
    <h2>Debug Info <a class="doc-link" href="/api/docs/overview" target="_blank" title="Panel documentation">?</a></h2>
    <div class="debug-grid">
      <div class="debug-section">
        <h3>Active Instances</h3>
        <div id="debugInstances"><div class="empty">Loading...</div></div>
      </div>
      <div class="debug-section">
        <h3>Server</h3>
        <div id="debugServer"><div class="empty">Loading...</div></div>
      </div>
      <div class="debug-section">
        <h3>Memory</h3>
        <div id="debugMemory"><div class="empty">Loading...</div></div>
      </div>
      <div class="debug-section">
        <h3>Event Counters</h3>
        <div id="debugEvents"><div class="empty">Loading...</div></div>
      </div>
      <div class="debug-section">
        <h3>Environment</h3>
        <div id="debugEnv"><div class="empty">Loading...</div></div>
      </div>
      <div class="debug-section" style="grid-column: 1 / -1">
        <h3>Recent Requests</h3>
        <div class="req-log" id="debugRequests"><div class="empty">No requests yet</div></div>
      </div>
      <div class="debug-section" style="grid-column: 1 / -1">
        <h3>Raw Snapshot</h3>
        <pre id="debugRaw">-</pre>
      </div>
    </div>
  </div>

</div>
<div id="crudModal" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeModal()">
  <div class="modal-content">
    <div class="modal-header">
      <h3 id="modalTitle">Form</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div id="modalBody"></div>
    <div id="askAgentResponse" class="ask-agent-response" style="display:none"></div>
    <div class="modal-footer">
      <button class="btn-ask-agent" id="modalAskAgent" onclick="askAgent()" style="display:none">&#x1F916; Ask Agent</button>
      <div style="flex:1"></div>
      <button class="btn-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-submit" id="modalSubmit">Save</button>
    </div>
  </div>
</div>
<script>
var MAX_EVENTS = 100;
var events = [];
var snapshot = null;
${DASHBOARD_RENDER_SCRIPT_V2}
${DASHBOARD_ACTION_SCRIPT_V2}
</script>
</body>
</html>`;
}
