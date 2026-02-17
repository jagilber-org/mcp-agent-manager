// mcp-agent-manager/src/services/dashboard/htmlRenderScriptV2.ts
// V2 render script - extends V1 with tab badges and enriched overview.
// Wraps V1 render() to add V2 extensions after each render cycle.

import { DASHBOARD_RENDER_SCRIPT } from './htmlRenderScript.js';

export const DASHBOARD_RENDER_SCRIPT_V2 = DASHBOARD_RENDER_SCRIPT + `

// ── V2 render extensions ───────────────────────────────────────────────

function setBadge(id, count, colorClass) {
  var el = document.getElementById(id);
  if (!el) return;
  if (count > 0) {
    el.textContent = count > 99 ? '99+' : String(count);
    el.className = 'tab-badge ' + colorClass;
  } else {
    el.textContent = '';
    el.className = 'tab-badge';
  }
}

function updateTabBadges() {
  if (!snapshot) return;
  var s = snapshot;

  // Agents: error count
  var errorAgents = s.agents.filter(function(a) { return a.state === 'error'; }).length;
  setBadge('badge-agents', errorAgents, 'red');

  // Review: pending count
  var pending = (s.reviewQueue && s.reviewQueue.stats) ? s.reviewQueue.stats.pending : 0;
  setBadge('badge-review', pending, 'yellow');

  // Messaging: total messages
  var totalMsgs = s.messaging ? s.messaging.totalMessages : 0;
  setBadge('badge-messaging', totalMsgs, 'green');

  // Events: new since last viewed
  var activeTab = localStorage.getItem('dashboard-tab') || 'overview';
  if (activeTab !== 'events' && window._newEventCount > 0) {
    setBadge('badge-events', window._newEventCount, 'blue');
  } else {
    setBadge('badge-events', 0, 'blue');
  }

  // Automation: active executions
  var activeExec = 0;
  if (s.automation && s.automation.rules) {
    s.automation.rules.forEach(function(r) { activeExec += r.activeExec || 0; });
  }
  setBadge('badge-automation', activeExec, 'yellow');

  // Cross-repo: active dispatches
  var activeCR = (s.crossRepo && s.crossRepo.active) ? s.crossRepo.active.length : 0;
  setBadge('badge-crossrepo', activeCR, 'yellow');
}

function renderOverviewExtras() {
  if (!snapshot) return;
  var s = snapshot;

  // Health strip - colored dots per agent
  var hs = document.getElementById('healthStrip');
  if (hs) {
    if (s.agents.length > 0) {
      hs.innerHTML = '<span class="hs-label">Agent Health</span>' +
        s.agents.map(function(a) {
          return '<span class="health-dot ' + a.state + '" title="' + esc(a.id) + ': ' + a.state + '"></span>';
        }).join('');
    } else {
      hs.innerHTML = '<span class="hs-label">No agents registered</span>';
    }
  }

  // Summary cards
  var sc = document.getElementById('summaryCards');
  if (sc) {
    var errorAgents = s.agents.filter(function(a) { return a.state === 'error'; }).length;
    var pendingReviews = (s.reviewQueue && s.reviewQueue.stats) ? s.reviewQueue.stats.pending : 0;
    var totalMsgs = s.messaging ? s.messaging.totalMessages : 0;
    var channels = s.messaging ? s.messaging.channels.length : 0;
    var autoRules = (s.automation && s.automation.rules) ? s.automation.rules.length : 0;
    var wsCount = s.workspaces ? s.workspaces.length : 0;

    sc.innerHTML =
      '<div class="summary-card"><div class="sc-value' + (errorAgents > 0 ? ' red' : ' green') + '">' + errorAgents + '</div><div class="sc-label">Agent Errors</div></div>' +
      '<div class="summary-card"><div class="sc-value' + (pendingReviews > 0 ? ' yellow' : '') + '">' + pendingReviews + '</div><div class="sc-label">Pending Reviews</div></div>' +
      '<div class="summary-card"><div class="sc-value green">' + totalMsgs + '</div><div class="sc-label">Messages (' + channels + ' ch)</div></div>' +
      '<div class="summary-card"><div class="sc-value">' + autoRules + '</div><div class="sc-label">Auto Rules</div></div>' +
      '<div class="summary-card"><div class="sc-value">' + wsCount + '</div><div class="sc-label">Workspaces</div></div>';
  }

  // Recent activity feed - last 5 events
  var af = document.getElementById('activityFeed');
  if (af) {
    var recent = events.slice(0, 5);
    if (recent.length === 0) {
      af.innerHTML = '<h4>Recent Activity</h4><div class="empty" style="padding:8px 0">No events yet</div>';
    } else {
      af.innerHTML = '<h4>Recent Activity</h4>' +
        recent.map(function(e) {
          var targetTab = 'events';
          if (e.event.indexOf('agent:') === 0) targetTab = 'agents';
          else if (e.event.indexOf('task:') === 0) targetTab = 'tasks';
          else if (e.event.indexOf('skill:') === 0) targetTab = 'skills';
          else if (e.event.indexOf('workspace:') === 0) targetTab = 'workspaces';
          else if (e.event.indexOf('crossrepo:') === 0) targetTab = 'crossrepo';
          else if (e.event.indexOf('message:') === 0) targetTab = 'messaging';
          return '<div class="af-item" onclick="switchTab(\\u0027' + targetTab + '\\u0027)">' +
            '<span class="af-time">' + e.time + '</span>' +
            '<span class="af-event">' + esc(e.event) + '</span>' +
            '<span class="af-detail">' + esc(e.summary) + '</span>' +
            '</div>';
        }).join('');
    }
  }
}

// Track new events for the events tab badge
window._newEventCount = 0;
var _v1AddEvent = addEvent;
addEvent = function(event, data) {
  _v1AddEvent(event, data);
  var activeTab = localStorage.getItem('dashboard-tab') || 'overview';
  if (activeTab !== 'events') {
    window._newEventCount++;
  }
};

// Wrap V1 render to add V2 extensions
var _v1Render = render;
render = function() {
  _v1Render();
  updateTabBadges();
  renderOverviewExtras();
};
`;
