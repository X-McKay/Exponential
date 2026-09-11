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
cp .env.example .env   # optional: LLM endpoint, sync source, pinned clock
just setup             # bun install --frozen-lockfile, then seed data/valueflow.sqlite
just dev               # dev server with HMR on http://localhost:3000
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
| `just seed` | Wipe the database and re-seed it with the sample portfolio, dated relative to now. |
| `just sync` | Pull development facts for every project from `SYNC_SOURCE`. |
| `just agent <agent> <project>` | Run an agent against a project through the API of the running server. |
| `just reset` | Delete the database; the next start seeds a fresh one. |
| `just clean` | Remove dependencies, build output, database, logs, and Nix result links. |
| `just ci` | Exactly what the GitHub Actions Bun job runs (frozen install, typecheck, lint, tests, build). |
| `just nix-check` | Typecheck, lint, and tests inside the Nix sandbox. |
| `just nix-build` / `just nix-run` | Build the production package to `./result`, or build and run it. |
| `just nix-hash` | After `bun.lock` changes, recompute the dependency hash and write it into `flake.nix`. |

### Configuration

Settings come from the environment. Bun loads `.env` from its working directory; the server also reads the repo-root `.env` explicitly, so one file at the root works for `just dev`, `just sync`, and `just seed`. `.env.example` lists everything.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port for the dev and production servers. |
| `VALUEFLOW_DB` | `data/valueflow.sqlite` (repo root) | SQLite file. The Nix package defaults to `~/.local/share/valueflow/valueflow.sqlite`. |
| `VALUEFLOW_NOW` | unset (real clock) | Pin "today" (`2026-09-10T09:00:00Z`) for demos and screenshots. Every derivation uses this clock. |
| `SYNC_SOURCE` | `sample` | Where development facts come from: `sample` (generated from the fixtures), `github` (REST API), `none`. |
| `GITHUB_TOKEN` | unset | Authenticates the GitHub source (unauthenticated calls are limited to 60 an hour). |
| `SYNC_INTERVAL_MIN` | `0` | Re-sync every project on a timer. `0` means only at boot for never-synced projects and on demand. |
| `LLM_BASE_URL` | unset (agents disabled) | OpenAI-compatible chat endpoint, e.g. `https://llm.almckay.io/v1` (vLLM, OpenAI, LiteLLM, Ollama). |
| `LLM_API_KEY` | unset | Bearer token for the endpoint. |
| `LLM_MODEL` | first model listed by the endpoint | Model name to request. |
| `LLM_THINKING` | off | `on` lets reasoning models think before answering (slower, more tokens). |
| `AGENT_SCHEDULE` | on | `off` disables the nightly scheduled runs. |
| `EVAL_JUDGE` | on | `off` stops the LLM judge scoring every finished run in the background (rules scores are always recorded; *Judge this run* still works). |
| `NODE_ENV` | unset | `production` serves the built bundle instead of bundling on the fly. `bun run start` sets it. |

### Changing dependencies

Add or update packages with `bun add` / `bun update` as usual, commit `bun.lock`, then run `just nix-hash` so the Nix build's fixed-output derivation matches the new lockfile. The hash is platform independent (the install pulls optional binaries for every platform), so one run on any machine is enough.

### Continuous integration

`.github/workflows/ci.yml` runs two jobs on every push and pull request: the Bun job (`just ci`) and the Nix job (`nix flake check`). Both must be green before merging.

### Troubleshooting

- **`bun: command not found`** after installing: open a new shell, or add `~/.bun/bin` to your PATH.
- **`nix: command not found`** in a shell that predates the install: run `. /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh` or open a new terminal.
- **`Port 3000 is in use`**: set `PORT`, or `just stop` a background server you forgot about.
- **Agents say "no model configured"**: set `LLM_BASE_URL` in `.env` and restart; the server logs the model it resolved at boot.
- **Development pages are empty after pulling**: `just sync` (or open the project and press *Sync now*).
- **Stale data after pulling fixture changes**: `just seed`.

## Architecture

```
packages/
  domain/   pure TypeScript: types (Project, Milestone, Metric, Release, Criterion, GovernanceItem,
            RepoStat, PullRequest, Build, CommitDay, Event, CalendarEvent, Agent, AgentRun, …),
            calendar, derived-state functions, Glance composer, sample fixtures
  shared/   API contract: zod request schemas + route helpers, shared by server and web
  server/   Bun.serve + bun:sqlite: migrations, seed, repository, router, repo sources (sample,
            GitHub), sync job, LLM client, agent runner, schedulers
  web/      React 18 app bundled by Bun: pages, charts, editors, ⌘K palette, keyboard chords
```

