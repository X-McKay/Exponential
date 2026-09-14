# Security and data-integrity fixes — 2026-09-12

This implements the security and evidence-integrity priorities from the repository review. The broader visual redesign and product roadmap remain for discussion.

## Request and provider boundaries

- The server defaults to loopback. Shared instances require a long bearer token supplied by a trusted authenticating proxy; request host/origin checks cover API calls, assets and event streams.
- Static files must remain inside the bundle after decoding and resolving symlinks. Traversal is rejected and missing assets return 404.
- URL-bearing model selections require explicit server configuration. Credentials are bound to their API base, and provider redirects are refused.
- Document extraction limits compressed entry counts, individual expanded size and aggregate expanded size. Setup also bounds source count and text size.

## Evidence and history

- Sliders now explore local scenarios. Only the explicit measurement action writes a reading, with manual provenance and an activity event.
- Editing a milestone's metadata cannot overwrite a newer measurement. Removed metrics retain their readings; removed milestones are archived with a separate historical projection.
- Timestamped snapshots preserve the status, impact, metric definitions and readings used by historical charts. Month-end cutoffs and sequence ordering make results deterministic. Past periods without a trustworthy snapshot remain unknown.
- Release dates cannot imply shipment. Passing criteria means Ready; no criteria means Not configured. Value claims are labelled eligible estimates, not measured business benefits.
- Dates, URLs, unique nested identifiers, gate ordering and impact ordering are validated.

## Agent decisions and costs

- A proposal stores its relevant input facts. Application checks the latest persisted proposal, expiration, target existence and unchanged inputs in the same transaction as the mutation and decision record.
- Legacy proposals lacking snapshots fail closed. Dismiss them and generate fresh proposals.
- Automatic actions are limited to calendar reminders, require qualifying human decisions on the same rule content and scope, and cannot earn authority from their own automatic decisions.
- Every provider attempt uses a durable usage ledger, including setup, retries, judges, briefs, tuning and chat. Per-call reservations and scoped checks prevent budget bypass through alternative call paths. Zero ceilings pause work; unknown usage and unreconciled calls hold budgeted work.
- Historical priced ledger entries retain their recorded costs. Old unlinked runs still count. IDs are allocated against persisted history rather than a rolling display window.
- Interrupted runs become visibly failed at startup; background job failures reach the UI.

## Saves and synchronization

- Editors await the server, reconcile successful results, and preserve drafts with an error on rejection. Manual recording guards duplicate submissions. Dialog focus stays stable during edits and supports Escape and focus restoration.
- GitHub permission/resource failures no longer masquerade as empty successful responses. A failed refresh preserves the previous complete snapshot, and concurrent syncs of the same project share one operation.

## Deployment and remaining boundaries

The access boundary is instance-level. Shared deployment still needs an authenticating proxy; this change does not add individual accounts or roles. Ordinary concurrent metadata edits are still last-write-wins, although metadata saves no longer overwrite measurement evidence and proposals reject changed inputs.

Budgets remain soft spending limits because token estimates and provider usage reports cannot guarantee a billing ceiling. Use provider-side limits where a hard ceiling is required. Unknown attempts need reconciliation against provider records; do not erase the ledger to resume spending.

Pre-upgrade historical milestone state cannot be recovered from current facts. This change deliberately leaves unsupported periods unknown. Explicit project deletion remains destructive for the project and its children. It does not introduce measured-benefit or deployment-evidence records.

All verification uses synthetic in-memory databases and an isolated local preview. The existing application database was not migrated or modified during this work.

## Verification

- `bun run check`: typecheck and lint pass; 177 tests pass, zero failures.
- `bun run build`: production bundle builds successfully.
- `git diff --check`: clean.
- Upgrade regression preserves legacy rows and foreign-key integrity, creates no fabricated past snapshots, and is idempotent.
- Browser checks: moving a scenario slider from 87 to 100 returns to the saved 87 after reload; explicit recording updates manual provenance; rejected validation leaves the editor open with its draft and error intact.

Changes are uncommitted for review. No deployment was performed.
