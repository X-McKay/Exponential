# Daily workflow UI improvements — 2026-09-12

Implemented the agreed Glance, Overview, and release-blocker improvements while retaining the existing theme.

## What changed

- Glance leads with three actionable priorities, including near-term at-risk releases. Supporting milestone gates do not take a second priority slot when their release is already represented. Each priority has one primary action and expandable evidence; detailed briefs and the original signal grid remain available below.
- Overview leads with compact project status, next planned release, eligible value, and release blockers. The project brief is collapsed and no longer triggers model curation merely by visiting the page. Explicit generation remains available. Mobile summaries use two columns.
- Roadmap leads with release health and actionable unmet criteria. Selecting a release updates its URL and featured summary. Gate and approval actions open their exact targets; manual criteria and broken references lead to the release editor. Empty criteria expose a configuration action. The optional timeline uses actual target markers instead of inferred delivery windows.
- Governance separates release-linked controls from the general register and prioritizes open controls by release timing. Recorded dates are labelled as such. Links open a specific control and place keyboard focus there; linked release navigation returns to the release.
- Deep links carry release, milestone or governance identifiers. Project views use a labelled selector on narrow screens. Release and milestone rows no longer contain nested edit buttons inside their expansion buttons.

## Validation

`bun run check` passes typecheck, lint, and all 184 tests. `bun run build` passes. `git diff --check` is clean.

Browser checks used an isolated in-memory sample workspace, including a 390 × 844 viewport. Verified Glance → release, switching the selected release, approval expansion, exact milestone expansion/focus, collapsed timeline, and compact mobile Overview. Checked that the page does not horizontally overflow on the tested mobile viewport. Existing application data was not changed.

This work does not add measured benefits, deployment evidence, individual accounts, or the deferred Inbox/Portfolio redesign. Changes remain uncommitted.

## Inbox refinement

Inbox proposals now show current and proposed values, expandable long content, and full rationale. Apply change and Dismiss wait for the server response; failed decisions remain visible with an inline error. Keyboard navigation follows project-group display order, and repeated decisions are blocked while saving. History is sorted by decision time and shows recorded outcomes, timestamps, and proposed content without presenting live values as historical evidence. Expired pending proposals cannot be applied; expiry is not inferred as the cause of a recorded dismissal. The empty state no longer promises scheduled agent runs.

Verified apply, stale rejection, dismissal, and history using a separate in-memory synthetic preview. Checked the final mobile layout at 390 × 844 with no page overflow. Real workspace data was not changed.
