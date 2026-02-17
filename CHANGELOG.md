# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.3] - 2026-02-15

### Added
- **Backup & Restore** — full backup/restore service for all persistent data stores (`src/services/backupService.ts`)
  - Create timestamped backups of agents, skills, rules, monitors, and workspace history
  - Restore with per-file selection and `.pre-restore` safety copies
  - Export/import backups to/from custom directories
  - Auto-prune to 20 backups, manifest with file checksums
- 7 MCP tools: `mgr_create_backup`, `mgr_list_backups`, `mgr_restore_backup`, `mgr_backup_details`, `mgr_delete_backup`, `mgr_export_backup`, `mgr_import_backup`
- 9 Dashboard API endpoints (`/api/backups/*`) for backup CRUD + restore/export/import
- Dashboard **Backups tab** with create, restore (per-file checkboxes), export, import, delete, and custom path support
- Keyboard nav updated for 11th tab (Backups)
- `tests/backup-service.test.ts` — 25 integration tests covering create, list, restore, delete, export, import, pruning, round-trip integrity
- **Persistence guards** on all 3 stores (rules, agents, skills):
  - Backup `.bak` before empty-write, recovery from `.bak` on load, anti-wipe reload guard
- `tests/persistence-guard.test.ts` — 25 integration tests with real file I/O
- `scripts/clean-vscode-sessions.cjs` — utility to prune archived VS Code Copilot Chat sessions

### Removed
- `migrateFromLegacy()` — removed all legacy migration code from `dataDir.ts` and `server/index.ts` (was causing recurring data wipes)

### Fixed
- Recurring automation rules wipe (4-day issue) — root cause was `migrateFromLegacy()` copying empty cwd files over APPDATA data
- All 10 automation rules restored from git history (commit `e1f8248`)

## [0.5.2] - 2026-02-15

### Added
- `includeRead` parameter on `mgr_read_messages` — intuitive way to re-read previously consumed messages (overrides `unreadOnly`)
- `reader="*"` wildcard on `mgr_read_messages` — admin/dashboard view that bypasses recipient filtering
- Diagnostic hints in `mgr_read_messages` response when 0 results but channel has messages — shows who messages are addressed to and how to read them
- `peekChannel()` method on `AgentMailbox` — returns sender/recipient metadata without filtering by reader
- 5-agent configuration restored to `agents/agents.json` (copilot-1 through copilot-5)

### Changed
- **Breaking:** `mgr_read_messages` `markRead` default changed from `true` to `false` (non-destructive peek mode by default)
- `mgr_read_messages` tool description updated to emphasize messages are retained after reading

### Fixed
- Messages appearing consumed/lost on first read — reads are now non-destructive by default
- `reader="*"` wildcard not working for directed messages — `_isRecipient()` now treats `*` reader as admin
- Silent 0 results when reader identity doesn't match message recipients — now returns diagnostic hint

## [0.5.1] - 2026-02-15

### Added
- StorageProvider abstraction layer with disk/mcp-index/both backends (`src/services/storage/`)
- ConfigWatcher-based cross-instance sync for `messages.jsonl` in `AgentMailbox`
- Parent process monitoring with `MCP_KEEP_ALIVE=persistent` daemon mode and parent-aware graceful shutdown
- `DATA_DIR` field in `/api/debug` endpoint for diagnosing data directory issues
- `npm run kill` script alias for `scripts/kill-stale-servers.cjs`
- Multi-instance persistence test script (`scripts/multi-instance-test.mjs`, 33 assertions)
- `tests/cross-instance-sync.test.ts` — 26 tests covering all 5 ConfigWatcher consumers
- `tests/messaging-api.test.ts` — 24 tests covering all `/api/messages/*` HTTP endpoints
- Dashboard divergence report with Chrome DevTools screenshots (`docs/dashboard-divergence-report.md`)
- Constitution rules: TS-9 (real reload methods), TS-10 (cross-instance-sync.test.ts), MI-8 (new watchConfigFile requires tests)

