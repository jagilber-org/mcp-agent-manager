// mcp-agent-manager/src/services/dashboard/htmlStylesV2.ts
// V2 dashboard CSS - extends V1 with tab bar, badges, and enriched overview.

import { DASHBOARD_CSS } from './htmlStyles.js';

export const DASHBOARD_CSS_V2 = DASHBOARD_CSS + `
  /* ── Tab bar ──────────────────────────────────────────────────────── */
  .tab-bar { display: flex; gap: 0; background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 24px; position: sticky; top: 0; z-index: 10; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .tab-btn { background: none; border: none; border-bottom: 2px solid transparent; color: var(--muted); padding: 10px 16px; font-size: 12px; cursor: pointer; white-space: nowrap; position: relative; transition: color 0.2s, border-color 0.2s; font-family: inherit; letter-spacing: 0.3px; }
  .tab-btn:hover { color: var(--text); }
  .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }

  /* ── Tab badges ───────────────────────────────────────────────────── */
  .tab-badge { position: absolute; top: 2px; right: 0; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; font-size: 9px; font-weight: 700; line-height: 16px; text-align: center; }
  .tab-badge:empty { display: none; }
  .tab-badge.red { background: var(--red); color: white; }
  .tab-badge.yellow { background: var(--yellow); color: #000; }
  .tab-badge.green { background: var(--green); color: #000; }
  .tab-badge.blue { background: var(--accent); color: #000; }

  /* ── Tab panels ───────────────────────────────────────────────────── */
  .tab-panel { display: none; grid-column: 1 / -1; }
  .tab-panel.active { display: block; }

  /* ── Overview enrichments ─────────────────────────────────────────── */
  .health-strip { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 12px 0; }
  .health-strip .hs-label { font-size: 11px; color: var(--muted); text-transform: uppercase; margin-right: 8px; }
  .health-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; cursor: default; transition: transform 0.15s; }
  .health-dot:hover { transform: scale(1.4); }
  .health-dot.idle { background: var(--green); }
  .health-dot.busy, .health-dot.running { background: var(--yellow); }
  .health-dot.error { background: var(--red); }
  .health-dot.stopped { background: var(--muted); }
  .overview-extras { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
  @media (max-width: 768px) { .overview-extras { grid-template-columns: 1fr; } }
  .summary-cards { display: flex; gap: 12px; flex-wrap: wrap; }
  .summary-card { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px; min-width: 110px; text-align: center; }
  .summary-card .sc-value { font-size: 22px; font-weight: 700; }
  .summary-card .sc-value.red { color: var(--red); }
  .summary-card .sc-value.yellow { color: var(--yellow); }
  .summary-card .sc-value.green { color: var(--green); }
  .summary-card .sc-label { font-size: 10px; color: var(--muted); text-transform: uppercase; margin-top: 2px; }
  .activity-feed h4 { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
  .af-item { padding: 5px 0; border-bottom: 1px solid var(--border); font-size: 12px; cursor: pointer; display: flex; gap: 8px; align-items: center; }
  .af-item:hover { background: rgba(255,255,255,0.02); }
  .af-item:last-child { border-bottom: none; }
  .af-time { color: var(--muted); white-space: nowrap; font-size: 11px; min-width: 65px; font-family: 'Cascadia Code', 'Fira Code', monospace; }
  .af-event { color: var(--accent); white-space: nowrap; font-size: 11px; min-width: 140px; }
  .af-detail { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }

  /* ── Version toggle link ──────────────────────────────────────────── */
  .v-toggle { font-size: 11px; color: var(--muted); text-decoration: none; border: 1px solid var(--border); padding: 3px 10px; border-radius: 4px; margin-left: 8px; }
  .v-toggle:hover { color: var(--accent); border-color: var(--accent); }
`;
