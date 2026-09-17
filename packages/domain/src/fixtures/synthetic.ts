// ================= synthetic workspaces =================
//
// A deterministic generator for whole workspaces of any size: projects across
// every stage and tier, milestones with readings on either side of their
// gates, governance registers in every state, releases with mixed criteria,
// development facts, events, calendar entries, and the documents a project
// would have been set up from. The same seed always yields the same
// workspace, so property-style tests, browser tests, and load-shaped demos
// all draw from one source. Every name is invented; nothing here is real.

import { addMonths, ymOf } from "../calendar.ts";
import { deriveDevEvents, sortEvents } from "../feed.ts";
import { sortDevFacts } from "../dev.ts";
import { BUILTIN_TEMPLATES, DEPENDENCY_CATEGORY, instantiateTemplate } from "../templates.ts";
import type { AppState, Build, CalendarEvent, CommitDay, DevFacts, Event, GovStatus, GovernanceItem, Milestone, MilestoneStatus, Project, ProjectTemplate, PullRequest, Release, RepoStat, RiskTier, Rule, TeamMember } from "../types.ts";
import { AGENTS, RULES, RUNS } from "./agents.ts";
import { WORKSPACE } from "./workspace.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A small, fast, seedable PRNG (mulberry32); the seed alone decides every value. */
export const prng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const FIRST = ["Ana", "Ben", "Chloe", "Dev", "Elin", "Farah", "Gus", "Hiro", "Ines", "Jae", "Kofi", "Lior", "Mira", "Noor", "Otis", "Pia", "Quinn", "Rosa", "Sven", "Tara", "Uma", "Viktor", "Wren", "Ximena", "Yusuf", "Zara"];
const LAST = ["Adeyemi", "Brandt", "Castillo", "Dubois", "Eriksen", "Fonseca", "Gallo", "Haddad", "Ivanova", "Jensen", "Kaur", "Lindqvist", "Moreau", "Nakamura", "Okoro", "Petrov", "Quiroga", "Rahman", "Sato", "Tanaka", "Ueda", "Varga", "Weber", "Xu", "Yilmaz", "Zhang"];
const ROLES = ["Sponsor", "Product Manager", "ML Engineer", "Platform Engineer", "SRE", "Domain Expert", "Data Engineer", "Analyst", "Legal Review", "Operations Lead"];
const DOMAINS = ["Invoice", "Claims", "Ticket", "Contract", "Onboarding", "Procurement", "Compliance", "Payroll", "Inventory", "Scheduling", "Knowledge", "Incident", "Expense", "Recruiting", "Renewal", "Returns"];
const SHAPES = ["Review Assistant", "Triage Assistant", "Summarizer", "Classifier", "Drafting Copilot", "Reconciliation Pipeline", "Search", "Routing Agent", "Extraction Service", "Forecast Helper"];
const STAGES = ["Discovery", "Pilot", "Scaling", "Sustain"] as const;
const CATEGORIES = ["Design & architecture", "AI governance", "Operations", "Release & adoption"];
const MS_NAMES = ["Evaluation harness", "Golden set v2", "Extraction service", "Reviewer queue", "Assisted pilot", "Routing rules", "Freshness service", "Confidence calibration", "Exception handling", "Workbench v2", "Batch mode", "Audit trail", "Scaled rollout", "Fallback path", "Drift monitor"];
const METRICS = ["Accuracy", "Precision", "Recall", "Coverage", "Acceptance rate", "Grounded rate", "Citation accuracy", "Throughput lift", "Auto-resolved share", "Reviewer rating"];
const REL_NAMES = ["Shadow mode", "Pilot", "Assisted rollout", "General availability", "Full volume", "Second wave"];
const LANGS = ["Python", "TypeScript", "Rust", "Go", null];

export interface SyntheticOptions {
  /** The seed decides everything else; the same seed always yields the same workspace. */
  seed?: number;
  /** How many projects to generate (1–40). */
  projects?: number;
  /** "Today" for the workspace, ISO. Planned months and timestamps are relative to it. */
  asOf?: string;
  /** Templates the projects are shaped by; built-ins when omitted. */
  templates?: ProjectTemplate[];
}

