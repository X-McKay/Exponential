import type { Database } from "bun:sqlite";
import { AGENTS, BUILTIN_TEMPLATES, CALENDAR, DEV, PROJECTS, RELEASES, RULES, RUNS, SEED_ASOF, WORKSPACE, addMonths, isMeasurable, monthsBetween, seedEvents, ymOf } from "@valueflow/domain";
import { insertProposal, insertRule, insertRun, loadState, recordEvent, replaceDevFacts, setAgents, setTemplates } from "./repo.ts";
import { registerProposalGuard } from "./proposal-guard.ts";
import { nextStoredProposalId, nextStoredRunId } from "./ids.ts";
import type { AgentRun, AppState, Metric, Proposal, ProposalAction, ProposalEvidence } from "@valueflow/domain";

/** The neutral profile a fresh workspace starts with. */
export const DEFAULT_OWNER = { name: "Workspace owner", ini: "ME" } as const;

/** The instant the fixtures describe. Seeding at another time shifts every planned month and timestamp by the same offset. */
export const SEED_NOW = new Date(SEED_ASOF);
export const READINGS_PER_METRIC = 30;
const TRAILING_DAYS = 56;

/** Deterministic pseudo-random in [0, 1), same generator the mockup used. */
export const rnd = (seed: number): number => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const hash = (s: string): number => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return h;
};

/**
 * A trajectory shaped like the mockup's eval scatter: starts ~32pts under the
 * latest value, converges with a t^0.75 curve, noise decays toward the end,
 * and the final reading is exactly `current`.
 */
export const trajectory = (metric: Pick<Metric, "current">, seed: number, n = READINGS_PER_METRIC): number[] => {
  const start = Math.max(10, metric.current - 32);
  return Array.from({ length: n }, (_, i) => {
    if (i === n - 1) return metric.current;
    const t = i / (n - 1);
    const trend = start + (metric.current - start) * Math.pow(t, 0.75);
    const noise = (rnd(seed * 100 + i) - 0.5) * 14 * (1 - t * 0.55);
    return Math.round(Math.max(2, Math.min(99, trend + noise)) * 10) / 10;
  });
};

