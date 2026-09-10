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

The database holds facts: the workspace user, projects with their team and repositories, milestones, metric definitions, `metric_readings` (every eval run or manual reading, append-only), governance items, releases, and criteria *references*. Realized value, gate tiers, governance readiness, release states, and the entire Glance composition are computed at read time — by `packages/domain` on the server (`GET /api/glance`) and on the client from fetched facts — and never written back. A test in `packages/server/test/api.test.ts` asserts the schema carries no derived column.

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

## Editing data

Nothing is hard-coded: every fact the app shows can be changed in the UI, and every change is optimistic with write-through to the API (on failure the client reloads server state and shows a toast).

| What | Where |
| --- | --- |
| Project name, key, stage, description, risk tier, committee approval, **team**, **repositories**, targets | Overview → *Edit* on any card; *+ New project* on Portfolio; delete from the editor |
| Milestones, eval gates, current readings | Value → *+ New milestone*, the pencil on a row, or drag a slider |
| Governance items (add, rename, recategorise, status, owner, delete) | Governance → *+ New item*, *+ Add* per category, *Edit item* on an expanded row |
| Releases: target month, milestones shipped, go-live criteria (gate / governance / manual) | Roadmap → *+ New release*, the pencil on a release |
| Development activity, agents, activity feed, calendar | *Data* in the sidebar (or *Edit data* / *Edit agents* on those pages): each is a JSON document validated against the API schema before it can be saved |
| Signed-in user (sidebar, Glance greeting, default owner) | Click your name at the bottom of the sidebar, or *Data → Workspace* |

Ids are generated for you: milestones `MS-n`, releases `Rn`, project keys `PRJ-n`, and URL ids and governance ids are slugs of the name. Deleting a milestone or governance item leaves any release criterion that referenced it in place; it resolves to *not met* / *not tracked* at read time. Deleting a project removes everything under it.

To start from a clean slate rather than the fixtures, delete the three seeded projects and edit the Data documents, or `just reset` and delete after the automatic seed.

## API

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/state` | |
| GET | `/api/glance` | |
| PUT | `/api/workspace` | `WorkspaceInput` |
| POST | `/api/projects` | `ProjectInput` |
| PUT / DELETE | `/api/projects/:pid` | `ProjectInput` |
| PUT | `/api/projects/:pid/targets` | `{ fte, time }` |
| POST | `/api/projects/:pid/milestones` | `MilestoneInput` |
| PUT / DELETE | `/api/projects/:pid/milestones/:mid` | `MilestoneInput` |
| GET / PUT | `/api/projects/:pid/milestones/:mid/metrics/:xid/readings` | `{ value, source? }` |
| POST | `/api/projects/:pid/governance` | `GovernanceItemInput` |
| PUT / DELETE | `/api/projects/:pid/governance/:gid` | `GovernanceInput` |
| POST | `/api/projects/:pid/releases` | `ReleaseInput` |
| PUT / DELETE | `/api/projects/:pid/releases/:rid` | `ReleaseInput` |
| PUT | `/api/projects/:pid/dev` | `DevActivity` document |
| PUT | `/api/agents` | `Agent[]` document |
| PUT | `/api/feed` | `FeedDay[]` document |
| PUT | `/api/upcoming` | `Upcoming[]` document |

Schemas live in `packages/shared/src/schemas.ts`; the web client and the server import the same definitions, and the JSON editors validate with them before sending.

## Keyboard

- `⌘K` / `Ctrl+K` — command palette (↑↓ navigate, ↵ open, esc close; recent destinations are listed first; includes the Data page)
- `g` then `g` / `p` / `a` — Glance / Portfolio / Agents (the sidebar tooltips show these)
- `g` then `o` / `v` / `r` / `d` / `n` — Overview / Value / Roadmap / Development / Governance of the current (or last visited) project
- `⌘↵` / `Ctrl+↵` — save in any editor dialog; `esc` closes it

## Deviations from the mockup

- **Eval history is real.** The scatter renders `metric_readings` (30 seeded per measurable metric, shaped like the mockup's trajectories, plus any manual readings you add) instead of a deterministic fake.
- **Editors persist.** Milestone, targets, and governance edits are optimistic and write through the API; on failure the client reloads server state and shows a toast.
- **Row carets rotate when a row is expanded.** The mockup sets `transform: rotate(90deg)` on an inline `span`, which browsers ignore; the intent is clear so the caret here is an inline SVG that rotates.
- **Development, agents, feed and calendar** mirror external systems and are stored as validated JSON documents rather than normalized tables; they are editable as documents from the Data page.
- **Everything is editable.** The mockup's project details, team, repositories, governance list, releases, and signed-in user were constants; they are all stored facts with editors and API endpoints now.
- **Deep links.** View state is mirrored to the URL hash (`#/project/ima/value`) so pages survive a reload.

### Visual polish pass

After the pixel-faithful port, the app was reviewed against Linear's visual system and deliberately moved off the mockup in these ways:

- **Inter actually loads.** The mockup named Inter but never loaded it, so it rendered in whatever the viewer had installed. Inter Variable is now self-hosted and applied on `body`, with `cv11`/`ss03` features and tabular numerals everywhere.
- **One type scale.** Twelve font sizes collapsed to 11 / 12 / 13 / 14 / 15 / 24; weights 600–700 became 500–550 (variable-font medium reads like Linear's 510); titles carry negative tracking; radii are 4 / 6 / 8 / 12.
- **Tonal hierarchy.** Secondary text is dimmer (`#8A8F98`) and tertiary text brighter (`#767B8A`, 4.7:1 on the background) so titles lead and small labels stay legible.
- **Quieter chips.** Fills at 8 % and borders at 22 %; colour lives in the text and an optional dot. The risk tier is a neutral chip with a coloured dot rather than a filled red pill.
- **Calmer motion.** Cards brighten in place instead of lifting with a shadow; the Glance stagger is 120 ms total; `prefers-reduced-motion` disables animations.
- **Command palette** groups results (Recent, Pages, Projects, Project views), matches subsequences (`imagov`), and remembers the last four destinations in `localStorage`.
- **Tooltips** are custom, with `kbd` hints for the `g` chords on the sidebar; native `title` tooltips are gone.
- **Sidebar** rows are 28 px with monochrome inline-SVG icons; project rows show a tier-coloured dot.
- **Editors** use 32 px inputs, a divider-free header, 20 px padding, and `⌘↵` to save with the hint in the footer.
- **Loading and empty states.** A layout-shaped skeleton replaces the pulsing text, and an empty milestone list offers the "New milestone" action.
