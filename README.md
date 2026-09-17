# Exponential

Exponential is a shared workspace for evidence-led AI project delivery. It connects milestones, evaluation gates, governance, release readiness, agent work, and eligible value estimates without treating projections as observed savings or release readiness as proof of deployment.

The current release supports **one trusted workspace on one application server**. People choose an acting user and role in the sidebar. Authentication is intentionally deferred, so anyone who can reach the app can select any user or role. Deploy it only on a trusted access path.

## Quick start

Install [Git](https://git-scm.com/downloads) and [Bun](https://bun.sh/docs/installation) 1.3.11 or newer, then run:

```sh
git clone https://github.com/X-McKay/Exponential.git
cd Exponential
bun run setup
bun run dev
```

Open [http://localhost:3000](http://localhost:3000). The setup helper checks required tools, preserves an existing `.env`, creates one from `.env.example` when needed, and installs the locked dependencies.

Fresh startup creates a neutral workspace owner and built-in agent definitions. It does **not** create projects, measurements, runs, calendar entries, or sample facts.

Run `bun run doctor` to diagnose a local environment. See [development setup](docs/development.md) for manual installation, optional `just` and Nix workflows, data paths, and troubleshooting.

## First workspace

1. Open **Workspace settings** and rename the owner or add colleagues.
2. Choose the acting user and role in the bottom-left sidebar.
3. Create a project from **Portfolio → New project**, starting from a **project template** (the governance documents, dependencies, and first plan a project of that kind needs), or configure a model and choose **Set up from documents**, which drafts the record from a charter or deck and folds in the template's base set.
4. Add milestones, evaluation gates, governance controls, releases, and measurements as work progresses.
5. When documents change, open the project and choose **Update from documents**: every difference is staged as a proposal in the **Inbox**, where you apply or dismiss each one (or all at once). Each proposal shows the current record and the proposed values field by field, and quotes the passage it came from, marked as quoted verbatim or paraphrased. Nothing is applied until you decide.

Templates are configurable under **Data → Project templates**. The built-in ones are a human-in-the-loop assistant, straight-through automation, an analysis and drafting copilot, and a minimal set. Template dependencies (data access, model quota, a golden set, staffing, a fallback) are tracked as governance items under a **Dependencies** category so release criteria can reference them.

Every template save is versioned, and a project remembers the template and version it was created from (or the one linked later in its editor). **Governance → Required by template** compares the project's documents and dependencies with the template, shows what is missing or still open, and can stage the missing items for approval in the inbox; saving a template with a new required item stages it for every project that follows the template.

**Agents → Economics** sets what the agents cost against the changes people accepted, by agent, project, and template, so the cost of each accepted change is visible. **Data → Transfer** exports the whole workspace as one JSON file and imports one back into an empty workspace (or replaces the current one after confirmation). Press `?` anywhere for the list of keyboard shortcuts.

The fictional [sample charters](docs/samples/) exercise document-based setup without adding seed data automatically:

- [Support Triage Assistant](docs/samples/support-triage-charter.md)
- [Invoice Review Assistant](docs/samples/invoice-review-charter.md)
- [Internal Knowledge Search](docs/samples/knowledge-search-charter.md)

`bun run demo:reset` is a **destructive** demo command that replaces the configured database with fictional fixtures: five projects across every stage and risk tier, with invented people and numbers. `bun run demo:reset -- --synthetic` generates a workspace instead (`SEED_SYNTHETIC=<seed> SEED_PROJECTS=<n>` shape it) and stages example proposals in the inbox. Use either only with disposable local data.

## Model connection

As Administrator, open **Workspace settings → LLM connection** and enter an OpenAI-compatible API base URL, model ID, and optional token. **Save and test connection** validates model listing without generating text. Project setup and agent runs call the configured model and can incur provider usage.

Tokens remain server-side and are never returned by the settings or state APIs. Runtime settings are stored beside the database by default, in a mode-`0600` file. Protect and back up both files. Advanced endpoint, pricing, model-candidate, and judge settings remain available through environment variables.

See [configuration](docs/configuration.md) for every environment variable and the endpoint/token rules.

## Common commands

| Command | Purpose |
| --- | --- |
| `bun run setup` | Check prerequisites, create `.env` when absent, and install dependencies |
| `bun run doctor` | Report required and optional local tools |
| `bun run dev` | Start the development server with browser bundling and HMR |
| `bun run build` | Build production browser assets |
| `bun run start` | Serve the production build |
| `bun run check` | Typecheck, lint, test, verify documentation links, and compare Claude/Codex skills |
| `bun run test:e2e` | Run the production HTTP acceptance suite with an isolated local provider |
| `bun run test:ui` | Run the Playwright browser suite against the production build on a synthetic workspace |
| `bun run container:ui` | Run the browser suite against the built container image |
| `bun run release:check` | Run all non-container release checks |
| `bun run container:build` | Build the image with Podman or Docker |
| `bun run container:test` | Run the acceptance suite against the built image |
| `bun run demo:reset` | Destructively replace the configured database with demo fixtures (`-- --synthetic` generates a workspace instead) |
| `bun run workspace:export > workspace.json` | Write the whole workspace (facts, templates, agents, rules, recent runs, the inbox; no credentials) as one JSON file |
| `bun run workspace:import -- workspace.json` | Load an exported workspace into an empty database (`--replace` clears the current one first) |

`just` mirrors the main workflows for developers who prefer a task runner. Run `just` to list recipes.

## Shared-workspace behavior

- **Administrator:** manage users, model settings, and project workflows.
- **Editor:** edit project data and run workflows.
- **Viewer:** browse shared data; project mutations are rejected.

These roles are workflow modes and attribution, not verified authorization. The selected user and role are local to each browser tab. Successful mutations record the selected actor, role, path, timestamp, and status. Browser mutations include a workspace revision; stale edits receive `409 Conflict` and retain their draft instead of overwriting newer work.

Provider budgets are soft operational limits. Calls reserve estimated capacity and record known usage. Use provider-side controls when a hard billing ceiling is required.

## Containers and deployment

For a local Docker deployment:

```sh
docker compose up --build -d
```

The supplied Compose file binds to `127.0.0.1:3000` and persists the database and runtime model settings in a named volume. Podman is supported through the helper commands and the manual instructions in the [deployment guide](docs/deployment.md).

Do not expose the authentication-deferred release directly to the public internet. Production requires one application process, persistent storage, an exact allowed browser origin, backups of the complete data directory, and a trusted internal access layer.

## Repository layout

- `packages/domain` — facts, types, deterministic derivations, prompts, and explicit demo/evaluation fixtures.
- `packages/shared` — validated API schemas and feature contracts shared by browser and server.
- `packages/server` — Bun HTTP server, SQLite migrations, repositories, integrations, model execution, and usage accounting.
- `packages/web` — React UI, state, editors, charts, and production bundling.
- `scripts` — setup, diagnostics, documentation, agent-skill, and container helpers.
- `.agents/skills` and `.claude/skills` — synchronized repository workflows for Codex and Claude.

See [architecture](docs/architecture.md) for the main data flows and design boundaries.

## Maintained documentation

- [Development setup](docs/development.md)
- [Configuration](docs/configuration.md)
- [Architecture](docs/architecture.md)
- [Deployment and operations](docs/deployment.md)
- [Release validation record](docs/release-validation.md)
- [Proposed AI delivery blueprint](docs/ai-delivery-blueprint.md)

The UI self-hosts a Latin subset of [Google Sans Flex](https://github.com/googlefonts/googlesans-flex). Its SIL Open Font License notice is included in source and production builds.