export interface SyntheticWorkspace extends AppState {
  /** The seed and options the workspace was generated from, for reproduction. */
  synthetic: { seed: number; projects: number; asOf: string };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
const int = (r: () => number, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
const round1 = (n: number): number => Math.round(n * 10) / 10;
const iso = (asOf: string, hoursAgo: number): string => new Date(new Date(asOf).getTime() - hoursAgo * HOUR).toISOString();
const initials = (name: string): string => name.split(/\s+/).map((w) => w[0] ?? "").join("").toUpperCase().slice(0, 3);
const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** A team of 2–6 fictional people with unique initials. */
const team = (r: () => number, owner: TeamMember): TeamMember[] => {
  const out: TeamMember[] = [owner];
  const used = new Set([owner.ini]);
  const n = int(r, 2, 6);
  let guard = 0;
  while (out.length < n && guard++ < 60) {
    const name = `${pick(r, FIRST)} ${pick(r, LAST)}`;
    const ini = initials(name);
    if (used.has(ini)) continue;
    used.add(ini);
    out.push({ ini, name, role: pick(r, ROLES) });
  }
  return out;
};

const statusFor = (r: () => number, stage: (typeof STAGES)[number], i: number, n: number): MilestoneStatus => {
  const done = stage === "Sustain" ? n : stage === "Scaling" ? Math.ceil(n * 0.5) : stage === "Pilot" ? Math.floor(n * 0.3) : 0;
  if (i < done) return "shipped";
  if (i === done) return stage === "Discovery" ? (r() < 0.5 ? "eval" : "progress") : "eval";
  if (i === done + 1) return "progress";
  return "backlog";
};

const govStatusFor = (r: () => number, stage: (typeof STAGES)[number]): GovStatus => {
  const x = r();
  switch (stage) {
    case "Sustain":
      return x < 0.9 ? "approved" : "na";
    case "Scaling":
      return x < 0.7 ? "approved" : x < 0.85 ? "in_review" : x < 0.95 ? "draft" : "missing";
    case "Pilot":
      return x < 0.4 ? "approved" : x < 0.6 ? "in_review" : x < 0.8 ? "draft" : "missing";
    case "Discovery":
      return x < 0.1 ? "approved" : x < 0.25 ? "draft" : x < 0.3 ? "na" : "missing";
  }
};

const milestones = (r: () => number, stage: (typeof STAGES)[number], todayYm: string, targets: { fte: number; time: number }): Milestone[] => {
  const n = int(r, 2, 6);
  const shareFte = targets.fte / n;
  const shareTime = targets.time / n;
  const names = [...MS_NAMES].sort(() => r() - 0.5).slice(0, n);
  return names.map((name, i): Milestone => {
    const status = statusFor(r, stage, i, n);
    const monthsOut = status === "shipped" ? -int(r, 1, 9) : status === "eval" ? int(r, 0, 2) : status === "progress" ? int(r, 1, 4) : int(r, 3, 9);
    const baseFte = round1(shareFte * (0.6 + r() * 0.8));
    const baseTime = round1(shareTime * (0.6 + r() * 0.8));
    const metricCount = int(r, 1, 3);
    const labels = [...METRICS].sort(() => r() - 0.5).slice(0, metricCount);
    const measurable = status === "eval" || status === "shipped";
    return {
      id: `MS-${i + 1}`,
      name,
      status,
      month: addMonths(todayYm, monthsOut),
      impact: { base: { fte: baseFte, time: baseTime }, stretch: { fte: round1(baseFte * (1.2 + r() * 0.5)), time: round1(baseTime * (1.2 + r() * 0.5)) } },
      metrics: labels.map((label, xi) => {
        const base = int(r, 60, 92);
        const stretch = Math.min(99, base + int(r, 3, 10));
        // Shipped milestones mostly clear a gate; eval milestones sit on either side of it.
        const current = !measurable ? 0 : status === "shipped" ? (r() < 0.8 ? int(r, base, 99) : int(r, base - 8, base - 1)) : r() < 0.5 ? int(r, Math.max(1, base - 12), base - 1) : int(r, base, 99);
        return { id: slug(label).slice(0, 12) || `m${xi + 1}`, label, base, stretch, current: Math.max(0, current) };
      }),
    };
  });
};

const governance = (r: () => number, template: ProjectTemplate, stage: (typeof STAGES)[number], members: TeamMember[], asOf: string): GovernanceItem[] => {
  const inst = instantiateTemplate(template, ymOf(asOf), members[0]?.ini ?? "ME");
  return inst.governance.map((g): GovernanceItem => {
    const status = govStatusFor(r, stage);
    const owner = pick(r, members).ini;
    const dated = status === "approved" || status === "in_review" || status === "draft";
    return { ...g, cat: g.cat === DEPENDENCY_CATEGORY ? g.cat : pick(r, CATEGORIES.includes(g.cat) ? [g.cat] : CATEGORIES), status, owner, date: dated ? iso(asOf, int(r, 24, 24 * 200)).slice(0, 10) : null, detail: g.detail };
  });
};

const releases = (r: () => number, ms: Milestone[], gov: GovernanceItem[], todayYm: string): Release[] => {
  const n = Math.min(int(r, 1, 3), ms.length);
  const perRelease = Math.ceil(ms.length / n);
  const names = [...REL_NAMES].sort(() => r() - 0.5);
  return Array.from({ length: n }, (_, i): Release => {
    const mine = ms.slice(i * perRelease, (i + 1) * perRelease);
    const last = mine[mine.length - 1] ?? ms[ms.length - 1]!;
    const month = last.month >= todayYm ? addMonths(last.month, int(r, 0, 1)) : last.month;
    const criteria: Release["criteria"] = mine.slice(0, 2).map((m) => ({ type: "gate", ms: m.id, label: `${m.name} base gate` }));
    for (const g of [...gov].sort(() => r() - 0.5).slice(0, int(r, 1, 3))) criteria.push({ type: "gov", gid: g.id, label: `${g.name} approved` });
    if (r() < 0.6) criteria.push({ type: "manual", ok: r() < 0.5, label: pick(r, ["Cohort confirmed", "Training session held", "Staffing plan agreed", "Fallback rehearsed"]) });
    return { id: `R${i + 1}`, name: names[i] ?? `Release ${i + 1}`, month, milestoneIds: mine.map((m) => m.id), criteria };
  });
};

const dev = (r: () => number, p: Project, asOf: string): DevFacts => {
  const repos: RepoStat[] = p.repos.map((repo) => ({ repo: repo.name, branch: "main", lang: pick(r, LANGS), coverage: r() < 0.85 ? int(r, 45, 96) : null, quality: r() < 0.8 ? pick(r, ["A", "A−", "B+", "B", "C"]) : null, measuredAt: asOf }));
  const prs: PullRequest[] = [];
  const builds: Build[] = [];
  const commits: CommitDay[] = [];
  let number = int(r, 20, 400);
  for (const repo of repos) {
    for (let i = 0; i < int(r, 1, 6); i++) {
      number += int(r, 1, 4);
      const merged = r() < 0.6;
      const hoursAgo = int(r, 1, 24 * 40);
      const openedAt = iso(asOf, hoursAgo + (merged ? int(r, 2, 40) : 0));
      const mergedAt = merged ? iso(asOf, hoursAgo) : null;
      prs.push({ repo: repo.repo, number, title: `${pick(r, ["Add", "Fix", "Refactor", "Tune", "Document"])} ${pick(r, ["retry policy", "eval report", "schema check", "confidence threshold", "batch parser", "drift alert", "review queue"])}`, author: pick(r, p.team).ini, status: merged ? "merged" : "open", checks: merged ? "pass" : pick(r, ["pass", "fail", "running"]), add: int(r, 5, 900), del: int(r, 0, 300), openedAt, mergedAt, updatedAt: mergedAt ?? openedAt, reviewers: [pick(r, p.team).ini], url: `https://github.com/org/${repo.repo}/pull/${number}` });
    }
    for (let i = 0; i < int(r, 2, 6); i++) {
      const kind = pick(r, ["ci", "ci", "deploy", "eval"] as const);
      const status = r() < 0.8 ? "pass" : "fail";
      builds.push({ repo: repo.repo, id: `#${int(r, 100, 2000)}`, branch: r() < 0.7 ? "main" : `pr/${number}`, kind, status, note: status === "fail" ? pick(r, ["3 test failures", "timeout in fixtures", "schema mismatch"]) : kind === "deploy" ? "deploy → staging" : kind === "eval" ? "nightly eval run · gates green" : "unit + integration", startedAt: iso(asOf, int(r, 1, 24 * 30)), durationS: int(r, 60, 2000), url: null });
    }
    const end = new Date(asOf);
    end.setUTCHours(0, 0, 0, 0);
    for (let d = 55; d >= 0; d--) {
      const date = new Date(end.getTime() - d * DAY);
      const dow = date.getUTCDay();
      if (dow === 0 || dow === 6 || r() < 0.35) continue;
      commits.push({ repo: repo.repo, day: date.toISOString().slice(0, 10), author: pick(r, p.team).ini, count: int(r, 1, 6) });
    }
  }
  return sortDevFacts({ repos, prs, builds, commits, lastSync: { source: "synthetic", startedAt: asOf, finishedAt: asOf, ok: true, message: `${repos.length} repos` } });
};

/** A charter-style document describing a project, as a person might have written it before setup. */
export const syntheticCharter = (p: Project, rels: Release[]): string =>
  [
    `# ${p.name} — project charter`,
    "",
    "This is a synthetic document generated for testing. It contains no real people, customers, or systems.",
    "",
    `Sponsor: ${p.team[0]?.name ?? "Unknown"}. ${p.team.slice(1).map((t) => `${t.role}: ${t.name}`).join(". ")}.`,
    `Stage: ${p.stage}. Risk tier: ${p.tier ?? "undetermined"}. ${p.committee ? `AI committee approval ${p.committee.date} (${p.committee.ref}).` : "No committee approval has been granted."}`,
    "",
    p.description,
    "",
    `Targets: reduce manual effort by ${p.targets.fte}% and time by ${p.targets.time}%. These are goals, not observed benefits.`,
    "",
    ...p.milestones.map((m, i) => `Milestone ${i + 1}: ${m.name}, planned for ${m.month}, currently ${m.status}. Base impact: ${m.impact.base.fte}% effort and ${m.impact.base.time}% time; stretch: ${m.impact.stretch.fte}% effort and ${m.impact.stretch.time}% time. ${m.metrics.map((x) => `Evaluation metric: ${x.label}, base gate ${x.base}%, stretch ${x.stretch}%.`).join(" ")}`),
    "",
    `Governance: ${p.governance.map((g) => `${g.name} ${g.status.replace("_", " ")}, owner ${p.team.find((t) => t.ini === g.owner)?.name ?? g.owner}`).join("; ")}.`,
    "",
    ...rels.map((r) => `Release: ${r.name}, ${r.month}. Criteria: ${r.criteria.map((c) => c.label).join("; ")}.`),
  ].join("\n");

/** Generate a whole workspace. Deterministic for a given seed and options. */
export const syntheticState = (options: SyntheticOptions = {}): SyntheticWorkspace => {
  const seed = options.seed ?? 1;
  const count = Math.max(1, Math.min(40, options.projects ?? 6));
  const asOf = options.asOf ?? "2026-09-10T09:00:00.000Z";
  const todayYm = ymOf(asOf);
  const templates = options.templates?.length ? options.templates : BUILTIN_TEMPLATES;
  const r = prng(seed);
  const owner: TeamMember = { ini: WORKSPACE.user.ini, name: WORKSPACE.user.name, role: "Portfolio Lead" };
  const usedIds = new Set<string>();
  const projects: Project[] = [];
  const rels: Record<string, Release[]> = {};
  const devFacts: Record<string, DevFacts> = {};
  const events: Event[] = [];
  const calendar: CalendarEvent[] = [];
  for (let i = 0; i < count; i++) {
    const stage = STAGES[i % STAGES.length]!;
    const tier: RiskTier | null = r() < 0.12 ? null : (int(r, 1, 3) as RiskTier);
    const template = templates.find((t) => t.tier === tier) ?? pick(r, templates);
    let name = `${pick(r, DOMAINS)} ${pick(r, SHAPES)}`;
    let id = slug(name);
    let n = 2;
    while (usedIds.has(id)) {
      name = `${name.replace(/ \d+$/, "")} ${n}`;
      id = `${slug(name.replace(/ \d+$/, ""))}-${n}`;
      n += 1;
    }
    usedIds.add(id);
    const members = team(r, owner);
    const targets = { fte: int(r, 10, 50), time: int(r, 15, 65) };
    const ms = milestones(r, stage, todayYm, targets);
    const gov = governance(r, template, stage, members, asOf);
    const approved = stage !== "Discovery" && r() < 0.8;
    const project: Project = {
      id,
      key: `PRJ-${100 + i + 1}`,
      name,
      stage,
      description: `${name}: ${pick(r, ["drafts", "classifies", "extracts", "summarises", "routes"])} ${pick(r, ["incoming requests", "supplier documents", "internal records", "customer contracts", "operational reports"])} for ${pick(r, ["a reviewer", "the operations team", "domain experts", "the service desk"])} to approve. ${pick(r, ["Nothing is sent or changed without a person.", "Every output is reviewed before it takes effect.", "A manual fallback remains available at all times."])}`,
      tier,
      committee: approved ? { date: iso(asOf, int(r, 24 * 30, 24 * 300)).slice(0, 10), ref: `AIC-${todayYm.slice(0, 4)}-${String(int(r, 1, 199)).padStart(3, "0")}` } : null,
      repos: Array.from({ length: int(r, 0, 3) }, (_, ri) => ({ name: `${id.split("-")[0]}-${pick(r, ["svc", "evals", "pipeline", "ui", "schema"])}-${ri + 1}`, url: `github.com/org/${id.split("-")[0]}-${ri + 1}` })),
      team: members,
      targets,
      milestones: ms,
      governance: gov,
      template: { id: template.id, version: 1 },
    };
    projects.push(project);
    rels[id] = releases(r, ms, gov, todayYm);
    if (project.repos.length) devFacts[id] = dev(r, project, asOf);
    // A few hand-written events and dated items per project, recent first.
    for (let e = 0; e < int(r, 1, 3); e++) {
      const m = pick(r, ms);
      events.push({ ref: `synthetic:${id}:${e}`, at: iso(asOf, int(r, 2, 24 * 20)), type: pick(r, ["eval", "gov", "ship"] as const), proj: id, tab: pick(r, ["value", "governance", "roadmap"] as const), text: `${m.name}: ${pick(r, ["nightly eval recorded", "review round completed", "scope confirmed with the sponsor", "entered evaluation"])}` });
    }
    if (r() < 0.7) calendar.push({ id: `${id}-review-${i}`, date: new Date(new Date(asOf).getTime() + int(r, 2, 60) * DAY).toISOString().slice(0, 10), proj: id, tab: "governance", text: pick(r, ["Steering review", "Committee re-review", "Gate review with domain experts", "Pilot retrospective"]), sub: r() < 0.5 ? "Synthetic calendar entry" : null });
  }
  const derived = Object.entries(devFacts).flatMap(([pid, facts]) => deriveDevEvents(pid, facts, asOf));
  const rules: Rule[] = RULES(asOf).filter((rule) => rule.proj === null);
  return {
    asOf,
    syncSource: "synthetic",
    workspace: { ...WORKSPACE },
    projects,
    releases: rels,
    dev: devFacts,
    agents: AGENTS,
    runs: RUNS(asOf).filter((run) => run.proj !== null && projects.some((p) => p.id === run.proj)),
    llm: null,
    proposals: [],
    scores: [],
    rules,
    promptVersions: [],
    brief: null,
    projectBriefs: {},
    budgets: [],
    events: sortEvents([...events, ...derived]),
    calendar: calendar.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    templates,
    synthetic: { seed, projects: count, asOf },
  };
};