```
 GitHub / CI ──sync──▶ repo stats · pull requests · builds · commit days ─┐
 eval suites ──PUT readings──▶ metric_readings ───────────────────────────┤
 people ──editors──▶ projects · milestones · governance · releases · calendar   sqlite (facts only)
 LLM ◀──briefing── agent runner ──▶ agent_runs ──────────────────────────┤
 mutations & syncs ──append──▶ events ────────────────────────────────────┘
                                          │
                     domain.* (same pure functions on server and client)
                                          ▼
   realized value · gate tiers · readiness · release states · burn-up · calendar axis
   dev stats · commit chart · contributors · feed · "coming up" · agent status · Glance
```

### The invariant: derived, never stored

**Value is never stored. It is always derived from milestone status plus metric readings against gates. Release readiness is always derived from live criteria references.** The same rule covers everything else the app shows.

The database holds facts: the workspace user, projects with their team and repositories, milestones, metric definitions, `metric_readings` (every eval run or manual reading, append-only), governance items, releases and criteria *references*, calendar events, synced development facts (repo stats, pull requests, builds, daily commit counts, sync runs), an append-only event log, agent definitions, and agent runs. Realized value, gate tiers, governance readiness, release states, the calendar axis, development KPIs and charts, the activity feed, "coming up", agent status and success rates, and the entire Glance composition are computed at read time by `packages/domain` and never written back. A test asserts the schema carries no derived column.

Consequences you can see in the app:

- A metric's `current` is the latest row in `metric_readings`. Dragging a slider or editing "Current" appends a reading; history is never rewritten.
- Deleting a milestone or governance item leaves any release criterion that referenced it in place; it resolves to *not met* / *not tracked* at read time rather than crashing or silently disappearing.
- N/A governance items are excluded from readiness. A measurable milestone with no metrics can never clear a gate.
- "3h ago", "Sep 14", "Jan '27", and every KPI tile are formatted from timestamps and counts at read time, against the server clock.

### Time

Milestones and releases are planned by month (`YYYY-MM`). "Today" is the server clock, reported to the client as `asOf` (pin it with `VALUEFLOW_NOW`). The axis every chart draws is derived: eight months back and six ahead of today, widened to include every planned month, so the app works on any date. Seeding shifts the sample portfolio's planned months and timestamps so the sample stays coherent whenever it is loaded.

### Sources of ground truth

Development facts come from a **repo source** behind one interface (`packages/server/src/connectors`): `fetchRepo(repo) → { stat, prs, builds, commits }`. The **sample** source materialises the fixtures relative to the clock; the **GitHub** source reads pull requests, check runs, reviews, workflow runs, and commits from the REST API. A sync replaces a project's facts wholesale, records a sync run, and appends events for merges, failed builds, deploys, and eval runs; a failed fetch keeps the previous facts. Syncs run at boot for never-synced projects, on a timer (`SYNC_INTERVAL_MIN`), from the Development and Data pages (*Sync now*), through `POST /api/projects/:pid/sync`, and via `just sync`. Coverage and quality grades stay null until a source reports them.

Eval suites report readings with `PUT …/readings { value, source: "eval" }`; each eval reading appends a feed event. Milestone status changes and governance moves append events too, so the feed is a log of what actually happened.

### Agents

An agent is a definition (kind, model, owner, schedule); a run is a fact. A run briefs the agent with the project's live state — targets, milestones and gates, governance, releases, synced development activity, recent events, and the calendar — then asks the configured model for a JSON reply (`summary`, `attention`, `body`, `proposals`) and stores it. Four kinds ship: **Slider** (decks), **Comma** (communications), **Nova** (ideation), and **Audie** (audit), which runs nightly. Runs flagged for attention appear on Glance. The LLM client is a minimal fetch wrapper over the OpenAI chat API with JSON-schema output; nothing else is required of the endpoint.

**Proposals.** Alongside prose, an agent may propose concrete changes: move a governance item or milestone to another status, add a missing governance item, add a dated calendar event, or change the value targets. Proposals are typed (the schema is enforced per type), validated against the project (unknown ids are dropped), and stored pending. A person accepts or dismisses them in the run viewer or the inbox at the top of the Agents page; accepting applies the change through the same repository functions the editors use, so events are appended and every derivation follows. A proposal whose target has since been deleted is refused rather than applied.

**Ask the workspace.** The *Ask* button at the bottom right (or `⌘J`) opens a conversation over every project. The model is briefed with a compact summary of the whole portfolio plus the full briefing of the project you are looking at, must answer from that only, links to the tabs that hold the evidence, and may draft proposals you accept in the panel. Every turn is a run of the built-in *Ask* agent (kind `chat`), so it is audited and scored like any other run; the transcript lives in the browser session.

