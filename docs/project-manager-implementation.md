# Project Manager first release

## Scope

Project Manager reviews health and blockers, prepares proposed plans and communications briefs, and revisits approved commitments. Automatic resource allocation, completion-date prediction, external reminders, and test execution are deferred. Communications Director remains available for existing on-demand communications runs; automated artifact distribution is not introduced.

## Workflow

1. Choose a project and create an assignment with an objective and accountable owner.
2. Run a review or send a follow-up instruction. The run retains its trigger, input fingerprint, steps, output, and errors.
3. Review proposed changes using the existing proposal and Inbox path.
4. Record agreed commitments with owner, optional due date, and status. The PM reports on these but does not automatically close them.
5. Optionally enable relevant-change and/or weekly checks. A paused assignment does not start new background runs. It does not cancel an already running provider request.

Existing agent configurations, run history, benchmarks, quality reviews, budgets, prompts, and standing rules are retained. Quantum is used for active work, with static reduced-motion behavior. Actual progress comes from recorded run events, not simulated percentages.

## Validation

Verified with `bun run check`: 198 tests pass, including PM assignment persistence, partial edits, stale-edit rejection, valid dates, manual reviews, changed-development inputs, unchanged-input suppression, weekly cadence, concurrent starts, failure cooldown, commitment creation timestamps, restart recovery, and installation into older workspaces. Typechecking, lint, production build, and whitespace checks pass.

An isolated in-memory preview with a fake model was used to create an assignment, add a commitment, change its status, run a review, inspect live steps, inspect the completed seven-step log, and send a follow-up. Quantum and the preparing-assessment shimmer were visually checked during execution. No real database or model provider was used.

The main preview at port 43187 uses sample data with no model or scheduler configured. Background checks are checked on the server's 30-minute schedule and retry failed attempts no sooner than one hour. Weekly means seven days since the last successful assessment. Change checks use project, release, calendar, development, objective, and commitment facts; sync timestamps and run output do not trigger them. Assignment creation defaults to on-demand reviews.

Communications Director now supports persistent conversations, background assignments, and versioned downloadable artifacts. See [Communications Director](communications-director-implementation.md) for the completed follow-on implementation.
