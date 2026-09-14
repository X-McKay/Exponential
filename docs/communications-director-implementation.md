# Communications Director

The Communications Director works through project-scoped assignments. Each records an objective, audience, output format, and accountable owner. Formats include executive updates, release notes, decision memos, and project briefs.

## Working with the agent

Use Conversation to ask questions and refine instructions. Create draft explicitly generates a new artifact version using the assignment, current project facts, the latest successful Project Manager assessment, and recent conversation context. The conversation retains its full history; the model receives bounded context.

Activity exposes current and previous runs through the existing inspector: steps, logs, output, proposals, model, usage, and errors. Quantum and preparing placeholders follow actual execution. Failed runs keep the user's message and error; they do not create artifacts.

Assets lists communications artifacts across assignments for the selected project. Each draft has an immutable version, its originating run, and an explicit draft/approved status. Preview and download Markdown or text. Approving one version does not approve future versions, send a message, or publish anything externally.

## Background execution

Assignments default to on demand. Weekly and changed-fact drafting are independently opt-in. The server scheduler checks assignments every 30 minutes when configured. Weekly means seven days since the previous successful draft. Change detection excludes the agent's own conversation and artifact activity, includes relevant project and PM changes, and ignores sync timestamps. Conversation replies do not count as successful background drafts.

Only one run can be active per assignment. Failed background attempts have a one-hour retry cooldown. Pausing prevents future scheduled drafts and does not cancel an active provider request. Server restarts mark interrupted runs failed and retain their history. Existing model budgets apply.

Assignment edits use version checks to reject stale writes. The download endpoint serves stored text as an attachment through the existing access guard, with a generated filename and `nosniff` headers.

## Validation

`bun run check` passes: 209 tests, typechecking, and lint. Production build and whitespace checks pass. Coverage includes assignment validation and stale writes, full conversation persistence, PM handoff, immutable versions and approval, Markdown/text download bytes and headers, conversation-only replies, empty replies, missing models, interrupted runs, weekly cadence, changed inputs, failure cooldowns, and concurrent starts.

An isolated in-memory fake-model preview verified assignment creation, a conversation reply with no artifact, draft creation, Quantum/preparing states, approval, a successful browser download, a revised version retaining the earlier approved version, artifact-to-run inspection, and saving an opt-in background setting. The browser reported no console errors or warnings. No live provider or real project database was used. The main sample preview remains model-free with its scheduler disabled.