**Evals: measured, not felt.** Every finished run is scored on three layers, all stored in `run_scores` and never derived on the fly from prose. *Rules* run instantly: `format` (summary, body, and a non-empty reply), `grounding` (the share of ids, percentages, and larger numbers in the output that appear in the briefing), and `proposals_valid` (the share of returned proposals that survived validation). A *judge* (the same model, a separate prompt) grades groundedness, completeness, actionability, and clarity 1–5 with a note; groundedness counts double in the overall. *People* rate a run 👍 / 👎 with a note in the run viewer. The Quality section on Agents turns these into a scorecard per agent: rules, judge, human rating, proposals accepted, latency, and the prompt version (a hash of the system prompt, so a change in wording is visible as a new version). *Run benchmark* replays a fixed set of cases (`EVAL_CASES`) against each agent with expectations checked by the judge, so two prompt versions or two models can be compared on the same questions; benchmark runs are labelled and excluded from the nightly flags. A reply the model cut off at the token budget is retried once with more room and a request to be terse.

**Setting up a project from documents.** *Set up from documents…* on Portfolio hands a setup agent a name, a brief, pasted snippets, and uploaded Word, PowerPoint, or text files (a dependency-free zip reader pulls the text out of `.docx` and `.pptx`; PDFs are reported as unsupported). The agent drafts every field of the project record — stage, risk tier, committee approval, targets, team, repositories, milestones with gate metrics, governance items with evidence-based statuses, releases with criteria — each with a rationale, its source document, and a confidence. The review step lets you untick, edit, or ask the agent to change things (rows you edited survive a refinement), then creates everything in one transaction.

### Glance as a composition contract

`composeGlance(state) → Block[]` in `packages/domain/src/glance.ts` runs three replaceable stages behind one data contract: `detectSignals` (deterministic detectors), `rankBlocks` (priority ranker), and `writeNarrative` (the briefing sentences). Blocks are typed variants (`blocked_release`, `below_gate`, `ci_failing`, `tier1_gaps`, `agent_flag`, `near_stretch`, `value_trajectory`, `ready_release`, `upcoming`, `activity`) carrying data only; the web app renders each kind with an exhaustive switch. An LLM can later replace the ranker or the narrative writer without touching the renderer.

### Stack

- **Bun** — runtime, package manager, bundler, test runner. No Node, npm, or Vite.
- **TypeScript** `strict`, `noUncheckedIndexedAccess`, exhaustive `switch` over every union; no `any` in the domain layer.
- **SQLite** via `bun:sqlite`, WAL mode, foreign keys on, versioned migrations (six so far; existing databases upgrade in place).
- **React 18** with inline styles and one global stylesheet, no component library or CSS framework. Inter Variable is self-hosted from `packages/web/src/fonts` (SIL OFL).
- **zod** for request validation at the API boundary (the only runtime dependency besides React).
- **Nix** flake: dev shell, `packages.default` (production bundle + server), `checks.default` (typecheck + lint + tests). Dependencies are a fixed-output derivation built from the manifests alone, so editing source never triggers a reinstall.

## Editing data

Nothing is hard-coded: every fact the app shows can be changed in the UI, and every change is optimistic with write-through to the API (on failure the client reloads server state and shows a toast).

| What | Where |
| --- | --- |
| Project name, key, stage, description, risk tier, committee approval, team, repositories, targets | Overview → *Edit* on any card; *+ New project* on Portfolio; delete from the editor |
| A whole new project from a charter, deck, or notes | Portfolio → *Set up from documents…*, then review the draft |
| Changes an agent proposed | Agents → the inbox at the top, or a run's viewer → *Accept* / *Dismiss* |
| Milestones, eval gates, current readings | Value → *+ New milestone*, the pencil on a row, or drag a slider |
| Governance items (add, rename, recategorise, status, owner, delete) | Governance → *+ New item*, *+ Add* per category, *Edit item* on an expanded row |
| Releases: target month, milestones shipped, go-live criteria (gate / governance / manual) | Roadmap → *+ New release*, the pencil on a release |
| Development activity | Synced, not edited: *Sync now* on Development or Data, `just sync`, or the timer |
| Activity feed | Derived from the event log, not edited |
| Calendar events | Data → Calendar → *+ Add event* / *Edit* |
| Agent definitions | Agents → *Edit agents* (a validated JSON document) |
| Agent runs | Agents → expand an agent → *Run…*; nightly for scheduled agents; the Ask panel (`⌘J`) for the conversational agent |
| Run ratings and judge scores | A run's viewer → 👍 / 👎 with a note, *Judge this run*; Agents → Quality → *Run benchmark* |
| Signed-in user (sidebar, Glance greeting, default owner) | Click your name at the bottom of the sidebar, or *Data → Workspace* |

Ids are generated for you: milestones `MS-n`, releases `Rn`, project keys `PRJ-n`, runs `run-n`; URL ids, governance ids, and calendar ids are slugs of the name. Deleting a milestone or governance item leaves any release criterion that referenced it in place; it resolves to *not met* / *not tracked* at read time. Deleting a project removes everything under it.

