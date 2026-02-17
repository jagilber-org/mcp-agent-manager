<!-- AUTO-GENERATED from constitution.json — do not edit directly -->
<!-- Regenerate: node scripts/sync-constitution.cjs -->
# Mcp Agent Manager - Constitution

## Purpose

Quality gates and structural invariants for MCP Agent Manager. These rules are enforced by the `speckit-constitution-check` automation rule and validated by the functional test suite.

## Article 1 - Governance Process

1. **constitution.json is the single source of truth; derived files (docs/constitution.md, .specify/memory/constitution.md) MUST NOT be edited directly** (GV-1)
2. **After editing constitution.json, `node scripts/sync-constitution.cjs` MUST be run to regenerate derived files** (GV-2)
3. **Amendments MUST update the amendedDate field and bump version for breaking changes** (GV-3)
4. **All rules MUST use RFC 2119 language (MUST, MUST NOT, SHOULD, SHOULD NOT, MAY)** (GV-4)

## Article 2 - Security

1. **No hardcoded secrets or credentials MUST appear in source; secrets MUST be loaded from environment variables** (SE-1)
2. **MCP tool inputs MUST be validated via zod schemas before filesystem or shell operations** (SE-2)
3. **File paths from user input MUST be sanitized against path traversal (../ and absolute paths outside DATA_DIR)** (SE-3)
4. **Shell command construction MUST NOT interpolate unsanitized user input** (SE-4)
5. **HTTP endpoints (dashboard, SSE) SHOULD bind to localhost by default; external exposure MUST be opt-in via configuration** (SE-5)
6. **State-mutating MCP tools MUST log the operation to the audit trail (events JSONL)** (SE-6)
7. **.env and .env.* files MUST be gitignored; secrets MUST NOT be committed to the repository** (SE-7)
8. **.env.example SHOULD document all expected environment variables with placeholder values (no real secrets)** (SE-8)

## Article 3 - PII & Pre-Commit Enforcement

1. **PII pre-commit hooks MUST be installed and active; .pre-commit-config.yaml with detect-secrets and detect-private-key MUST be present** (PH-1)
2. **.secrets.baseline MUST be committed and kept current; new secrets MUST be audited before allowlisting** (PH-2)
3. **Committed source, data files, and test fixtures MUST NOT contain real PII (emails, SSNs, IPs, credentials); use synthetic data for tests** (PH-3)

## Article 4 - Data Integrity & Persistence

1. **All stateful data MUST persist to disk; startup MUST auto-restore persisted state** (DI-1)
2. **Graceful shutdown MUST preserve state (skipPersist flag)** (DI-2)
3. **All persisted stores MUST survive concurrent read/write from separate processes; multi-instance scenarios MUST be tested** (DI-3)
4. **Corrupted or empty config files MUST result in safe empty state, not crashes; recovery MUST be tested for all JSON and JSONL stores** (DI-4)
5. **JSONL files with malformed lines MUST skip bad lines and load valid ones** (DI-5)
6. **ConfigWatcher MUST detect and reload external changes; every consumer MUST have E2E reload tests in cross-instance-sync.test.ts** (DI-6)
7. **SharedState version sentinel and FeedbackStore ensureFresh() cross-instance reload MUST be tested with timing** (DI-7)
8. **Reload tests MUST call the real module reload() method against real data, not re-implement logic inline** (DI-8)
9. **Adding a new watchConfigFile() call MUST include tests in cross-instance-sync.test.ts and update the knownConsumers list** (DI-9)
10. **Schema changes to persisted JSON files (agents.json, skills.json, rules.json) MUST include migration logic or be backwards-compatible** (DI-10)

## Article 5 - Data & Directory Governance

1. **All runtime data paths MUST use dataDir.ts helpers (getLogsDir, getStateDir, etc.); CWD-relative path.resolve() is prohibited** (DG-1)
2. **Checked-in default data MUST live in seed/; runtime data MUST live in DATA_DIR (%APPDATA%/mcp-agent-manager)** (DG-2)
3. **New data subdirectories MUST be added to dataDir.ts with a getter function and env-var override** (DG-3)
4. **Seed files are copied to DATA_DIR on first run via ensureDataDirs(); they MUST NOT be modified at runtime** (DG-4)

