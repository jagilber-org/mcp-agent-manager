# MCP Agent Manager - Product Requirements Document (PRD)

## 1. Overview

**Product:** MCP Agent Manager
**Type:** Model Context Protocol (MCP) server
**Transport:** stdio
**Runtime:** Node.js 22+ / TypeScript 5.7
**Purpose:** Multi-agent orchestration, workspace monitoring, skills-based task routing, and automated event-driven workflows for AI coding agents.

## 2. Problem Statement

AI coding agents (GitHub Copilot, Anthropic Claude, etc.) operate in isolation without coordination, monitoring, or automated reaction to workspace events. There is no unified system to:

- Register and manage multiple AI agents with different providers
- Route tasks to agents using intelligent strategies (race, consensus, fallback, cost-optimized)
- Automatically trigger agent skills when workspace events occur (commits, file changes, session updates)
- Persist agent configurations, monitoring state, and automation rules across restarts
- Provide real-time visibility into agent activity via a dashboard

## 3. Target Users

- **AI Engineering Teams** building multi-agent workflows
- **Individual Developers** using AI coding assistants who want automated code review, security audits, and quality checks
- **DevOps/Platform Teams** integrating AI into CI/CD pipelines via MCP

## 4. Core Requirements

### 4.1 Agent Management

| Req | Description | Priority |
|-----|-------------|----------|
| AM-1 | Register agents with provider, model, tags, concurrency limits | P0 |
| AM-2 | Persist agent configs to disk, auto-restore on startup | P0 |
| AM-3 | Track agent state (idle/running/busy/error), tasks, tokens, costs | P0 |
| AM-4 | Find agents by tags, provider, availability | P0 |
| AM-5 | Health checks with uptime, error tracking, task stats | P1 |
| AM-6 | Emit lifecycle events (registered, unregistered, state-changed) | P0 |

### 4.2 Skill Management

| Req | Description | Priority |
|-----|-------------|----------|
| SK-1 | Define skills with prompt templates, strategy, target tags | P0 |
| SK-2 | Resolve prompt templates with runtime parameters | P0 |
| SK-3 | Persist skills to disk | P0 |
| SK-4 | Search skills by keywords and categories | P1 |
| SK-5 | Support SpecKit skills (constitution, compliance, governance) | P1 |

### 4.3 Task Routing

| Req | Description | Priority |
|-----|-------------|----------|
| TR-1 | 6 routing strategies: single, race, fan-out, consensus, fallback, cost-optimized | P0 |
| TR-2 | Resolve candidate agents via targetAgents → targetTags → all available fallback | P0 |
| TR-3 | Track metrics: total tasks, tokens, costs, latency | P0 |
| TR-4 | Emit task:started and task:completed events | P0 |
| TR-5 | Agent concurrency enforcement (busy state when at max) | P0 |

### 4.4 Automation Engine

| Req | Description | Priority |
|-----|-------------|----------|
| AE-1 | Event → skill trigger rules with matcher patterns | P0 |
| AE-2 | Throttling (leading/trailing modes) with per-key grouping | P0 |
| AE-3 | Conditions: min-agents, schedule, custom | P1 |
| AE-4 | Retry with exponential backoff | P1 |
| AE-5 | Cascade guard: prevent self-referential event loops | P0 |
| AE-6 | Execution history with stats (success/failure/throttled/skipped) | P0 |
| AE-7 | Persist rules to disk | P0 |
| AE-8 | Dry-run mode for testing rules | P1 |
| AE-9 | Review queue for human-in-the-loop feedback on completed tasks | P1 |
| AE-10 | Retry queue with exponential backoff for failed tasks | P1 |

### 4.5 Workspace Monitoring

| Req | Description | Priority |
|-----|-------------|----------|
| WM-1 | Watch local filesystem for file changes | P0 |
| WM-2 | Periodic git fetch for remote changes | P0 |
| WM-3 | Mine Copilot chat session JSONL files | P0 |
| WM-4 | Load Copilot memory files (.github/copilot-memory.md) | P1 |
| WM-5 | Persist monitored paths, auto-restore on startup | P0 |
| WM-6 | Emit 6 workspace event types to EventBus | P0 |
| WM-7 | Support remote git branch tracking with ref comparison | P1 |

