---
name: exponential-development
description: Set up, run, modify, or validate the Exponential Bun monorepo. Use for local development, tests, database changes, API changes, and UI work in this repository.
---

# Exponential development

Follow the user's request when it conflicts with this workflow.

1. Read `README.md` and `docs/development.md` before changing setup or developer commands.
2. Run `bun run doctor` when diagnosing a new environment. Use Bun 1.3.11 or newer and install dependencies with `bun install --frozen-lockfile`.
3. Preserve existing `.env`, SQLite databases, settings files, and uncommitted work. Normal startup creates a neutral workspace. Run `bun run demo:reset` only when the user explicitly requests disposable sample data, and offer `bun run workspace:export` first so a workspace can be restored with `bun run workspace:import`.
4. Keep pure facts and derivations in `packages/domain`, shared validation/contracts in `packages/shared`, persistence and integrations in `packages/server`, and browser behavior in `packages/web`.
5. Reuse shared schemas and the central API client. Do not bypass request-local actor attribution, provider endpoint credential binding, usage accounting, or workspace revision checks.
6. Add focused regression coverage for material behavior changes. Do not add tests that merely repeat implementation details.
7. Before handing work back, run `bun run check`, `bun run docs:check`, `bun run skills:check`, and `git diff --check`. Run `bun run test:e2e` for cross-layer or release-facing changes and `bun run test:ui` (Playwright, synthetic workspace) for browser-facing changes.

See `docs/architecture.md` for system boundaries and `docs/configuration.md` for runtime settings.
