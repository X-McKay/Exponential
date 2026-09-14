# Exponential AI delivery blueprint

**Status: proposed design; illustrative data only.** This blueprint describes a possible future version of Exponential. It does not describe implemented behavior or authorize production schema, prompt, or workflow changes.

## Current scope — two-role first release

Project Manager and Communications Director are the only proposed user-facing AI roles for the first release. Other role designs below are deferred context. PM owns assessment, proposed coordination, and follow-through; Communications owns drafting, revision, and versioned deliverables. Technical evaluations and release execution are not added by renaming those responsibilities. Existing production agents are unchanged during design review.

## Product direction

Exponential should become a role based AI project manager for evidence led delivery. A person starts an initiative from a template, gives each delivery role a bounded job, and sees requirements, evidence requests, work items, decisions, and communication artifacts in one traceable flow. AI prepares and coordinates; people retain authority over targets, measurements, approvals, exceptions, releases, budgets, and policy.

The existing domain remains the system of record for projects and targets, milestones and readings, releases and criteria, governance, synced development facts, agent runs, proposals, prompt versions, and spend. The new layer adds workflow structure and links around those facts. “Eligible value” remains a derived estimate after shipped milestones clear gates, not an observed benefit. “Ready” remains a criteria result, not proof of deployment.

## Roles and mapping to the current model

| New role | Job in the workflow | Existing facts it reads or proposes against |
| --- | --- | --- |
| AI PM | Maintains scope, plan, dependencies, brief, and decisions | Projects, milestones, releases, calendar, proposals; brief/chat/curator capabilities |
| Testing Coordinator | Converts acceptance into tests, requests readings, explains failures | Metrics, eval readings, builds, pull requests; audit/evaluation capabilities |
| Strategy Lead | Connects outcomes, assumptions, options, and value | Targets, impacts, gates, snapshots, decisions; ideation capability |
| Comms Director | Produces audience specific updates with evidence and approvals | Glance, brief, events, release state; communications capability |
| Release Coordinator | Tracks readiness, cutover, deployment evidence, and release pack | Releases, criteria, milestones, builds, governance |
| Governance Lead | Owns controls, risk, exceptions, decisions, and routing | Governance, owners, proposals, budgets, run logs; rules/audit capabilities |

Roles are configurations with capabilities, model, prompt/SOP version, owner, schedule, and budget scope. A role run is still auditable. A role may create a draft artifact, requirement, work item, decision, or proposal; it may apply only actions allowed by policy. Existing agent kinds can remain a compatibility mapping during migration.

## Shared delivery objects

Every initiative uses four linked record families:

* **Requirements** state the outcome, acceptance criteria, owner, priority, assumptions, and references to milestones or releases. AI can propose one, but it becomes authoritative only after acceptance.
* **Evidence** records what was observed, by whom or which connector, when, with source URI, dataset/build/version, method, confidence, and freshness. A metric reading is evidence; the record adds provenance and policy.
* **Work** contains tasks, dependencies, due dates, owner, status, and links to requirements, evidence gaps, and decisions. Calendar events can be generated from accepted work.
* **Decisions** capture the question, options, recommendation, owner, due date, evidence references, affected release/value, outcome, and rationale. Accepting a proposal should create or update the record atomically with the mutation and event.

Templates and SOPs are immutable versioned records. A run stores the versions used, input references and snapshot, outputs, spend, and review state, making its inputs and provenance inspectable as the live project changes; regeneration may produce different wording.

## Three core SOPs

### SOP 1: Initiative initiation

1. A person selects a template and supplies purpose, target outcome, sponsor, team, repositories or source documents, risk tier, and desired release window.
2. AI PM drafts the project brief, requirements, milestones, initial impacts and metrics, dependencies, and open decisions. Strategy Lead checks that outcome claims are hypotheses and identifies baseline data needed to measure benefit.
3. Testing Coordinator turns acceptance criteria into an evaluation plan and names the evidence source for each metric. Governance Lead proposes controls, owners, review dates, and any required committee decision.
4. A person reviews a before/after preview, edits or rejects rows, and accepts the batch. Accepted rows are created in one transaction; unresolved items remain drafts. AI never silently applies a target, gate, status, or approval.

