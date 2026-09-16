// Five fictional AI delivery projects, one per stage of the lifecycle, across
// the three risk tiers. Every name, person, and number here is invented;
// the projects mirror the sample charters in docs/samples so document-based
// setup and the demo workspace tell the same story.
//
//   invoice   Invoice Review Assistant     Scaling    Tier 2   value flowing, one release blocked on docs
//   clauses   Contract Clause Review       Pilot      Tier 1   recall under gate, governance gaps
//   search    Internal Knowledge Search    Discovery  Tier 3   quality below gate, little governance yet
//   triage    Support Triage Assistant     Pilot      Tier 2   pilot ready to go live
//   meetings  Meeting Notes Summarizer     Sustain    Tier 3   fully delivered, every gate cleared

import type { Project } from "../types.ts";

export const PROJECTS: Project[] = [
  {
    id: "invoice", key: "PRJ-4", name: "Invoice Review Assistant", stage: "Scaling",
    description:
      "Extracts line items from supplier invoices, matches them to purchase orders, and routes exceptions to the accounts-payable team with a suggested resolution. Replaces the manual three-way matching spreadsheet run by the AP operations team.",
    tier: 2, committee: { date: "2026-05-14", ref: "AIC-2026-031" },
    repos: [
      { name: "invoice-extraction-svc", url: "github.com/org/invoice-extraction-svc" },
      { name: "invoice-po-matcher", url: "github.com/org/invoice-po-matcher" },
      { name: "invoice-evals", url: "github.com/org/invoice-evals" },
    ],
    team: [
      { ini: "JA", name: "Jordan Avery", role: "Lead / Sponsor" },
      { ini: "SL", name: "Sam Lee", role: "ML Engineer" },
      { ini: "PN", name: "Priya Nair", role: "Platform Engineer" },
      { ini: "TO", name: "Tom Okafor", role: "SRE" },
      { ini: "AR", name: "Alex Rivera", role: "Product Ops" },
    ],
    targets: { fte: 40, time: 40 },
    milestones: [
      { id: "MS-12", name: "Line-item extraction service", status: "shipped", month: "2026-08",
        impact: { base: { fte: 10, time: 10 }, stretch: { fte: 15, time: 15 } },
        metrics: [
          { id: "acc", label: "Extraction accuracy", base: 80, stretch: 95, current: 87 },
          { id: "cov", label: "Supplier coverage", base: 80, stretch: 95, current: 82 },
        ] },
      { id: "MS-15", name: "Supplier format templates", status: "shipped", month: "2026-05",
        impact: { base: { fte: 5, time: 5 }, stretch: { fte: 5, time: 7 } },
        metrics: [{ id: "tpl", label: "Suppliers on template", base: 60, stretch: 85, current: 71 }] },
      { id: "MS-13", name: "Purchase-order matching", status: "eval", month: "2026-10",
        impact: { base: { fte: 8, time: 12 }, stretch: { fte: 11, time: 16 } },
        metrics: [
          { id: "ext", label: "Match accuracy", base: 85, stretch: 97, current: 81 },
          { id: "thr", label: "Invoices auto-matched", base: 70, stretch: 90, current: 74 },
        ] },
      { id: "MS-14", name: "Exception triage and approval routing", status: "progress", month: "2026-12",
        impact: { base: { fte: 6, time: 8 }, stretch: { fte: 9, time: 11 } },
        metrics: [
          { id: "rec", label: "Auto-routed exceptions", base: 75, stretch: 92, current: 0 },
          { id: "fpr", label: "Exception precision", base: 80, stretch: 95, current: 0 },
        ] },
      { id: "MS-16", name: "Duplicate and anomaly detection", status: "backlog", month: "2027-02",
        impact: { base: { fte: 7, time: 4 }, stretch: { fte: 10, time: 6 } },
        metrics: [
          { id: "match", label: "Detection precision", base: 90, stretch: 98, current: 0 },
          { id: "recall", label: "Detection recall", base: 85, stretch: 95, current: 0 },
        ] },
    ],
    governance: [
      { cat: "Design & architecture", id: "tdd", name: "Technical design document", status: "approved", owner: "JA", date: "2026-03-02", detail: "v2.3 covers the extraction service, the matcher, and the eval harness. Reviewed by the architecture guild.", link: "wiki/invoice-tdd" },
      { cat: "Design & architecture", id: "arch", name: "Architecture review", status: "approved", owner: "PN", date: "2026-03-18", detail: "Sign-off including data flow diagrams and the threat model appendix." },
      { cat: "Design & architecture", id: "sec", name: "Security review and pen test", status: "approved", owner: "TO", date: "2026-04-22", detail: "No criticals. Two mediums remediated (secrets handling, egress policy)." },
      { cat: "AI governance", id: "airc", name: "AI committee review", status: "approved", owner: "JA", date: "2026-05-14", detail: "AIC-2026-031. Classified Tier 2 (human-in-the-loop, internal data, reversible actions). Annual re-review required.", link: "committee/2026-031" },
      { cat: "AI governance", id: "mra", name: "Model risk assessment", status: "approved", owner: "SL", date: "2026-05-02", detail: "Covers hallucinated line items; mitigations: confidence thresholds plus a reviewer queue." },
      { cat: "AI governance", id: "evalso", name: "Evaluation suite sign-off", status: "approved", owner: "SL", date: "2026-06-10", detail: "Golden set of 1,400 invoices across 12 supplier formats; gates wired to CI." },
      { cat: "AI governance", id: "dpia", name: "Data privacy assessment", status: "approved", owner: "AR", date: "2026-04-08", detail: "Supplier contact details scoped out of prompts; field-level redaction verified." },
      { cat: "AI governance", id: "card", name: "Model and system card", status: "in_review", owner: "SL", date: "2026-08-30", detail: "Draft published; pending the intended-use section for exception routing." },
      { cat: "Operations", id: "sre", name: "Runbook and rollback plan", status: "approved", owner: "TO", date: "2026-06-20", detail: "On-call rotation, rollback procedure, degradation modes (fall back to the manual queue)." },
      { cat: "Operations", id: "sla", name: "Service level agreement", status: "approved", owner: "AR", date: "2026-06-25", detail: "99.5% availability; extraction p95 under 2 s; 4-hour support response." },
      { cat: "Operations", id: "mon", name: "Monitoring and drift detection", status: "in_review", owner: "TO", date: "2026-09-01", detail: "Dashboards live; automated drift alerts on supplier mix in staging." },
      { cat: "Release & adoption", id: "rel", name: "Release process", status: "approved", owner: "PN", date: "2026-05-30", detail: "Canary by supplier cohort; eval gates block promotion below base thresholds." },
      { cat: "Release & adoption", id: "uat", name: "User acceptance testing", status: "approved", owner: "AR", date: "2026-07-12", detail: "AP team UAT script, 3 cohorts complete; sign-off template stored per release." },
      { cat: "Release & adoption", id: "docs", name: "User and operator documentation", status: "in_review", owner: "AR", date: "2026-09-05", detail: "User guide complete; admin guide for the exception queue in review." },
    ],
  },
  {
    id: "clauses", key: "PRJ-7", name: "Contract Clause Review", stage: "Pilot",
    description:
      "Extracts obligations, renewal terms, and restrictions from supplier and customer contracts into structured, reviewable clause records for the legal team. High-scrutiny workflow: every extracted clause is approved by a reviewer before it becomes part of the contract record.",
    tier: 1, committee: { date: "2026-07-28", ref: "AIC-2026-058" },
    repos: [
      { name: "clause-extractor", url: "github.com/org/clause-extractor" },
      { name: "contract-schema", url: "github.com/org/contract-schema" },
    ],
    team: [
      { ini: "JA", name: "Jordan Avery", role: "Lead" },
      { ini: "LF", name: "Lena Fischer", role: "Legal SME" },
      { ini: "SL", name: "Sam Lee", role: "ML Engineer" },
      { ini: "DM", name: "Diego Morales", role: "Legal Review" },
    ],
    targets: { fte: 30, time: 50 },
    milestones: [
      { id: "MS-21", name: "Obligation clause extraction", status: "eval", month: "2026-09",
        impact: { base: { fte: 12, time: 20 }, stretch: { fte: 16, time: 26 } },
        metrics: [
          { id: "prec", label: "Clause precision", base: 92, stretch: 98, current: 94 },
          { id: "rec", label: "Clause recall", base: 88, stretch: 96, current: 86 },
        ] },
      { id: "MS-22", name: "Renewal and termination parser", status: "progress", month: "2026-11",
        impact: { base: { fte: 8, time: 15 }, stretch: { fte: 10, time: 18 } },
        metrics: [
          { id: "cov", label: "Contract coverage", base: 75, stretch: 90, current: 0 },
          { id: "acc", label: "Parse accuracy", base: 90, stretch: 97, current: 0 },
        ] },
      { id: "MS-23", name: "Reviewer workbench v2", status: "backlog", month: "2027-01",
        impact: { base: { fte: 10, time: 15 }, stretch: { fte: 12, time: 20 } },
        metrics: [{ id: "tta", label: "Review throughput lift", base: 40, stretch: 70, current: 0 }] },
    ],
    governance: [
      { cat: "Design & architecture", id: "tdd", name: "Technical design document", status: "approved", owner: "JA", date: "2026-06-11", detail: "Includes the clause schema contract and reviewer workflow states.", link: "wiki/clauses-tdd" },
      { cat: "Design & architecture", id: "arch", name: "Architecture review", status: "approved", owner: "JA", date: "2026-06-24", detail: "Approved with a condition: clause activation requires dual approval." },
      { cat: "Design & architecture", id: "sec", name: "Security review and pen test", status: "in_review", owner: "TO", date: "2026-09-03", detail: "Pen test scheduled for the week of Sep 14; document store access review complete." },
      { cat: "AI governance", id: "airc", name: "AI committee review", status: "approved", owner: "JA", date: "2026-07-28", detail: "AIC-2026-058. Tier 1: legally binding output. Quarterly re-review; 100% human approval of extracted clauses mandated.", link: "committee/2026-058" },
      { cat: "AI governance", id: "mra", name: "Model risk assessment", status: "in_review", owner: "LF", date: "2026-09-02", detail: "Missed-obligation (false negative) analysis in a second review round with the model risk team." },
      { cat: "AI governance", id: "evalso", name: "Evaluation suite sign-off", status: "in_review", owner: "SL", date: "2026-08-25", detail: "Golden set of 320 contracts labelled by legal SMEs; recall gate contested: SMEs want a 90% base." },
      { cat: "AI governance", id: "dpia", name: "Data privacy assessment", status: "approved", owner: "DM", date: "2026-07-06", detail: "Contracts processed in-region; no third-party model calls." },
      { cat: "AI governance", id: "card", name: "Model and system card", status: "draft", owner: "SL", date: "2026-08-15", detail: "Skeleton only; blocked on final eval numbers." },
      { cat: "Operations", id: "sre", name: "Runbook and rollback plan", status: "draft", owner: "TO", date: "2026-08-28", detail: "Runbook drafted; failure mode review with the SRE guild pending." },
      { cat: "Operations", id: "sla", name: "Service level agreement", status: "missing", owner: "AR", date: null, detail: "Not started. Needed before pilot exit; extraction turnaround target to be agreed with legal operations." },
      { cat: "Operations", id: "mon", name: "Monitoring and drift detection", status: "draft", owner: "TO", date: "2026-09-04", detail: "Precision and recall tracking per contract type designed, not deployed." },
      { cat: "Release & adoption", id: "rel", name: "Release process", status: "draft", owner: "JA", date: "2026-08-20", detail: "Proposal: shadow mode, then assisted review, then gated activation. The architecture condition applies." },
      { cat: "Release & adoption", id: "uat", name: "User acceptance testing", status: "missing", owner: "LF", date: null, detail: "Legal team UAT plan not yet drafted; depends on the workbench v2 scope." },
      { cat: "Release & adoption", id: "docs", name: "User and operator documentation", status: "missing", owner: "AR", date: null, detail: "Not started." },
    ],
  },
  {
    id: "search", key: "PRJ-9", name: "Internal Knowledge Search", stage: "Discovery",
    description:
      "Drafts answers to internal policy and process questions from the staff handbook and resolved support tickets, with citations, for the knowledge team to review before publication. Currently validating answer quality against expert-written baselines.",
    tier: 3, committee: null,
    repos: [{ name: "knowledge-search-agents", url: "github.com/org/knowledge-search-agents" }],
    team: [
      { ini: "JA", name: "Jordan Avery", role: "Lead" },
      { ini: "GK", name: "Grace Kim", role: "Knowledge Manager" },
      { ini: "SL", name: "Sam Lee", role: "ML Engineer" },
    ],
    targets: { fte: 25, time: 60 },
    milestones: [
      { id: "MS-31", name: "Grounded answer pipeline", status: "eval", month: "2026-10",
        impact: { base: { fte: 15, time: 35 }, stretch: { fte: 18, time: 45 } },
        metrics: [
          { id: "qual", label: "Reviewer quality rating", base: 70, stretch: 85, current: 64 },
          { id: "fact", label: "Citation accuracy", base: 95, stretch: 99, current: 91 },
        ] },
      { id: "MS-32", name: "Content freshness service", status: "backlog", month: "2026-12",
        impact: { base: { fte: 10, time: 25 }, stretch: { fte: 12, time: 30 } },
        metrics: [{ id: "lat", label: "Content staleness under 24h", base: 90, stretch: 99, current: 0 }] },
    ],
    governance: [
      { cat: "Design & architecture", id: "tdd", name: "Technical design document", status: "in_review", owner: "JA", date: "2026-08-29", detail: "v0.9 circulated to the architecture guild; the retrieval section is under discussion." },
      { cat: "Design & architecture", id: "arch", name: "Architecture review", status: "missing", owner: "JA", date: null, detail: "Queued after the design document is approved." },
      { cat: "Design & architecture", id: "sec", name: "Security review and pen test", status: "missing", owner: "TO", date: null, detail: "Not started; discovery phase." },
      { cat: "AI governance", id: "airc", name: "AI committee review", status: "missing", owner: "JA", date: null, detail: "Submission targeted for the October cycle. Pre-read drafted; expected Tier 3 (internal drafts, expert approval before publication)." },
      { cat: "AI governance", id: "mra", name: "Model risk assessment", status: "missing", owner: "SL", date: null, detail: "Blocked on committee tiering." },
      { cat: "AI governance", id: "evalso", name: "Evaluation suite sign-off", status: "draft", owner: "GK", date: "2026-09-01", detail: "Rubric with the knowledge team in its second iteration; 40 baseline answers labelled." },
      { cat: "AI governance", id: "dpia", name: "Data privacy assessment", status: "na", owner: "AR", date: null, detail: "No personal data in scope (handbook and anonymised tickets only). Confirmed with the privacy office." },
      { cat: "AI governance", id: "card", name: "Model and system card", status: "missing", owner: "SL", date: null, detail: "Not started." },
      { cat: "Operations", id: "sre", name: "Runbook and rollback plan", status: "missing", owner: "TO", date: null, detail: "Not started; no production footprint yet." },
      { cat: "Operations", id: "sla", name: "Service level agreement", status: "na", owner: "AR", date: null, detail: "Not applicable in discovery; revisit at pilot." },
      { cat: "Operations", id: "mon", name: "Monitoring and drift detection", status: "missing", owner: "TO", date: null, detail: "Not started." },
      { cat: "Release & adoption", id: "rel", name: "Release process", status: "missing", owner: "JA", date: null, detail: "Not started." },
      { cat: "Release & adoption", id: "uat", name: "User acceptance testing", status: "missing", owner: "GK", date: null, detail: "Pilot group identified; process not defined." },
      { cat: "Release & adoption", id: "docs", name: "User and operator documentation", status: "missing", owner: "AR", date: null, detail: "Not started." },
    ],
  },
  {
    id: "triage", key: "PRJ-11", name: "Support Triage Assistant", stage: "Pilot",
    description:
      "Proposes a category, a priority, and a first response for incoming support requests. A support specialist reviews every suggestion before anything is sent; the assistant never sends messages or changes account settings itself.",
    tier: 2, committee: { date: "2026-08-19", ref: "AIC-2026-064" },
    repos: [
      { name: "triage-assistant", url: "github.com/org/triage-assistant" },
      { name: "triage-evals", url: "github.com/org/triage-evals" },
    ],
    team: [
      { ini: "JA", name: "Jordan Avery", role: "Sponsor" },
      { ini: "MC", name: "Maya Chen", role: "Support Lead" },
      { ini: "SL", name: "Sam Lee", role: "ML Engineer" },
      { ini: "RP", name: "Ravi Patel", role: "Data Engineer" },
      { ini: "AR", name: "Alex Rivera", role: "Project Manager" },
    ],
    targets: { fte: 20, time: 35 },
    milestones: [
      { id: "MS-41", name: "Ticket classification", status: "shipped", month: "2026-07",
        impact: { base: { fte: 8, time: 15 }, stretch: { fte: 12, time: 20 } },
        metrics: [{ id: "cls", label: "Classification accuracy", base: 90, stretch: 95, current: 93 }] },
      { id: "MS-42", name: "Reviewed response drafts", status: "eval", month: "2026-10",
        impact: { base: { fte: 12, time: 20 }, stretch: { fte: 16, time: 25 } },
        metrics: [
          { id: "grd", label: "Grounded response rate", base: 95, stretch: 98, current: 96 },
          { id: "acc", label: "Draft acceptance rate", base: 60, stretch: 80, current: 71 },
        ] },
      { id: "MS-43", name: "Priority and routing suggestions", status: "progress", month: "2026-12",
        impact: { base: { fte: 4, time: 8 }, stretch: { fte: 6, time: 12 } },
        metrics: [{ id: "rte", label: "Routing accuracy", base: 85, stretch: 95, current: 0 }] },
    ],
    governance: [
      { cat: "Design & architecture", id: "tdd", name: "Technical design document", status: "approved", owner: "SL", date: "2026-04-14", detail: "Covers the classifier, the draft generator, and the reviewer queue." },
      { cat: "Design & architecture", id: "sec", name: "Security review and pen test", status: "approved", owner: "TO", date: "2026-06-02", detail: "No criticals; ticket attachments are never sent to the model." },
      { cat: "AI governance", id: "airc", name: "AI committee review", status: "approved", owner: "JA", date: "2026-08-19", detail: "AIC-2026-064. Tier 2: a specialist reviews every suggestion. Annual re-review.", link: "committee/2026-064" },
      { cat: "AI governance", id: "evalso", name: "Evaluation suite sign-off", status: "approved", owner: "MC", date: "2026-06-30", detail: "Golden set of 900 tickets labelled by the support team; gates wired to CI." },
      { cat: "AI governance", id: "dpia", name: "Data privacy assessment", status: "approved", owner: "AR", date: "2026-05-20", detail: "Customer identifiers redacted before prompting; 30-day retention." },
      { cat: "AI governance", id: "card", name: "Model and system card", status: "approved", owner: "SL", date: "2026-08-28", detail: "Published with the pilot results and known failure modes." },
      { cat: "Operations", id: "sre", name: "Runbook and rollback plan", status: "approved", owner: "TO", date: "2026-07-22", detail: "Assistant can be paused per queue; specialists continue unaided." },
      { cat: "Operations", id: "mon", name: "Monitoring and drift detection", status: "in_review", owner: "RP", date: "2026-09-06", detail: "Acceptance-rate and category-mix dashboards live; alert thresholds under review." },
      { cat: "Release & adoption", id: "rel", name: "Release process", status: "approved", owner: "AR", date: "2026-07-01", detail: "Queue-by-queue rollout; a queue is added only after two weeks above gate." },
      { cat: "Release & adoption", id: "uat", name: "User acceptance testing", status: "approved", owner: "MC", date: "2026-08-08", detail: "Two specialist cohorts completed the script; sign-off filed." },
      { cat: "Release & adoption", id: "docs", name: "User and operator documentation", status: "missing", owner: "AR", date: null, detail: "Specialist quick-start drafted; operator guide not started." },
    ],
  },
  {
    id: "meetings", key: "PRJ-2", name: "Meeting Notes Summarizer", stage: "Sustain",
    description:
      "Turns meeting transcripts into a summary, decisions, and action items that the meeting owner edits before sharing. In steady-state operation since spring; the team now tracks adoption and quality drift rather than new scope.",
    tier: 3, committee: { date: "2025-11-20", ref: "AIC-2025-142" },
    repos: [{ name: "meeting-notes", url: "github.com/org/meeting-notes" }],
    team: [
      { ini: "JA", name: "Jordan Avery", role: "Sponsor" },
      { ini: "HS", name: "Hana Sato", role: "Operations Analyst" },
      { ini: "RP", name: "Ravi Patel", role: "Data Engineer" },
    ],
    targets: { fte: 12, time: 60 },
    milestones: [
      { id: "MS-51", name: "Transcript summarization", status: "shipped", month: "2026-02",
        impact: { base: { fte: 6, time: 30 }, stretch: { fte: 8, time: 38 } },
        metrics: [{ id: "qual", label: "Owner quality rating", base: 80, stretch: 90, current: 88 }] },
      { id: "MS-52", name: "Action item extraction", status: "shipped", month: "2026-04",
        impact: { base: { fte: 4, time: 20 }, stretch: { fte: 5, time: 24 } },
        metrics: [
          { id: "acc", label: "Action item accuracy", base: 85, stretch: 95, current: 96 },
          { id: "own", label: "Owner assignment accuracy", base: 80, stretch: 92, current: 94 },
        ] },
    ],
    governance: [
      { cat: "Design & architecture", id: "tdd", name: "Technical design document", status: "approved", owner: "RP", date: "2025-10-06", detail: "Transcript ingestion, summarization, and the owner edit step." },
      { cat: "Design & architecture", id: "sec", name: "Security review and pen test", status: "approved", owner: "TO", date: "2025-11-03", detail: "Transcripts encrypted at rest; deleted 14 days after the summary is shared." },
      { cat: "AI governance", id: "airc", name: "AI committee review", status: "approved", owner: "JA", date: "2025-11-20", detail: "AIC-2025-142. Tier 3: internal drafts always edited by the owner. Annual re-review due November.", link: "committee/2025-142" },
      { cat: "AI governance", id: "evalso", name: "Evaluation suite sign-off", status: "approved", owner: "HS", date: "2025-12-12", detail: "Rubric over 120 meetings; gates re-checked monthly." },
      { cat: "AI governance", id: "dpia", name: "Data privacy assessment", status: "approved", owner: "HS", date: "2025-11-10", detail: "Participants are told recording is on; opt-out honoured per meeting." },
      { cat: "AI governance", id: "card", name: "Model and system card", status: "approved", owner: "RP", date: "2026-02-20", detail: "Published; updated when the model changes." },
      { cat: "Operations", id: "sre", name: "Runbook and rollback plan", status: "approved", owner: "TO", date: "2026-01-15", detail: "Summaries queue for manual notes when the service is paused." },
      { cat: "Operations", id: "mon", name: "Monitoring and drift detection", status: "approved", owner: "RP", date: "2026-03-01", detail: "Weekly quality sample and adoption dashboard." },
      { cat: "Release & adoption", id: "rel", name: "Release process", status: "approved", owner: "HS", date: "2026-01-20", detail: "Team-by-team rollout completed in April." },
      { cat: "Release & adoption", id: "uat", name: "User acceptance testing", status: "approved", owner: "HS", date: "2026-02-05", detail: "Three pilot teams signed off." },
      { cat: "Release & adoption", id: "docs", name: "User and operator documentation", status: "approved", owner: "HS", date: "2026-03-12", detail: "One-page guide in the handbook; operator notes in the runbook." },
    ],
  },
];
