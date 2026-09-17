// ================= project templates =================
//
// A template is a configurable starting point: the governance documents a
// project of its kind must carry, what it depends on before it can ship, and
// a first plan. Built-in templates are installed once and can be edited in
// the workspace; instantiating one is a pure derivation from the template,
// the creation month, and a default owner. Nothing about a template is stored
// on the project afterwards, so a later template edit never rewrites history.

import { addMonths } from "./calendar.ts";
import type { YearMonth } from "./calendar.ts";
import { slugId } from "./derive.ts";
import type { AppState, Criterion, GovernanceItem, Milestone, Project, ProjectTemplate, Release, TemplateDocument, TemplateVersion } from "./types.ts";

/** The governance category every template dependency lands in. */
export const DEPENDENCY_CATEGORY = "Dependencies";

const D = (cat: string, name: string, detail: string, required = true): TemplateDocument => ({ cat, name, detail, required });

/** Documents every AI project carries, whatever its shape. */
const CORE_DOCUMENTS: TemplateDocument[] = [
  D("Design & architecture", "Technical design document", "What the system does, its components, data flows, and the human review points."),
  D("Design & architecture", "Architecture review", "Sign-off from the architecture forum, including the threat model appendix."),
  D("Design & architecture", "Security review", "Security assessment of the service, its secrets handling, and its egress."),
  D("AI governance", "AI committee review", "Risk tiering and approval by the AI governance committee before any release."),
  D("AI governance", "Model risk assessment", "Failure modes, their impact, and the mitigations in place."),
  D("AI governance", "Evaluation suite sign-off", "The golden set, the gate thresholds, and who approved them."),
  D("AI governance", "Data privacy assessment", "Personal data in scope, retention, and redaction; N/A only when confirmed by the privacy office."),
  D("AI governance", "Model and system card", "Intended use, limits, evaluation results, and monitoring for the deployed system."),
  D("Operations", "Runbook and rollback plan", "On-call, degradation modes, and how to fall back to the manual process."),
  D("Operations", "Service level agreement", "Availability, latency, and support response commitments.", false),
  D("Operations", "Monitoring and drift detection", "Dashboards and alerts on quality, volume, and input drift."),
  D("Release & adoption", "Release process", "Cohorts, canaries, and the gates that block promotion."),
  D("Release & adoption", "User acceptance testing", "Who tests, the script they follow, and the sign-off record."),
  D("Release & adoption", "User and operator documentation", "Guides for the people who use and operate the system.", false),
];