To start from a clean slate rather than the sample portfolio, delete the three seeded projects; the default agents stay.

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
| POST | `/api/projects/:pid/sync` | |
| GET | `/api/sync` | |
| PUT | `/api/agents` | `Agent[]` |
| POST | `/api/agents/:aid/runs` | `{ proj, tab?, instruction? }` |
| POST | `/api/proposals/:id/accept` · `/dismiss` | |
| POST | `/api/chat` | `{ messages: [{ role, content }], proj? }` → `{ answer, links, proposals, runId, model }` |
| POST | `/api/runs/:id/rate` | `{ rating: 1 \| -1 \| null, note? }` |
| POST | `/api/runs/:id/judge` | |
| POST | `/api/benchmark` | `{ agentId? }` → 202; poll `GET /api/benchmark` |
| POST | `/api/setup` | multipart: `name`, `key?`, `brief`, `snippet[]`, `file[]` |
| GET | `/api/setup/:id` | |
| POST | `/api/setup/:id/refine` | `{ feedback }` |
| POST | `/api/setup/:id/create` | `{ project, milestones, governance, releases }` |
| POST | `/api/calendar` | `CalendarEventInput` |
| PUT / DELETE | `/api/calendar/:id` | `CalendarEventInput` |

Schemas live in `packages/shared/src/schemas.ts`; the web client and the server import the same definitions, and the JSON editor validates with them before sending. A sync returns `{ run, facts }` with status 502 when the source failed; an agent run returns the finished run (state `failed` carries the error).

## Keyboard

- `⌘J` / `Ctrl+J` — Ask the workspace (↵ send, ⇧↵ newline, esc close)
- `⌘K` / `Ctrl+K` — command palette (↑↓ navigate, ↵ open, esc close; recent destinations are listed first; includes the Data page)
- `g` then `g` / `p` / `a` — Glance / Portfolio / Agents (the sidebar tooltips show these)
- `g` then `o` / `v` / `r` / `d` / `n` — Overview / Value / Roadmap / Development / Governance of the current (or last visited) project
- `⌘↵` / `Ctrl+↵` — save in any editor dialog; `esc` closes it

## Going live

What is already production-shaped, and what to decide when connecting real systems:

1. **Source control and CI.** Set `SYNC_SOURCE=github` and `GITHUB_TOKEN`, make sure each project's repository URLs point at real GitHub repos, and set `SYNC_INTERVAL_MIN`. Coverage and quality grades need a second source (a coverage service, a static-analysis tool); add it by implementing the `RepoSource` interface and merging its `stat` fields, or by extending the GitHub source to read a badge or artifact. GitLab or Bitbucket are the same interface.
2. **Eval suites.** Have the nightly eval job `PUT` its results to the readings endpoint with `source: "eval"`. That is the whole integration: gates, release criteria, the feed, and Glance follow.
3. **The model.** Any OpenAI-compatible endpoint works. For production, set `LLM_API_KEY`, pin `LLM_MODEL`, and consider `LLM_THINKING=on` for audit runs if latency allows. Runs are synchronous today (the request waits for the model); if runs grow long, queue them and poll `runs` in state.
4. **The database.** SQLite through `bun:sqlite` in WAL mode is fine for a single server. Every read and write goes through `packages/server/src/repo.ts`, so a Postgres move is contained to that file plus `migrations.ts` and `seed.ts`; the schema uses only portable SQL (text ids, ISO timestamps, JSON in text columns).
5. **Identity.** The workspace user is a single stored record. Put an authenticating proxy in front and map its identity onto that record, or add a users table alongside it; nothing else assumes a single user.
6. **Operations.** Back up the SQLite file (or its WAL checkpoint), watch the server log for `sync … failed` and `scheduled agents failed`, and run `just check` in CI on every change.

## Deviations from the mockup

- **Everything is editable and nothing is hard-coded.** The mockup's project details, team, repositories, governance list, releases, calendar, feed, development activity, agents, and signed-in user were constants. They are stored facts with editors, sources, or derivations now.
- **Time is real.** The mockup pinned today as Sep 2026 on a fixed 15-month axis; the app uses the clock and derives the axis.
- **Eval history is real.** The scatter renders `metric_readings` (30 seeded per measurable metric, shaped like the mockup's trajectories, plus any readings you add) instead of a deterministic fake.
- **The commit chart is real.** It draws daily commit counts synced per repository, not a seeded curve.
- **Editors persist.** Milestone, targets, and governance edits are optimistic and write through the API; on failure the client reloads server state and shows a toast.
- **Row carets rotate when a row is expanded.** The mockup sets `transform: rotate(90deg)` on an inline `span`, which browsers ignore; the caret here is an inline SVG that rotates.
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
