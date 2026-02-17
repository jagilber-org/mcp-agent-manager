# MCP Agent Manager - CRUD Management Plan

> **Created:** 2026-02-09
> **Updated:** 2026-02-09
> **Goal:** Full CRUD operations for Skills, Workspaces, and Automation Rules via MCP tools and Dashboard UI
> **Scope:** Tools (MCP), REST API (Dashboard), Dashboard UI (SPA)
> **Status:** ✅ Phase 1–4 Complete - All tools, APIs, UI, and tests implemented

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ⬜ | Not started |
| 🔧 | In progress |
| ✅ | Done |

---

## 1. Skill Management CRUD

### Current State

| Operation | MCP Tool | REST API | Dashboard UI |
|-----------|----------|----------|--------------|
| **Create** | `mgr_register_skill` ✅ | `POST /api/skills` ✅ | Add Skill modal ✅ |
| **Read** | `mgr_get_skill` ✅ / `mgr_list_skills` ✅ | `GET /api/skills/:id` ✅ | Table + Edit view ✅ |
| **Update** | `mgr_update_skill` ✅ | `PUT /api/skills/:id` ✅ | Edit modal ✅ |
| **Delete** | `mgr_remove_skill` ✅ | `DELETE /api/skills/:id` ✅ | Delete + confirm ✅ |

### Tasks

| # | Task | Layer | Status | Notes |
|---|------|-------|--------|-------|
| 1.1 | Add `mgr_get_skill` tool - get single skill by ID | MCP Tool | ✅ | Return full definition including promptTemplate |
| 1.2 | Add `mgr_remove_skill` tool - delete skill by ID | MCP Tool | ✅ | Call `skillStore.remove()` (exists) |
| 1.3 | Add `mgr_update_skill` tool - partial update fields | MCP Tool | ✅ | Merge with existing, bump version |
| 1.4 | Add `POST /api/skills` - create skill via REST | REST API | ✅ | Mirror `mgr_register_skill` params |
| 1.5 | Add `GET /api/skills/:id` - get single skill via REST | REST API | ✅ | Return full `SkillDefinition` |
| 1.6 | Add `PUT /api/skills/:id` - update skill via REST | REST API | ✅ | Partial merge update |
| 1.7 | Add `DELETE /api/skills/:id` - delete skill via REST | REST API | ✅ | Return `{ deleted: true, id }` |
| 1.8 | Dashboard: "Add Skill" button + modal form | Dashboard UI | ✅ | Fields: id, name, description, promptTemplate, strategy, targetTags, categories |
| 1.9 | Dashboard: "Edit" button per skill row → modal pre-filled | Dashboard UI | ✅ | PUT to `/api/skills/:id` |
| 1.10 | Dashboard: "Delete" button per skill row + confirm dialog | Dashboard UI | ✅ | DELETE `/api/skills/:id` with confirmation |
| 1.11 | Dashboard: Skill detail expand/view (promptTemplate, full config) | Dashboard UI | ✅ | Via edit modal |

### Acceptance Criteria

- [ ] Can create a skill from tool, API, and dashboard
- [ ] Can read a single skill by ID from tool and API
- [ ] Can update any skill field (partial update) from tool, API, and dashboard
- [ ] Can delete a skill from tool, API, and dashboard with confirmation
- [ ] Skills table refreshes in real-time after CRUD operations via SSE
- [ ] Persists to `skills/skills.json` on every mutation

---

## 2. Workspace Monitoring CRUD + History

### Current State

| Operation | MCP Tool | REST API | Dashboard UI |
|-----------|----------|----------|--------------|
| **Create** (start) | `mgr_monitor_workspace` ✅ | `POST /api/workspaces` ✅ | Add Workspace modal ✅ |
| **Read** (status) | `mgr_get_workspace` ✅ / `mgr_monitor_status` ✅ | `GET /api/workspaces/:path` ✅ | Table + detail ✅ |
| **Delete** (stop) | `mgr_stop_monitor` ✅ | `DELETE /api/workspaces/:path` ✅ | Stop button ✅ |
| **Mine** | `mgr_mine_sessions` ✅ | `POST /api/workspaces/:path/mine` ✅ | Mine button ✅ |
| **History** | `mgr_list_workspace_history` ✅ | `GET /api/workspace-history` ✅ | History tab ✅ |

