# ValueFlow

ValueFlow is an AI-project delivery platform built on one idea: **claimed value is worthless until delivery proves it**. Every project states value targets (FTE reduction, time reduction). Every milestone carries an impact it *could* contribute and a set of eval metrics with base and stretch gates. A milestone only counts toward realized value once it has shipped **and** its eval metrics clear a gate; releases only go live when every criterion — performance gates, governance approvals, manual sign-offs — is met against live state. The Glance briefing is generated from the same facts, so what a sponsor reads in the morning is exactly what the eval suite and the governance register say.

## Quickstart

```sh
nix develop      # pinned Bun + sqlite + typescript-language-server; runs bun install on first entry
bun run dev      # http://localhost:3000 — seeds a SQLite db with the fixture portfolio on first start
```

Without Nix: install [Bun](https://bun.sh) 1.3+, then `bun install && bun run dev`.

| Command             | What it does                                                |
| ------------------- | ----------------------------------------------------------- |
| `bun run dev`       | Bun.serve with HMR for the React app, API on `/api/*`       |
| `bun run check`     | `tsc --noEmit` + oxlint + `bun test`                        |
| `bun test`          | domain unit tests, API tests, gate-crossing integration test |
| `bun run build`     | production bundle → `packages/web/dist`                     |
| `bun run start`     | production server serving the built bundle                  |
| `bun run seed`      | wipe and re-seed the database from the mockup fixtures      |
| `nix flake check`   | typecheck + lint + tests in the Nix sandbox (CI gate)       |
| `nix build` / `nix run` | production bundle + server as a Nix package             |

Environment: `PORT` (default 3000), `VALUEFLOW_DB` (default `data/valueflow.sqlite`).

### First `nix build`

Dependencies are a fixed-output derivation. The flake ships with `lib.fakeHash`; the first `nix build .#nodeModules` fails with a hash mismatch that prints the real value — paste it into `flake.nix`. Repeat whenever `bun.lock` changes.

## Architecture

```
packages/
  domain/   pure TypeScript: types (Project, Milestone, Metric, Release, Criterion,
            GovernanceItem, Agent, …), derived-state functions, Glance composer, seed fixtures
  shared/   API contract: zod request schemas + route helpers, shared by server and web
  server/   Bun.serve + bun:sqlite: migrations, seed, repository, framework-free router
  web/      React 18 app bundled by Bun: pages, charts, editors, ⌘K palette, keyboard chords
```

```
 browser ──GET /api/state──▶ server ──▶ sqlite (facts only)
    │                           │
    │   domain.composeGlance    │   domain.composeGlance
    │   domain.releaseState     │   domain.releaseState      ← same pure functions
    │   domain.realized …       │   domain.realized …           on both sides
    ▼                           ▼
  pages                    GET /api/glance
    │
    └──PUT/POST/DELETE (optimistic, then write-through)──▶ server ──▶ sqlite
```

### The invariant: derived, never stored

**Value is never stored. It is always derived from milestone status plus metric readings against gates. Release readiness is always derived from live criteria references.**

The database holds facts: projects, milestones, metric definitions, `metric_readings` (every eval run or manual reading, append-only), governance item statuses, releases, and criteria *references*. Realized value, gate tiers, governance readiness, release states, and the entire Glance composition are computed at read time — by `packages/domain` on the server (`GET /api/glance`) and on the client from fetched facts — and never written back. A test in `packages/server/test/api.test.ts` asserts the schema carries no derived column.

Consequences you can see in the app:

- A metric's `current` is the latest row in `metric_readings`. Dragging a slider or editing "Current" appends a reading; history is never rewritten.
- Deleting a milestone leaves the release criterion that referenced it in place; it resolves to *not met* at read time rather than crashing or silently disappearing.
- N/A governance items are excluded from readiness. A measurable milestone with no metrics can never clear a gate.

### Glance as a composition contract

`composeGlance(state) → Block[]` in `packages/domain/src/glance.ts` runs three replaceable stages behind one data contract: `detectSignals` (deterministic detectors), `rankBlocks` (priority ranker), and `writeNarrative` (the briefing sentences). Blocks are typed variants (`blocked_release`, `below_gate`, `ci_failing`, `tier1_gaps`, `near_stretch`, `value_trajectory`, `ready_release`, `upcoming`, `activity`) carrying data only; the web app renders each kind with an exhaustive switch. An LLM can later replace the ranker or the narrative writer without touching the renderer.

### Stack

- **Bun** — runtime, package manager, bundler, test runner. No Node, npm, or Vite.
- **TypeScript** `strict`, `noUncheckedIndexedAccess`, exhaustive `switch` over every union; no `any` in the domain layer.
- **SQLite** via `bun:sqlite`, WAL mode, foreign keys on, versioned migrations.
- **React 18** with inline styles and one global stylesheet, no component library or CSS framework.
- **zod** for request validation at the API boundary (the only runtime dependency besides React).
- **Nix** flake: dev shell, `packages.default` (production bundle + server), `checks.default` (typecheck + lint + tests).

## API

| Method | Path                                                       | Body                 |
| ------ | ---------------------------------------------------------- | -------------------- |
| GET    | `/api/state`                                               |                      |
| GET    | `/api/glance`                                              |                      |
| GET    | `/api/projects/:pid/milestones/:mid/metrics/:xid/readings` |                      |
| PUT    | `/api/projects/:pid/milestones/:mid/metrics/:xid/readings` | `{ value, source? }` |
| POST   | `/api/projects/:pid/milestones`                            | `MilestoneInput`     |
| PUT    | `/api/projects/:pid/milestones/:mid`                       | `MilestoneInput`     |
| DELETE | `/api/projects/:pid/milestones/:mid`                       |                      |
| PUT    | `/api/projects/:pid/targets`                               | `{ fte, time }`      |
| PUT    | `/api/projects/:pid/governance/:gid`                       | `GovernanceInput`    |

Schemas live in `packages/shared/src/schemas.ts`.

## Keyboard

- `⌘K` / `Ctrl+K` — command palette (↑↓ navigate, ↵ open, esc close)
- `g` then `g` / `p` / `a` — Glance / Portfolio / Agents
- `g` then `o` / `v` / `r` / `d` / `n` — Overview / Value / Roadmap / Development / Governance of the current (or last visited) project

## Deviations from the mockup

- **Eval history is real.** The scatter renders `metric_readings` (30 seeded per measurable metric, shaped like the mockup's trajectories, plus any manual readings you add) instead of a deterministic fake.
- **Editors persist.** Milestone, targets, and governance edits are optimistic and write through the API; on failure the client reloads server state and shows a toast.
- **Row carets rotate when a row is expanded.** The mockup sets `transform: rotate(90deg)` on an inline `span`, which browsers ignore; the intent is clear so the caret here is `inline-block` and rotates.
- **Development, agents, feed and calendar** are read-only mirrors of external systems and are stored as validated JSON documents rather than normalized tables.
- **Deep links.** View state is mirrored to the URL hash (`#/project/ima/value`) so pages survive a reload.