### 4.6 Event System

| Req | Description | Priority |
|-----|-------------|----------|
| EV-1 | 13 typed events across agent, task, skill, workspace categories | P0 |
| EV-2 | JSONL event persistence to logs/events.jsonl | P0 |
| EV-3 | SSE broadcast to dashboard clients | P0 |
| EV-4 | Event-driven automation rule matching | P0 |

### 4.7 Dashboard

| Req | Description | Priority |
|-----|-------------|----------|
| DB-1 | Self-contained dark-theme SPA on HTTP port 3900 | P0 |
| DB-2 | Real-time SSE with 2s polling fallback | P0 |
| DB-3 | REST API for status, agents, skills, events, automation | P0 |
| DB-4 | Agent registration/removal from dashboard | P1 |
| DB-5 | Workspace monitoring management from dashboard | P1 |
| DB-6 | Git activity panel (full-width), scrollable skills table | P1 |
| DB-7 | Task results & review queue with approve/dismiss/flag actions | P1 |
| DB-8 | Full CRUD for skills (add/edit/delete) from dashboard | P0 |
| DB-9 | Full CRUD for automation rules (add/edit/delete/toggle/trigger) from dashboard | P0 |
| DB-10 | Workspace operations (add/mine/stop/history) from dashboard | P0 |
| DB-11 | Event log search filtering and clear with count badge | P1 |
| DB-12 | Modal-based forms for add/edit operations | P0 |

### 4.8 Persistence

| Req | Description | Priority |
|-----|-------------|----------|
| PE-1 | All stateful data persisted to JSON/JSONL files | P0 |
| PE-2 | Graceful shutdown preserves persisted state (skipPersist) | P0 |
| PE-3 | Automatic restore on startup | P0 |

### 4.9 Workspace History

| Req | Description | Priority |
|-----|-------------|----------|
| WH-1 | Track start/stop timestamps for all monitored workspaces | P0 |
| WH-2 | Record stop reasons (manual, shutdown, error) with detail | P0 |
| WH-3 | Persist history to config/workspace-history.json | P0 |
| WH-4 | Query history with limit and status filters | P1 |
| WH-5 | Expose history via MCP tool (mgr_list_workspace_history) | P0 |
| WH-6 | Expose history via dashboard REST API (GET /api/workspaces/history) | P0 |

### 4.10 Testing

| Req | Description | Priority |
|-----|-------------|----------|
| TE-1 | Unit tests via vitest covering all core services | P0 |
| TE-2 | Dashboard HTML validation tests | P0 |
| TE-3 | Dashboard CRUD API tests (skills, automation, workspaces) | P0 |
| TE-4 | CDP regression tests via puppeteer-core (browser automation) | P1 |
| TE-5 | All tests pass in under 2 seconds | P0 |

## 5. Provider Support

| Provider | Transport | Features |
|----------|-----------|----------|
| GitHub Copilot | CLI (copilot.exe) or ACP | --silent mode, prompt piping |
| Anthropic | HTTPS API | @anthropic-ai/sdk, cost tracking (sonnet/opus/haiku) |
| Extensible | Any | registerProvider() API for custom providers |

## 6. Non-Functional Requirements

| Req | Description |
|-----|-------------|
| NF-1 | Runs on Windows, macOS, Linux via Node.js |
| NF-2 | Zero external database dependencies (file-based persistence) |
| NF-3 | All tests pass in < 2 seconds |
| NF-4 | Supports stdio MCP transport for VS Code integration |
| NF-5 | Constitution-enforced quality gates validated by SpecKit skills |

## 7. Success Metrics

| Metric | Target |
|--------|--------|
| Test coverage | 204+ tests across 19 files, all passing |
| Event types | 13 typed events |
| MCP tools | 34 tools exposed |
| CDP tests | 34 browser regression tests |
| Routing strategies | 6 strategies validated |
| Startup time | < 500ms to ready |
| Persistence recovery | 100% state restoration after restart |