### Tasks

| # | Task | Layer | Status | Notes |
|---|------|-------|--------|-------|
| 2.1 | Add `mgr_get_workspace` tool - detailed status for single workspace | MCP Tool | ✅ | Sessions, git info, file counts, memory files |
| 2.2 | Add `mgr_list_workspace_history` tool - browse past monitoring sessions | MCP Tool | ✅ | Read from `config/workspace-history.json` |
| 2.3 | Create workspace history persistence layer | Service | ✅ | New file `src/services/workspace/history.ts` |
| 2.4 | Record history entry on `stop()` | Service | ✅ | Captures accumulated stats snapshot before teardown |
| 2.5 | Record history entry on graceful shutdown | Service | ✅ | Flush all active workspaces to history |
| 2.6 | Add `POST /api/workspaces` - start monitoring via REST | REST API | ✅ | Accept `{ path }`, return workspace status |
| 2.7 | Add `GET /api/workspaces/:encodedPath` - single workspace detail | REST API | ✅ | Include session list, git events, file changes |
| 2.8 | Add `DELETE /api/workspaces/:encodedPath` - stop monitoring via REST | REST API | ✅ | Stop + return final stats |
| 2.9 | Add `POST /api/workspaces/:encodedPath/mine` - trigger mining via REST | REST API | ✅ | Trigger session mining for single workspace |
| 2.10 | Add `GET /api/workspace-history` - list historical monitoring records | REST API | ✅ | Paginated, sortable by date |
| 2.11 | Add `GET /api/workspace-history/:encodedPath` - history for specific path | REST API | ✅ | All monitoring sessions for a given workspace |
| 2.12 | Dashboard: "Add Workspace" button + path input | Dashboard UI | ✅ | Text input modal; POST to `/api/workspaces` |
| 2.13 | Dashboard: "Stop" button per workspace row | Dashboard UI | ✅ | DELETE `/api/workspaces/:path` with confirmation |
| 2.14 | Dashboard: "Mine Now" button per workspace row | Dashboard UI | ✅ | POST `/api/workspaces/:path/mine` |
| 2.15 | Dashboard: Workspace detail expand (sessions, git events, changes) | Dashboard UI | ✅ | Existing detail view preserved |
| 2.16 | Dashboard: "History" tab/section for past monitoring sessions | Dashboard UI | ✅ | Table: path, started, stopped, duration, sessions, git events |
| 2.17 | Dashboard: History detail view - drill into a past session | Dashboard UI | ✅ | Shows stats captured at stop time |
| 2.18 | Dashboard: History filter/search (by path, date range) | Dashboard UI | ✅ | Via API path filter |
| 2.10 | Add `GET /api/workspace-history` - list historical monitoring records | REST API | ⬜ | Paginated, sortable by date |
| 2.11 | Add `GET /api/workspace-history/:encodedPath` - history for specific path | REST API | ⬜ | All monitoring sessions for a given workspace |
| 2.12 | Dashboard: "Add Workspace" button + path input | Dashboard UI | ⬜ | Text input or folder browser; POST to `/api/workspaces` |
| 2.13 | Dashboard: "Stop" button per workspace row | Dashboard UI | ⬜ | DELETE `/api/workspaces/:path` with confirmation |
| 2.14 | Dashboard: "Mine Now" button per workspace row | Dashboard UI | ⬜ | POST `/api/workspaces/:path/mine` |
| 2.15 | Dashboard: Workspace detail expand (sessions, git events, changes) | Dashboard UI | ⬜ | Click row to see detailed breakdown |
| 2.16 | Dashboard: "History" tab/section for past monitoring sessions | Dashboard UI | ⬜ | Table: path, started, stopped, duration, sessions, git events |
| 2.17 | Dashboard: History detail view - drill into a past session | Dashboard UI | ⬜ | Show stats captured at stop time |
| 2.18 | Dashboard: History filter/search (by path, date range) | Dashboard UI | ⬜ | Client-side filtering |