**Exit criteria:** accepted brief and outcome owner; requirements linked to milestones; test/evidence plan; assigned governance gaps; and a first decision or action with a due date.

### SOP 2: Evaluation and learning

1. Testing Coordinator schedules or receives an eval, records an append only reading with source and timestamp, and attaches the run/build/dataset evidence.
2. AI PM compares current evidence with requirement acceptance and release criteria. Strategy Lead updates assumptions and drafts a value interpretation, keeping forecast, delivery eligibility, and observed benefit separate.
3. Missing, stale, conflicting, or below gate evidence creates an evidence request, work item, or decision proposal with affected objects and a reason.
4. A reviewer can accept, edit, dismiss, or defer the proposal. Changed inputs or expired proposals fail closed and require a fresh run. Human ratings and eval scores feed role quality metrics.

**Exit criteria:** each requirement has a current evidence state; failures have an owner and next action; material interpretation is logged; and release impact is visible without changing authoritative facts.

### SOP 3: Release and closeout

1. Release Coordinator assembles a readiness view from live milestone gates, governance criteria, manual checks, dependencies, and deployment evidence. Empty criteria are “Not configured”; planned date alone cannot mark a release shipped.
2. Governance Lead verifies required controls, approvals, exceptions, and budget status. Comms Director drafts audience specific messages from accepted facts and links each claim to evidence or a decision.
3. A person approves go/no go or records an exception with scope, expiry, owner, and rationale. Release execution records environment, version, timestamp, and deployment evidence.
4. After launch, Testing Coordinator runs post release checks; Strategy Lead records an observation period, adoption, outcome, and attribution assumptions. Release Coordinator publishes a versioned evidence pack for review and download.

**Exit criteria:** decision and approver are recorded; deployment evidence exists; exceptions are explicit; the pack passed review; and post release measurement is scheduled.

## Assets and artifact lifecycle

Assets are inputs such as briefs, PDFs, links, repository snapshots, datasets, screenshots, and connector records. Each has owner, access scope, checksum/version, source, captured time, and extraction status. A new version never rewrites history.

Artifacts are generated outputs: requirement packs, test plans, decision briefs, release evidence packs, status updates, and exports. Generation creates a draft with run id, template/SOP versions, input asset versions, cited fact ids, and cost. The artifact page supports preview, download, comparison, regeneration, and “request review.”

Review is a distinct state machine: draft → in review → approved, with changes requested and superseded branches. Reviewers annotate claims, edit permitted fields, and record approval. Acceptance never changes source evidence; it publishes a human approved view.

Freshness is separate from review. A reviewed artifact becomes stale when cited facts, requirements, readings, governance, criteria, or assets change, or when its window expires. Show reviewed and stale together, explain the trigger, and offer regeneration. It remains downloadable as historical output with a visible warning.

## Permissions and guardrails

Use workspace, project, and artifact scopes with named owners and reviewers. Asset read access does not imply permission to use it in a model run or download. Default AI capabilities are read, draft, cite, and propose. Write, approve, publish, change targets/gates, record measurements, alter prompts, and exceed a role budget require explicit grants. Release approval, governance exceptions, deployment records, and observed benefit claims always require a person. Log access, generation, review, proposal decisions, and policy denials; redact secrets and do not store model tokens.

## Incremental build phases

**Phase 1 — Traceable drafts.** Add versioned templates/SOPs, the four shared record families, asset metadata, artifact generation records, citations, preview/download, and review states. Acceptance: an initiation run produces a reviewable draft whose every claim links to a fact or is labeled an assumption; no existing derivation changes.

**Phase 2 — Evidence and coordination.** Add freshness computation, evidence requests, work dependencies, decision records, role capability policies, and proposal conflict checks. Acceptance: changed or expired inputs block application; stale artifacts identify the exact trigger; accepted actions preserve existing events and append only facts.