const hasProjects = (db: Database): boolean =>
  (db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM projects").get()?.n ?? 0) > 0;

export const fixtureState = (asOf = SEED_ASOF): AppState => ({ asOf, syncSource: null, workspace: WORKSPACE, projects: PROJECTS, releases: RELEASES, dev: DEV(asOf), agents: AGENTS, runs: RUNS(asOf), llm: null, proposals: [], scores: [], rules: RULES(asOf), promptVersions: [], brief: null, projectBriefs: {}, budgets: [], events: seedEvents(asOf), calendar: CALENDAR(asOf), templates: BUILTIN_TEMPLATES });

export const seed = (db: Database, state: AppState = fixtureState(), now = SEED_NOW): void => {
  // Planned months are relative to the fixtures' own "today"; keep them the same distance from `now`.
  const shift = monthsBetween(ymOf(state.asOf), ymOf(now));
  const ym = (m: string): string => (shift === 0 ? m : addMonths(m, shift));
  const q = {
    project: db.query("INSERT INTO projects (id, key, name, stage, description, tier, committee_date, committee_ref, target_fte, target_time, sort, template_id, template_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"),
    repo: db.query("INSERT INTO project_repos (project_id, name, url, sort) VALUES (?,?,?,?)"),
    member: db.query("INSERT INTO team_members (project_id, ini, name, role, sort) VALUES (?,?,?,?,?)"),
    milestone: db.query("INSERT INTO milestones (project_id, id, name, status, month, base_fte, base_time, stretch_fte, stretch_time, sort, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"),
    metric: db.query("INSERT INTO metrics (project_id, milestone_id, id, label, base, stretch, sort) VALUES (?,?,?,?,?,?,?)"),
    snapshot: db.query("INSERT INTO milestone_snapshots (project_id, milestone_id, at, status, month, base_fte, base_time, stretch_fte, stretch_time, metrics) VALUES (?,?,?,?,?,?,?,?,?,?)"),
    reading: db.query("INSERT INTO metric_readings (project_id, milestone_id, metric_id, value, recorded_at, source) VALUES (?,?,?,?,?,?)"),
    gov: db.query("INSERT INTO governance_items (project_id, id, cat, name, status, owner, date, detail, link, sort) VALUES (?,?,?,?,?,?,?,?,?,?)"),
    release: db.query("INSERT INTO releases (project_id, id, name, month, sort) VALUES (?,?,?,?,?)"),
    relMs: db.query("INSERT INTO release_milestones (project_id, release_id, milestone_id, sort) VALUES (?,?,?,?)"),
    crit: db.query("INSERT INTO release_criteria (project_id, release_id, sort, type, milestone_id, governance_id, ok, label) VALUES (?,?,?,?,?,?,?,?)"),
    calendar: db.query("INSERT INTO calendar_events (id, date, project_id, tab, text, sub) VALUES (?,?,?,?,?,?)"),
    workspace: db.query("INSERT OR REPLACE INTO workspace (id, user_name, user_ini) VALUES (1, ?, ?)"),
  };

  db.transaction(() => {
    q.workspace.run(state.workspace.user.name, state.workspace.user.ini);
    state.projects.forEach((p, pi) => {
      q.project.run(p.id, p.key, p.name, p.stage, p.description, p.tier, p.committee?.date ?? null, p.committee?.ref ?? null, p.targets.fte, p.targets.time, pi, p.template?.id ?? null, p.template?.version ?? null);
      p.repos.forEach((r, i) => q.repo.run(p.id, r.name, r.url, i));
      p.team.forEach((t, i) => q.member.run(p.id, t.ini, t.name, t.role, i));
      p.milestones.forEach((m, mi) => {
        q.milestone.run(p.id, m.id, m.name, m.status, ym(m.month), m.impact.base.fte, m.impact.base.time, m.impact.stretch.fte, m.impact.stretch.time, mi, now.toISOString());
        m.metrics.forEach((x, xi) => {
          q.metric.run(p.id, m.id, x.id, x.label, x.base, x.stretch, xi);
          if (!isMeasurable(m) || x.current <= 0) return;
          const values = trajectory(x, hash(`${p.id}/${m.id}/${x.id}`));
          values.forEach((v, i) => {
            const t = i / (values.length - 1);
            const at = new Date(now.getTime() - (1 - t) * TRAILING_DAYS * 86_400_000);
            q.reading.run(p.id, m.id, x.id, v, at.toISOString(), "eval");
          });
        });
        q.snapshot.run(
          p.id,
          m.id,
          now.toISOString(),
          m.status,
          ym(m.month),
          m.impact.base.fte,
          m.impact.base.time,
          m.impact.stretch.fte,
          m.impact.stretch.time,
          JSON.stringify(m.metrics.map((x) => ({ ...x, readAt: isMeasurable(m) && x.current > 0 ? now.toISOString() : null, readSource: isMeasurable(m) && x.current > 0 ? "eval" : null }))),
        );
      });
      p.governance.forEach((g, i) => q.gov.run(p.id, g.id, g.cat, g.name, g.status, g.owner, g.date, g.detail, g.link ?? null, i));
      (state.releases[p.id] ?? []).forEach((r, ri) => {
        q.release.run(p.id, r.id, r.name, ym(r.month), ri);
        r.milestoneIds.forEach((mid, i) => q.relMs.run(p.id, r.id, mid, i));
        r.criteria.forEach((c, i) => {
          switch (c.type) {
            case "gate":
              q.crit.run(p.id, r.id, i, "gate", c.ms, null, null, c.label);
              break;
            case "gov":
              q.crit.run(p.id, r.id, i, "gov", null, c.gid, null, c.label);
              break;
            case "manual":
              q.crit.run(p.id, r.id, i, "manual", null, null, c.ok ? 1 : 0, c.label);
              break;
          }
        });
      });
    });
    // Development facts, as the sample source would have synced them at `now`.
    for (const p of state.projects) {
      const d = state.dev[p.id];
      if (d) replaceDevFacts(db, p.id, d, d.lastSync ?? { source: "sample", startedAt: now.toISOString(), finishedAt: now.toISOString(), ok: true, message: "seeded" });
    }
    setAgents(db, state.agents);
    setTemplates(db, state.templates ?? BUILTIN_TEMPLATES, now);
    for (const r of state.rules) insertRule(db, r);
    for (const r of state.runs) insertRun(db, r);
    for (const e of state.events) recordEvent(db, e);
    for (const c of state.calendar) q.calendar.run(c.id, c.date, c.proj, c.tab, c.text, c.sub);
  })();
};

/**
 * Stage a few pending proposals against the seeded facts so the inbox has
 * something to decide: one status nudge, one calendar reminder, and one
 * record edit per project that has room for it. Each is attributed to a
 * finished setup run and guarded like a real proposal, so accepting it goes
 * through the normal path. Demo and test data only.
 */
export const seedProposals = (db: Database, now = SEED_NOW): Proposal[] => {
  const state = loadState(db, now);
  const setup = state.agents.find((a) => a.kind === "setup");
  if (!setup) return [];
  const out: Proposal[] = [];
  const at = now.toISOString();
  for (const p of state.projects) {
    const actions: { action: ProposalAction; rationale: string; evidence: ProposalEvidence }[] = [];
    const charter = `${p.key.toLowerCase()}-charter-v2.md`;
    const cite = (quote: string, verified = true): ProposalEvidence => ({ source: charter, quote, verified });
    const inReview = p.governance.find((g) => g.status === "in_review");
    if (inReview) actions.push({ action: { type: "governance_status", gid: inReview.id, status: "approved" }, rationale: `Seeded example: the latest notes describe ${inReview.name} as signed off.`, evidence: cite(`${inReview.name} was signed off at the last steering review and no further changes are expected.`) });
    const backlog = p.milestones.find((m) => m.status === "backlog");
    if (backlog) actions.push({ action: { type: "milestone_update", mid: backlog.id, month: addMonths(backlog.month, 1) }, rationale: `Seeded example: the revised plan moves ${backlog.name} out by a month.`, evidence: cite(`${backlog.name} now targets ${addMonths(backlog.month, 1)} to leave room for the evaluation rerun.`) });
    if (p.team.length < 6) actions.push({ action: { type: "team_member", ini: "QA", name: "Quinn Abara", role: "Quality Analyst" }, rationale: "Seeded example: the revised charter names a quality analyst.", evidence: cite("Quinn Abara joins the team as Quality Analyst from the next sprint.") });
    actions.push({ action: { type: "calendar_event", date: new Date(now.getTime() + 14 * 86_400_000).toISOString().slice(0, 10), tab: "overview", text: `${p.name}: steering review`, sub: "Seeded example" }, rationale: "Seeded example: a steering review is due in two weeks.", evidence: cite("The steering committee reconvenes in two weeks to review progress.", false) });
    if (actions.length === 0) continue;
    const run: AgentRun = {
      id: nextStoredRunId(db), agentId: setup.id, proj: p.id, tab: "overview", state: "done", startedAt: at, finishedAt: at, instruction: null,
      summary: `Staged ${actions.length} change${actions.length === 1 ? "" : "s"} from 1 document: seeded charter revision`, output: `## Seeded update\n\n${actions.map((a) => `- ${a.rationale}`).join("\n")}`,
      model: "seed", error: null, promptVersion: null, latencyMs: 1200, promptTokens: null, completionTokens: null, benchmark: null, rating: null, ratingNote: null,
    };
    insertRun(db, run);
    db.transaction(() => {
      for (const a of actions) {
        const proposal: Proposal = { id: nextStoredProposalId(db), runId: run.id, agentId: setup.id, proj: p.id, ruleId: null, action: a.action, rationale: a.rationale, state: "pending", createdAt: at, decidedAt: null, evidence: a.evidence };
        insertProposal(db, proposal);
        registerProposalGuard(db, proposal, state);
        out.push(proposal);
      }
    })();
  }
  return out;
};

/** Install the default agent definitions when none exist, and add built-in kinds older databases lack; returns the ids added. */
export const ensureAgents = (db: Database): string[] => {
  if ((db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM agents").get()?.n ?? 0) === 0) {
    setAgents(db, AGENTS);
    return AGENTS.map((a) => a.id);
  }
  const have = new Set(db.query<{ kind: string }, []>("SELECT kind FROM agents").all().map((r) => r.kind));
  const added: string[] = [];
  for (const a of AGENTS) {
    if (a.id === "project-manager" ? !!db.query("SELECT id FROM agents WHERE id = ?").get(a.id) : have.has(a.kind) || !["chat", "rules", "brief", "tuner", "scout", "curator", "setup"].includes(a.kind)) continue;
    const sort = db.query<{ s: number }, []>("SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM agents").get()?.s ?? 0;
    db.query("INSERT INTO agents (id, sort, name, grad, purpose, kind, model, owner, caps, schedule, prompt) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(a.id, sort, a.name, a.grad, a.purpose, a.kind, a.model, a.owner, JSON.stringify(a.caps), a.schedule, a.prompt);
    added.push(a.id);
  }
  return added;
};

/** Install the built-in templates when a workspace has none; returns how many were added. */
export const ensureTemplates = (db: Database, now = new Date()): number => {
  if ((db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM project_templates").get()?.n ?? 0) > 0) return 0;
  setTemplates(db, BUILTIN_TEMPLATES, now);
  return BUILTIN_TEMPLATES.length;
};

/** Release initialization never creates sample projects or evidence. Safe after deleting the last project. */
export const initializeWorkspace = (db: Database, now = new Date()): void => {
  db.transaction(() => {
    const members = db.query<{ n: number }, []>("SELECT COUNT(*) n FROM workspace_members").get()?.n ?? 0;
    if (!members) {
      const populated = hasProjects(db);
      const old = db.query<{ user_name: string; user_ini: string }, []>("SELECT user_name,user_ini FROM workspace WHERE id=1").get();
      // A workspace with projects, or one whose profile was customised, keeps it; an untouched empty one restarts from the neutral owner.
      const preserveProfile = old && (populated || old.user_name !== DEFAULT_OWNER.name || old.user_ini !== DEFAULT_OWNER.ini);
      const name = preserveProfile ? old.user_name : DEFAULT_OWNER.name;
      const ini = preserveProfile ? old.user_ini : DEFAULT_OWNER.ini;
      db.query("INSERT INTO workspace_members (id,name,ini,role) VALUES ('owner',?,?,'admin')").run(name, ini);
      db.query("UPDATE workspace SET user_name=?,user_ini=? WHERE id=1").run(name, ini);
    }
    const added = ensureAgents(db);
    ensureTemplates(db, now);
    const owner = db.query<{ ini: string }, []>("SELECT ini FROM workspace_members ORDER BY rowid LIMIT 1").get();
    for (const id of added) db.query("UPDATE agents SET owner=? WHERE id=?").run(owner?.ini ?? "ME", id);
  })();
};