export const BUILTIN_TEMPLATES: ProjectTemplate[] = [
  {
    id: "assistant",
    name: "Human-in-the-loop assistant",
    description: "A system that proposes and a person decides: drafts, classifications, or suggestions that are always reviewed before they take effect.",
    stage: "Discovery",
    tier: 2,
    targets: { fte: 25, time: 35 },
    documents: [
      ...CORE_DOCUMENTS,
      D("Release & adoption", "Reviewer operating procedure", "How reviewers accept, edit, or reject suggestions, and how disagreements are recorded."),
    ],
    dependencies: [
      { name: "Evaluation golden set", detail: "Labelled examples the gates are measured against, owned by the domain experts.", required: true },
      { name: "Model access and quota", detail: "An approved provider endpoint with enough capacity for the pilot cohort.", required: true },
      { name: "Source data access", detail: "Read access to the systems the assistant draws on, with the data owner's agreement.", required: true },
      { name: "Reviewer staffing", detail: "Named reviewers with time set aside for the pilot.", required: true },
    ],
    milestones: [
      { name: "Evaluation harness and golden set", monthsOut: 2, impact: { base: { fte: 0, time: 0 }, stretch: { fte: 0, time: 0 } }, metrics: [{ label: "Golden set coverage", base: 80, stretch: 95 }] },
      { name: "Assisted pilot", monthsOut: 4, impact: { base: { fte: 10, time: 15 }, stretch: { fte: 15, time: 22 } }, metrics: [{ label: "Suggestion acceptance rate", base: 70, stretch: 85 }, { label: "Grounded output rate", base: 95, stretch: 98 }] },
      { name: "Scaled rollout", monthsOut: 8, impact: { base: { fte: 15, time: 20 }, stretch: { fte: 20, time: 28 } }, metrics: [{ label: "Reviewer throughput lift", base: 30, stretch: 50 }] },
    ],
    releases: [
      { name: "Pilot", monthsOut: 4, milestones: [0, 1], criteria: [{ type: "gate", milestone: 1, label: "Pilot base gate" }, { type: "document", name: "AI committee review", label: "AI committee approval" }, { type: "document", name: "Data privacy assessment", label: "Privacy assessment approved" }, { type: "manual", label: "Pilot cohort confirmed" }] },
      { name: "General availability", monthsOut: 8, milestones: [2], criteria: [{ type: "gate", milestone: 2, label: "Rollout base gate" }, { type: "document", name: "Runbook and rollback plan", label: "Runbook approved" }, { type: "document", name: "Monitoring and drift detection", label: "Monitoring approved" }, { type: "document", name: "User acceptance testing", label: "UAT signed off" }] },
    ],
  },
  {
    id: "automation",
    name: "Straight-through automation",
    description: "A pipeline that acts without a person on every case, with exceptions routed to a queue. Higher scrutiny: rollback, audit trail, and a manual fallback are required.",
    stage: "Discovery",
    tier: 1,
    targets: { fte: 40, time: 40 },
    documents: [
      ...CORE_DOCUMENTS,
      D("Operations", "Exception queue design", "How cases the pipeline cannot settle reach a person, and how quickly."),
      D("AI governance", "Audit log design", "An immutable record of every automated action and its inputs."),
    ],
    dependencies: [
      { name: "Evaluation golden set", detail: "Labelled examples the gates are measured against, owned by the domain experts.", required: true },
      { name: "Model access and quota", detail: "An approved provider endpoint with capacity for production volume.", required: true },
      { name: "Reconciliation data source", detail: "The system of record the pipeline's outputs are checked against.", required: true },
      { name: "Manual fallback process", detail: "A staffed manual path that can absorb the volume when the pipeline is paused.", required: true },
      { name: "Immutable audit log", detail: "Append-only storage for automated actions, retained per policy.", required: true },
    ],
    milestones: [
      { name: "Evaluation harness and golden set", monthsOut: 2, impact: { base: { fte: 0, time: 0 }, stretch: { fte: 0, time: 0 } }, metrics: [{ label: "Golden set coverage", base: 85, stretch: 95 }] },
      { name: "Shadow mode", monthsOut: 4, impact: { base: { fte: 0, time: 0 }, stretch: { fte: 0, time: 0 } }, metrics: [{ label: "Decision precision", base: 95, stretch: 99 }, { label: "Decision recall", base: 90, stretch: 97 }] },
      { name: "Gated automation", monthsOut: 7, impact: { base: { fte: 25, time: 25 }, stretch: { fte: 32, time: 32 } }, metrics: [{ label: "Straight-through rate", base: 70, stretch: 90 }, { label: "Exception precision", base: 85, stretch: 95 }] },
      { name: "Full volume", monthsOut: 10, impact: { base: { fte: 15, time: 15 }, stretch: { fte: 20, time: 20 } }, metrics: [{ label: "Straight-through rate", base: 85, stretch: 95 }] },
    ],
    releases: [
      { name: "Shadow mode", monthsOut: 4, milestones: [0, 1], criteria: [{ type: "gate", milestone: 1, label: "Shadow base gate" }, { type: "document", name: "Security review", label: "Security review approved" }, { type: "document", name: "Model risk assessment", label: "Model risk assessment approved" }, { type: "document", name: "Audit log design", label: "Audit log in place" }] },
      { name: "Gated automation", monthsOut: 7, milestones: [2], criteria: [{ type: "gate", milestone: 2, label: "Automation base gate" }, { type: "document", name: "AI committee review", label: "AI committee approval" }, { type: "document", name: "Runbook and rollback plan", label: "Rollback plan approved" }, { type: "document", name: "Exception queue design", label: "Exception queue staffed" }, { type: "manual", label: "Manual fallback rehearsed" }] },
      { name: "Full volume", monthsOut: 10, milestones: [3], criteria: [{ type: "gate", milestone: 3, label: "Full-volume base gate" }, { type: "document", name: "Monitoring and drift detection", label: "Monitoring approved" }, { type: "document", name: "Model and system card", label: "System card approved" }] },
    ],
  },
  {
    id: "insight",
    name: "Analysis and drafting copilot",
    description: "Internal drafts, summaries, or answers that an expert always edits before anything leaves the team. Lower risk, lighter governance, faster iteration.",
    stage: "Discovery",
    tier: 3,
    targets: { fte: 15, time: 40 },
    documents: [
      D("Design & architecture", "Technical design document", "What the system does, its sources, and where the expert edits."),
      D("Design & architecture", "Security review", "Security assessment of the service and its data access."),
      D("AI governance", "AI committee review", "Risk tiering and approval by the AI governance committee before any release."),
      D("AI governance", "Evaluation suite sign-off", "The rubric, the baseline set, and who approved them."),
      D("AI governance", "Data privacy assessment", "Personal data in scope; N/A only when confirmed by the privacy office.", false),
      D("Operations", "Runbook and rollback plan", "How to pause the copilot and work without it.", false),
      D("Operations", "Monitoring and drift detection", "Quality and usage tracking after rollout.", false),
      D("Release & adoption", "Release process", "Pilot group, feedback loop, and the gate for wider rollout."),
      D("Release & adoption", "User and operator documentation", "A short guide for the people who use it.", false),
    ],
    dependencies: [
      { name: "Evaluation rubric and baseline set", detail: "Expert-written baselines the drafts are rated against.", required: true },
      { name: "Model access and quota", detail: "An approved provider endpoint for the pilot group.", required: true },
      { name: "Source content access", detail: "The documents or data the copilot reads, with the owner's agreement.", required: true },
    ],
    milestones: [
      { name: "Draft generation pipeline", monthsOut: 2, impact: { base: { fte: 8, time: 25 }, stretch: { fte: 10, time: 30 } }, metrics: [{ label: "Expert quality rating", base: 70, stretch: 85 }, { label: "Citation accuracy", base: 95, stretch: 99 }] },
      { name: "Team rollout", monthsOut: 5, impact: { base: { fte: 7, time: 15 }, stretch: { fte: 10, time: 20 } }, metrics: [{ label: "Weekly active users", base: 60, stretch: 85 }] },
    ],
    releases: [
      { name: "Pilot group", monthsOut: 3, milestones: [0], criteria: [{ type: "gate", milestone: 0, label: "Draft quality gate" }, { type: "document", name: "AI committee review", label: "AI committee review and tiering" }, { type: "manual", label: "Pilot group confirmed" }] },
      { name: "Team rollout", monthsOut: 5, milestones: [1], criteria: [{ type: "gate", milestone: 1, label: "Adoption gate" }, { type: "document", name: "Release process", label: "Release process approved" }] },
    ],
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Only the documents every project needs. Add the rest as the shape of the work becomes clear.",
    stage: "Discovery",
    tier: null,
    targets: { fte: 20, time: 30 },
    documents: [
      D("AI governance", "AI committee review", "Risk tiering and approval by the AI governance committee before any release."),
      D("AI governance", "Evaluation suite sign-off", "The golden set, the gate thresholds, and who approved them."),
      D("Operations", "Runbook and rollback plan", "How to pause the system and fall back to the manual process."),
    ],
    dependencies: [{ name: "Model access and quota", detail: "An approved provider endpoint.", required: true }],
    milestones: [],
    releases: [],
  },
];

