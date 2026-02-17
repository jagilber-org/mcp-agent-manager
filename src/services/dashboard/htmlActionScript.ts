// mcp-agent-manager/src/services/dashboard/htmlActionScript.ts
// Client-side JavaScript: SSE/polling connectivity, kill, review, debug.
// Exported as a string for inclusion in the dashboard HTML template.

export const DASHBOARD_ACTION_SCRIPT = `
var pollTimer = null;
async function pollSnapshot() {
  try {
    var res = await fetch('/api/snapshot');
    if (res.ok) {
      snapshot = await res.json();
      render();
      var dot = document.getElementById('sseDot');
      var status = document.getElementById('sseStatus');
      dot.className = 'dot connected';
      status.textContent = 'Connected (polling)';
    }
  } catch(e) { /* ignore */ }
  try {
    var iRes = await fetch('/api/instances');
    if (iRes.ok) { renderInstances(await iRes.json()); }
  } catch(e) { /* best-effort */ }
}

function startPolling() {
  pollSnapshot();
  if (!pollTimer) pollTimer = setInterval(pollSnapshot, 2000);
}

function connectSSE() {
  startPolling();
  try {
    var es = new EventSource('/api/events');
    var dot = document.getElementById('sseDot');
    var status = document.getElementById('sseStatus');

    es.onopen = function() {
      dot.className = 'dot connected';
      status.textContent = 'Connected (SSE)';
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      pollTimer = setInterval(pollSnapshot, 10000);
    };

    es.addEventListener('snapshot', function(e) {
      snapshot = JSON.parse(e.data);
      render();
    });

    // NOTE: This list mirrors ALL_EVENT_NAMES from events.ts
    // It must be inline here because this is client-side browser JS
    var eventNames = [
      'agent:registered', 'agent:unregistered', 'agent:state-changed',
      'task:started', 'task:completed',
      'skill:registered', 'skill:removed',
      'workspace:monitoring', 'workspace:stopped', 'workspace:file-changed',
      'workspace:session-updated', 'workspace:git-event', 'workspace:remote-update',
      'crossrepo:dispatched', 'crossrepo:completed',
      'message:received'
    ];
    for (var i = 0; i < eventNames.length; i++) {
      (function(evt) {
        es.addEventListener(evt, function(e) {
          var data = JSON.parse(e.data);
          addEvent(evt, data);
          render();
        });
      })(eventNames[i]);
    }

    es.onerror = function() {
      dot.className = 'dot disconnected';
      status.textContent = 'Reconnecting... (polling active)';
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(pollSnapshot, 2000);
    };
  } catch(e) {
    console.warn('SSE not available, using polling:', e);
  }
}

async function killAgent(id) {
  if (!confirm('Kill agent "' + id + '"?')) return;
  try {
    var res = await fetch('/api/agents/' + encodeURIComponent(id) + '/kill', { method: 'POST' });
    var data = await res.json();
    if (data.error) alert('Error: ' + data.error);
  } catch(e) {
    alert('Failed to kill agent: ' + e.message);
  }
}

async function killAllAgents() {
  if (!confirm('Kill ALL agents?')) return;
  try {
    await fetch('/api/agents/kill-all', { method: 'POST' });
  } catch(e) {
    alert('Failed: ' + e.message);
  }
}

// ── Agent CRUD ─────────────────────────────────────────────────────────
function openAgentModal(existing) {
  var isEdit = !!existing;
  var title = isEdit ? 'Edit Agent: ' + existing.id : 'Add Agent';
  var body =
    fieldHTML('agentId', 'ID', 'text', existing ? existing.id : '', { required: true, placeholder: 'my-agent' }) +
    fieldHTML('agentName', 'Name', 'text', existing ? existing.name : '', { required: true }) +
    fieldHTML('agentProvider', 'Provider', 'select', existing ? existing.provider : 'copilot', { options: ['copilot', 'anthropic', 'openai', 'custom'] }) +
    fieldHTML('agentModel', 'Model', 'text', existing ? existing.model : 'gpt-4o', { required: true }) +
    fieldHTML('agentTags', 'Tags (comma-separated)', 'text', existing ? (existing.tags || []).join(', ') : '') +
    fieldHTML('agentMaxConcurrency', 'Max Concurrency', 'number', existing ? existing.maxConcurrency : '1') +
    fieldHTML('agentCostMultiplier', 'Cost Multiplier', 'number', existing ? existing.costMultiplier : '1') +
    fieldHTML('agentTimeoutMs', 'Timeout (ms)', 'number', existing ? existing.timeoutMs : '60000') +
    fieldHTML('agentCanMutate', 'Can Mutate', 'select', existing ? String(existing.canMutate) : 'false', { options: ['false', 'true'] });
  openModal(title, body, function() { submitAgent(isEdit); }, 'agent');
  if (isEdit) setTimeout(function() { var el = document.getElementById('f_agentId'); if (el) el.disabled = true; }, 0);
}

async function submitAgent(isEdit) {
  var payload = {
    id: getField('agentId'),
    name: getField('agentName'),
    provider: getField('agentProvider'),
    model: getField('agentModel'),
    tags: getField('agentTags').split(',').map(function(s) { return s.trim(); }).filter(Boolean),
    canMutate: getField('agentCanMutate') === 'true',
  };
  var maxC = parseInt(getField('agentMaxConcurrency'), 10);
  if (!isNaN(maxC) && maxC > 0) payload.maxConcurrency = maxC;
  var costM = parseFloat(getField('agentCostMultiplier'));
  if (!isNaN(costM) && costM > 0) payload.costMultiplier = costM;
  var timeout = parseInt(getField('agentTimeoutMs'), 10);
  if (!isNaN(timeout) && timeout > 0) payload.timeoutMs = timeout;

  try {
    var url = isEdit ? '/api/agents/' + encodeURIComponent(payload.id) : '/api/agents';
    var res = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    var data = await res.json();
    if (!res.ok) { alert('Error: ' + (data.error || res.statusText)); return; }
    closeModal();
  } catch(e) { alert('Failed: ' + e.message); }
}

async function editAgent(id) {
  try {
    var res = await fetch('/api/agents/' + encodeURIComponent(id));
    if (!res.ok) { alert('Agent not found'); return; }
    var agent = await res.json();
    openAgentModal(agent);
  } catch(e) { alert('Failed: ' + e.message); }
}

function filterReviews(filter) {
  window._reviewFilter = filter;
  render();
}

async function createGitHubIssue(reviewId) {
  try {
    var res = await fetch('/api/review-queue/' + encodeURIComponent(reviewId) + '/create-issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    var data = await res.json();
    if (data.success && data.issueUrl) {
      window.open(data.issueUrl, '_blank');
    } else {
      alert('Issue creation failed: ' + (data.error || 'Unknown error'));
    }
  } catch(e) {
    alert('Failed: ' + e.message);
  }
}

async function reviewAction(reviewId, action) {
  try {
    var res = await fetch('/api/review-queue/' + encodeURIComponent(reviewId) + '/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      var err = await res.json();
      alert('Error: ' + (err.error || res.statusText));
    }
  } catch(e) {
    alert('Failed: ' + e.message);
  }
}

connectSSE();

// ── Event log controls ─────────────────────────────────────────────────
window._eventFilter = '';

function filterEvents() {
  window._eventFilter = (document.getElementById('eventSearch') || {}).value || '';
  render();
}

async function clearEvents() {
  try {
    await fetch('/api/events/clear', { method: 'DELETE' });
  } catch(e) { /* ignore */ }
  events.length = 0;
  window._eventFilter = '';
  var search = document.getElementById('eventSearch');
  if (search) search.value = '';
  // Clear snapshot events so render() doesn't re-seed
  if (snapshot && snapshot.events) snapshot.events.length = 0;
  render();
  pollSnapshot();
}

async function clearTaskHistory() {
  if (!confirm('Clear task history?')) return;
  try {
    await fetch('/api/task-history', { method: 'DELETE' });
    pollSnapshot();
  } catch(e) { alert('Failed: ' + e.message); }
}

async function clearCrossRepo() {
  if (!confirm('Clear cross-repo dispatch history?')) return;
  try {
    await fetch('/api/cross-repo', { method: 'DELETE' });
    pollSnapshot();
  } catch(e) { alert('Failed: ' + e.message); }
}

async function clearReviewQueue() {
  if (!confirm('Clear review queue?')) return;
  try {
    await fetch('/api/review-queue', { method: 'DELETE' });
    pollSnapshot();
  } catch(e) { alert('Failed: ' + e.message); }
}

// ── Modal helpers ──────────────────────────────────────────────────────
var _modalEntityType = ''; // 'agent' | 'skill' | 'automation' | ''

function closeModal() {
  document.getElementById('crudModal').style.display = 'none';
  document.getElementById('askAgentResponse').style.display = 'none';
  document.getElementById('askAgentResponse').innerHTML = '';
  _modalEntityType = '';
}

function openModal(title, bodyHtml, onSubmit, entityType) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  document.getElementById('modalSubmit').onclick = onSubmit;
  document.getElementById('askAgentResponse').style.display = 'none';
  document.getElementById('askAgentResponse').innerHTML = '';
  _modalEntityType = entityType || '';
  // Show Ask Agent button only for entity CRUD modals
  var askBtn = document.getElementById('modalAskAgent');
  askBtn.style.display = _modalEntityType ? '' : 'none';
  document.getElementById('crudModal').style.display = 'flex';
}

function fieldHTML(id, label, type, value, opts) {
  opts = opts || {};
  if (type === 'textarea') {
    return '<div class="modal-field"><label for="f_' + id + '">' + esc(label) + '</label><textarea id="f_' + id + '" rows="' + (opts.rows || 3) + '">' + esc(value || '') + '</textarea></div>';
  }
  if (type === 'select') {
    var options = (opts.options || []).map(function(o) { return '<option value="' + esc(o) + '"' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
    return '<div class="modal-field"><label for="f_' + id + '">' + esc(label) + '</label><select id="f_' + id + '">' + options + '</select></div>';
  }
  return '<div class="modal-field"><label for="f_' + id + '">' + esc(label) + (opts.required ? ' *' : '') + '</label><input id="f_' + id + '" type="' + (type || 'text') + '" value="' + esc(value || '') + '"' + (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') + '></div>';
}

function getField(id) { return (document.getElementById('f_' + id) || {}).value || ''; }

// ── Ask Agent ──────────────────────────────────────────────────────────
function collectFormData() {
  if (_modalEntityType === 'agent') {
    return {
      type: 'agent',
      id: getField('agentId'),
      name: getField('agentName'),
      provider: getField('agentProvider'),
      model: getField('agentModel'),
      tags: getField('agentTags'),
      maxConcurrency: getField('agentMaxConcurrency'),
      costMultiplier: getField('agentCostMultiplier'),
      timeoutMs: getField('agentTimeoutMs'),
      canMutate: getField('agentCanMutate'),
    };
  }
  if (_modalEntityType === 'skill') {
    return {
      type: 'skill',
      id: getField('id'),
      name: getField('name'),
      description: getField('description'),
      promptTemplate: getField('promptTemplate'),
      strategy: getField('strategy'),
      targetTags: getField('targetTags'),
      categories: getField('categories'),
      maxTokens: getField('maxTokens'),
      timeoutMs: getField('timeoutMs'),
    };
  }
  if (_modalEntityType === 'automation') {
    return {
      type: 'automation rule',
      id: getField('ruleId'),
      name: getField('ruleName'),
      description: getField('ruleDesc'),
      skillId: getField('ruleSkill'),
      events: getField('ruleEvents'),
      priority: getField('rulePriority'),
      tags: getField('ruleTags'),
      throttleIntervalMs: getField('ruleThrottle'),
    };
  }
  if (_modalEntityType === 'message') {
    return {
      type: 'message',
      body: getField('editBody'),
      recipients: getField('editRecipients'),
      persistent: document.getElementById('f_editPersistent') ? document.getElementById('f_editPersistent').checked : false,
    };
  }
  return {};
}

function buildAskPrompt(formData) {
  var lines = ['Review and suggest improvements for this ' + (formData.type || 'entity') + ' configuration:'];
  lines.push('');
  for (var key in formData) {
    if (key === 'type') continue;
    var val = formData[key];
    if (val !== undefined && val !== '') {
      lines.push('  ' + key + ': ' + val);
    }
  }
  lines.push('');
  lines.push('Please suggest specific improvements, identify potential issues, and recommend best practices.');
  lines.push('If fields are empty, suggest good values. Keep the response concise and actionable.');
  return lines.join('\\n');
}

async function askAgent() {
  var btn = document.getElementById('modalAskAgent');
  var respDiv = document.getElementById('askAgentResponse');
  btn.disabled = true;
  btn.textContent = '\\u2026 Asking Agent';
  respDiv.style.display = 'block';
  respDiv.innerHTML = '<span style="color:var(--muted)">Waiting for agent response...</span>';

  var formData = collectFormData();
  var prompt = buildAskPrompt(formData);

  try {
    var res = await fetch('/api/ask-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt }),
    });
    var data = await res.json();
    if (!res.ok) {
      respDiv.innerHTML = '<span class="ask-error">Error: ' + esc(data.error || res.statusText) + '</span>';
      return;
    }
    if (data.error) {
      respDiv.innerHTML = '<span class="ask-error">Agent error: ' + esc(data.error) + '</span>';
      return;
    }
    respDiv.innerHTML = esc(data.content || 'No response from agent.') +
      '<div class="ask-meta">Agent: ' + esc(data.agentId || '?') +
      ' \\u00b7 ' + (data.tokenCount || 0) + ' tokens' +
      ' \\u00b7 ' + (data.latencyMs || 0) + 'ms</div>';
  } catch(e) {
    respDiv.innerHTML = '<span class="ask-error">Failed: ' + esc(e.message) + '</span>';
  } finally {
    btn.disabled = false;
    btn.textContent = '\\ud83e\\udd16 Ask Agent';
  }
}

// ── Skill CRUD ─────────────────────────────────────────────────────────
function openSkillModal(existing) {
  var isEdit = !!existing;
  var title = isEdit ? 'Edit Skill: ' + existing.id : 'Add Skill';
  var body =
    fieldHTML('id', 'ID', 'text', existing ? existing.id : '', { required: true, placeholder: 'my-skill' }) +
    fieldHTML('name', 'Name', 'text', existing ? existing.name : '', { required: true }) +
    fieldHTML('description', 'Description', 'text', existing ? existing.description : '') +
    fieldHTML('promptTemplate', 'Prompt Template', 'textarea', existing ? existing.promptTemplate : '', { rows: 4, required: true }) +
    fieldHTML('strategy', 'Strategy', 'select', existing ? existing.strategy : 'single', { options: ['single', 'race', 'fan-out', 'consensus', 'fallback', 'cost-optimized'] }) +
    fieldHTML('targetTags', 'Target Tags (comma-separated)', 'text', existing ? (existing.targetTags || []).join(', ') : '') +
    fieldHTML('categories', 'Categories (comma-separated)', 'text', existing ? (existing.categories || []).join(', ') : '') +
    fieldHTML('maxTokens', 'Max Tokens', 'number', existing ? existing.maxTokens || '' : '') +
    fieldHTML('timeoutMs', 'Timeout (ms)', 'number', existing ? existing.timeoutMs || '' : '');
  if (isEdit) document.getElementById && setTimeout(function() { var el = document.getElementById('f_id'); if (el) el.disabled = true; }, 0);
  openModal(title, body, function() { submitSkill(isEdit); }, 'skill');
  if (isEdit) setTimeout(function() { var el = document.getElementById('f_id'); if (el) el.disabled = true; }, 0);
}

async function submitSkill(isEdit) {
  var payload = {
    id: getField('id'),
    name: getField('name'),
    description: getField('description'),
    promptTemplate: getField('promptTemplate'),
    strategy: getField('strategy'),
    targetTags: getField('targetTags').split(',').map(function(s) { return s.trim(); }).filter(Boolean),
    categories: getField('categories').split(',').map(function(s) { return s.trim(); }).filter(Boolean),
  };
  var maxT = parseInt(getField('maxTokens'), 10);
  if (!isNaN(maxT) && maxT > 0) payload.maxTokens = maxT;
  var timeout = parseInt(getField('timeoutMs'), 10);
  if (!isNaN(timeout) && timeout > 0) payload.timeoutMs = timeout;

  try {
    var url = isEdit ? '/api/skills/' + encodeURIComponent(payload.id) : '/api/skills';
    var res = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    var data = await res.json();
    if (!res.ok) { alert('Error: ' + (data.error || res.statusText)); return; }
    closeModal();
  } catch(e) { alert('Failed: ' + e.message); }
}

async function editSkill(id) {
  try {
    var res = await fetch('/api/skills/' + encodeURIComponent(id));
    if (!res.ok) { alert('Skill not found'); return; }
    var skill = await res.json();
    openSkillModal(skill);
  } catch(e) { alert('Failed: ' + e.message); }
}

async function deleteSkill(id) {
  if (!confirm('Delete skill "' + id + '"?')) return;
  try {
    var res = await fetch('/api/skills/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!res.ok) { var d = await res.json(); alert('Error: ' + (d.error || res.statusText)); }
  } catch(e) { alert('Failed: ' + e.message); }
}

// ── Workspace CRUD ─────────────────────────────────────────────────────
function openWorkspaceModal() {
  var body = fieldHTML('wsPath', 'Workspace Path', 'text', '', { required: true, placeholder: 'C:\\\\path\\\\to\\\\workspace' });
  openModal('Add Workspace', body, submitWorkspace);
}

async function submitWorkspace() {
  var path = getField('wsPath');
  if (!path) { alert('Path is required'); return; }
  try {
    var res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path }),
    });
    var data = await res.json();
    if (!res.ok) { alert('Error: ' + (data.error || res.statusText)); return; }
    closeModal();
  } catch(e) { alert('Failed: ' + e.message); }
}

async function stopWorkspace(path) {
  if (!confirm('Stop monitoring "' + path + '"?')) return;
  try {
    var res = await fetch('/api/workspaces/' + encodeURIComponent(path), { method: 'DELETE' });
    if (!res.ok) { var d = await res.json(); alert('Error: ' + (d.error || res.statusText)); }
  } catch(e) { alert('Failed: ' + e.message); }
}

async function mineWorkspace(path) {
  try {
    var res = await fetch('/api/workspaces/' + encodeURIComponent(path) + '/mine', { method: 'POST' });
    var data = await res.json();
    if (!res.ok) { alert('Error: ' + (data.error || res.statusText)); return; }
    alert('Mining complete: ' + JSON.stringify(data));
  } catch(e) { alert('Failed: ' + e.message); }
}

// Workspace tab switching
window._wsTab = 'active';
function switchWorkspaceTab(tab) {
  window._wsTab = tab;
  document.getElementById('workspacesTable').style.display = tab === 'active' ? '' : 'none';
  document.getElementById('workspaceHistoryTable').style.display = tab === 'history' ? '' : 'none';
  document.querySelectorAll('#workspaceTabs .filter-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  if (tab === 'history') loadWorkspaceHistory();
}

async function loadWorkspaceHistory() {
  var ht = document.getElementById('workspaceHistoryTable');
  ht.innerHTML = '<div class="empty">Loading history...</div>';
  try {
    var res = await fetch('/api/workspace-history');
    var data = await res.json();
    if (data.entries.length === 0) {
      ht.innerHTML = '<div class="empty">No history entries yet</div>';
      return;
    }
    ht.innerHTML = '<table><tr><th>Path</th><th>Started</th><th>Stopped</th><th>Duration</th><th>Sessions</th><th>Git Events</th><th>Reason</th></tr>' +
      data.entries.map(function(e) {
        return '<tr><td class="history-path">' + esc(e.path) + '</td>' +
          '<td>' + esc((e.startedAt || '').split('T')[0]) + '</td>' +
          '<td>' + esc((e.stoppedAt || '').split('T')[0]) + '</td>' +
          '<td>' + fmt(e.durationMs) + '</td>' +
          '<td>' + (e.sessionCount || 0) + '</td>' +
          '<td>' + (e.gitEvents || 0) + '</td>' +
          '<td><span class="badge ' + (e.reason === 'manual' ? 'running' : 'busy') + '">' + esc(e.reason) + '</span></td></tr>';
      }).join('') + '</table>';
  } catch(e) {
    ht.innerHTML = '<div class="empty">Failed to load: ' + esc(e.message) + '</div>';
  }
}

// ── Automation CRUD ────────────────────────────────────────────────────
function openAutomationModal(existing) {
  var isEdit = !!existing;
  var title = isEdit ? 'Edit Rule: ' + existing.id : 'Add Automation Rule';
  var body =
    fieldHTML('ruleId', 'ID', 'text', existing ? existing.id : '', { required: true, placeholder: 'my-rule' }) +
    fieldHTML('ruleName', 'Name', 'text', existing ? existing.name : '', { required: true }) +
    fieldHTML('ruleDesc', 'Description', 'text', existing ? existing.description : '') +
    fieldHTML('ruleSkill', 'Skill ID', 'text', existing ? existing.skillId : '', { required: true }) +
    fieldHTML('ruleEvents', 'Events (comma-separated)', 'text', existing ? (existing.events || (existing.matcher && existing.matcher.events) || []).join(', ') : '', { required: true, placeholder: 'workspace:file-changed, workspace:git-event' }) +
    fieldHTML('rulePriority', 'Priority', 'select', existing ? existing.priority : 'normal', { options: ['low', 'normal', 'high', 'critical'] }) +
    fieldHTML('ruleTags', 'Tags (comma-separated)', 'text', existing ? (existing.tags || []).join(', ') : '') +
    fieldHTML('ruleThrottle', 'Throttle Interval (ms)', 'number', existing ? (existing.throttle && existing.throttle.intervalMs || '') : '');
  openModal(title, body, function() { submitAutomation(isEdit); }, 'automation');
  if (isEdit) setTimeout(function() { var el = document.getElementById('f_ruleId'); if (el) el.disabled = true; }, 0);
}

async function submitAutomation(isEdit) {
  var id = getField('ruleId');
  var payload = {
    id: id,
    name: getField('ruleName'),
    description: getField('ruleDesc'),
    skillId: getField('ruleSkill'),
    events: getField('ruleEvents').split(',').map(function(s) { return s.trim(); }).filter(Boolean),
    priority: getField('rulePriority'),
    tags: getField('ruleTags').split(',').map(function(s) { return s.trim(); }).filter(Boolean),
  };
  var throttle = parseInt(getField('ruleThrottle'), 10);
  if (!isNaN(throttle) && throttle > 0) payload.throttleIntervalMs = throttle;

  try {
    var url = isEdit ? '/api/automation/' + encodeURIComponent(id) : '/api/automation';
    var res = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    var data = await res.json();
    if (!res.ok) { alert('Error: ' + (data.error || res.statusText)); return; }
    closeModal();
  } catch(e) { alert('Failed: ' + e.message); }
}

async function editAutomation(id) {
  try {
    var res = await fetch('/api/automation/' + encodeURIComponent(id));
    if (!res.ok) { alert('Rule not found'); return; }
    var data = await res.json();
    openAutomationModal(data.rule);
  } catch(e) { alert('Failed: ' + e.message); }
}

async function deleteAutomation(id) {
  if (!confirm('Delete automation rule "' + id + '"?')) return;
  try {
    var res = await fetch('/api/automation/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!res.ok) { var d = await res.json(); alert('Error: ' + (d.error || res.statusText)); }
  } catch(e) { alert('Failed: ' + e.message); }
}

async function toggleAutomation(id, enabled) {
  try {
    var res = await fetch('/api/automation/' + encodeURIComponent(id) + '/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enabled }),
    });
    if (!res.ok) { var d = await res.json(); alert('Error: ' + (d.error || res.statusText)); }
  } catch(e) { alert('Failed: ' + e.message); }
}

async function triggerAutomation(id) {
  if (!confirm('Trigger rule "' + id + '" manually?')) return;
  try {
    var res = await fetch('/api/automation/' + encodeURIComponent(id) + '/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testData: {}, dryRun: false }),
    });
    var data = await res.json();
    if (!res.ok) { alert('Error: ' + (data.error || res.statusText)); return; }
    alert('Triggered: ' + (data.status || 'ok') + (data.resultSummary ? '\\n' + data.resultSummary : ''));
  } catch(e) { alert('Failed: ' + e.message); }
}

// Debug panel
var debugOpen = false;
var debugData = null;

// ── Messaging actions ──────────────────────────────────────────────────

function openComposeModal() {
  var body =
    fieldHTML('msgChannel', 'Channel', 'text', '', { required: true, placeholder: 'general' }) +
    fieldHTML('msgSender', 'Sender', 'text', '', { required: true, placeholder: 'my-agent' }) +
    fieldHTML('msgRecipients', 'Recipients (comma-separated, or * for broadcast)', 'text', '*', { required: true }) +
    fieldHTML('msgBody', 'Message', 'textarea', '', { required: true, rows: 4, placeholder: 'Enter message body...' }) +
    fieldHTML('msgTtl', 'TTL (seconds)', 'number', '3600');
  openModal('Compose Message', body, submitMessage, '');
}

async function submitMessage() {
  var payload = {
    channel: getField('msgChannel'),
    sender: getField('msgSender'),
    recipients: getField('msgRecipients').split(',').map(function(s) { return s.trim(); }).filter(Boolean),
    body: getField('msgBody'),
    ttlSeconds: parseInt(getField('msgTtl'), 10) || 3600,
  };
  if (!payload.channel || !payload.sender || !payload.body) { alert('Channel, sender, and body are required'); return; }
  try {
    var res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    var data = await res.json();
    if (!res.ok) { alert('Error: ' + (data.error || res.statusText)); return; }
    closeModal();
    pollSnapshot();
  } catch(e) { alert('Failed: ' + e.message); }
}

async function viewChannel(channel) {
  var detail = document.getElementById('messagingDetail');
  detail.style.display = 'block';
  detail.innerHTML = '<div class=\"empty\">Loading channel ' + esc(channel) + '...</div>';
  try {
    var res = await fetch('/api/messages/' + encodeURIComponent(channel) + '?reader=*&unreadOnly=false&limit=50');
    var data = await res.json();
    if (!data.messages || data.messages.length === 0) {
      detail.innerHTML = '<h3 style=\"color:var(--accent)\">Channel: ' + esc(channel) + '</h3><div class=\"empty\">No messages</div>';
      return;
    }
    detail.innerHTML = '<h3 style=\"color:var(--accent)\">Channel: ' + esc(channel) + ' (' + data.messages.length + ' messages)</h3>' +
      '<table><tr><th>ID</th><th>Sender</th><th>Recipients</th><th>Body</th><th>Created</th><th>Read By</th></tr>' +
      data.messages.map(function(m, i) {
        var bodyId = 'msg-body-' + i;
        return '<tr id=\"msg-row-' + esc(m.id) + '\">' +
          '<td><code style=\"font-size:11px\">' + esc(m.id) + '</code></td>' +
          '<td>' + esc(m.sender) + '</td>' +
          '<td>' + (m.recipients || []).map(function(r) { return '<span class=\"tag\">' + esc(r) + '</span>'; }).join('') + '</td>' +
          '<td><div id=\"' + bodyId + '\" style=\"max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer\" title=\"Click to expand\" onclick=\"var s=this.style;if(s.whiteSpace===\\u0027nowrap\\u0027){s.whiteSpace=\\u0027pre-wrap\\u0027;s.maxWidth=\\u0027600px\\u0027;s.overflow=\\u0027visible\\u0027}else{s.whiteSpace=\\u0027nowrap\\u0027;s.maxWidth=\\u0027300px\\u0027;s.overflow=\\u0027hidden\\u0027}\">' + esc(m.body) + '</div></td>' +
          '<td style=\"font-size:11px;color:var(--muted)\">' + esc((m.createdAt || '').replace('T', ' ').split('.')[0]) + '</td>' +
          '<td>' + (m.readBy && m.readBy.length ? m.readBy.map(function(r) { return '<span class=\"tag\">' + esc(r) + '</span>'; }).join('') : '<span style=\"color:var(--muted)\">-</span>') + '</td>' +
          '<td style=\"white-space:nowrap\">' +
            '<button class=\"btn-action\" style=\"font-size:11px;padding:2px 6px\" onclick=\"editMessage(\\u0027' + esc(m.id) + '\\u0027,\\u0027' + esc(channel) + '\\u0027)\">Edit</button> ' +
            '<button class=\"btn-action\" style=\"font-size:11px;padding:2px 6px;background:#c62828\" onclick=\"deleteSingleMessage(\\u0027' + esc(m.id) + '\\u0027,\\u0027' + esc(channel) + '\\u0027)\">Delete</button>' +
          '</td>' +
          '</tr>';
      }).join('') + '</table>' +
      '<div style=\"margin-top:8px;display:flex;gap:8px\">' +
        '<button class=\"btn-action\" onclick=\"document.querySelectorAll(\\u0027[id^=msg-body-]\\u0027).forEach(function(e){e.style.whiteSpace=\\u0027pre-wrap\\u0027;e.style.maxWidth=\\u0027600px\\u0027;e.style.overflow=\\u0027visible\\u0027})\">Expand All</button>' +
        '<button class=\"btn-action\" onclick=\"document.querySelectorAll(\\u0027[id^=msg-body-]\\u0027).forEach(function(e){e.style.whiteSpace=\\u0027nowrap\\u0027;e.style.maxWidth=\\u0027300px\\u0027;e.style.overflow=\\u0027hidden\\u0027})\">Collapse All</button>' +
        '<button class=\"btn-action\" onclick=\"document.getElementById(\\u0027messagingDetail\\u0027).style.display=\\u0027none\\u0027\">Close</button>' +
      '</div>';
  } catch(e) {
    detail.innerHTML = '<div class=\"empty\">Failed to load: ' + esc(e.message) + '</div>';
  }
}

async function purgeMessages() {
  if (!confirm('Purge ALL messages from this instance?')) return;
  try {
    var res = await fetch('/api/messages', { method: 'DELETE' });
    if (res.ok) {
      document.getElementById('messagingDetail').style.display = 'none';
      pollSnapshot();
    } else {
      var d = await res.json();
      alert('Error: ' + (d.error || res.statusText));
    }
  } catch(e) { alert('Failed: ' + e.message); }
}

async function deleteSingleMessage(msgId, channel) {
  if (!confirm('Delete message ' + msgId + '?')) return;
  try {
    var res = await fetch('/api/messages', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageIds: [msgId] })
    });
    if (res.ok) {
      viewChannel(channel);
      pollSnapshot();
    } else {
      var d = await res.json();
      alert('Error: ' + (d.error || res.statusText));
    }
  } catch(e) { alert('Failed: ' + e.message); }
}

var _editMsgId = '';
var _editMsgChannel = '';

async function editMessage(msgId, channel) {
  try {
    var res = await fetch('/api/messages/by-id/' + encodeURIComponent(msgId));
    if (!res.ok) { alert('Message not found'); return; }
    var msg = await res.json();
    _editMsgId = msgId;
    _editMsgChannel = channel;
    var body =
      fieldHTML('editBody', 'Body', 'textarea', msg.body, { required: true, rows: 12 }) +
      fieldHTML('editRecipients', 'Recipients (comma-separated)', 'text', (msg.recipients||[]).join(', '), { required: true }) +
      '<div class="modal-field"><label><input type="checkbox" id="f_editPersistent"' + (msg.persistent ? ' checked' : '') + '> Persistent</label></div>';
    openModal('Edit Message', body, submitEditMessage, 'message');
  } catch(e) { alert('Failed: ' + e.message); }
}

async function submitEditMessage() {
  var body = getField('editBody');
  var recipientsRaw = getField('editRecipients');
  var persistent = document.getElementById('f_editPersistent').checked;
  var recipients = recipientsRaw.split(',').map(function(r) { return r.trim(); }).filter(Boolean);
  try {
    var res = await fetch('/api/messages/by-id/' + encodeURIComponent(_editMsgId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: body, recipients: recipients, persistent: persistent })
    });
    if (res.ok) {
      document.getElementById('crudModal').style.display = 'none';
      viewChannel(_editMsgChannel);
      pollSnapshot();
    } else {
      var d = await res.json();
      alert('Error: ' + (d.error || res.statusText));
    }
  } catch(e) { alert('Failed: ' + e.message); }
}

function toggleDebug() {
  debugOpen = !debugOpen;
  document.getElementById('debugPanel').className = 'card full debug-panel' + (debugOpen ? ' open' : '');
  if (debugOpen) refreshDebug();
}

async function refreshDebug() {
  try {
    var res = await fetch('/api/debug');
    debugData = await res.json();
    renderDebug();
  } catch(e) {
    document.getElementById('debugServer').innerHTML = '<div class="empty">Failed to load: ' + esc(e.message) + '</div>';
  }
  try {
    var iRes = await fetch('/api/instances');
    var iData = await iRes.json();
    renderInstances(iData);
  } catch(e) { /* best-effort */ }
}

function kv(key, val, cls) {
  return '<div class="kv"><span class="k">' + esc(key) + '</span><span class="v' + (cls ? ' ' + cls : '') + '">' + esc(String(val)) + '</span></div>';
}

function renderInstances(iData) {
  var el = document.getElementById('debugInstances');
  var hdr = document.getElementById('hdrInstances');
  var dropdown = document.getElementById('instanceDropdown');
  if (!iData || !iData.instances) return;
  var list = iData.instances;
  var myPid = iData.current.pid;
  var myPort = iData.current.port;
  if (hdr) {
    hdr.textContent = list.length + ' instance' + (list.length !== 1 ? 's' : '');
    hdr.style.color = list.length > 1 ? '#f5c542' : '#6bff6b';
  }
  var linksHtml = list.length === 0 ? '<div style="color:#888">No active instances</div>' : list.map(function(inst) {
    var isCurrent = inst.pid === myPid;
    var link = 'http://127.0.0.1:' + inst.port;
    return '<div style="padding:3px 0;font-size:12px">' +
      '<a href="' + link + '" target="_blank" style="color:' + (isCurrent ? '#6bff6b' : '#8ab4f8') + ';text-decoration:none">' +
      ':' + inst.port + '</a>' +
      ' <span style="color:#888">PID ' + inst.pid + (isCurrent ? ' (this)' : '') + '</span></div>';
  }).join('');
  if (dropdown) dropdown.innerHTML = linksHtml;
  if (el) {
    if (list.length === 0) { el.innerHTML = '<div class="empty">No active instances</div>'; return; }
    el.innerHTML = list.map(function(inst) {
      var isCurrent = inst.pid === myPid;
      var link = 'http://127.0.0.1:' + inst.port;
      return '<div class="kv">' +
        '<span class="k">PID ' + inst.pid + (isCurrent ? ' (this)' : '') + '</span>' +
        '<span class="v"><a href="' + link + '" target="_blank" style="color:#6bff6b">' + link + '</a>' +
        ' &middot; started ' + (inst.startedAt || '-') + '</span></div>';
    }).join('');
  }
}

var instanceDropdownOpen = false;
function toggleInstanceDropdown() {
  instanceDropdownOpen = !instanceDropdownOpen;
  var dd = document.getElementById('instanceDropdown');
  if (dd) dd.style.display = instanceDropdownOpen ? 'block' : 'none';
}
document.addEventListener('click', function(e) {
  var hdr = document.getElementById('hdrInstances');
  var dd = document.getElementById('instanceDropdown');
  if (instanceDropdownOpen && hdr && dd && !hdr.contains(e.target) && !dd.contains(e.target)) {
    instanceDropdownOpen = false;
    dd.style.display = 'none';
  }
});

function renderDebug() {
  if (!debugData) return;
  var d = debugData;

  document.getElementById('hdrPid').textContent = d.server.pid;

  document.getElementById('debugServer').innerHTML =
    kv('PID', d.server.pid) +
    kv('Node', d.server.nodeVersion) +
    kv('Platform', d.server.platform + '/' + d.server.arch) +
    kv('CWD', d.server.cwd) +
    kv('Dashboard Port', d.server.dashboardPort) +
    kv('Started', d.server.serverStartedAt || '-') +
    kv('SSE Clients', d.sse.connectedClients);

  document.getElementById('debugMemory').innerHTML =
    kv('RSS', d.memory.rss) +
    kv('Heap Used', d.memory.heapUsed) +
    kv('Heap Total', d.memory.heapTotal) +
    kv('External', d.memory.external);

  var evEntries = Object.entries(d.events);
  document.getElementById('debugEvents').innerHTML = evEntries.length
    ? evEntries.map(function(kv2) { return kv(kv2[0], kv2[1], Number(kv2[1]) > 0 ? 'ok' : ''); }).join('')
    : '<div class="empty">No events fired yet</div>';

  var envEntries = Object.entries(d.env);
  document.getElementById('debugEnv').innerHTML = envEntries.length
    ? envEntries.map(function(kv2) { return kv(kv2[0], kv2[1]); }).join('')
    : '<div class="empty">No MCP_* env vars set</div>';

  var rl = document.getElementById('debugRequests');
  if (d.requests.recent.length === 0) {
    rl.innerHTML = '<div class="empty">No requests logged yet</div>';
  } else {
    rl.innerHTML = d.requests.recent.map(function(r) {
      return '<div class="req"><span class="method">' + esc(r.method) + '</span>' +
      '<span class="url">' + esc(r.url) + '</span>' +
      '<span class="status s' + String(r.status)[0] + '">' + r.status + '</span>' +
      '<span class="dur">' + r.ms + 'ms</span></div>';
    }).join('');
  }

  document.getElementById('debugRaw').textContent = JSON.stringify(snapshot, null, 2);
}

setInterval(function() {
  if (snapshot) { snapshot.uptimeMs += 1000; updateUptimeOnly(); }
  if (debugOpen) refreshDebug();
}, 1000);
`;