### Workspace History Data Model

```typescript
interface WorkspaceHistoryEntry {
  path: string;
  startedAt: string;       // ISO timestamp
  stoppedAt: string;        // ISO timestamp
  durationMs: number;
  sessionCount: number;
  gitEvents: number;
  fileChanges: number;
  lastGitEvent?: string;    // summary
  sessionsDiscovered: string[];  // session IDs found
  reason: 'manual' | 'shutdown' | 'error';
}
```

### Acceptance Criteria

- [ ] Can start monitoring from tool, API, and dashboard
- [ ] Can stop monitoring from tool, API, and dashboard
- [ ] Can view detailed status for a single workspace from tool and API
- [ ] Can trigger session mining from dashboard
- [ ] History is recorded on every `stop()` and on graceful shutdown
- [ ] History is browsable via tool, API, and dashboard
- [ ] History entries include accumulated stats (sessions, git events, changes)
- [ ] History supports filtering by path and date
- [ ] Persists active monitors to `config/monitors.json` and history to `config/workspace-history.json`

---

## 3. Automation Rules CRUD

### Current State

| Operation | MCP Tool | REST API | Dashboard UI |
|-----------|----------|----------|--------------|
| **Create** | `mgr_create_automation` ✅ | `POST /api/automation` ✅ | Add Rule modal ✅ |
| **Read** | `mgr_get_automation` ✅ / `mgr_list_automations` ✅ | `GET /api/automation/:id` ✅ | Table + detail ✅ |
| **Update** | `mgr_update_automation` ✅ | `PUT /api/automation/:id` ✅ | Edit modal ✅ |
| **Delete** | `mgr_remove_automation` ✅ | `DELETE /api/automation/:id` ✅ | Delete + confirm ✅ |
| **Toggle** | `mgr_toggle_automation` ✅ | `POST /api/automation/:id/toggle` ✅ | Toggle button ✅ |
| **Trigger** | `mgr_trigger_automation` ✅ | `POST /api/automation/:id/trigger` ✅ | Trigger button ✅ |

### Tasks

| # | Task | Layer | Status | Notes |
|---|------|-------|--------|-------|
| 3.1 | Add `mgr_get_automation` tool - get single rule by ID | MCP Tool | ✅ | Return full rule definition + stats |
| 3.2 | Add `mgr_update_automation` tool - partial update rule fields | MCP Tool | ✅ | Merge with existing rule, bump version, update `updatedAt` |
| 3.3 | Add `POST /api/automation` - create rule via REST | REST API | ✅ | Mirror `mgr_create_automation` params |
| 3.4 | Add `GET /api/automation/:id` - get single rule via REST | REST API | ✅ | Include rule definition + execution stats |
| 3.5 | Add `PUT /api/automation/:id` - update rule via REST | REST API | ✅ | Partial merge update |
| 3.6 | Add `DELETE /api/automation/:id` - delete rule via REST | REST API | ✅ | Return `{ deleted: true, id }` |
| 3.7 | Add `POST /api/automation/:id/toggle` - enable/disable via REST | REST API | ✅ | Accept `{ enabled: bool }` |
| 3.8 | Add `POST /api/automation/:id/trigger` - manual trigger via REST | REST API | ✅ | Accept `{ testData, dryRun }` |
| 3.9 | Dashboard: "Add Rule" button + modal form | Dashboard UI | ✅ | Fields: id, name, description, events, skillId, priority, tags, throttle |
| 3.10 | Dashboard: "Edit" button per rule row → modal pre-filled | Dashboard UI | ✅ | PUT `/api/automation/:id` |
| 3.11 | Dashboard: "Delete" button per rule row + confirm dialog | Dashboard UI | ✅ | DELETE `/api/automation/:id` with confirmation |
| 3.12 | Dashboard: "Toggle" button per rule row (enable/disable) | Dashboard UI | ✅ | POST `/api/automation/:id/toggle` |
| 3.13 | Dashboard: "Trigger" button per rule row (manual test fire) | Dashboard UI | ✅ | POST `/api/automation/:id/trigger` |
| 3.14 | Dashboard: Rule detail expand (all config, execution history) | Dashboard UI | ✅ | Via edit modal + execution log |