**Phase 3 — Release operations.** Add deployment facts, release evidence packs, exception expiry, post release measurement, and audience specific comms. Acceptance: a release cannot become shipped from date or empty criteria alone; a pack includes version, readings, approvals, exceptions, and decision history.

**Phase 4 — Quality and scale.** Add role scorecards, benchmarks, prompt/SOP comparison, connector health, saved views, and cost forecasting. Acceptance: role output is measurable for grounding, completeness, actionability, freshness, acceptance, latency, and spend; reservations cover concurrent calls.

## Decisions for discussion

1. **Role model:** recommended default is six configurable roles mapped to existing agents, preserving current IDs and runs; alternatives are one universal AI PM or six separate products.
2. **Approval boundary:** recommended default is human approval for all authoritative writes and release/governance actions; alternatives are earned autonomy for low risk reminders or policy driven automatic writes.
3. **Freshness policy:** recommended default is event driven invalidation plus configurable time windows; alternatives are time only or manual refresh only.
4. **Template scope:** recommended default is workspace owned templates with immutable versions and project overrides; alternatives are centrally locked templates or per project free form prompts.
5. **Evidence pack:** recommended default is a versioned downloadable HTML/PDF bundle with links back to live facts; alternatives are an API only record or a static document with no live links.


## Reference template: AI pilot to controlled production

The first template starts with a human-approved problem statement, intended users, sponsor, outcome owner, risk classification, and baseline-measurement plan. It creates four phases: initiation, evaluation, controlled release, and outcome review. Dates and effort remain unset until estimated.

| Phase | Expected deliverables | Completion condition |
| --- | --- | --- |
| Initiation | Charter, project deck, success measures | Scope and accountable owner approved |
| Evaluation | Evaluation plan, dataset specification, evaluation report | Required evidence exists; failures have assigned follow-up |
| Controlled release | Operating guide, release pack, stakeholder update | Configured gates and required approvals satisfied; release decision recorded |
| Outcome review | Adoption and benefit report | Observations compared with baseline, limitations documented |

Template adoption creates deliverable expectations before files exist. An expected operating guide can therefore appear as “Not created,” with an owner needed. High-risk requirements add human review and required governance checks. Template updates present a reviewed diff against the adopted version; local exceptions retain approver, scope, rationale, and expiry. Standards must identify which requirements cannot be waived.

## Worked IMA scenario for the mock-up

All statuses below are illustrative. IMA's Shadow mode release has a recall result of 86% against an 88% requirement and two outstanding governance reviews. The Testing Coordinator drafts evaluation plan v2. The Project Manager groups the investigation and re-evaluation into one recommendation, with Dan K. proposed as the human owner and effort explicitly unconfirmed. The Release Coordinator links that work to the blocked release.

The user opens the plan from Files & Deliverables, checks the source facts, and reviews exactly what approval authorizes. Approval records the plan version and creates an internal assignment; it does not clear the gate, change the release date, or send a communication. The Project Manager next obtains an estimate and tracks the expected evidence. A subsequent passing result can satisfy the performance criterion, while the release remains blocked until its other requirements are satisfied.

A project deck retains its approved version but is flagged for refresh when cited evaluation facts change. The executive update stays in review and undistributed. The release pack remains “Waiting on inputs.” This keeps file existence, review, freshness, and delivery readiness distinct.

## File delivery contract

Generation states are queued, generating, ready, and failed; these are independent of review and freshness. A ready artifact version references actual stored files with format, size, checksum, and access policy. PPTX/PDF exports of one deck version share the same source snapshot. Failed conversion must not expose a working-looking download. Regeneration creates a new version and cannot overwrite an approved one. Distribution records its audience and exact approved version separately.

The first implementation should demonstrate one complete path: instantiate the reference template manually, generate and store an evaluation-plan artifact, review it, create an assignment, and trace it back to a release requirement. Expand document formats and agent roles after this path works. The broader phases above describe the destination, not a single initial release.
