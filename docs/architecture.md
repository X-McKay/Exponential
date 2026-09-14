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

Milestone schedules are explicit facts: optional planned start/end dates and an ordered list of upstream milestone dependencies. The roadmap draws duration bars only when both dates are present; legacy and intentionally unscheduled milestones remain target markers. Dependency cycles, missing references, self-dependencies, and reversed date ranges are rejected instead of being repaired or inferred.

## Shared editing and identity

The user and role selectors provide request attribution and workflow modes while authentication is deferred. Selection is tab-local. The server resolves an actor for each request and stores successful mutation history; it does not establish verified identity.

Browser writes carry the workspace revision from their latest response. The server claims revisions with an atomic compare-and-swap, rejects stale writers, and returns a rejected claim when the mutation fails before committing work. Editors keep unsaved drafts on conflicts.

Trusted integrations may omit the revision header for backward compatibility and must coordinate their own writes.

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

## Deliberate limits

- One application process and one SQLite writer.
- One shared workspace.
- Self-declared roles until authentication is integrated.
- No proof-of-deployment fact; passing release criteria means **Ready**.
- No observed-benefit fact; shipped, gate-clearing impact is an **eligible estimate**.
- No durable external job queue or high-availability scheduler.

The [AI delivery blueprint](ai-delivery-blueprint.md) describes proposed future roles and objects and is not an implementation specification.