## Article 6 - API & Tool Contracts

1. **MCP tool schemas MUST use zod validation for all inputs** (AC-1)
2. **Removing or renaming an existing MCP tool MUST be treated as a breaking change requiring version bump** (AC-2)
3. **New MCP tools MUST be documented in copilot-instructions.md or the relevant architecture doc** (AC-3)
4. **MCP tool errors MUST return structured error objects with isError: true; stack traces MUST NOT be exposed to clients** (AC-4)

## Article 7 - Event Integrity

1. **All typed event types in ManagerEventMap MUST be registered** (EV-1)
2. **All events MUST be logged to JSONL with structured fields (timestamp, type, data)** (EV-2)
3. **Cascade guard MUST prevent infinite event loops** (EV-3)
4. **All event types MUST have test coverage** (EV-4)
5. **Event payloads MUST NOT contain secrets, credentials, or PII** (EV-5)

## Article 8 - Agent Generalization

1. **Provider and model MUST be free-form strings** (AG-1)
2. **AgentConfig MUST accept any valid configuration** (AG-2)
3. **Provider registration MUST be extensible via ProviderFn** (AG-3)

## Article 9 - Routing Correctness

1. **All routing strategies MUST be tested** (RT-1)
2. **Agent resolution MUST follow: targetAgents → targetTags → all** (RT-2)
3. **Concurrency limits MUST be enforced via busy state** (RT-3)

## Article 10 - Automation Safety

1. **Throttle/conditions MUST be evaluated before execution** (AU-1)
2. **Disabled rules MUST NOT execute** (AU-2)
3. **Disabled engine MUST NOT process events** (AU-3)
4. **Execution history MUST record all attempts** (AU-4)
5. **Dry-run MUST resolve params without side effects** (AU-5)

## Article 11 - Test Requirements

1. **All tests MUST pass before commit** (TS-1)
2. **Test count MUST NOT decrease below minTestCount threshold (see thresholds.minTestCount)** (TS-2)
3. **Functional tests MUST validate full pipeline** (TS-3)
4. **New features MUST include test coverage** (TS-4)
5. **Test coverage MUST be tracked and maintained above project threshold** (TS-5)
6. **Tests MUST be implemented, verified passing, and results stored before commit** (TS-6)
7. **Individual test files SHOULD complete within maxTestFileDurationMs (see thresholds); slow tests MUST be investigated** (TS-7)
8. **For new features and changes, tests MUST be written and verified FAILING before implementation code; implementation MUST NOT be committed without a corresponding passing test** (TS-8)
9. **Reported bugs and issues MUST have a red-green regression test: write a test that reproduces the failure (red), then fix and verify pass (green)** (TS-9)

## Article 12 - Resource Management

1. **File watchers, intervals, and SSE connections MUST be cleaned up on shutdown; leaks MUST be tested** (RM-1)
2. **Child processes (cross-repo dispatch, provider calls) MUST have timeouts and MUST be killed on parent shutdown** (RM-2)
3. **JSONL log files SHOULD be bounded; unbounded growth MUST be documented as a known limitation if not addressed** (RM-3)

## Article 13 - Dependency Management

1. **Production dependencies MUST be pinned to exact versions in package.json** (DP-1)
2. **Lock files (package-lock.json, poetry.lock, go.sum, etc.) MUST be committed and MUST NOT be manually edited** (DP-2)
3. **New dependencies MUST be justified; prefer stdlib or existing deps over adding new packages** (DP-3)

## Article 14 - Dashboard Integrity

1. **HTML MUST contain no JS syntax errors** (DB-1)
2. **All required sections MUST be present** (DB-2)
3. **SSE MUST be primary with polling fallback** (DB-3)

## Article 15 - Workspace Monitoring

1. **Git intervals MUST be clearable** (WM-1)
2. **Session mining MUST tolerate malformed JSONL** (WM-2)
3. **Monitor paths MUST persist independently of shutdown** (WM-3)

## Article 16 - Build & Deploy Discipline

