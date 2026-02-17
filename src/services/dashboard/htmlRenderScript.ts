// mcp-agent-manager/src/services/dashboard/htmlRenderScript.ts
// Client-side JavaScript: render(), renderSkillsTable(), helpers.
// Exported as a string for inclusion in the dashboard HTML template.

export const DASHBOARD_RENDER_SCRIPT = `
function fmt(ms) {
  if (!ms || ms < 0) return '-';
  var s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  var m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + (s % 60) + 's';
  var h = Math.floor(m / 60);
  return h + 'h ' + (m % 60) + 'm';
}

function getExpandedRows() {
  var expanded = [];
  document.querySelectorAll('tr[id][style*="table-row"], div[id][style*="block"]').forEach(function(el) {
    if (el.id && el.style.display !== 'none') expanded.push(el.id);
  });
  return expanded;
}

function restoreExpandedRows(expanded) {
  expanded.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) {
      if (el.tagName === 'TR') el.style.display = 'table-row';
      else el.style.display = 'block';
    }
  });
}

function render() {
  if (!snapshot) return;

  // Seed event log from snapshot on first render (shows history on page load)
  if (events.length === 0 && snapshot.events && snapshot.events.length > 0) {
    for (var ei = 0; ei < snapshot.events.length; ei++) {
      var ev = snapshot.events[ei];
      var evTime = ev.ts ? new Date(ev.ts).toTimeString().split(' ')[0] : '--:--:--';
      events.push({ time: evTime, event: ev.event || 'unknown', summary: summarize(ev.event, ev), data: ev });
    }
    // Most recent first
    events.reverse();
    if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  }

  var expanded = getExpandedRows();
  var s = snapshot;
  window._lastSnapshot = s;
  document.getElementById('mAgents').textContent = s.agentCount;
  document.getElementById('mActive').textContent = s.activeAgents;
  document.getElementById('mSkills').textContent = s.skillCount;
  document.getElementById('mTasks').textContent = s.router.totalTasks;
  document.getElementById('mTokens').textContent = (s.router.totalEstimatedTokens ? '~' : '') + (s.router.totalTokens || 0).toLocaleString();
  document.getElementById('mCost').textContent = s.router.totalPremiumRequests
    ? s.router.totalPremiumRequests + ' reqs / $' + (s.router.totalCost || 0).toFixed(4)
    : '$' + (s.router.totalCost || 0).toFixed(4);
  document.getElementById('uptime').textContent = fmt(s.uptimeMs);
  if (s.pid) document.getElementById('hdrPid').textContent = s.pid;

  // Agents table
  var at = document.getElementById('agentsTable');
  var kab = document.getElementById('killAllBtn');
  if (s.agents.length === 0) {
    at.innerHTML = '<div class="empty">No agents registered</div>';
    kab.innerHTML = '';
  } else {
    kab.innerHTML = '<button class="btn-kill-all" onclick="killAllAgents()">Kill All</button>';
    at.innerHTML = '<table class="agent-table"><tr><th>ID</th><th>Provider</th><th>Model</th><th>State</th><th>Tags</th><th>Tasks</th><th>Tokens</th><th></th></tr>' +
      s.agents.map(function(a) {
        return '<tr><td><strong>' + esc(a.id) + '</strong><br><span style="color:var(--muted);font-size:11px">' + esc(a.name || '') + '</span></td>' +
        '<td>' + esc(a.provider) + '</td>' +
        '<td>' + esc(a.model) + '</td>' +
        '<td><span class="badge ' + a.state + '">' + a.state + '</span></td>' +
        '<td>' + (a.tags || []).map(function(t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</td>' +
        '<td>' + a.tasksCompleted + ' / ' + (a.tasksCompleted + a.tasksFailed) + '</td>' +
        '<td>' + (a.tokensEstimated ? '~' : '') + (a.totalTokens || 0).toLocaleString() + (a.premiumRequests ? '<br><span style="color:var(--muted);font-size:10px">' + a.premiumRequests + ' premium reqs</span>' : '') + '</td>' +
        '<td><button class="btn-action" data-agent-id="' + esc(a.id) + '" onclick="editAgent(this.dataset.agentId)">Edit</button><button class="btn-kill" data-agent-id="' + esc(a.id) + '" onclick="killAgent(this.dataset.agentId)">Kill</button></td></tr>';
      }).join('') + '</table>';
  }

  // Skills table with category filter
  var st = document.getElementById('skillsTable');
  var sf = document.getElementById('skillFilter');
  if (s.skills.length === 0) {
    st.innerHTML = '<div class="empty">No skills loaded</div>';
    sf.innerHTML = '';
  } else {
    var allCats = new Set();
    s.skills.forEach(function(sk) { (sk.categories || []).forEach(function(c) { allCats.add(c); }); });
    var cats = Array.from(allCats).sort();
    sf.innerHTML = '<span class="filter-btn active" data-cat="all" onclick="filterSkills(this.dataset.cat)">All (' + s.skills.length + ')</span>' +
      cats.map(function(c) {
        var count = s.skills.filter(function(sk) { return (sk.categories || []).includes(c); }).length;
        return '<span class="filter-btn' + (c === 'speckit' ? ' speckit' : '') + '" data-cat="' + esc(c) + '" onclick="filterSkills(this.dataset.cat)">' + esc(c) + ' (' + count + ')</span>';
      }).join('');
    renderSkillsTable(s.skills, window._skillFilter || 'all');
  }

  // Workspaces
  var wt = document.getElementById('workspacesTable');
  var mc = document.getElementById('monitorCount');
  var workspaces = s.workspaces || [];
  if (workspaces.length === 0) {
    wt.innerHTML = '<div class="empty">No workspaces monitored \\u2014 use mgr_monitor_workspace tool to start</div>';
    mc.textContent = '';
  } else {
    mc.textContent = '(' + workspaces.length + ')';
    wt.innerHTML = workspaces.map(function(ws) {
      var shortPath = ws.path.replace(/\\\\\\\\/g, '/').split('/').slice(-2).join('/');
      var uptime = fmt(ws.monitoringMs);
      var encodedPath = encodeURIComponent(ws.path);
      var html = '<div class="ws-header"><span class="ws-path">' + esc(ws.path) + '</span>' +
        '<span class="ws-id">' + (ws.workspaceId ? 'ID: ' + esc(ws.workspaceId.substring(0, 12)) + '...' : 'no workspace ID') + '</span>' +
        '<span class="ws-id">' + ws.watcherCount + ' watchers \\u00b7 ' + uptime + ' uptime</span>' +
        '<span style="margin-left:auto"><button class="btn-action" onclick="mineWorkspace(\\\'' + esc(jsStr(ws.path)) + '\\\')">Mine</button>' +
        '<button class="btn-action danger" onclick="stopWorkspace(\\\'' + esc(jsStr(ws.path)) + '\\\')">Stop</button></span></div>';

      html += '<div class="ws-detail">';
      html += '<div class="ws-detail-section ws-sessions-section"><h4>Chat Sessions (' + ws.sessionCount + ')';
      if (ws.memoryCount > 0) html += ' \\u00b7 ' + ws.memoryCount + ' memories';
      html += '</h4>';
      if (ws.sessionMetas && ws.sessionMetas.length > 0) {
        var totalPrompt = 0, totalOutput = 0, totalReqs = 0, totalErrors = 0;
        ws.sessionMetas.forEach(function(sm) {
          totalPrompt += sm.promptTokens || 0;
          totalOutput += sm.outputTokens || 0;
          totalReqs += sm.requestCount || 0;
          totalErrors += sm.errorCount || 0;
        });
        html += '<div class="ws-session-totals">' +
          '<span class="tag">Requests: ' + totalReqs + '</span>' +
          '<span class="tag">Prompt: ' + totalPrompt.toLocaleString() + '</span>' +
          '<span class="tag">Output: ' + totalOutput.toLocaleString() + '</span>' +
          (totalErrors > 0 ? '<span class="tag" style="background:#5c1919;color:#f48771">Errors: ' + totalErrors + '</span>' : '') +
          '</div>';
        html += '<table class="session-table"><thead><tr>' +
          '<th>Title</th><th>Model</th><th>Reqs</th><th>Prompt</th><th>Output</th><th>Errors</th><th>Files</th><th>Last</th>' +
          '</tr></thead><tbody>';
        var sorted = ws.sessionMetas.slice().sort(function(a, b) { return (b.lastRequestTs || 0) - (a.lastRequestTs || 0); });
        sorted.slice(0, 15).forEach(function(sm) {
          var title = sm.title || sm.sessionId.substring(0, 12) + '...';
          var model = sm.models && sm.models.length > 0 ? sm.models[sm.models.length - 1].split('/').pop() : '-';
          var lastTs = sm.lastRequestTs ? new Date(sm.lastRequestTs).toLocaleString() : '-';
          html += '<tr>' +
            '<td title="' + esc(sm.sessionId) + '">' + esc(title.length > 40 ? title.substring(0, 37) + '...' : title) + '</td>' +
            '<td>' + esc(model) + '</td>' +
            '<td style="text-align:right">' + sm.requestCount + '</td>' +
            '<td style="text-align:right">' + (sm.promptTokens || 0).toLocaleString() + '</td>' +
            '<td style="text-align:right">' + (sm.outputTokens || 0).toLocaleString() + '</td>' +
            '<td style="text-align:right">' + (sm.errorCount > 0 ? '<span style="color:#f48771">' + sm.errorCount + '</span>' : '0') + '</td>' +
            '<td style="text-align:right">' + (sm.filesModified || 0) + '</td>' +
            '<td>' + esc(lastTs) + '</td>' +
            '</tr>';
        });
        html += '</tbody></table>';
        if (sorted.length > 15) html += '<div class="ws-change">... +' + (sorted.length - 15) + ' more sessions</div>';
      } else if (ws.knownSessions && ws.knownSessions.length > 0) {
        html += ws.knownSessions.slice(0, 5).map(function(sid) {
          return '<div class="ws-session">' + esc(sid.substring(0, 20)) + '...</div>';
        }).join('');
        if (ws.knownSessions.length > 5) html += '<div class="ws-change">... +' + (ws.knownSessions.length - 5) + ' more</div>';
      } else {
        html += '<div class="ws-change">No sessions found</div>';
      }
      html += '</div>';

      html += '</div>';
      html += '<div class="ws-detail-section ws-git-section" style="width:100%;box-sizing:border-box"><h4>Git Activity</h4>';
      if (ws.gitEvents && ws.gitEvents.length > 0) {
        html += ws.gitEvents.slice(0, 5).map(function(g) {
          return '<div class="ws-git-event"><span class="ws-git-label">' + esc(g.event) + '</span> ' + esc(g.detail) + '</div>';
        }).join('');
      } else {
        html += '<div class="ws-change">No git events yet</div>';
      }
      html += '</div>';

      if (ws.recentChanges && ws.recentChanges.length > 0) {
        html += '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">Recent: ' +
          ws.recentChanges.slice(0, 3).map(function(c) { return '<span class="tag">' + esc(c.kind) + ': ' + esc(c.file) + '</span>'; }).join(' ') +
          '</div>';
      }

      return html;
    }).join('');
  }

  // Automation rules
  var autoDiv = document.getElementById('automationTable');
  var autoStatus = document.getElementById('automationStatus');
  var autoExecLog = document.getElementById('automationExecLog');
  var auto = s.automation || { enabled: true, rules: [], recentExecutions: [] };
  autoStatus.innerHTML = auto.enabled
    ? '<span class="badge running">Engine ON</span> ' + auto.rules.length + ' rule(s)'
    : '<span class="badge stopped">Engine OFF</span>';
  if (auto.rules.length === 0) {
    autoDiv.innerHTML = '<div class="empty">No automation rules \\u2014 use mgr_create_automation tool to add event-driven skill triggers</div>';
  } else {
    autoDiv.innerHTML = '<table><tr><th>Rule</th><th>Events</th><th>Skill</th><th>Conditions</th><th>Priority</th><th>Throttle</th><th>Stats</th><th>Status</th><th>Actions</th></tr>' +
      auto.rules.map(function(r) {
        return '<tr><td><strong>' + esc(r.id) + '</strong><br><span style="color:var(--muted);font-size:11px">' + esc(r.name) + '</span>' +
        (r.description ? '<br><span style="color:var(--muted);font-size:10px;font-style:italic">' + esc(r.description.substring(0, 80)) + '</span>' : '') + '</td>' +
        '<td>' + r.events.map(function(e) { return '<span class="tag">' + esc(e) + '</span>'; }).join('') +
        (r.filters ? '<br><span style="color:var(--muted);font-size:10px">filter: ' + esc(r.filters) + '</span>' : '') + '</td>' +
        '<td><span class="badge running">' + esc(r.skillId) + '</span></td>' +
        '<td>' + (r.conditions.length > 0 ? r.conditions.map(function(c) { return '<span class="tag">' + esc(c) + '</span>'; }).join('') : '<span style="color:var(--muted)">none</span>') + '</td>' +
        '<td>' + esc(r.priority) + '</td>' +
        '<td>' + (r.throttle || 'none') + '</td>' +
        '<td>' + r.totalExec + ' total / ' + r.successCount + ' ok / ' + r.failureCount + ' fail' +
        (r.throttledCount ? ' / ' + r.throttledCount + ' throttled' : '') +
        (r.skippedCount ? ' / ' + r.skippedCount + ' skipped' : '') +
        (r.avgDurationMs ? '<br><span style="color:var(--muted);font-size:11px">avg ' + r.avgDurationMs + 'ms</span>' : '') + '</td>' +
        '<td><span class="badge ' + (r.enabled ? 'running' : 'stopped') + '">' + (r.enabled ? 'enabled' : 'disabled') + '</span>' +
        (r.activeExec > 0 ? ' <span class="badge busy">' + r.activeExec + ' active</span>' : '') +
        (r.lastExecutedAt ? '<br><span style="color:var(--muted);font-size:10px">last: ' + esc(r.lastExecutedAt.split('T')[1].split('.')[0] || '') + '</span>' : '') + '</td>' +
        '<td style="white-space:nowrap">' +
        '<button class="btn-action ' + (r.enabled ? 'toggle-on' : 'toggle-off') + '" onclick="toggleAutomation(\\\'' + esc(r.id) + '\\\'' + ',' + !r.enabled + ')">' + (r.enabled ? 'Disable' : 'Enable') + '</button>' +
        '<button class="btn-action" onclick="editAutomation(\\\'' + esc(r.id) + '\\\')">Edit</button>' +
        '<button class="btn-action" onclick="triggerAutomation(\\\'' + esc(r.id) + '\\\')">Trigger</button>' +
        '<button class="btn-action danger" onclick="deleteAutomation(\\\'' + esc(r.id) + '\\\')">Del</button></td></tr>';
      }).join('') + '</table>';
  }
  if (auto.recentExecutions && auto.recentExecutions.length > 0) {
    autoExecLog.innerHTML = '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">Recent Executions (' + auto.recentExecutions.length + '):</div>' +
      auto.recentExecutions.map(function(e) {
        var execId = 'exec-' + (e.executionId || '').replace(/[^a-zA-Z0-9]/g, '');
        var params = e.resolvedParams ? Object.entries(e.resolvedParams).map(function(kv) { return esc(kv[0]) + '=' + esc(String(kv[1]).substring(0, 60)); }).join(', ') : '';
        var triggerInfo = e.triggerData ? Object.entries(e.triggerData).map(function(kv) { return esc(kv[0]) + ': ' + esc(String(kv[1]).substring(0, 60)); }).join(' | ') : '';
        return '<div class="ev" style="flex-wrap:wrap;cursor:pointer" data-toggle="' + execId + '">' +
          '<span class="ts">' + (e.startedAt || '').split('T')[1].split('.')[0] + '</span>' +
          '<span class="name">' + esc(e.ruleId) + '</span>' +
          '<span class="badge ' + (e.status === 'success' ? 'running' : e.status === 'failed' ? 'error' : 'idle') + '">' + esc(e.status) + '</span> ' +
          '<span class="detail">' + esc(e.triggerEvent) + ' \\u2192 ' + esc(e.skillId) + (e.durationMs ? ' (' + e.durationMs + 'ms)' : '') +
          (e.retryAttempt > 0 ? ' retry #' + e.retryAttempt : '') + '</span>' +
          (e.error ? '<span style="color:var(--red);font-size:11px;margin-left:8px"> ' + esc(e.error) + '</span>' : '') +
          (e.resultSummary ? '<span style="color:var(--green);font-size:11px;margin-left:8px"> ' + esc(e.resultSummary.substring(0, 100)) + '</span>' : '') +
          '<div id="' + execId + '" style="display:none;width:100%;padding:6px 0 2px 0;font-size:11px;color:var(--muted);border-top:1px solid var(--border);margin-top:4px">' +
          (e.taskId ? '<div>Task: <span style="color:var(--accent)">' + esc(e.taskId) + '</span></div>' : '') +
          (e.executionId ? '<div>Exec: ' + esc(e.executionId) + '</div>' : '') +
          (params ? '<div>Params: ' + params + '</div>' : '') +
          (triggerInfo ? '<div>Trigger: ' + triggerInfo + '</div>' : '') +
          (e.completedAt ? '<div>Completed: ' + esc(e.completedAt.split('T')[1].split('.')[0] || '') + '</div>' : '') +
          '</div></div>';
      }).join('');
  } else {
    autoExecLog.innerHTML = '';
  }

  // Review Queue
  var rq = s.reviewQueue || { stats: { pending: 0, approved: 0, dismissed: 0, flagged: 0, total: 0 }, items: [] };
  var reviewStatus = document.getElementById('reviewStatus');
  var reviewFilters = document.getElementById('reviewFilters');
  var reviewTable = document.getElementById('reviewTable');
  reviewStatus.innerHTML = rq.stats.total > 0
    ? '<span class="badge ' + (rq.stats.pending > 0 ? 'busy' : 'running') + '">' + rq.stats.pending + ' pending</span> ' +
      '<span style="color:var(--muted);font-size:11px">' + rq.stats.approved + ' approved / ' + rq.stats.dismissed + ' dismissed' +
      (rq.stats.flagged > 0 ? ' / <span style="color:var(--red)">' + rq.stats.flagged + ' flagged</span>' : '') + '</span>'
    : '';
  window._reviewFilter = window._reviewFilter || 'all';
  reviewFilters.innerHTML = ['all', 'pending', 'approved', 'dismissed', 'flagged'].map(function(f) {
    var count = f === 'all' ? rq.stats.total : rq.stats[f] || 0;
    return '<span class="filter-btn' + (window._reviewFilter === f ? ' active' : '') +
      (f === 'flagged' && count > 0 ? ' speckit' : '') +
      '" data-filter="' + esc(f) + '" onclick="filterReviews(this.dataset.filter)">' + f[0].toUpperCase() + f.slice(1) + ' (' + count + ')</span>';
  }).join('');
  var filteredItems = rq.items;
  if (window._reviewFilter !== 'all') {
    filteredItems = rq.items.filter(function(i) { return i.status === window._reviewFilter; });
  }
  if (filteredItems.length === 0) {
    reviewTable.innerHTML = '<div class="empty">' + (rq.stats.total === 0 ? 'No task results yet' : 'No items matching filter') + '</div>';
  } else {
    reviewTable.innerHTML = filteredItems.map(function(item) {
      var statusBadge = item.status === 'pending' ? 'busy' : item.status === 'approved' ? 'running' : item.status === 'flagged' ? 'error' : 'idle';
      var execStatusBadge = item.executionStatus === 'success' ? 'running' : item.executionStatus === 'failed' ? 'error' : 'idle';
      var rid = item.reviewId.replace(/[^a-zA-Z0-9]/g, '');
      return '<div class="review-item" id="ri-' + rid + '">' +
        '<div class="review-header">' +
        '<span class="badge ' + execStatusBadge + '">' + esc(item.executionStatus) + '</span> ' +
        '<strong>' + esc(item.ruleId) + '</strong> \\u2192 ' + esc(item.skillId) +
        (item.durationMs ? ' <span style="color:var(--muted)">(' + (item.durationMs / 1000).toFixed(1) + 's)</span>' : '') +
        '<span style="margin-left:auto;font-size:10px;color:var(--muted)">' + esc(item.createdAt.split('T')[1].split('.')[0] || '') + '</span>' +
        '</div>' +
        (item.resultSummary
          ? '<div class="review-result" onclick="this.classList.toggle(\\u0027expanded\\u0027)" title="Click to expand">' + esc(item.resultSummary) + '</div>'
          : '') +
        (item.error ? '<div style="color:var(--red);font-size:11px;margin:2px 0">Error: ' + esc(item.error) + '</div>' : '') +
        (item.githubIssueUrl ? '<div style="font-size:11px;margin:2px 0"><a href="' + esc(item.githubIssueUrl) + '" target="_blank" style="color:#8b5cf6">\\uD83D\\uDD17 GitHub Issue</a></div>' : '') +
        (item.notes ? '<div style="color:var(--accent);font-size:11px;margin:2px 0">Notes: ' + esc(item.notes) + '</div>' : '') +
        '<div class="review-actions">' +
        '<span class="badge ' + statusBadge + '" style="margin-right:6px">' + esc(item.status) + '</span>' +
        (item.status === 'pending'
          ? '<button class="review-btn approve" data-rid="' + esc(item.reviewId) + '" data-action="approve" onclick="reviewAction(this.dataset.rid, this.dataset.action)">\\u2713 Approve</button>' +
            '<button class="review-btn dismiss" data-rid="' + esc(item.reviewId) + '" data-action="dismiss" onclick="reviewAction(this.dataset.rid, this.dataset.action)">\\u2715 Dismiss</button>' +
            '<button class="review-btn flag" data-rid="' + esc(item.reviewId) + '" data-action="flag" onclick="reviewAction(this.dataset.rid, this.dataset.action)">\\u26A0 Flag</button>'
          : '<button class="review-btn" data-rid="' + esc(item.reviewId) + '" data-action="pending" onclick="reviewAction(this.dataset.rid, this.dataset.action)">Reset</button>') +
        '<button class="review-btn issue" data-rid="' + esc(item.reviewId) + '" onclick="createGitHubIssue(this.dataset.rid)" title="Create GitHub Issue">\\uD83D\\uDCCB Issue</button>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  // Task History
  var thStatus = document.getElementById('taskHistoryStatus');
  var thTable = document.getElementById('taskHistoryTable');
  var recentTasks = (s.router && s.router.recentTasks) || [];
  if (recentTasks.length === 0) {
    thTable.innerHTML = '<div class="empty">No tasks executed yet \\u2014 results appear here when skills are invoked via assign_task or automation</div>';
    thStatus.textContent = '';
  } else {
    var thOk = recentTasks.filter(function(t) { return t.success; }).length;
    var thFail = recentTasks.length - thOk;
    thStatus.innerHTML = '<span class="badge running">' + thOk + ' ok</span>' +
      (thFail > 0 ? ' <span class="badge error">' + thFail + ' failed</span>' : '') +
      ' <span style="color:var(--muted)">(' + recentTasks.length + ' recent)</span>';
    thTable.innerHTML = '<table><tr><th>Task ID</th><th>Skill</th><th>Strategy</th><th>Agents</th><th>Status</th><th>Tokens</th><th>Latency</th><th>Preview</th><th>Time</th></tr>' +
      recentTasks.map(function(t) {
        var tid = 'th-' + (t.taskId || '').replace(/[^a-zA-Z0-9]/g, '');
        return '<tr style="cursor:pointer" onclick="var el=document.getElementById(\\u0027' + tid + '\\u0027);if(el)el.style.display=el.style.display===\\u0027none\\u0027?\\u0027table-row\\u0027:\\u0027none\\u0027">' +
          '<td><code style="font-size:11px">' + esc(t.taskId) + '</code></td>' +
          '<td><span class="badge running">' + esc(t.skillId) + '</span></td>' +
          '<td>' + esc(t.strategy) + '</td>' +
          '<td>' + t.agents.map(function(a) { return '<span class="tag">' + esc(a) + '</span>'; }).join('') + '</td>' +
          '<td><span class="badge ' + (t.success ? 'running' : 'error') + '">' + (t.success ? 'OK' : 'FAIL') + '</span></td>' +
          '<td>' + (t.tokensEstimated ? '~' : '') + (t.totalTokens || 0).toLocaleString() + '</td>' +
          '<td>' + (t.totalLatencyMs / 1000).toFixed(1) + 's</td>' +
          '<td><div style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--muted)" title="' + esc(t.contentPreview) + '">' + esc(t.contentPreview.substring(0, 80)) + '</div></td>' +
          '<td style="font-size:11px;color:var(--muted)">' + esc((t.completedAt || '').split('T')[1].split('.')[0] || '') + '</td>' +
          '</tr>' +
          '<tr id="' + tid + '" style="display:none"><td colspan="9"><div style="padding:8px;background:var(--surface);border-radius:4px;font-size:12px;white-space:pre-wrap;max-height:200px;overflow-y:auto">' +
          (t.error ? '<span style="color:var(--red)">Error: ' + esc(t.error) + '</span>\\n' : '') +
          esc(t.contentPreview) +
          '</div></td></tr>';
      }).join('') + '</table>';
  }

  // Cross-Repo Dispatches
  var crStatus = document.getElementById('crossRepoStatus');
  var crTable = document.getElementById('crossRepoTable');
  var cr = s.crossRepo || { active: [], history: [] };
  var allDispatches = cr.active.concat(cr.history);
  if (allDispatches.length === 0) {
    crTable.innerHTML = '<div class="empty">No cross-repo dispatches yet \\u2014 use mgr_cross_repo_dispatch to send tasks to other repos</div>';
    crStatus.textContent = '';
  } else {
    var crActive = cr.active.length;
    crStatus.innerHTML = (crActive > 0 ? '<span class="badge busy">' + crActive + ' running</span> ' : '') +
      '<span style="color:var(--muted)">' + cr.history.length + ' completed</span>';
    crTable.innerHTML = '<table><tr><th>Dispatch ID</th><th>Repo</th><th>Model</th><th>Status</th><th>Tokens</th><th>Duration</th><th>Prompt</th><th>Time</th></tr>' +
      allDispatches.map(function(d) {
        var shortRepo = (d.repoPath || '').replace(/\\\\\\\\/g, '/').split('/').slice(-2).join('/');
        var statusClass = d.status === 'completed' ? 'running' : d.status === 'running' ? 'busy' : d.status === 'failed' ? 'error' : 'idle';
        var did = 'cr-' + (d.dispatchId || '').replace(/[^a-zA-Z0-9]/g, '');
        var timeStr = d.completedAt ? (d.completedAt.split('T')[1] || '').split('.')[0] : (d.queuedAt ? (d.queuedAt.split('T')[1] || '').split('.')[0] : '-');
        return '<tr style="cursor:pointer" onclick="var el=document.getElementById(\\u0027' + did + '\\u0027);if(el)el.style.display=el.style.display===\\u0027none\\u0027?\\u0027table-row\\u0027:\\u0027none\\u0027">' +
          '<td><code style="font-size:11px">' + esc(d.dispatchId) + '</code></td>' +
          '<td title="' + esc(d.repoPath) + '"><span class="tag">' + esc(shortRepo) + '</span></td>' +
          '<td>' + esc(d.model || '-') + '</td>' +
          '<td><span class="badge ' + statusClass + '">' + esc(d.status) + '</span></td>' +
          '<td>' + (d.estimatedTokens || 0).toLocaleString() + '</td>' +
          '<td>' + (d.durationMs ? (d.durationMs / 1000).toFixed(1) + 's' : '-') + '</td>' +
          '<td><div style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--muted)" title="' + esc(d.prompt) + '">' + esc((d.prompt || '').substring(0, 80)) + '</div></td>' +
          '<td style="font-size:11px;color:var(--muted)">' + esc(timeStr) + '</td>' +
          '</tr>' +
          '<tr id="' + did + '" style="display:none"><td colspan="8"><div style="padding:8px;background:var(--surface);border-radius:4px;font-size:12px;white-space:pre-wrap;max-height:200px;overflow-y:auto">' +
          '<strong>Repo:</strong> ' + esc(d.repoPath) + '\\n' +
          '<strong>Prompt:</strong> ' + esc(d.prompt) + '\\n' +
          (d.error ? '<span style="color:var(--red)">Error: ' + esc(d.error) + '</span>' : '') +
          '</div></td></tr>';
      }).join('') + '</table>';
  }

  // Delegated click handler for expandable execution rows
  document.querySelectorAll('[data-toggle]').forEach(function(el) {
    el.onclick = function() {
      var target = document.getElementById(el.getAttribute('data-toggle'));
      if (target) target.style.display = target.style.display === 'none' ? 'block' : 'none';
    };
  });

  // Restore expanded rows after re-render
  restoreExpandedRows(expanded);

  // Messaging card
  var msgEl = document.getElementById('messagingChannels');
  var msgStatus = document.getElementById('messagingStatus');
  var msgTotal = document.getElementById('mMsgTotal');
  var msgChCount = document.getElementById('mMsgChannels');
  var messaging = s.messaging || { channels: [], totalMessages: 0 };
  msgTotal.textContent = messaging.totalMessages;
  msgChCount.textContent = messaging.channels.length;
  if (messaging.channels.length === 0) {
    msgEl.innerHTML = '<div class=\"empty\">No messages yet \\u2014 use mgr_send_message tool or Compose button to send</div>';
    msgStatus.textContent = '';
  } else {
    msgStatus.textContent = messaging.totalMessages + ' msg across ' + messaging.channels.length + ' channel(s)';
    msgEl.innerHTML = '<table><tr><th>Channel</th><th>Messages</th><th>Latest Activity</th><th>Actions</th></tr>' +
      messaging.channels.map(function(ch) {
        return '<tr>' +
          '<td><strong>' + esc(ch.channel) + '</strong></td>' +
          '<td>' + ch.messageCount + '</td>' +
          '<td>' + esc((ch.latestAt || '').replace('T', ' ').split('.')[0]) + '</td>' +
          '<td><button class=\"btn-action\" onclick=\"viewChannel(\\u0027' + esc(ch.channel) + '\\u0027)\">View</button></td>' +
          '</tr>';
      }).join('') + '</table>';
  }

  // Events
  var el = document.getElementById('eventLog');
  var ec = document.getElementById('eventCount');
  var searchTerm = (window._eventFilter || '').toLowerCase();
  var filtered = searchTerm
    ? events.filter(function(e) { return e.event.toLowerCase().indexOf(searchTerm) >= 0 || e.summary.toLowerCase().indexOf(searchTerm) >= 0; })
    : events;
  ec.textContent = filtered.length === events.length
    ? '(' + events.length + ')'
    : '(' + filtered.length + '/' + events.length + ')';
  if (filtered.length === 0) {
    el.innerHTML = events.length === 0
      ? '<div class="empty">Waiting for events...</div>'
      : '<div class="empty">No events matching "' + esc(searchTerm) + '"</div>';
  } else {
    el.innerHTML = filtered.map(function(e) {
      var highlight = searchTerm && (e.event.toLowerCase().indexOf(searchTerm) >= 0 || e.summary.toLowerCase().indexOf(searchTerm) >= 0);
      return '<div class="ev' + (highlight && searchTerm ? ' highlight' : '') + '"><span class="ts">' + e.time + '</span><span class="name">' + esc(e.event) + '</span><span class="detail">' + esc(e.summary) + '</span></div>';
    }).join('');
    el.scrollTop = 0;
  }
}

function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function jsStr(s) { return (s || '').replace(/\\\\/g, '\\\\\\\\'); }

function renderSkillsTable(skills, filter) {
  var st = document.getElementById('skillsTable');
  var filtered = filter === 'all' ? skills : skills.filter(function(sk) { return (sk.categories || []).includes(filter); });
  document.querySelectorAll('.filter-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.textContent.startsWith(filter === 'all' ? 'All' : filter));
  });
  if (filtered.length === 0) {
    st.innerHTML = '<div class="empty">No skills in category "' + esc(filter) + '"</div>';
    return;
  }
  st.innerHTML = '<table><tr><th>ID / Name</th><th>Description</th><th>Strategy</th><th>Targets</th><th>Categories</th><th>Config</th><th>Actions</th></tr>' +
    filtered.map(function(sk) {
      return '<tr class="skill-row' + ((sk.categories || []).includes('speckit') ? ' speckit-row' : '') + '"><td><strong>' + esc(sk.id) + '</strong><br><span style="color:var(--muted);font-size:11px">' + esc(sk.name) + '</span>' +
      (sk.version ? '<br><span class="skill-meta">v' + esc(sk.version) + '</span>' : '') + '</td>' +
      '<td><div class="skill-desc" title="' + esc(sk.description) + '">' + esc(sk.description) + '</div></td>' +
      '<td><span class="badge running">' + esc(sk.strategy) + '</span></td>' +
      '<td>' + (sk.targetAgents && sk.targetAgents.length ? sk.targetAgents.map(function(t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') : (sk.targetTags && sk.targetTags.length ? sk.targetTags.map(function(t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') : '<span style="color:var(--muted)">any</span>')) + '</td>' +
      '<td>' + (sk.categories || []).map(function(c) { return '<span class="tag' + (c === 'speckit' ? ' speckit-tag' : '') + '">' + esc(c) + '</span>'; }).join('') + '</td>' +
      '<td class="skill-meta">' + (sk.maxTokens ? sk.maxTokens + ' max' : '') + (sk.mergeResults ? ' merge' : '') + (sk.timeoutMs ? ' ' + (sk.timeoutMs/1000) + 's timeout' : '') + '</td>' +
      '<td style="white-space:nowrap"><button class="btn-action" onclick="editSkill(\\\'' + esc(sk.id) + '\\\')">Edit</button><button class="btn-action danger" onclick="deleteSkill(\\\'' + esc(sk.id) + '\\\')">Del</button></td></tr>';
    }).join('') + '</table>';
}

function filterSkills(cat) {
  window._skillFilter = cat;
  if (window._lastSnapshot) renderSkillsTable(window._lastSnapshot.skills, cat);
}

function summarize(event, data) {
  switch (event) {
    case 'agent:registered': return data.agentId + ' (' + data.provider + '/' + data.model + ')';
    case 'agent:unregistered': return data.agentId;
    case 'agent:state-changed': return data.agentId + ': ' + data.previousState + ' -> ' + data.newState;
    case 'task:started': return data.taskId + ' [' + data.strategy + '] ' + data.agentCount + ' agent(s)';
    case 'task:completed': return data.taskId + ' ' + (data.success ? 'OK' : 'FAIL') + ' ' + data.totalTokens + ' tokens ' + data.totalLatencyMs + 'ms';
    case 'skill:registered': return data.skillId + ' (' + data.strategy + ')';
    case 'skill:removed': return data.skillId;
    case 'workspace:monitoring': return data.path + ' (' + data.sessionCount + ' sessions)';
    case 'workspace:stopped': return data.path;
    case 'workspace:file-changed': return data.kind + ': ' + data.file;
    case 'workspace:session-updated': return data.sessionId.substring(0, 8) + '... (' + data.sizeBytes + ' bytes)';
    case 'workspace:git-event': return data.event + ': ' + data.detail;
    case 'workspace:remote-update': return data.remote + '/' + data.branch + ': ' + data.detail;
    case 'crossrepo:dispatched': return data.dispatchId + ' -> ' + (data.repoPath || '').split(/[\\\\/]/).slice(-2).join('/') + ' (' + data.model + ')';
    case 'crossrepo:completed': return data.dispatchId + ' ' + (data.success ? 'OK' : 'FAIL') + ' ' + (data.estimatedTokens || 0) + ' tokens ' + (data.durationMs || 0) + 'ms';
    case 'message:received': return data.channel + ': ' + data.sender + ' -> ' + (data.recipients || []).join(', ');
    case 'server:started': return 'PID ' + (data.pid || '?') + ' (' + (data.nodeVersion || '') + ')';
    default: return JSON.stringify(data).substring(0, 120);
  }
}

function addEvent(event, data) {
  var now = new Date();
  var time = now.toTimeString().split(' ')[0];
  events.unshift({ time: time, event: event, summary: summarize(event, data), data: data });
  if (events.length > MAX_EVENTS) events.pop();
}

function updateUptimeOnly() {
  if (!snapshot) return;
  document.getElementById('uptime').textContent = fmt(snapshot.uptimeMs);
}
`;
