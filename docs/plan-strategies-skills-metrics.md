# Plan: Strategies, Skills & Metrics Overhaul

> **Status:** Active
> **Created:** 2026-02-10
> **Scope:** Fix metrics model, upgrade routing strategies, improve built-in skills, clean up provider framework

## Phase 1: Fix the Metrics Model for Copilot

**Problem:** The metrics pipeline (`tokenCount`, `costUnits`, `totalTokens`, `totalCost`) is modeled around per-token billing. Copilot doesn't charge per token, and estimated `Math.ceil((prompt + content) / 4)` numbers are misleading alongside real Anthropic token counts.

### Changes

1. **Add `premiumRequests` to `AgentResponse`** - Copilot uses premium requests as billing unit. Each CLI invocation = 1 premium request.
2. **Add `tokenCountEstimated` flag to `AgentResponse`** - Boolean so consumers can distinguish real counts from heuristics. Copilot = `true`, Anthropic = `false`.
3. **Refactor `costUnits` semantics** - Keep as provider-specific billing unit. Anthropic = dollars. Copilot = 0. Document in type. Remove misleading cross-provider cost aggregation.
4. **Dashboard: show "~" prefix on estimated tokens** - Display `~1,200` vs `1,200`. Add "Premium Requests" for Copilot agents.
5. **Separate metrics by provider type** - Split token/cost metrics by provider in `ManagerMetrics` and dashboard.

**Files:** `types/task.ts`, `types/metrics.ts`, `providers/copilot.ts`, `providers/anthropic.ts`, `services/taskRouter.ts`, `services/metaCollector.ts`, dashboard files.

---

## Phase 2: Make Routing Strategies Real

**Problem:** `consensus` just concatenates with a header. `cost-optimized` uses `content.length > 50` as quality check.

### Changes

1. **`consensus` → real agreement detection** - Two-pass: (1) fan-out, (2) synthesis agent compares responses, identifies agreement/disagreement, produces final answer. Add `synthesizerTags` to `SkillDefinition`.
2. **`cost-optimized` → quality evaluation** - Replace char-count with: non-empty check → prompt-relevance heuristic → optional LLM quality eval via `qualityThreshold` field.
3. **`fallback` → add `fallbackOnEmpty`** - Also fall back when response is empty/too short, not just on provider errors.
4. **Add `evaluate` strategy** - Send to agent 1, then agent 2 evaluates/critiques. Sequential two-agent workflow.

**Files:** `services/taskRouter.ts`, `types/task.ts`, `types/skill.ts`, tests.

---

## Phase 3: Upgrade Built-in Skills

**Problem:** Most skills are `{question}` pass-throughs - routing demos, not real prompt engineering.

### Changes

1. **`code-review`** - Structured sections (Bugs, Security, Performance, Style, Summary). Add `{language}`, `{focus}` params.
2. **`security-audit`** - OWASP-driven: injection, auth, data exposure, SSRF, path traversal. Table output format.
3. **`explain-code`** - Add `{audience}` param (junior/senior/non-technical).
4. **`consensus-check`** - Structured analysis for better cross-agent comparison.
5. **New: `refactor-suggest`** - Single strategy, before/after code snippets. Params: `{code}`, `{goals}`.
6. **New: `test-generation`** - Fan-out, merged test cases. Params: `{code}`, `{framework}`, `{coverage}`.
7. **New: `commit-review`** - For automation `workspace:git-event`. Params: `{diff}`, `{message}`, `{context}`.
8. **Remove `placeholder`** - No value.

**Files:** `services/skillStore.ts`, `skills/skills.json`, tests.

---

## Phase 4: Provider Framework Cleanup

**Problem:** Want Copilot as primary but framework ready for others. Current state almost there but has some coupling.

### Changes

1. **`ProviderCapabilities` interface** - Each provider declares: `supportsStreaming`, `supportsTokenCounting`, `billingModel`, `supportsConcurrency`, `supportsAcp`.
2. **Provider registry returns capabilities** - `getProviderCapabilities(name)` for router/metrics/dashboard decisions.
3. **Stub `openai-compatible` provider** - Skeleton for OpenAI/Ollama/LM Studio/Azure OpenAI. Wire registration but minimal implementation.
4. **Extract Copilot binary resolution** - Deduplicate `resolveCopilotBinary()` from `providers/copilot.ts` and `services/crossRepoDispatcher.ts`.

**Files:** `providers/index.ts`, `types/agent.ts`, new `providers/types.ts`, `services/taskRouter.ts`.

---

## Execution Order

| # | Phase | Reason |
|---|-------|--------|
| 1 | Metrics | Foundation - everything displays metrics, fix data model first |
| 2 | Provider framework | Strategy improvements need provider capabilities |
| 3 | Strategies | Core differentiator |
| 4 | Skills | Build on improved strategies |

## Out of Scope

- Dashboard HTML refactoring
- Streaming support
- Authentication/rate limiting
- Feedback store persistence
- Cross-platform workspace monitoring