1. **After every `npm run build`, ALL node processes running dist/server/index.js MUST be killed before verifying behavior** (BD-1)
2. **Process checks MUST filter on `dist[\\|/]server[\\|/]index\.js` — NEVER on repo name or assumed absolute paths. Use `npm run kill` or `node scripts/kill-stale-servers.cjs`.** (BD-2)
3. **MUST NOT confirm 'no instances running' from empty output without verifying the check command itself was correct** (BD-3)
4. **End-to-end verification MUST use live MCP tool calls against the rebuilt server, not just unit tests in isolated sandboxes** (BD-4)
5. **When verifying data visibility, MUST compare tool output count against raw file count — mismatches indicate stale processes** (BD-5)

## Article 17 - Code Quality

1. **Source files SHOULD target ≤600 lines (guideline); MUST NOT exceed 1000 lines (template literals exempt)** (CQ-1)
2. **Each module MUST have a single primary responsibility; god-modules that mix unrelated concerns are prohibited** (CQ-2)
3. **No inline HTML/CSS/JS SHOULD be mixed with business logic** (CQ-3)
4. **Error handling MUST use structured error types; raw string throws are prohibited in library code** (CQ-4)
5. **Source files exceeding sourceFileLinesGuideline (600) MUST be evaluated for decomposition during the next edit; files exceeding maxSourceFileLines (1000) MUST be split before any new feature work in that file** (CQ-5)
6. **Source code MUST follow layered architecture: types/ (pure types, no imports from other src/ layers) → services/ (business logic, state) → server/ (MCP protocol, HTTP, tool wiring) → providers/ (external integrations). Cross-layer imports MUST flow downward only** (CQ-6)
7. **When splitting a file, MUST extract by cohesive domain concept (not arbitrary line count); each extracted module MUST have a name reflecting its single responsibility** (CQ-7)
8. **Service subdirectories (e.g. automation/, dashboard/) SHOULD contain an index.ts barrel export; new service groupings with ≥3 related files SHOULD be extracted into a subdirectory** (CQ-8)

## Article 18 - Repository Structure & Documentation

1. **New files and directories MUST conform to the established project structure documented in copilot-instructions.md; agents MUST NOT create ad-hoc files outside recognized directory patterns without a specification** (RS-1)
2. **Required repo root documents (README.md, LICENSE, constitution.json) MUST be present; CHANGELOG.md, CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md SHOULD be present** (RS-2)
3. **Architecture diagrams MUST be maintained as Mermaid-in-markdown in docs/; diagrams MUST be updated when the component they describe changes** (RS-3)
4. **.specify/ folder MUST follow SpecKit layout (memory/, config/, templates/, commands/); ad-hoc top-level config directories are prohibited** (RS-4)
5. **Feature specs MUST live in specs/{NNN-feature-name}/ with sequential numbering; standalone design docs MUST NOT be created at repo root** (RS-5)

## Article 19 - Dual-Repo Publishing

1. **All active repos MUST follow the dual-repo pattern: private dev repo for all development, public pub repo as read-only mirror** (PB-1)
2. **Public publication repos MUST NOT receive direct pushes; all updates MUST flow through the publish script (scripts/publish.cjs) from the dev repo** (PB-2)
3. **Internal artifacts (.specify/, specs/, issue templates, state/, logs/) MUST be excluded from publication via .publish-exclude** (PB-3)
4. **Publishes MUST be release-aligned; the publish script MUST be used (no ad-hoc file copies or direct pushes)** (PB-4)
5. **Public repos MUST have issues, wiki, and projects disabled; CONTRIBUTING.md MUST explain the contribution policy** (PB-5)

---

## Enforcement

These rules are enforced at three levels:

1. **Compile-time:** TypeScript strict mode, typed events, typed configurations
2. **Test-time:** 600+ tests including functional pipeline validation
3. **Runtime:** `speckit-constitution-check` automation rule triggers on session updates

## Thresholds (from constitution.json)

| Threshold | Value |
|-----------|-------|
| minTestCount | 600 |
| maxSuiteDurationMs | 30000 |
| maxTestFileDurationMs | 5000 |
| sourceFileLinesGuideline | 600 |
| maxSourceFileLines | 1000 |

## Governance

- Constitution changes require explicit rationale and versioning
- All features MUST begin as specifications
- Constitution supersedes all other practices
- Amendments require documentation, approval, and migration plan
- Machine-checkable gates are maintained in `constitution.json`

**Version**: 1.6.0 | **Ratified**: 2025-08-30 | **Last Amended**: 2026-02-17