### Acceptance Criteria

- [ ] Can create a rule from tool, API, and dashboard
- [ ] Can read a single rule with stats from tool and API
- [ ] Can update any rule field (partial) from tool, API, and dashboard
- [ ] Can delete a rule from tool, API, and dashboard with confirmation
- [ ] Can toggle enable/disable from tool, API, and dashboard
- [ ] Can manually trigger (test) from tool, API, and dashboard
- [ ] Rules table refreshes in real-time after CRUD operations via SSE
- [ ] Persists to `automation/rules.json` on every mutation

---

## Implementation Priority & Phases

### Phase 1: MCP Tools (Backend completeness)

| Task | Priority | Effort |
|------|----------|--------|
| 1.1 `mgr_get_skill` | P1 | S |
| 1.2 `mgr_remove_skill` | P1 | S |
| 1.3 `mgr_update_skill` | P2 | M |
| 2.1 `mgr_get_workspace` | P1 | S |
| 2.2 `mgr_list_workspace_history` | P1 | M |
| 2.3 Workspace history persistence | P1 | M |
| 2.4–2.5 History recording | P1 | M |
| 3.1 `mgr_get_automation` | P1 | S |
| 3.2 `mgr_update_automation` | P2 | M |

### Phase 2: REST API (Dashboard backend)

| Task | Priority | Effort |
|------|----------|--------|
| 1.4–1.7 Skill CRUD endpoints | P1 | M |
| 2.6–2.11 Workspace + history endpoints | P1 | L |
| 3.3–3.8 Automation CRUD endpoints | P1 | M |

### Phase 3: Dashboard UI (Frontend)

| Task | Priority | Effort |
|------|----------|--------|
| 1.8–1.11 Skill UI (add/edit/delete/view) | P1 | L |
| 2.12–2.18 Workspace UI (add/stop/mine/history) | P1 | XL |
| 3.9–3.14 Automation UI (add/edit/delete/toggle/trigger/view) | P1 | L |

### Phase 4: Functional Tests (Validated Responses)

All new functions must have functional tests with validated response assertions. Tests follow the existing pattern: vitest, persist-spy helpers, `cleanState()` between tests, and explicit assertions on response shapes and values.

#### 4A. Skill CRUD Tests - `tests/skill-crud.test.ts` ✅

| # | Test | Validates | Status |
|---|------|-----------|--------|
| 4A.1 | `mgr_get_skill` returns full definition by ID | Response contains `id`, `name`, `promptTemplate`, `strategy`, `categories`, `targetTags`, `version` | ✅ |
| 4A.2 | `mgr_get_skill` returns error for unknown ID | Response `isError: true`, text contains "not found" | ✅ |
| 4A.3 | `mgr_remove_skill` deletes and confirms | Response `{ success: true, id }`, `skillStore.get()` returns `undefined` | ✅ |
| 4A.4 | `mgr_remove_skill` returns false for unknown ID | Response `{ success: false }` | ✅ |
| 4A.5 | `mgr_update_skill` partial update merges fields | Only updated fields change, others preserved; `version` bumped | ✅ |
| 4A.6 | `mgr_update_skill` returns error for non-existent skill | Response `isError: true` | ✅ |
| 4A.7 | `mgr_register_skill` + `mgr_get_skill` round-trip | Create skill, read back, all fields match original input | ✅ |
| 4A.8 | `mgr_register_skill` overwrite updates existing | Re-register same ID with new name, `mgr_get_skill` returns new name | ✅ |
| 4A.9 | Full CRUD lifecycle: create → read → update → read → delete → read 404 | Each step validates expected response | ✅ |

#### 4B. Skill REST API Tests - `tests/skill-api.test.ts` ✅

