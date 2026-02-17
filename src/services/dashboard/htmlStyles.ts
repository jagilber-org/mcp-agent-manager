// mcp-agent-manager/src/services/dashboard/htmlStyles.ts
// Dashboard CSS styles - extracted for PE-6 (no mixed presentation in TS).

export const DASHBOARD_CSS = `
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #e6edf3; --muted: #8b949e; --accent: #58a6ff;
    --green: #3fb950; --yellow: #d29922; --red: #f85149; --purple: #bc8cff;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); }
  .header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 16px 24px; display: flex; align-items: center; gap: 16px; }
  .header h1 { font-size: 18px; font-weight: 600; }
  .header .status { font-size: 12px; color: var(--muted); margin-left: auto; }
  .header .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
  .dot.connected { background: var(--green); }
  .dot.disconnected { background: var(--red); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 24px; max-width: 1400px; margin: 0 auto; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .card h2 { font-size: 14px; font-weight: 600; color: var(--accent); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  .card.full { grid-column: 1 / -1; }
  .metrics { display: flex; gap: 24px; flex-wrap: wrap; }
  .metric { text-align: center; }
  .metric .value { font-size: 28px; font-weight: 700; }
  .metric .label { font-size: 11px; color: var(--muted); text-transform: uppercase; }
  .metric .value.green { color: var(--green); }
  .metric .value.yellow { color: var(--yellow); }
  .metric .value.accent { color: var(--accent); }
  .metric .value.purple { color: var(--purple); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .agent-table { table-layout: fixed; }
  th { text-align: left; color: var(--muted); font-weight: 500; padding: 6px 12px; border-bottom: 1px solid var(--border); font-size: 11px; text-transform: uppercase; white-space: nowrap; }
  td { padding: 8px 12px; border-bottom: 1px solid var(--border); overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  .agent-table th:nth-child(1), .agent-table td:nth-child(1) { width: 22%; }
  .agent-table th:nth-child(2), .agent-table td:nth-child(2) { width: 10%; }
  .agent-table th:nth-child(3), .agent-table td:nth-child(3) { width: 18%; }
  .agent-table th:nth-child(4), .agent-table td:nth-child(4) { width: 9%; text-align: center; }
  .agent-table th:nth-child(5), .agent-table td:nth-child(5) { width: 18%; }
  .agent-table th:nth-child(6), .agent-table td:nth-child(6) { width: 9%; text-align: right; }
  .agent-table th:nth-child(7), .agent-table td:nth-child(7) { width: 9%; text-align: right; }
  .agent-table th:nth-child(8), .agent-table td:nth-child(8) { width: 5%; text-align: center; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; }
  .badge.idle { background: #1f2937; color: var(--muted); }
  .badge.running { background: #0d3321; color: var(--green); }
  .badge.busy { background: #3b2607; color: var(--yellow); }
  .badge.error { background: #3d1418; color: var(--red); }
  .badge.stopped { background: #1f2937; color: var(--muted); }
  .btn-kill { background: var(--red); color: white; border: none; padding: 3px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: 500; }
  .btn-kill:hover { background: #da3633; }
  .btn-kill-all { background: none; border: 1px solid var(--red); color: var(--red); padding: 3px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; margin-left: 8px; }
  .btn-kill-all:hover { background: var(--red); color: white; }
  .filter-btn { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; background: var(--card); border: 1px solid var(--border); color: var(--muted); margin-right: 4px; transition: all 0.2s; }
  .filter-btn:hover { border-color: var(--accent); color: var(--accent); }
  .filter-btn.active { background: var(--accent); color: white; border-color: var(--accent); }
  .filter-btn.speckit { border-color: #f59e0b; color: #f59e0b; }
  .filter-btn.speckit.active { background: #f59e0b; color: #000; border-color: #f59e0b; }
  .speckit-row { border-left: 3px solid #f59e0b !important; }
  .speckit-tag { background: rgba(245,158,11,0.15) !important; color: #f59e0b !important; border-color: #f59e0b !important; }
  .monitor-card { border-left: 3px solid #06b6d4; }
  .monitor-count { font-size: 12px; font-weight: normal; color: var(--muted); margin-left: 8px; }
  .ws-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding: 8px; background: rgba(6,182,212,0.08); border-radius: 6px; border: 1px solid rgba(6,182,212,0.2); }
  .ws-header .ws-path { font-family: monospace; font-size: 12px; color: #06b6d4; font-weight: 600; }
  .ws-header .ws-id { font-size: 10px; color: var(--muted); }
  .ws-detail { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
  .ws-detail-section { background: var(--card); border: 1px solid var(--border); border-radius: 4px; padding: 8px; }
  .ws-detail-section.ws-sessions-section { grid-column: 1 / -1; }
  .ws-detail-section.ws-git-section { grid-column: 1 / -1 !important; width: 100% !important; min-width: 0; box-sizing: border-box; }
  .ws-detail-section h4 { margin: 0 0 4px 0; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
  .ws-session-totals { display: flex; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
  .session-table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
  .session-table th { text-align: left; font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; padding: 3px 4px; border-bottom: 1px solid var(--border); }
  .session-table td { padding: 3px 4px; border-bottom: 1px solid var(--border); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session-table th:nth-child(1) { width: 28%; }
  .session-table th:nth-child(2) { width: 14%; }
  .session-table th:nth-child(3), .session-table th:nth-child(4), .session-table th:nth-child(5), .session-table th:nth-child(6), .session-table th:nth-child(7) { width: 8%; }
  .session-table th:nth-child(8) { width: 18%; }
  .session-table tr:hover { background: rgba(255,255,255,0.03); }
  .ws-git-event { font-size: 11px; padding: 2px 0; border-bottom: 1px solid var(--border); }
  .ws-git-event:last-child { border-bottom: none; }
  .ws-git-label { display: inline-block; min-width: 70px; font-weight: 600; color: #06b6d4; }
  .ws-session { font-size: 11px; color: var(--text); font-family: monospace; padding: 1px 0; }
  .ws-change { font-size: 10px; color: var(--muted); padding: 1px 0; }
  .skill-desc { color: var(--muted); font-size: 11px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .skill-desc:hover { white-space: normal; overflow: visible; }
  .skill-row td { vertical-align: top; }
  .skill-meta { font-size: 11px; color: var(--muted); }
  .tag { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 11px; background: #1c2333; color: var(--accent); margin: 1px 2px; }
  .events { max-height: 300px; overflow-y: auto; font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 12px; }
  .events .ev { padding: 4px 0; border-bottom: 1px solid var(--border); display: flex; gap: 12px; }
  .events .ev:last-child { border-bottom: none; }
  .events .ts { color: var(--muted); white-space: nowrap; min-width: 80px; }
  .events .name { color: var(--accent); white-space: nowrap; min-width: 160px; }
  .events .detail { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .events .ev.highlight .name { color: var(--green); font-weight: bold; }
  .events .ev.highlight .detail { color: var(--green); }
  .event-controls { float: right; display: inline-flex; gap: 6px; align-items: center; }
  .event-search { background: var(--card); border: 1px solid var(--border); color: var(--text); padding: 3px 8px; border-radius: 4px; font-size: 12px; width: 200px; outline: none; }
  .event-search:focus { border-color: var(--accent); }
  .event-count { font-size: 12px; font-weight: normal; color: var(--muted); margin-left: 6px; }
  .empty { color: var(--muted); font-style: italic; padding: 16px 0; text-align: center; }
  .debug-toggle { background: none; border: 1px solid var(--border); color: var(--muted); padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; }
  .debug-toggle:hover { color: var(--accent); border-color: var(--accent); }
  .debug-panel { display: none; }
  .debug-panel.open { display: block; }
  .debug-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .debug-section h3 { font-size: 12px; color: var(--yellow); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
  .debug-section pre { font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 11px; color: var(--text); background: var(--bg); padding: 8px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; }
  .debug-section .kv { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
  .debug-section .kv .k { color: var(--muted); }
  .debug-section .kv .v { color: var(--text); font-family: 'Cascadia Code', monospace; }
  .debug-section .kv .v.ok { color: var(--green); }
  .debug-section .kv .v.err { color: var(--red); }
  .req-log { max-height: 200px; overflow-y: auto; font-family: 'Cascadia Code', monospace; font-size: 11px; }
  .req-log .req { padding: 2px 0; border-bottom: 1px solid var(--border); display: flex; gap: 8px; }
  .req-log .req .method { color: var(--green); min-width: 35px; }
  .req-log .req .url { color: var(--accent); flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .req-log .req .status { min-width: 30px; }
  .req-log .req .status.s2 { color: var(--green); }
  .req-log .req .status.s4, .req-log .req .status.s5 { color: var(--red); }
  .req-log .req .dur { color: var(--muted); min-width: 50px; text-align: right; }
  .review-item { padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 12px; }
  .review-item:last-child { border-bottom: none; }
  .review-item:hover { background: rgba(255,255,255,0.02); }
  .review-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .review-result { color: var(--muted); font-size: 11px; margin: 4px 0; max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; cursor: pointer; padding: 6px 8px; background: rgba(0,0,0,0.2); border-radius: 4px; border: 1px solid var(--border); }
  .review-result.expanded { max-height: none; }
  .review-actions { display: flex; gap: 4px; margin-top: 6px; }
  .review-btn { border: 1px solid var(--border); background: none; color: var(--muted); padding: 2px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; }
  .review-btn:hover { border-color: var(--accent); color: var(--accent); }
  .review-btn.approve { border-color: var(--green); color: var(--green); }
  .review-btn.approve:hover { background: var(--green); color: white; }
  .review-btn.dismiss { border-color: var(--muted); }
  .review-btn.dismiss:hover { background: var(--muted); color: var(--bg); }
  .review-btn.flag { border-color: var(--red); color: var(--red); }
  .review-btn.flag:hover { background: var(--red); color: white; }
  .review-btn.issue { border-color: #8b5cf6; color: #8b5cf6; }
  .review-btn.issue:hover { background: #8b5cf6; color: white; }
  .review-btn.active { font-weight: 700; }
  .review-notes { width: 100%; background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 4px 8px; border-radius: 4px; font-size: 11px; margin-top: 4px; resize: vertical; }
  @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } .debug-grid { grid-template-columns: 1fr; } }

  /* Doc link */
  .doc-link { display: inline-block; color: var(--muted); font-size: 10px; margin-left: 6px; text-decoration: none; border: 1px solid var(--border); border-radius: 50%; width: 16px; height: 16px; line-height: 16px; text-align: center; vertical-align: middle; transition: all 0.2s; }
  .doc-link:hover { color: var(--accent); border-color: var(--accent); background: rgba(88,166,255,0.1); }

  /* CRUD buttons */
  .btn-add { float: right; background: var(--accent); color: white; border: none; padding: 3px 12px; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: 500; text-transform: none; letter-spacing: 0; }
  .btn-add:hover { background: #4c93e6; }
  .btn-action { background: none; border: 1px solid var(--border); color: var(--muted); padding: 2px 8px; border-radius: 4px; font-size: 10px; cursor: pointer; margin: 0 2px; }
  .btn-action:hover { border-color: var(--accent); color: var(--accent); }
  .btn-action.danger { border-color: var(--red); color: var(--red); }
  .btn-action.danger:hover { background: var(--red); color: white; }
  .btn-action.toggle-on { border-color: var(--green); color: var(--green); }
  .btn-action.toggle-off { border-color: var(--muted); color: var(--muted); }

  /* Modal */
  .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 1000; display: flex; align-items: center; justify-content: center; }
  .modal-content { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; width: 90%; max-width: 600px; max-height: 85vh; overflow-y: auto; }
  .modal-content:has(textarea[rows="12"]) { max-width: 800px; }
  .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px; border-bottom: 1px solid var(--border); }
  .modal-header h3 { font-size: 14px; color: var(--accent); margin: 0; }
  .modal-close { background: none; border: none; color: var(--muted); font-size: 20px; cursor: pointer; }
  .modal-close:hover { color: var(--text); }
  .modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }
  .btn-cancel { background: none; border: 1px solid var(--border); color: var(--muted); padding: 6px 16px; border-radius: 4px; font-size: 12px; cursor: pointer; }
  .btn-cancel:hover { color: var(--text); border-color: var(--text); }
  .btn-submit { background: var(--accent); color: white; border: none; padding: 6px 16px; border-radius: 4px; font-size: 12px; cursor: pointer; font-weight: 500; }
  .btn-submit:hover { background: #4c93e6; }
  .btn-ask-agent { background: none; border: 1px solid #a78bfa; color: #a78bfa; padding: 6px 16px; border-radius: 4px; font-size: 12px; cursor: pointer; margin-right: auto; }
  .btn-ask-agent:hover { background: rgba(167,139,250,0.15); color: #c4b5fd; border-color: #c4b5fd; }
  .btn-ask-agent:disabled { opacity: 0.5; cursor: wait; }
  .ask-agent-response { margin: 0 16px 12px; padding: 10px 12px; background: rgba(167,139,250,0.08); border: 1px solid rgba(167,139,250,0.25); border-radius: 6px; font-size: 12px; line-height: 1.5; max-height: 200px; overflow-y: auto; white-space: pre-wrap; font-family: 'Cascadia Code', monospace; color: #e2e8f0; }
  .ask-agent-response .ask-error { color: #f87171; }
  .ask-agent-response .ask-meta { color: var(--muted); font-size: 10px; margin-top: 6px; border-top: 1px solid var(--border); padding-top: 4px; }
  .modal-field { margin: 0 16px 12px; }
  .modal-field label { display: block; font-size: 11px; color: var(--muted); text-transform: uppercase; margin-bottom: 4px; }
  .modal-field input, .modal-field textarea, .modal-field select { width: 100%; background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 6px 8px; border-radius: 4px; font-size: 12px; font-family: inherit; }
  .modal-field textarea { resize: vertical; min-height: 60px; font-family: 'Cascadia Code', monospace; }
  .modal-field input:focus, .modal-field textarea:focus, .modal-field select:focus { outline: none; border-color: var(--accent); }

  /* Workspace history table */
  .history-entry { padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 12px; }
  .history-entry:last-child { border-bottom: none; }
  .history-path { font-family: monospace; color: #06b6d4; font-size: 11px; }
  .history-meta { color: var(--muted); font-size: 10px; margin-top: 2px; }
`;