### Fixed
- Cross-instance message visibility: `AgentMailbox` now watches `messages.jsonl` via ConfigWatcher and reloads on external changes
- Storage backend `both` mode reads disk-primary (was mcp-index-primary), preventing empty-state reads when mcp-index unavailable
- Data directory migration: `migrateFile()` now overwrites empty `[]` targets from non-empty legacy sources
- Test pollution: `createPersistSpies()` now mocks mailbox persistence (`appendMessageToLog`, `rewriteMessageLog`, `broadcastToPeers`)
- Kill script pattern: copilot-instructions and BD-2 constitution rule enforce `dist[\\/]server[\\/]index\.js` regex (never `mcp-agent-manager`)
- `MCP_KEEP_ALIVE` grace period: active agents get 30s instead of infinite wait on stdin close

### Changed
- Default storage backend from `mcp-index` to `both` (disk primary, mcp-index backup)
- Constitution minimum test count bumped to 600 (MI-2)

## [0.5.0] - 2026-02-13

### Added
- Dashboard V2 tabbed layout (`?v=2`) with 10 tabs: Overview, Agents, Skills, Workspaces, Automation, Tasks, Cross-Repo, Review, Messaging, Events
- V2 enriched Overview: agent health dots, summary cards (errors, reviews, messages, rules, workspaces), clickable recent activity feed
- V2 tab badges with live counts (agents errors, pending reviews, messages, events, automation, cross-repo)
- V2 keyboard navigation: 1-9/0 switch tabs, Escape returns to Overview, localStorage persistence
- A/B testing: `?v=2` query param routes to V2, default remains V1 classic layout
- Message CRUD: `mgr_get_message` and `mgr_update_message` MCP tools, `GET/PUT /api/messages/by-id/:id` REST endpoints, dashboard Edit/Delete buttons per message
- Messaging expand/collapse: click individual messages or use Expand All/Collapse All buttons
- Shared `toolErrors.ts` with `toolError()` helper returning schema hints on every failed MCP tool call
- `TOOL_SCHEMAS` dictionary covering all ~40 tools across 9 tool files (32 error sites updated)
- Default message sender fallback using `path.basename(process.cwd())` in `agentMailbox.ts`

### Fixed
- Message View button showing "No messages" - `reader=*` now treated as wildcard in `/api/messages/:channel` API
- Split-brain DATA_DIR: documented `MCP_DATA_DIR` env var fix in mcp.json (no code change needed)

## [0.4.0] - 2026-02-12

### Added
- Spec-kit scaffold: `.github/agents/`, `.github/prompts/`, `.specify/`, `specs/`
- Constitution at `.specify/memory/constitution.md` (derived from `docs/constitution.md`)
- Community health files: LICENSE (MIT), CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md
- `.env.example` with documented environment variables
- VS Code `chat.promptFilesRecommendations` for spec-kit slash commands
- `mgr_cross_repo_batch_dispatch` tool documentation in README
- `mgr_purge_messages` tool documentation in README

### Fixed
- `docs/constitution.md`: PE-4/5/6 moved from Article 1 (Persistence) to Article 11 (Code Quality)
- `docs/constitution.md`: Article ordering fixed (Build & Deploy before Multi-Instance)
- `docs/constitution.md`: Stale test count updated from 110 to 500+
- `constitution.json`: PE-4/5/6 moved from `persistence` to new `code-quality` article (CQ-1/2/3)
- `.github/copilot-instructions.md`: Fixed stale `src/core/` and `src/cross-repo/` paths
- README: Test count updated from 479 to 514, tool count from 43+2 to 45+2, license from Private to MIT
- README: Added 9 missing test files to coverage section, updated stale per-file test counts

### Removed
- `instructions/` directory (0 useful content, all entries skipped by mcp-index-server)

## [0.3.0] - 2026-02-08

### Added
- HTTP peer mesh for multi-instance communication
- Messaging system with channels and SSE delivery
- Cross-repo dispatch with GitHub Actions integration
- Real-time SSE dashboard with polling fallback
- Constitution enricher skill
- Markdown lint and bad-chars skills
- Dashboard clear button fixes

### Changed
- Migrated from stdio-only to HTTP+SSE transport