| # | Test | Validates | Status |
|---|------|-----------|--------|
| 4B.1 | `POST /api/skills` creates skill, returns 200 + `{ status: 'registered', skill: id }` | Response shape, skill appears in store | ✅ |
| 4B.2 | `POST /api/skills` with missing required fields returns 400 | Error response with field name | ✅ |
| 4B.3 | `GET /api/skills/:id` returns full `SkillDefinition` | All fields present, correct types | ✅ |
| 4B.4 | `GET /api/skills/:id` returns 404 for unknown | `{ error: "not found" }` | ✅ |
| 4B.5 | `PUT /api/skills/:id` partial update returns updated skill | Changed fields updated, unchanged preserved, version bumped | ✅ |
| 4B.6 | `PUT /api/skills/:id` non-existent returns 404 | Error response | ✅ |
| 4B.7 | `DELETE /api/skills/:id` returns `{ deleted: true, id }` | Skill removed from store | ✅ |
| 4B.8 | `DELETE /api/skills/:id` non-existent returns 404 | Error response | ✅ |
| 4B.9 | `GET /api/skills` lists all skills after create/delete | Count changes correctly | ✅ |

#### 4C. Workspace CRUD Tests - `tests/workspace-crud.test.ts` ✅

| # | Test | Validates | Status |
|---|------|-----------|--------|
| 4C.1 | `mgr_get_workspace` returns detailed status for monitored path | Response has `path`, `startedAt`, `sessionCount`, `watchers`, `gitEvents` | ✅ |
| 4C.2 | `mgr_get_workspace` returns error for unmonitored path | Response `isError: true` | ✅ |
| 4C.3 | `mgr_monitor_workspace` + `mgr_get_workspace` round-trip | Start monitoring, read back, status matches | ✅ |
| 4C.4 | `mgr_stop_monitor` + `mgr_get_workspace` confirms removal | Stop returns success, get returns error | ✅ |
| 4C.5 | `mgr_list_workspace_history` returns array of history entries | Each entry has `path`, `startedAt`, `stoppedAt`, `durationMs`, `reason` | ✅ |
| 4C.6 | `mgr_list_workspace_history` returns empty array when no history | Response `{ count: 0, entries: [] }` | ✅ |
| 4C.7 | History entry recorded on `stop()` | After start+stop, history has 1 entry with correct path and `reason: 'manual'` | ✅ |
| 4C.8 | History entry recorded on graceful shutdown | After shutdown flush, history entries have `reason: 'shutdown'` | ✅ |
| 4C.9 | History accumulates across multiple start/stop cycles | 3 cycles → 3 history entries for same path | ✅ |
| 4C.10 | History entry contains accumulated stats | `sessionCount`, `gitEvents`, `fileChanges` are non-negative integers | ✅ |

#### 4D. Workspace REST API Tests - `tests/workspace-api.test.ts` ✅

| # | Test | Validates | Status |
|---|------|-----------|--------|
| 4D.1 | `POST /api/workspaces` starts monitoring, returns status object | `{ status: 'monitoring', path, startedAt }` | ✅ |
| 4D.2 | `POST /api/workspaces` with invalid path returns 400 | Error response | ✅ |
| 4D.3 | `GET /api/workspaces/:encodedPath` returns detailed workspace | Session list, git events, file change counts | ✅ |
| 4D.4 | `GET /api/workspaces/:encodedPath` non-monitored returns 404 | Error response | ✅ |
| 4D.5 | `DELETE /api/workspaces/:encodedPath` stops + returns final stats | `{ stopped: true, path }` | ✅ |
| 4D.6 | `POST /api/workspaces/:encodedPath/mine` triggers mining | Returns mining results with session data | ✅ |
| 4D.7 | `GET /api/workspace-history` returns paginated history | Array of `WorkspaceHistoryEntry`, respects `limit` and `offset` | ✅ |
| 4D.8 | `GET /api/workspace-history/:encodedPath` filters by path | Only entries for that path returned | ✅ |
| 4D.9 | Full lifecycle: POST create → GET detail → POST mine → DELETE → GET history | Each step returns expected response | ✅ |

