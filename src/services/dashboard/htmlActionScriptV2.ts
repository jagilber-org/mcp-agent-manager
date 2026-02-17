// mcp-agent-manager/src/services/dashboard/htmlActionScriptV2.ts
// V2 action script - extends V1 with tab switching, keyboard nav, and init.

import { DASHBOARD_ACTION_SCRIPT } from './htmlActionScript.js';

export const DASHBOARD_ACTION_SCRIPT_V2 = DASHBOARD_ACTION_SCRIPT + `

// ── V2 tab management ─────────────────────────────────────────────────

function switchTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
  var panel = document.getElementById('tab-' + tabId);
  if (panel) panel.classList.add('active');
  var btn = document.querySelector('.tab-btn[data-tab="' + tabId + '"]');
  if (btn) btn.classList.add('active');
  localStorage.setItem('dashboard-tab', tabId);
  // Clear badge for this tab
  if (tabId === 'events') window._newEventCount = 0;
  var badge = document.getElementById('badge-' + tabId);
  if (badge) { badge.textContent = ''; badge.className = 'tab-badge'; }
  // Lazy-load backups on first tab switch
  if (tabId === 'backups' && !window._backupsLoaded) {
    window._backupsLoaded = true;
    refreshBackups();
  }
}

// Keyboard navigation: 1-0 for tabs, Escape for overview
document.addEventListener('keydown', function(e) {
  var tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (document.getElementById('crudModal').style.display === 'flex') return;
  var tabs = ['overview', 'agents', 'skills', 'workspaces', 'automation', 'tasks', 'crossrepo', 'review', 'messaging', 'events', 'backups'];
  var key = e.key;
  if (key >= '1' && key <= '9') {
    var idx = parseInt(key) - 1;
    if (idx < tabs.length) { switchTab(tabs[idx]); e.preventDefault(); }
  } else if (key === '0') {
    switchTab(tabs[9]);
    e.preventDefault();
  } else if (key === 'Escape') {
    switchTab('overview');
    e.preventDefault();
  }
});

// ── Backup / Restore functions ─────────────────────────────────────────

window._backupsLoaded = false;
window._backupsList = [];

function getBackupPath() {
  var el = document.getElementById('backupCustomPath');
  return el && el.value.trim() ? el.value.trim() : '';
}

async function refreshBackups() {
  var table = document.getElementById('backupsTable');
  table.innerHTML = '<div class="empty">Loading...</div>';
  try {
    var pathParam = getBackupPath();
    var url = '/api/backups' + (pathParam ? '?path=' + encodeURIComponent(pathParam) : '');
    var res = await fetch(url);
    var data = await res.json();
    window._backupsList = data.backups || [];
    renderBackups();
  } catch(e) {
    table.innerHTML = '<div class="empty">Failed to load: ' + esc(e.message) + '</div>';
  }
}

function renderBackups() {
  var table = document.getElementById('backupsTable');
  var list = window._backupsList;
  if (list.length === 0) {
    table.innerHTML = '<div class="empty">No backups found. Click "+ Create Backup" to create one.</div>';
    return;
  }
  table.innerHTML = '<table><tr>' +
    '<th>Backup ID</th><th>Created</th><th>Files</th><th>Size</th><th>Path</th><th>Actions</th>' +
    '</tr>' +
    list.map(function(b) {
      var sizeKB = (b.totalBytes / 1024).toFixed(1);
      var created = (b.createdAt || '').replace('T', ' ').split('.')[0];
      return '<tr>' +
        '<td><code style="font-size:11px">' + esc(b.id) + '</code></td>' +
        '<td style="font-size:12px;color:var(--muted)">' + esc(created) + '</td>' +
        '<td style="text-align:center">' + b.fileCount + '</td>' +
        '<td style="font-size:12px">' + sizeKB + ' KB</td>' +
        '<td style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis" title="' + esc(b.path || '') + '">' + esc(b.path || '-') + '</td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn-action" style="font-size:11px;padding:2px 6px" onclick="viewBackup(\\u0027' + esc(b.id) + '\\u0027)">Details</button> ' +
          '<button class="btn-action" style="font-size:11px;padding:2px 6px;background:#2ea043" onclick="restoreBackupUI(\\u0027' + esc(b.id) + '\\u0027)">Restore</button> ' +
          '<button class="btn-action" style="font-size:11px;padding:2px 6px" onclick="exportBackupUI(\\u0027' + esc(b.id) + '\\u0027)">Export</button> ' +
          '<button class="btn-action" style="font-size:11px;padding:2px 6px;background:#c62828" onclick="deleteBackupUI(\\u0027' + esc(b.id) + '\\u0027)">Delete</button>' +
        '</td></tr>';
    }).join('') + '</table>';
}

async function createBackup() {
  var customPath = getBackupPath();
  try {
    var body = customPath ? JSON.stringify({ path: customPath }) : '{}';
    var res = await fetch('/api/backups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    });
    var data = await res.json();
    if (!res.ok) { alert('Error: ' + (data.error || res.statusText)); return; }
    alert('Backup created: ' + data.backup.id + '\\n' + data.backup.files.length + ' files, ' + (data.backup.totalBytes / 1024).toFixed(1) + ' KB');
    refreshBackups();
  } catch(e) { alert('Failed: ' + e.message); }
}

async function viewBackup(backupId) {
  try {
    var res = await fetch('/api/backups/' + encodeURIComponent(backupId));
    if (!res.ok) { alert('Backup not found'); return; }
    var manifest = await res.json();
    var body = '<div style="margin-bottom:12px"><strong>Backup:</strong> ' + esc(manifest.id) + '</div>' +
      '<div style="margin-bottom:8px;font-size:12px;color:var(--muted)">' +
        'Created: ' + esc(manifest.createdAt) + ' | Files: ' + manifest.files.length + ' | Size: ' + (manifest.totalBytes / 1024).toFixed(1) + ' KB' +
      '</div>' +
      '<div style="margin-bottom:8px;font-size:12px;color:var(--muted)">Data Dir: ' + esc(manifest.dataDir) + '</div>' +
      '<table><tr><th>File</th><th>Size</th><th>Checksum</th></tr>' +
      manifest.files.map(function(f) {
        return '<tr><td><code style="font-size:11px">' + esc(f.relativePath) + '</code></td>' +
          '<td style="font-size:12px">' + (f.sizeBytes / 1024).toFixed(1) + ' KB</td>' +
          '<td style="font-size:11px;color:var(--muted)">' + esc(f.hash) + '</td></tr>';
      }).join('') + '</table>';
    openModal('Backup Details', body, function() { closeModal(); }, '');
    document.getElementById('modalSubmit').textContent = 'Close';
    document.getElementById('modalAskAgent').style.display = 'none';
  } catch(e) { alert('Failed: ' + e.message); }
}

async function restoreBackupUI(backupId) {
  try {
    var res = await fetch('/api/backups/' + encodeURIComponent(backupId));
    if (!res.ok) { alert('Backup not found'); return; }
    var manifest = await res.json();
    var files = manifest.files.map(function(f) { return f.relativePath; });
    var body = '<div style="margin-bottom:12px">Select files to restore from <strong>' + esc(backupId) + '</strong>:</div>' +
      '<div style="margin-bottom:8px"><label><input type="checkbox" id="restoreSelectAll" checked onchange="toggleRestoreAll(this.checked)"> Select All</label></div>' +
      files.map(function(f, i) {
        return '<div style="margin-left:20px"><label><input type="checkbox" class="restore-file-cb" value="' + esc(f) + '" checked> ' + esc(f) + '</label></div>';
      }).join('') +
      '<div style="margin-top:12px;padding:8px;background:#1e1e2e;border-radius:4px;font-size:12px;color:var(--muted)">' +
        'Current files will be saved as .pre-restore before overwriting.' +
      '</div>';
    openModal('Restore Backup', body, function() { performRestore(backupId); }, '');
    document.getElementById('modalSubmit').textContent = 'Restore';
    document.getElementById('modalSubmit').style.background = '#2ea043';
    document.getElementById('modalAskAgent').style.display = 'none';
  } catch(e) { alert('Failed: ' + e.message); }
}

function toggleRestoreAll(checked) {
  document.querySelectorAll('.restore-file-cb').forEach(function(cb) { cb.checked = checked; });
}

async function performRestore(backupId) {
  var cbs = document.querySelectorAll('.restore-file-cb:checked');
  var files = [];
  cbs.forEach(function(cb) { files.push(cb.value); });
  if (files.length === 0) { alert('Select at least one file to restore'); return; }
  if (!confirm('Restore ' + files.length + ' files from ' + backupId + '? Current data will be backed up as .pre-restore.')) return;
  try {
    var pathParam = getBackupPath();
    var res = await fetch('/api/backups/' + encodeURIComponent(backupId) + '/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: files, path: pathParam || undefined }),
    });
    var data = await res.json();
    if (data.errors && data.errors.length > 0) {
      alert('Restore completed with errors:\\n\\nRestored: ' + data.restoredFiles.join(', ') + '\\n\\nErrors: ' + data.errors.join('\\n'));
    } else {
      alert('Restore successful!\\n\\nRestored: ' + data.restoredFiles.join(', '));
    }
    closeModal();
    pollSnapshot();
  } catch(e) { alert('Failed: ' + e.message); }
}

function exportBackupUI(backupId) {
  var body = fieldHTML('exportPath', 'Export Destination Path', 'text', '', { required: true, placeholder: 'C:\\\\Backups\\\\mcp-agent-manager' });
  openModal('Export Backup: ' + backupId, body, function() { performExport(backupId); }, '');
  document.getElementById('modalSubmit').textContent = 'Export';
  document.getElementById('modalAskAgent').style.display = 'none';
}

async function performExport(backupId) {
  var exportPath = getField('exportPath');
  if (!exportPath) { alert('Export path is required'); return; }
  try {
    var res = await fetch('/api/backups/' + encodeURIComponent(backupId) + '/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exportPath: exportPath }),
    });
    var data = await res.json();
    if (!res.ok) { alert('Error: ' + (data.error || res.statusText)); return; }
    alert('Exported to: ' + data.path);
    closeModal();
  } catch(e) { alert('Failed: ' + e.message); }
}

async function deleteBackupUI(backupId) {
  if (!confirm('Delete backup "' + backupId + '"? This cannot be undone.')) return;
  try {
    var res = await fetch('/api/backups/' + encodeURIComponent(backupId), { method: 'DELETE' });
    if (!res.ok) { var d = await res.json(); alert('Error: ' + (d.error || res.statusText)); return; }
    refreshBackups();
  } catch(e) { alert('Failed: ' + e.message); }
}

function openImportModal() {
  var body = fieldHTML('importPath', 'Import From Path', 'text', '', { required: true, placeholder: 'C:\\\\Backups\\\\mcp-agent-manager\\\\backup-2026-...' }) +
    '<div style="margin-top:8px;font-size:12px;color:var(--muted)">The directory must contain a manifest.json file.</div>';
  openModal('Import Backup', body, performImport, '');
  document.getElementById('modalSubmit').textContent = 'Import';
  document.getElementById('modalAskAgent').style.display = 'none';
}

async function performImport() {
  var importPath = getField('importPath');
  if (!importPath) { alert('Import path is required'); return; }
  try {
    var res = await fetch('/api/backups/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ importPath: importPath }),
    });
    var data = await res.json();
    if (!res.ok) { alert('Error: ' + (data.error || res.statusText)); return; }
    alert('Imported: ' + (data.backup ? data.backup.id : 'unknown'));
    closeModal();
    refreshBackups();
  } catch(e) { alert('Failed: ' + e.message); }
}

// Initialize active tab from localStorage
switchTab(localStorage.getItem('dashboard-tab') || 'overview');
`;