export interface TemplateInstance {
  milestones: Milestone[];
  governance: GovernanceItem[];
  releases: Release[];
}

/** How many facts instantiating a template adds, for the picker. */
export const templateSummary = (t: ProjectTemplate): string => {
  const parts = [`${t.documents.length} document${t.documents.length === 1 ? "" : "s"}`, `${t.dependencies.length} dependenc${t.dependencies.length === 1 ? "y" : "ies"}`];
  if (t.milestones.length) parts.push(`${t.milestones.length} milestone${t.milestones.length === 1 ? "" : "s"}`);
  if (t.releases.length) parts.push(`${t.releases.length} release${t.releases.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
};

/**
 * Everything a template adds to a new project, with ids and months resolved.
 * Documents and dependencies start Missing and belong to `owner`; releases
 * reference the milestones and documents by the ids assigned here.
 */
export const instantiateTemplate = (t: ProjectTemplate, todayYm: YearMonth, owner: string): TemplateInstance => {
  const govIds: string[] = [];
  const gidByName = new Map<string, string>();
  const governance: GovernanceItem[] = [];
  const addItem = (cat: string, name: string, detail: string): void => {
    const id = slugId(name, govIds, "item");
    govIds.push(id);
    gidByName.set(name.toLowerCase(), id);
    governance.push({ id, cat, name, status: "missing", owner, date: null, detail });
  };
  for (const d of t.documents) addItem(d.cat, d.name, d.detail);
  for (const d of t.dependencies) addItem(DEPENDENCY_CATEGORY, d.name, d.detail);

  const milestones: Milestone[] = t.milestones.map((m, i) => ({
    id: `MS-${i + 1}`,
    name: m.name,
    status: "backlog",
    month: addMonths(todayYm, Math.max(0, m.monthsOut)),
    impact: structuredClone(m.impact),
    metrics: m.metrics.map((x, xi) => ({ id: slugId(x.label, [], `m${xi + 1}`).slice(0, 24), label: x.label, base: x.base, stretch: x.stretch, current: 0 })),
  }));

  const releases: Release[] = t.releases.map((r, i) => ({
    id: `R${i + 1}`,
    name: r.name,
    month: addMonths(todayYm, Math.max(0, r.monthsOut)),
    milestoneIds: r.milestones.map((mi) => milestones[mi]?.id).filter((id): id is string => id !== undefined),
    criteria: r.criteria.flatMap((c): Criterion[] => {
      switch (c.type) {
        case "gate": {
          const ms = milestones[c.milestone]?.id;
          return ms ? [{ type: "gate", ms, label: c.label }] : [];
        }
        case "document": {
          const gid = gidByName.get(c.name.toLowerCase());
          return gid ? [{ type: "gov", gid, label: c.label }] : [];
        }
        case "manual":
          return [{ type: "manual", ok: false, label: c.label }];
      }
    }),
  }));
  return { milestones, governance, releases };
};

/** Required documents and dependencies a project is missing entirely (by name, case-insensitive). */
export const missingFromTemplate = (t: ProjectTemplate, governance: readonly Pick<GovernanceItem, "name">[]): { documents: TemplateDocument[]; dependencies: ProjectTemplate["dependencies"] } => {
  const have = new Set(governance.map((g) => g.name.toLowerCase()));
  return {
    documents: t.documents.filter((d) => d.required && !have.has(d.name.toLowerCase())),
    dependencies: t.dependencies.filter((d) => d.required && !have.has(d.name.toLowerCase())),
  };
};

// ---- drift --------------------------------------------------------------------

/** One template item and how the project carries it right now. */
export interface DriftItem {
  /** "document" or "dependency", as the template lists it. */
  kind: "document" | "dependency";
  cat: string;
  name: string;
  detail: string;
  required: boolean;
  /** The project's matching governance item (by name, case-insensitive), or null when missing. */
  item: GovernanceItem | null;
}

export interface TemplateDrift {
  template: ProjectTemplate;
  /** The version the project was created from and the version now saved; null when unknown. */
  createdFrom: number | null;
  current: number | null;
  /** Every template item, required first, in template order. */
  items: DriftItem[];
  /** Required items the project lacks entirely: the backfill a proposal would add. */
  missingRequired: DriftItem[];
  /** Optional items the project lacks; informational. */
  missingOptional: DriftItem[];
  /** Required items present but still Missing or N/A on the project. */
  open: DriftItem[];
  /** Governance items the project has that the template does not list. */
  extra: GovernanceItem[];
  /** True when nothing required is missing. */
  aligned: boolean;
}

/**
 * How far a project has drifted from the template it follows. Nothing here is
 * stored: the template can be edited, the project can gain or lose items, and
 * the answer follows.
 */
export const templateDrift = (project: Pick<Project, "governance" | "template">, t: ProjectTemplate, versions: readonly TemplateVersion[] = []): TemplateDrift => {
  const byName = new Map(project.governance.map((g) => [g.name.toLowerCase(), g] as const));
  const listed = new Set<string>();
  const items: DriftItem[] = [
    ...t.documents.map((d): DriftItem => ({ kind: "document", cat: d.cat, name: d.name, detail: d.detail, required: d.required, item: byName.get(d.name.toLowerCase()) ?? null })),
    ...t.dependencies.map((d): DriftItem => ({ kind: "dependency", cat: DEPENDENCY_CATEGORY, name: d.name, detail: d.detail, required: d.required, item: byName.get(d.name.toLowerCase()) ?? null })),
  ].sort((a, b) => Number(b.required) - Number(a.required));
  for (const i of items) listed.add(i.name.toLowerCase());
  const missingRequired = items.filter((i) => i.required && i.item === null);
  const current = versions.filter((v) => v.templateId === t.id).reduce<number | null>((max, v) => (max === null || v.version > max ? v.version : max), null);
  return {
    template: t,
    createdFrom: project.template?.version ?? null,
    current,
    items,
    missingRequired,
    missingOptional: items.filter((i) => !i.required && i.item === null),
    open: items.filter((i) => i.required && i.item !== null && (i.item.status === "missing" || i.item.status === "na")),
    extra: project.governance.filter((g) => !listed.has(g.name.toLowerCase())),
    aligned: missingRequired.length === 0,
  };
};

/** Drift for every project that follows a template the workspace still has. */
export const workspaceDrift = (state: Pick<AppState, "projects" | "templates" | "templateVersions">): { project: Project; drift: TemplateDrift }[] =>
  state.projects.flatMap((project) => {
    const t = project.template ? state.templates?.find((x) => x.id === project.template?.id) : undefined;
    return t ? [{ project, drift: templateDrift(project, t, state.templateVersions ?? []) }] : [];
  });
