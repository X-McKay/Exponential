# Architecture

Exponential is a Bun and React monorepo with one HTTP process and one SQLite database. The current design favors explicit facts, deterministic derivations, shared validation, and auditable model work.

## Packages

| Package | Responsibility |
| --- | --- |
| `@valueflow/domain` | Stored fact types, pure derivations, labels, prompts, Glance composition, and explicit demo/evaluation fixtures |
| `@valueflow/shared` | Zod request schemas and feature contracts shared by the browser and server |
| `@valueflow/server` | HTTP routing, SQLite schema and repositories, integrations, model execution, scheduling, and usage accounting |
| `@valueflow/web` | React pages, editors, browser state, live events, charts, and production assets |

The `@valueflow` package namespace is retained as an internal compatibility name. The product and repository are Exponential.

## Data flow

```text
Browser editor
  → shared request schema
  → Bun route and request-local actor
  → repository transaction / feature service
  → SQLite facts and audit history
  → derived application state
  → response revision and live change event
  → browser reconciliation
```

The database stores facts rather than computed readiness, tiers, release state, or eligible value. Domain functions derive those views from current facts and timestamped milestone snapshots. Missing historical evidence stays unknown.

SQLite runs with foreign keys and WAL mode. Migrations are additive and idempotent. Retired metrics and milestones retain history; explicit project deletion removes the project and its child records.

The roadmap draws milestones and releases as spans, but only target and ship months are stored. A milestone's start is derived from its oldest snapshot or its creation instant when either precedes the target month, otherwise from a fixed lead; a release spans from its earliest milestone start to its ship month, and the axis covers only the months with planned work.

## Shared editing and identity

The user and role selectors provide request attribution and workflow modes while authentication is deferred. Selection is tab-local. The server resolves an actor for each request and stores successful mutation history; it does not establish verified identity.

Browser writes carry the workspace revision from their latest response. The server claims revisions with an atomic compare-and-swap, rejects stale writers, and returns a rejected claim when the mutation fails before committing work. Editors keep unsaved drafts on conflicts.

Trusted integrations may omit the revision header for backward compatibility and must coordinate their own writes.

## Project templates and updates from documents

A project template is a stored JSON document (documents, dependencies, a first plan) that a person edits on the Data page. Creating a project from one instantiates it in the domain package and writes the result through the same repository functions the editors use; nothing about the template is stored on the project afterwards, so editing a template never rewrites history. Dependencies become governance items under the `Dependencies` category so release criteria can reference them. Document-based setup folds a template's required items into the draft as Missing, low-confidence rows the reviewer keeps or drops.

"Update project from documents" never writes to the project. The setup agent compares new documents with the current record and stages each difference as a proposal (details, people, repositories, governance, milestones, releases, calendar), attributed to a run and guarded by a snapshot of the fields it would overwrite. Accepting a proposal applies it through the repository; a proposal whose target moved since it was staged is refused rather than overwriting the newer fact.

Every proposal carries evidence: the document it cites and the passage quoted from it. The server checks the quote against the uploaded text when the proposal is staged (case, spacing, and curly quotes folded) and records whether it was found verbatim, so the inbox can distinguish a citation from a paraphrase. The inbox renders each proposal as a field-by-field diff derived in the domain package (`proposalDiff`): what the record says now beside what accepting would write, with unchanged fields shown as no-ops.

Templates are versioned: each save that changes a template's document records the next version number and keeps the document, and a project stores the template id and version it was created from (a person can also link or change the template in the project editor). Drift is a derivation (`templateDrift`): the template's items matched to the project's governance items by name, with the required ones missing, the ones still open, and the extras. Staging the backfill creates governance-item proposals attributed to the setup agent, with the template as their evidence; saving a template re-checks every project that follows it. Nothing is written to a project until a person accepts.

Agent economics is a derivation too (`economics`): spend from every run's token counts and prices over the trailing window, beside the proposals those runs staged and what people decided, grouped by agent, by project, and by the template a project follows.

## Workspace transfer

`GET /api/workspace/export` serialises the whole workspace as one JSON document validated by a shared schema: the owner, members, projects with milestones, governance, releases, and metric readings, calendar events, agents, templates, rules, budgets, recent runs, proposals with their evidence, and the event log. Provider credentials, access tokens, and derived values are never included. `POST /api/workspace/import` (administrators only) writes such a document through the same repository functions the editors use, in one transaction, into an empty workspace or, when asked to replace, after clearing projects, runs, proposals, rules, budgets, and calendar events. Proposal guards are registered against the imported facts, so a pending proposal stays acceptable exactly when its target still reads as exported. The same paths are available from the command line as `bun run workspace:export` and `bun run workspace:import`.

## Model execution

Every model call resolves through a configured provider whose credentials are bound to its API base. Provider redirects are refused. Runtime settings can replace the default provider while retaining advanced environment configuration.

Calls reserve estimated budget capacity and write a durable usage-ledger attempt. Known provider usage is reconciled into tokens and cost; unknown or interrupted usage remains held for review. Budgets are soft controls because providers and token estimates cannot guarantee billing limits.

Agent runs record model, prompt context, steps, logs, output, errors, usage, scores, and proposals. Proposals carry input snapshots, expire, and are rechecked in the same transaction as an accepted mutation. Automatic rules are limited to eligible calendar reminders.

## Project Manager and Communications Director

Project Manager assignments hold an objective, accountable owner, commitments, cadence, and input fingerprint. Manual, changed-fact, and weekly runs share the same execution and audit path. Concurrent runs are rejected, failures cool down before retry, and interrupted work becomes visibly failed after restart.

Communications assignments add audience and output format. Conversation messages refine context without creating artifacts. Explicit or scheduled drafting creates immutable artifact versions. Approval applies to one version and never sends or publishes it automatically; downloads serve the stored bytes through the access guard.

## Browser architecture

The browser uses one API transport for actor headers, workspace revisions, errors, and token redaction. Successful writes reconcile server state; failed writes preserve the editor draft. Server-sent events announce shared changes and stream run output.

The UI supports dark, light, and system themes. Google Sans Flex and the Exponential SVG mark are bundled locally, so the application makes no runtime font request.

Pages are built for assistive technology and the keyboard: landmarks (navigation, main content, complementary sidebar), a skip link as the first Tab stop, real headings on every section card, dialogs labelled by their titles with focus trapped and restored, the palette as a combobox over a listbox, tab bars that move with the arrow keys, and inbox triage whose focus follows the selection. Every form control has a label, theme tokens meet WCAG AA contrast on the surfaces they sit on, and smooth scrolling and decorative animation follow the system's reduced-motion setting. `?` lists every shortcut. The browser suite audits each page with axe-core.

## Deliberate limits

- One application process and one SQLite writer.
- One shared workspace.
- Self-declared roles until authentication is integrated.
- No proof-of-deployment fact; passing release criteria means **Ready**.
- No observed-benefit fact; shipped, gate-clearing impact is an **eligible estimate**.
- No durable external job queue or high-availability scheduler.

The [AI delivery blueprint](ai-delivery-blueprint.md) describes proposed future roles and objects and is not an implementation specification.
