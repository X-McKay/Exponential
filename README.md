# ValueFlow

ValueFlow is an AI-project delivery platform built on one idea: **claimed value is worthless until delivery proves it**. Every project states value targets (FTE reduction, time reduction). Every milestone carries an impact it *could* contribute and a set of eval metrics with base and stretch gates. A milestone only counts toward realized value once it has shipped **and** its eval metrics clear a gate; releases only go live when every criterion — performance gates, governance approvals, manual sign-offs — is met against live state. The Glance briefing is generated from the same facts, so what a sponsor reads in the morning is exactly what the eval suite and the governance register say.

## Setup

### Prerequisites

| Tool | Required | Install |
| --- | --- | --- |
| [Bun](https://bun.sh) 1.3 or newer | yes | `brew install oven-sh/bun/bun` or `curl -fsSL https://bun.sh/install \| bash` |
| [just](https://just.systems) | recommended | `brew install just` (or `cargo install just`, or any package manager) |
| [Nix](https://nixos.org) with flakes | optional | `curl -fsSL https://install.determinate.systems/nix \| sh -s -- install` |

Bun is the runtime, package manager, bundler, and test runner: there is no Node, npm, or Vite. `just` is a thin task runner over the `bun run` scripts so the commands below are memorable; every recipe prints the underlying command. Nix gives you a pinned toolchain (Bun, just, sqlite, TypeScript language server) and a sandboxed build, and is what CI uses for the `nix flake check` job.

### First run

```sh
git clone https://github.com/X-McKay/Exponential.git
cd Exponential
just setup      # bun install --frozen-lockfile, then seed data/valueflow.sqlite
just dev        # dev server with HMR on http://localhost:3000
```

With Nix, enter the dev shell first; it installs dependencies on first entry and puts `bun` and `just` on your PATH:

```sh
nix develop
just dev
```

Without `just`, the equivalent commands are `bun install`, `bun run seed`, and `bun run dev`.

If port 3000 is taken, every recipe honours `PORT`:

```sh
PORT=3001 just dev
```

### Everyday commands

Run `just` with no arguments to list every recipe.

| Command | What it does |
| --- | --- |
| `just dev` | Dev server in the foreground with HMR. `Ctrl+C` stops it. |
| `just start` / `just stop` | Run the dev server in the background (pid in `.valueflow.pid`, log in `data/valueflow.log`). `just status`, `just restart`, and `just logs` go with them. |
| `just check` | Typecheck, lint, and tests: the gate every change must pass. |
| `just test [filter]` | Run the test suite, optionally narrowed (`just test glance`). `just watch` re-runs on change. |
| `just typecheck` / `just lint` | The two halves of `check` on their own. |
| `just build` | Production bundle to `packages/web/dist`. |
| `just serve` | Build, then run the production server (no HMR). |
| `just seed` | Wipe the database and re-seed it from the mockup fixtures. |
| `just reset` | Delete the database; the next start seeds a fresh one. |
| `just clean` | Remove dependencies, build output, database, logs, and Nix result links. |
| `just ci` | Exactly what the GitHub Actions Bun job runs (frozen install, typecheck, lint, tests, build). |
| `just nix-check` | Typecheck, lint, and tests inside the Nix sandbox. |
| `just nix-build` / `just nix-run` | Build the production package to `./result`, or build and run it. |
| `just nix-hash` | After `bun.lock` changes, recompute the dependency hash and write it into `flake.nix`. |

### Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port for the dev and production servers. |
| `VALUEFLOW_DB` | `data/valueflow.sqlite` (repo root) | SQLite file. The Nix package defaults to `~/.local/share/valueflow/valueflow.sqlite`. |
| `NODE_ENV` | unset | `production` serves the built bundle instead of bundling on the fly. `bun run start` sets it. |

### Changing dependencies

Add or update packages with `bun add` / `bun update` as usual, commit `bun.lock`, then run `just nix-hash` so the Nix build's fixed-output derivation matches the new lockfile. The hash is platform independent (the install pulls optional binaries for every platform), so one run on any machine is enough.

### Continuous integration

`.github/workflows/ci.yml` runs two jobs on every push and pull request: the Bun job (`just ci`) and the Nix job (`nix flake check`). Both must be green before merging.

### Troubleshooting

- **`bun: command not found`** after installing: open a new shell, or add `~/.bun/bin` to your PATH.
- **`nix: command not found`** in a shell that predates the install: run `. /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh` or open a new terminal.
- **`Port 3000 is in use`**: set `PORT`, or `just stop` a background server you forgot about.
- **Stale data after pulling fixture changes**: `just seed`.

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
- **React 18** with inline styles and one global stylesheet, no component library or CSS framework. Inter Variable is self-hosted from `packages/web/src/fonts` (SIL OFL).
- **zod** for request validation at the API boundary (the only runtime dependency besides React).
- **Nix** flake: dev shell, `packages.default` (production bundle + server), `checks.default` (typecheck + lint + tests). Dependencies are a fixed-output derivation built from the manifests alone, so editing source never triggers a reinstall.

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

- `⌘K` / `Ctrl+K` — command palette (↑↓ navigate, ↵ open, esc close; recent destinations are listed first)
- `g` then `g` / `p` / `a` — Glance / Portfolio / Agents (the sidebar tooltips show these)
- `g` then `o` / `v` / `r` / `d` / `n` — Overview / Value / Roadmap / Development / Governance of the current (or last visited) project
- `⌘↵` / `Ctrl+↵` — save in any editor dialog; `esc` closes it

## Deviations from the mockup

- **Eval history is real.** The scatter renders `metric_readings` (30 seeded per measurable metric, shaped like the mockup's trajectories, plus any manual readings you add) instead of a deterministic fake.
- **Editors persist.** Milestone, targets, and governance edits are optimistic and write through the API; on failure the client reloads server state and shows a toast.
- **Row carets rotate when a row is expanded.** The mockup sets `transform: rotate(90deg)` on an inline `span`, which browsers ignore; the intent is clear so the caret here is an inline SVG that rotates.
- **Development, agents, feed and calendar** are read-only mirrors of external systems and are stored as validated JSON documents rather than normalized tables.
- **Deep links.** View state is mirrored to the URL hash (`#/project/ima/value`) so pages survive a reload.