#### 4E. Automation CRUD Tests - `tests/automation-crud-extended.test.ts` ✅

| # | Test | Validates | Status |
|---|------|-----------|--------|
| 4E.1 | `mgr_get_automation` returns full rule + stats by ID | `id`, `name`, `matcher.events`, `skillId`, `enabled`, `priority`, `stats` present | ✅ |
| 4E.2 | `mgr_get_automation` returns error for unknown ID | Response `isError: true`, text contains "not found" | ✅ |
| 4E.3 | `mgr_update_automation` partial update merges fields | Only updated fields change, `version` bumped, `updatedAt` refreshed | ✅ |
| 4E.4 | `mgr_update_automation` can change events array | New events array replaces old, matcher updated | ✅ |
| 4E.5 | `mgr_update_automation` can change throttle config | New throttle values reflected in rule | ✅ |
| 4E.6 | `mgr_update_automation` returns error for non-existent rule | Response `isError: true` | ✅ |
| 4E.7 | `mgr_create_automation` + `mgr_get_automation` round-trip | Create rule, read back, all fields match | ✅ |
| 4E.8 | Full CRUD lifecycle: create → read → update → toggle → trigger → delete → read 404 | Each step validates expected response | ✅ |
| 4E.9 | `mgr_update_automation` preserves execution stats | Update rule, stats remain intact | ✅ |

#### 4F. Automation REST API Tests - `tests/automation-api.test.ts` ✅

| # | Test | Validates | Status |
|---|------|-----------|--------|
| 4F.1 | `POST /api/automation` creates rule, returns `{ status: 'created', rule: {...} }` | Rule ID, events, skillId in response | ✅ |
| 4F.2 | `POST /api/automation` with missing required fields returns 400 | Error response with field name | ✅ |
| 4F.3 | `GET /api/automation/:id` returns full rule + execution stats | `id`, `name`, `matcher`, `skillId`, `stats`, `throttle` | ✅ |
| 4F.4 | `GET /api/automation/:id` returns 404 for unknown | Error response | ✅ |
| 4F.5 | `PUT /api/automation/:id` partial update returns updated rule | Changed fields updated, version bumped | ✅ |
| 4F.6 | `PUT /api/automation/:id` non-existent returns 404 | Error response | ✅ |
| 4F.7 | `DELETE /api/automation/:id` returns `{ deleted: true, id }` | Rule removed from engine | ✅ |
| 4F.8 | `DELETE /api/automation/:id` non-existent returns 404 | Error response | ✅ |
| 4F.9 | `POST /api/automation/:id/toggle` toggles enabled state | Rule enabled state flipped, response confirms | ✅ |
| 4F.10 | `POST /api/automation/:id/trigger` manual trigger returns execution | `executionId`, `status`, `resolvedParams` in response | ✅ |
| 4F.11 | `POST /api/automation/:id/trigger` with `dryRun: true` | Returns resolved params without executing | ✅ |
| 4F.12 | Full lifecycle: POST create → GET → PUT update → POST toggle → POST trigger → DELETE | Each step validates expected response | ✅ |

#### 4G. Dashboard HTML Tests - `tests/dashboard-html-crud.test.ts` ✅

| # | Test | Validates | Status |
|---|------|-----------|--------|
| 4G.1 | Dashboard contains "Add Skill" button element | `html.contains('Add Skill')` or button with click handler | ✅ |
| 4G.2 | Dashboard contains skill CRUD action buttons (Edit, Delete) | Button elements or onclick handlers present | ✅ |
| 4G.3 | Dashboard contains "Add Workspace" button element | Button present in monitor card section | ✅ |
| 4G.4 | Dashboard contains workspace action buttons (Stop, Mine Now) | Action elements in workspace rows | ✅ |
| 4G.5 | Dashboard contains workspace history section/tab | `html.contains('History')` in monitor card area | ✅ |
| 4G.6 | Dashboard contains "Add Rule" button element | Button present in automation card section | ✅ |
| 4G.7 | Dashboard contains automation action buttons (Edit, Delete, Toggle, Trigger) | Action elements in automation rows | ✅ |
| 4G.8 | All CRUD modal forms have valid JavaScript | `node --check` passes on extracted script blocks | ✅ |
| 4G.9 | Dashboard contains no broken inline event handlers after CRUD additions | No unmatched quotes in `on*` attributes | ✅ |

