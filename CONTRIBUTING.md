# Contributing to MCP Agent Manager

## Development Setup

1. Clone the repository
2. Run `npm install`
3. Run `npm run build`
4. Run `npx vitest run` to verify all tests pass

## Development Rules

1. **Tests first**: Write failing tests before implementation (TDD red-green-refactor)
2. **All tests must pass**: Run `npx vitest run` before committing - 400+ tests, <2s target
3. **File size limits**: Source files target ≤400 lines, must not exceed 1000 (template literals exempt)
4. **Constitution compliance**: Follow rules in `.specify/memory/constitution.md` and `constitution.json`
5. **Spec-driven workflow**: Use `/speckit.specify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.implement`
6. **No auto-push**: Never push without explicit approval

## Pull Request Process

1. Create a feature branch from `main`
2. Follow spec-driven development: create a spec in `specs/NNN-feature-name/`
3. Ensure all tests pass and no regressions
4. After `npm run build`, kill all stale `node dist/server/index.js` processes before verifying
5. Submit PR with clear description of changes

## Commit Messages

Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`