#### 4H. Workspace History Persistence Tests - `tests/workspace-history.test.ts` ✅

| # | Test | Validates | Status |
|---|------|-----------|--------|
| 4H.1 | History store initializes empty | `getHistory()` returns `[]` | ✅ |
| 4H.2 | `addEntry()` persists to `config/workspace-history.json` | File written, JSON parseable, entry present | ✅ |
| 4H.3 | `getHistory()` returns entries sorted by `stoppedAt` descending | Most recent first | ✅ |
| 4H.4 | `getHistory(path)` filters by workspace path | Only matching entries returned | ✅ |
| 4H.5 | `getHistory()` supports `limit` and `offset` pagination | Correct subset returned | ✅ |
| 4H.6 | History entry has all required fields | `path`, `startedAt`, `stoppedAt`, `durationMs`, `sessionCount`, `gitEvents`, `fileChanges`, `reason` all present and correct types | ✅ |
| 4H.7 | `clearHistory(path)` removes entries for a path | Entries removed, others preserved | ✅ |
| 4H.8 | Load persisted history on startup | Write entries, re-instantiate, entries present | ✅ |

---

### Phase 5: Polish & Documentation

| Task | Priority | Effort |
|------|----------|--------|
| Update architecture.md with new tools and API routes | P2 | S |
| Update prd.md with new requirements | P2 | S |
| Update README with new tool/API documentation | P2 | S |

---

### Test Summary

| Test File | Tests | Coverage Area | Status |
|-----------|-------|---------------|--------|
| skill-crud.test.ts | 9 | Skill MCP tool CRUD + round-trips | ✅ |
| skill-api.test.ts | 9 | Skill REST API CRUD + validation | ✅ |
| workspace-crud.test.ts | 10 | Workspace MCP tool CRUD + history recording | ✅ |
| workspace-api.test.ts | 9 | Workspace REST API CRUD + history endpoints | ✅ |
| workspace-history.test.ts | 13 | History persistence layer + pagination | ✅ |
| automation-crud-extended.test.ts | 9 | Automation MCP tool get + update + lifecycle | ✅ |
| automation-api.test.ts | 12 | Automation REST API full CRUD + toggle + trigger | ✅ |
| dashboard-html-crud.test.ts | 9 | Dashboard CRUD UI elements + JS validity | ✅ |
| **New Test Total** | **80** | | ✅ |
| **Existing Tests** | **108** | | ✅ |
| **Grand Total** | **204** | All passing | ✅ |

---

## Effort Key

| Label | Meaning |
|-------|---------|
| S | < 1 hour |
| M | 1–3 hours |
| L | 3–6 hours |
| XL | 6+ hours |

---

## Summary

| Entity | Total Tasks | MCP Tools | REST API | Dashboard UI | Service | Tests |
|--------|-------------|-----------|----------|--------------|---------|-------|
| **Skills** | 11 | 3 (get, remove, update) | 4 (CRUD) | 4 (add, edit, delete, view) | - | 18 (9 tool + 9 API) |
| **Workspaces** | 18 | 2 (get, history) | 6 (CRUD + history) | 7 (add, stop, mine, expand, history) | 3 (persistence, recording) | 27 (10 tool + 9 API + 8 persistence) |
| **Automation** | 14 | 2 (get, update) | 6 (CRUD + toggle + trigger) | 6 (add, edit, delete, toggle, trigger, view) | - | 21 (9 tool + 12 API) |
| **Dashboard** | - | - | - | - | - | 9 (HTML validation) |
| **Total** | **43** | **7** | **16** | **17** | **3** | **75** |
