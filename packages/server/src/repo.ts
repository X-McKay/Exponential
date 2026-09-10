// ================= data access =================
//
// Reads assemble facts into domain objects. Writes persist facts. No derived
// value is read or written here.

import type { Database } from "bun:sqlite";
import { EVENT_WINDOW_DAYS, GSTATUS_LABEL, RUN_WINDOW_DAYS, deriveDevEvents } from "@valueflow/domain";
import type {
  Agent,
  AgentRun,
  AppState,
  Proposal,
  ProposalAction,
  SetupDraft,
  Build,
  CalendarEvent,
  Criterion,
  DevFacts,
  Event,
  GovernanceItem,
  Metric,
  MetricReading,
  Milestone,
  MilestoneStatus,
  Project,
  PullRequest,
  Release,
  RiskTier,
  SyncRun,
  Workspace,
} from "@valueflow/domain";
import type {
  AgentsInput,
  CalendarEventInput,
  GovernanceInput,
  GovernanceItemInput,
  MilestoneInput,
  ProjectInput,
  ReleaseInput,
  TargetsInput,
  WorkspaceInput,
} from "@valueflow/shared";

export class NotFound extends Error {
  override name = "NotFound";
}
export class Conflict extends Error {
  override name = "Conflict";
}

interface ProjectRow {
  id: string;
  key: string;
  name: string;
  stage: string;
  description: string;
  tier: number | null;
  committee_date: string | null;
  committee_ref: string | null;
  target_fte: number;
  target_time: number;
}
interface RepoRow {
  project_id: string;
  name: string;
  url: string;
}
interface MemberRow {
  project_id: string;
  ini: string;
  name: string;
  role: string;
}
interface MilestoneRow {
  project_id: string;
  id: string;
  name: string;
  status: MilestoneStatus;
  month: string;
  base_fte: number;
  base_time: number;
  stretch_fte: number;
  stretch_time: number;
}
interface MetricRow {
  project_id: string;
  milestone_id: string;
  id: string;
  label: string;
  base: number;
  stretch: number;
}
interface LatestRow {
  project_id: string;
  milestone_id: string;
  metric_id: string;
  value: number;
}
interface GovRow {
  project_id: string;
  id: string;
  cat: string;
  name: string;
  status: GovernanceItem["status"];
  owner: string;
  date: string | null;
  detail: string;
  link: string | null;
}
interface ReleaseRow {
  project_id: string;
  id: string;
  name: string;
  month: string;
}
interface RelMsRow {
  project_id: string;
  release_id: string;
  milestone_id: string;
}
interface CritRow {
  project_id: string;
  release_id: string;
  type: "gate" | "gov" | "manual";
  milestone_id: string | null;
  governance_id: string | null;
  ok: number | null;
  label: string;
}
interface AgentRow {
  id: string;
  name: string;
  grad: string;
  purpose: string;
  kind: Agent["kind"];
  model: string | null;
  owner: string;
  caps: string;
  schedule: Agent["schedule"];
}
interface ProposalRow {
  id: string;
  run_id: string;
  agent_id: string;
  project_id: string;
  action: string;
  rationale: string;
  state: Proposal["state"];
  created_at: string;
  decided_at: string | null;
}
interface RunRow {
  id: string;
  agent_id: string;
  project_id: string;
  tab: AgentRun["tab"];
  state: AgentRun["state"];
  started_at: string;
  finished_at: string | null;
  instruction: string | null;
  summary: string;
  output: string;
  model: string | null;
  error: string | null;
}
interface WorkspaceRow {
  user_name: string;
  user_ini: string;
}
interface EventRow {
  ref: string;
  at: string;
  type: Event["type"];
  project_id: string;
  tab: Event["tab"];
  text: string;
}
interface CalendarRow {
  id: string;
  date: string;
  project_id: string;
  tab: CalendarEvent["tab"];
  text: string;
  sub: string | null;
}
interface RepoStatRow {
  project_id: string;
  repo: string;
  branch: string;
  lang: string | null;
  coverage: number | null;
  quality: string | null;
  measured_at: string;
}
interface PrRow {
  project_id: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  status: PullRequest["status"];
  checks: PullRequest["checks"];
  additions: number;
  deletions: number;
  opened_at: string;
  merged_at: string | null;
  updated_at: string;
  reviewers: string;
  url: string | null;
}
interface BuildRow {
  project_id: string;
  repo: string;
  id: string;
  branch: string;
  kind: Build["kind"];
  status: Build["status"];
  note: string;
  started_at: string;
  duration_s: number;
  url: string | null;
}
interface CommitRow {
  project_id: string;
  repo: string;
  day: string;
  author: string;
  count: number;
}
interface SyncRow {
  project_id: string;
  source: string;
  started_at: string;
  finished_at: string;
  ok: number;
  message: string;
}
interface ReadingRow {
  project_id: string;
  milestone_id: string;
  metric_id: string;
  value: number;
  recorded_at: string;
  source: "eval" | "manual";
}

const LATEST_SQL = `
  SELECT r.project_id, r.milestone_id, r.metric_id, r.value
  FROM metric_readings r
  WHERE r.seq = (
    SELECT r2.seq FROM metric_readings r2
    WHERE r2.project_id = r.project_id AND r2.milestone_id = r.milestone_id AND r2.metric_id = r.metric_id
    ORDER BY r2.recorded_at DESC, r2.seq DESC LIMIT 1
  )`;

const key3 = (a: string, b: string, c: string): string => `${a} ${b} ${c}`;

const asTier = (t: number | null): RiskTier | null => (t === 1 || t === 2 || t === 3 ? t : null);

const groupBy = <T>(rows: T[], k: (r: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const list = m.get(k(r));
    if (list) list.push(r);
    else m.set(k(r), [r]);
  }
  return m;
};

const toCriterion = (c: CritRow): Criterion => {
  switch (c.type) {
    case "gate":
      return { type: "gate", ms: c.milestone_id ?? "", label: c.label };
    case "gov":
      return { type: "gov", gid: c.governance_id ?? "", label: c.label };
    case "manual":
      return { type: "manual", ok: c.ok === 1, label: c.label };
  }
};

export const loadState = (db: Database, now: Date = new Date()): AppState => {
  const projects = db.query<ProjectRow, []>("SELECT * FROM projects ORDER BY sort").all();
  const repos = groupBy(db.query<RepoRow, []>("SELECT * FROM project_repos ORDER BY sort").all(), (r) => r.project_id);
  const members = groupBy(db.query<MemberRow, []>("SELECT * FROM team_members ORDER BY sort").all(), (r) => r.project_id);
  const milestones = groupBy(db.query<MilestoneRow, []>("SELECT * FROM milestones ORDER BY sort").all(), (r) => r.project_id);
  const metrics = groupBy(db.query<MetricRow, []>("SELECT * FROM metrics ORDER BY sort").all(), (r) => `${r.project_id} ${r.milestone_id}`);
  const latest = new Map(db.query<LatestRow, []>(LATEST_SQL).all().map((r) => [key3(r.project_id, r.milestone_id, r.metric_id), r.value]));
  const gov = groupBy(db.query<GovRow, []>("SELECT * FROM governance_items ORDER BY sort").all(), (r) => r.project_id);
  const releases = groupBy(db.query<ReleaseRow, []>("SELECT * FROM releases ORDER BY sort").all(), (r) => r.project_id);
  const relMs = groupBy(db.query<RelMsRow, []>("SELECT * FROM release_milestones ORDER BY sort").all(), (r) => `${r.project_id} ${r.release_id}`);
  const crits = groupBy(db.query<CritRow, []>("SELECT * FROM release_criteria ORDER BY sort").all(), (r) => `${r.project_id} ${r.release_id}`);
  const dev = loadDevFacts(db);

  const out: AppState = {
    asOf: now.toISOString(),
    syncSource: null,
    workspace: loadWorkspace(db),
    projects: [],
    releases: {},
    dev: {},
    agents: loadAgents(db),
    runs: loadRuns(db, now),
    llm: null,
    proposals: loadProposals(db, now),
    events: loadEvents(db, now),
    calendar: loadCalendar(db),
  };
  for (const p of projects) {
    const ms: Milestone[] = (milestones.get(p.id) ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      status: m.status,
      month: m.month,
      impact: { base: { fte: m.base_fte, time: m.base_time }, stretch: { fte: m.stretch_fte, time: m.stretch_time } },
      metrics: (metrics.get(`${p.id} ${m.id}`) ?? []).map(
        (x): Metric => ({ id: x.id, label: x.label, base: x.base, stretch: x.stretch, current: latest.get(key3(p.id, m.id, x.id)) ?? 0 }),
      ),
    }));
    const project: Project = {
      id: p.id,
      key: p.key,
      name: p.name,
      stage: p.stage,
      description: p.description,
      tier: asTier(p.tier),
      committee: p.committee_date && p.committee_ref ? { date: p.committee_date, ref: p.committee_ref } : null,
      repos: (repos.get(p.id) ?? []).map((r) => ({ name: r.name, url: r.url })),
      team: (members.get(p.id) ?? []).map((t) => ({ ini: t.ini, name: t.name, role: t.role })),
      targets: { fte: p.target_fte, time: p.target_time },
      milestones: ms,
      governance: (gov.get(p.id) ?? []).map(
        (g): GovernanceItem => ({
          cat: g.cat,
          id: g.id,
          name: g.name,
          status: g.status,
          owner: g.owner,
          date: g.date,
          detail: g.detail,
          ...(g.link ? { link: g.link } : {}),
        }),
      ),
    };
    out.projects.push(project);
    out.releases[p.id] = (releases.get(p.id) ?? []).map(
      (r): Release => ({
        id: r.id,
        name: r.name,
        month: r.month,
        milestoneIds: (relMs.get(`${p.id} ${r.id}`) ?? []).map((x) => x.milestone_id),
        criteria: (crits.get(`${p.id} ${r.id}`) ?? []).map(toCriterion),
      }),
    );
    const d = dev.get(p.id);
    if (d) out.dev[p.id] = d;
  }
  return out;
};

// ---- agents & runs -------------------------------------------------------

export const loadAgents = (db: Database): Agent[] =>
  db
    .query<AgentRow, []>("SELECT * FROM agents ORDER BY sort")
    .all()
    .map((r) => ({ id: r.id, name: r.name, grad: r.grad, purpose: r.purpose, kind: r.kind, model: r.model, owner: r.owner, caps: JSON.parse(r.caps) as string[], schedule: r.schedule }));

const toRun = (r: RunRow): AgentRun => ({
  id: r.id,
  agentId: r.agent_id,
  proj: r.project_id,
  tab: r.tab,
  state: r.state,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  instruction: r.instruction,
  summary: r.summary,
  output: r.output,
  model: r.model,
  error: r.error,
});

export const loadRuns = (db: Database, now: Date, windowDays = RUN_WINDOW_DAYS * 2): AgentRun[] => {
  const since = new Date(now.getTime() - windowDays * 86_400_000).toISOString();
  return db.query<RunRow, [string]>("SELECT * FROM agent_runs WHERE started_at >= ? ORDER BY started_at DESC, id").all(since).map(toRun);
};

export const insertRun = (db: Database, r: AgentRun): void => {
  db.query(
    "INSERT INTO agent_runs (id, agent_id, project_id, tab, state, started_at, finished_at, instruction, summary, output, model, error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(r.id, r.agentId, r.proj, r.tab, r.state, r.startedAt, r.finishedAt, r.instruction, r.summary, r.output, r.model, r.error);
};

/** Pending proposals plus those decided in the trailing window, newest first. */
export const loadProposals = (db: Database, now: Date, windowDays = RUN_WINDOW_DAYS): Proposal[] => {
  const since = new Date(now.getTime() - windowDays * 86_400_000).toISOString();
  return db
    .query<ProposalRow, [string]>("SELECT * FROM proposals WHERE state = 'pending' OR created_at >= ? ORDER BY created_at DESC, id")
    .all(since)
    .map((r) => ({
      id: r.id,
      runId: r.run_id,
      agentId: r.agent_id,
      proj: r.project_id,
      action: JSON.parse(r.action) as ProposalAction,
      rationale: r.rationale,
      state: r.state,
      createdAt: r.created_at,
      decidedAt: r.decided_at,
    }));
};

export const insertProposal = (db: Database, p: Proposal): void => {
  db.query("INSERT INTO proposals (id, run_id, agent_id, project_id, action, rationale, state, created_at, decided_at) VALUES (?,?,?,?,?,?,?,?,?)").run(
    p.id,
    p.runId,
    p.agentId,
    p.proj,
    JSON.stringify(p.action),
    p.rationale,
    p.state,
    p.createdAt,
    p.decidedAt,
  );
};

export const updateProposal = (db: Database, p: Proposal): void => {
  const res = db.query("UPDATE proposals SET state = ?, decided_at = ? WHERE id = ?").run(p.state, p.decidedAt, p.id);
  if (res.changes === 0) throw new NotFound(`proposal ${p.id} not found`);
};

// ---- setup drafts -----------------------------------------------------------

interface DraftRow {
  id: string;
  created_at: string;
  name: string;
  key: string;
  brief: string;
  sources: string;
  source_text: string;
  draft: string;
  feedback: string;
  model: string | null;
}

/** Extracted text kept with the draft so refinement can re-read the documents. */
export interface StoredSourceText {
  name: string;
  kind: SetupDraft["sources"][number]["kind"];
  text: string;
  chars: number;
  error: string | null;
  truncated: boolean;
}

export const insertSetupDraft = (db: Database, d: SetupDraft, texts: StoredSourceText[]): void => {
  db.query("INSERT INTO setup_drafts (id, created_at, name, key, brief, sources, source_text, draft, feedback, model) VALUES (?,?,?,?,?,?,?,?,?,?)").run(
    d.id,
    d.createdAt,
    d.name,
    d.key,
    d.brief,
    JSON.stringify(d.sources),
    JSON.stringify(texts),
    JSON.stringify(d.draft),
    JSON.stringify(d.feedback),
    d.model,
  );
};

export const updateSetupDraft = (db: Database, d: SetupDraft): void => {
  const res = db.query("UPDATE setup_drafts SET draft = ?, feedback = ?, model = ? WHERE id = ?").run(JSON.stringify(d.draft), JSON.stringify(d.feedback), d.model, d.id);
  if (res.changes === 0) throw new NotFound(`setup draft ${d.id} not found`);
};

export const loadSetupDraft = (db: Database, id: string): { draft: SetupDraft; sources: StoredSourceText[] } => {
  const r = db.query<DraftRow, [string]>("SELECT * FROM setup_drafts WHERE id = ?").get(id);
  if (!r) throw new NotFound(`setup draft ${id} not found`);
  return {
    draft: { id: r.id, createdAt: r.created_at, name: r.name, key: r.key, brief: r.brief, sources: JSON.parse(r.sources) as SetupDraft["sources"], draft: JSON.parse(r.draft) as SetupDraft["draft"], feedback: JSON.parse(r.feedback) as string[], model: r.model },
    sources: JSON.parse(r.source_text) as StoredSourceText[],
  };
};

export const deleteSetupDraft = (db: Database, id: string): void => {
  db.query("DELETE FROM setup_drafts WHERE id = ?").run(id);
};

export const updateRun = (db: Database, r: AgentRun): void => {
  const res = db
    .query("UPDATE agent_runs SET state = ?, finished_at = ?, summary = ?, output = ?, model = ?, error = ? WHERE id = ?")
    .run(r.state, r.finishedAt, r.summary, r.output, r.model, r.error, r.id);
  if (res.changes === 0) throw new NotFound(`run ${r.id} not found`);
};

// ---- events & calendar ---------------------------------------------------

export const loadEvents = (db: Database, now: Date, windowDays = EVENT_WINDOW_DAYS): Event[] => {
  const since = new Date(now.getTime() - windowDays * 86_400_000).toISOString();
  return db
    .query<EventRow, [string]>("SELECT * FROM events WHERE at >= ? ORDER BY at DESC, ref")
    .all(since)
    .map((r) => ({ ref: r.ref, at: r.at, type: r.type, proj: r.project_id, tab: r.tab, text: r.text }));
};

/** Append an event; an existing ref is left untouched so re-syncs never duplicate. Returns whether it was new. */
export const recordEvent = (db: Database, e: Event): boolean =>
  db.query("INSERT OR IGNORE INTO events (ref, at, type, project_id, tab, text) VALUES (?,?,?,?,?,?)").run(e.ref, e.at, e.type, e.proj, e.tab, e.text).changes > 0;

/** Record the feed entries a project's development facts imply (merges, failed builds, deploys, eval runs). */
export const recordDevEvents = (db: Database, pid: string, facts: Pick<DevFacts, "prs" | "builds">, now: Date): number => {
  let n = 0;
  for (const e of deriveDevEvents(pid, facts, now.toISOString())) if (recordEvent(db, e)) n += 1;
  return n;
};

export const loadCalendar = (db: Database): CalendarEvent[] =>
  db
    .query<CalendarRow, []>("SELECT * FROM calendar_events ORDER BY date, id")
    .all()
    .map((r) => ({ id: r.id, date: r.date, proj: r.project_id, tab: r.tab, text: r.text, sub: r.sub }));

export const upsertCalendarEvent = (db: Database, input: CalendarEventInput, mode: "create" | "update"): void => {
  if (!projectExists(db, input.proj)) throw new NotFound(`project ${input.proj} not found`);
  const exists = (db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM calendar_events WHERE id = ?").get(input.id)?.n ?? 0) > 0;
  if (mode === "create" && exists) throw new Conflict(`calendar event ${input.id} already exists`);
  if (mode === "update" && !exists) throw new NotFound(`calendar event ${input.id} not found`);
  db.query("INSERT OR REPLACE INTO calendar_events (id, date, project_id, tab, text, sub) VALUES (?,?,?,?,?,?)").run(input.id, input.date, input.proj, input.tab, input.text, input.sub);
};

export const deleteCalendarEvent = (db: Database, id: string): void => {
  const res = db.query("DELETE FROM calendar_events WHERE id = ?").run(id);
  if (res.changes === 0) throw new NotFound(`calendar event ${id} not found`);
};

/** Development facts per project; only projects with at least one synced row or run appear. */
export const loadDevFacts = (db: Database): Map<string, DevFacts> => {
  const out = new Map<string, DevFacts>();
  const get = (pid: string): DevFacts => {
    let f = out.get(pid);
    if (!f) {
      f = { repos: [], prs: [], builds: [], commits: [], lastSync: null };
      out.set(pid, f);
    }
    return f;
  };
  for (const r of db.query<RepoStatRow, []>("SELECT * FROM repo_stats ORDER BY project_id, repo").all())
    get(r.project_id).repos.push({ repo: r.repo, branch: r.branch, lang: r.lang, coverage: r.coverage, quality: r.quality, measuredAt: r.measured_at });
  for (const r of db.query<PrRow, []>("SELECT * FROM pull_requests ORDER BY project_id, updated_at DESC, repo, number").all())
    get(r.project_id).prs.push({
      repo: r.repo,
      number: r.number,
      title: r.title,
      author: r.author,
      status: r.status,
      checks: r.checks,
      add: r.additions,
      del: r.deletions,
      openedAt: r.opened_at,
      mergedAt: r.merged_at,
      updatedAt: r.updated_at,
      reviewers: JSON.parse(r.reviewers) as string[],
      url: r.url,
    });
  for (const r of db.query<BuildRow, []>("SELECT * FROM builds ORDER BY project_id, started_at DESC, repo, id").all())
    get(r.project_id).builds.push({ repo: r.repo, id: r.id, branch: r.branch, kind: r.kind, status: r.status, note: r.note, startedAt: r.started_at, durationS: r.duration_s, url: r.url });
  for (const r of db.query<CommitRow, []>("SELECT * FROM commit_days ORDER BY project_id, repo, day, author").all())
    get(r.project_id).commits.push({ repo: r.repo, day: r.day, author: r.author, count: r.count });
  for (const r of db
    .query<SyncRow, []>("SELECT s.* FROM sync_runs s WHERE s.seq = (SELECT MAX(seq) FROM sync_runs WHERE project_id = s.project_id)")
    .all())
    get(r.project_id).lastSync = { source: r.source, startedAt: r.started_at, finishedAt: r.finished_at, ok: r.ok === 1, message: r.message };
  return out;
};

export const recordSyncRun = (db: Database, pid: string, run: SyncRun): void => {
  db.query("INSERT INTO sync_runs (project_id, source, started_at, finished_at, ok, message) VALUES (?,?,?,?,?,?)").run(
    pid,
    run.source,
    run.startedAt,
    run.finishedAt,
    run.ok ? 1 : 0,
    run.message,
  );
};

/** Replace a project's synced facts wholesale and record the run that produced them. */
export const replaceDevFacts = (db: Database, pid: string, facts: Omit<DevFacts, "lastSync">, run: SyncRun): void => {
  if (!projectExists(db, pid)) throw new NotFound(`project ${pid} not found`);
  db.transaction(() => {
    for (const t of ["repo_stats", "pull_requests", "builds", "commit_days"]) db.query(`DELETE FROM ${t} WHERE project_id = ?`).run(pid);
    const qs = db.query("INSERT INTO repo_stats (project_id, repo, branch, lang, coverage, quality, measured_at) VALUES (?,?,?,?,?,?,?)");
    for (const r of facts.repos) qs.run(pid, r.repo, r.branch, r.lang, r.coverage, r.quality, r.measuredAt);
    const qp = db.query(
      "INSERT OR REPLACE INTO pull_requests (project_id, repo, number, title, author, status, checks, additions, deletions, opened_at, merged_at, updated_at, reviewers, url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (const p of facts.prs) qp.run(pid, p.repo, p.number, p.title, p.author, p.status, p.checks, p.add, p.del, p.openedAt, p.mergedAt, p.updatedAt, JSON.stringify(p.reviewers), p.url);
    const qb = db.query("INSERT OR REPLACE INTO builds (project_id, repo, id, branch, kind, status, note, started_at, duration_s, url) VALUES (?,?,?,?,?,?,?,?,?,?)");
    for (const b of facts.builds) qb.run(pid, b.repo, b.id, b.branch, b.kind, b.status, b.note, b.startedAt, b.durationS, b.url);
    const qc = db.query("INSERT OR REPLACE INTO commit_days (project_id, repo, day, author, count) VALUES (?,?,?,?,?)");
    for (const c of facts.commits) qc.run(pid, c.repo, c.day, c.author, c.count);
    recordSyncRun(db, pid, run);
  })();
};

export const loadWorkspace = (db: Database): Workspace => {
  const w = db.query<WorkspaceRow, []>("SELECT user_name, user_ini FROM workspace WHERE id = 1").get();
  return { user: { name: w?.user_name ?? "You", ini: w?.user_ini ?? "ME" } };
};

export const setWorkspace = (db: Database, w: WorkspaceInput): void => {
  db.query("INSERT OR REPLACE INTO workspace (id, user_name, user_ini) VALUES (1, ?, ?)").run(w.user.name, w.user.ini);
};

export const findProject = (state: AppState, pid: string): Project => {
  const p = state.projects.find((x) => x.id === pid);
  if (!p) throw new NotFound(`project ${pid} not found`);
  return p;
};

export const findMilestone = (state: AppState, pid: string, mid: string): Milestone => {
  const m = findProject(state, pid).milestones.find((x) => x.id === mid);
  if (!m) throw new NotFound(`milestone ${pid}/${mid} not found`);
  return m;
};

// ---- readings -----------------------------------------------------------

const metricExists = (db: Database, pid: string, mid: string, xid: string): boolean =>
  (db.query<{ n: number }, [string, string, string]>("SELECT COUNT(*) AS n FROM metrics WHERE project_id = ? AND milestone_id = ? AND id = ?").get(pid, mid, xid)?.n ?? 0) > 0;

export const listReadings = (db: Database, pid: string, mid: string, xid: string): MetricReading[] => {
  if (!metricExists(db, pid, mid, xid)) throw new NotFound(`metric ${pid}/${mid}/${xid} not found`);
  return db
    .query<ReadingRow, [string, string, string]>(
      "SELECT * FROM metric_readings WHERE project_id = ? AND milestone_id = ? AND metric_id = ? ORDER BY recorded_at, seq",
    )
    .all(pid, mid, xid)
    .map((r) => ({ projectId: r.project_id, milestoneId: r.milestone_id, metricId: r.metric_id, value: r.value, recordedAt: r.recorded_at, source: r.source }));
};

export const recordReading = (
  db: Database,
  pid: string,
  mid: string,
  xid: string,
  value: number,
  source: "eval" | "manual",
  at = new Date(),
): MetricReading => {
  if (!metricExists(db, pid, mid, xid)) throw new NotFound(`metric ${pid}/${mid}/${xid} not found`);
  const recordedAt = at.toISOString();
  db.query("INSERT INTO metric_readings (project_id, milestone_id, metric_id, value, recorded_at, source) VALUES (?,?,?,?,?,?)").run(
    pid,
    mid,
    xid,
    value,
    recordedAt,
    source,
  );
  if (source === "eval") {
    // An eval run is news; a manual reading is the user simulating, not an event.
    const x = db
      .query<{ label: string; base: number; ms: string }, [string, string, string]>(
        "SELECT x.label, x.base, m.name AS ms FROM metrics x JOIN milestones m ON m.project_id = x.project_id AND m.id = x.milestone_id WHERE x.project_id = ? AND x.milestone_id = ? AND x.id = ?",
      )
      .get(pid, mid, xid);
    if (x) {
      const gap = Math.round((x.base - value) * 10) / 10;
      const verdict = gap > 0 ? `${gap}pt${gap === 1 ? "" : "s"} below base gate (${x.base}%)` : `clears base gate (${x.base}%)`;
      recordEvent(db, { ref: `eval:${pid}/${mid}/${xid}:${recordedAt}`, at: recordedAt, type: "eval", proj: pid, tab: "value", text: `Eval: ${x.ms} · ${x.label} at ${value}% — ${verdict}` });
    }
  }
  return { projectId: pid, milestoneId: mid, metricId: xid, value, recordedAt, source };
};

// ---- milestones ---------------------------------------------------------

const milestoneExists = (db: Database, pid: string, mid: string): boolean =>
  (db.query<{ n: number }, [string, string]>("SELECT COUNT(*) AS n FROM milestones WHERE project_id = ? AND id = ?").get(pid, mid)?.n ?? 0) > 0;

const projectExists = (db: Database, pid: string): boolean =>
  (db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM projects WHERE id = ?").get(pid)?.n ?? 0) > 0;

/**
 * Create or replace a milestone and its metric definitions. A metric's
 * `current` is a reading: when it differs from the latest recorded value (or
 * no reading exists yet and it is non-zero) a manual reading is appended, so
 * eval history is never rewritten.
 */
export const upsertMilestone = (db: Database, pid: string, input: MilestoneInput, mode: "create" | "update", now = new Date()): void => {
  if (!projectExists(db, pid)) throw new NotFound(`project ${pid} not found`);
  const exists = milestoneExists(db, pid, input.id);
  if (mode === "create" && exists) throw new Conflict(`milestone ${pid}/${input.id} already exists`);
  if (mode === "update" && !exists) throw new NotFound(`milestone ${pid}/${input.id} not found`);

  const before = exists ? db.query<{ status: MilestoneStatus }, [string, string]>("SELECT status FROM milestones WHERE project_id = ? AND id = ?").get(pid, input.id) : null;
  db.transaction(() => {
    if (exists) {
      db.query(
        "UPDATE milestones SET name = ?, status = ?, month = ?, base_fte = ?, base_time = ?, stretch_fte = ?, stretch_time = ? WHERE project_id = ? AND id = ?",
      ).run(input.name, input.status, input.month, input.impact.base.fte, input.impact.base.time, input.impact.stretch.fte, input.impact.stretch.time, pid, input.id);
      if (before && before.status !== input.status) {
        const at = now.toISOString();
        const text =
          input.status === "shipped"
            ? `${input.name} shipped — gated impact now counts toward realized value`
            : input.status === "eval"
              ? `${input.name} entered In eval — gate metrics now tracking`
              : `${input.name} moved to ${input.status === "progress" ? "In progress" : "Backlog"}`;
        recordEvent(db, { ref: `ship:${pid}/${input.id}:${input.status}:${at}`, at, type: "ship", proj: pid, tab: "value", text });
      }
    } else {
      const sort = db.query<{ s: number }, [string]>("SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM milestones WHERE project_id = ?").get(pid)?.s ?? 0;
      db.query(
        "INSERT INTO milestones (project_id, id, name, status, month, base_fte, base_time, stretch_fte, stretch_time, sort) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ).run(pid, input.id, input.name, input.status, input.month, input.impact.base.fte, input.impact.base.time, input.impact.stretch.fte, input.impact.stretch.time, sort);
    }
    const keep = input.metrics.map((x) => x.id);
    const existing = db
      .query<{ id: string }, [string, string]>("SELECT id FROM metrics WHERE project_id = ? AND milestone_id = ?")
      .all(pid, input.id)
      .map((r) => r.id);
    for (const id of existing) {
      if (!keep.includes(id)) db.query("DELETE FROM metrics WHERE project_id = ? AND milestone_id = ? AND id = ?").run(pid, input.id, id);
    }
    input.metrics.forEach((x, i) => {
      if (existing.includes(x.id)) {
        db.query("UPDATE metrics SET label = ?, base = ?, stretch = ?, sort = ? WHERE project_id = ? AND milestone_id = ? AND id = ?").run(
          x.label,
          x.base,
          x.stretch,
          i,
          pid,
          input.id,
          x.id,
        );
      } else {
        db.query("INSERT INTO metrics (project_id, milestone_id, id, label, base, stretch, sort) VALUES (?,?,?,?,?,?,?)").run(pid, input.id, x.id, x.label, x.base, x.stretch, i);
      }
      const latest = db
        .query<{ value: number }, [string, string, string]>(
          "SELECT value FROM metric_readings WHERE project_id = ? AND milestone_id = ? AND metric_id = ? ORDER BY recorded_at DESC, seq DESC LIMIT 1",
        )
        .get(pid, input.id, x.id);
      const currentStored = latest?.value ?? 0;
      if (x.current !== currentStored) recordReading(db, pid, input.id, x.id, x.current, "manual", now);
    });
  })();
};

export const deleteMilestone = (db: Database, pid: string, mid: string): void => {
  if (!milestoneExists(db, pid, mid)) throw new NotFound(`milestone ${pid}/${mid} not found`);
  // Release criteria that reference this milestone are intentionally left in
  // place: they resolve to "milestone not found" / not-met at read time.
  db.query("DELETE FROM milestones WHERE project_id = ? AND id = ?").run(pid, mid);
};

// ---- projects ------------------------------------------------------------

/** Create or replace a project's own facts (details, team, repos, targets). Children are untouched. */
export const upsertProject = (db: Database, input: ProjectInput, mode: "create" | "update"): void => {
  const exists = projectExists(db, input.id);
  if (mode === "create" && exists) throw new Conflict(`project ${input.id} already exists`);
  if (mode === "update" && !exists) throw new NotFound(`project ${input.id} not found`);
  db.transaction(() => {
    if (exists) {
      db.query(
        "UPDATE projects SET key = ?, name = ?, stage = ?, description = ?, tier = ?, committee_date = ?, committee_ref = ?, target_fte = ?, target_time = ? WHERE id = ?",
      ).run(input.key, input.name, input.stage, input.description, input.tier, input.committee?.date ?? null, input.committee?.ref ?? null, input.targets.fte, input.targets.time, input.id);
    } else {
      const sort = db.query<{ s: number }, []>("SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM projects").get()?.s ?? 0;
      db.query(
        "INSERT INTO projects (id, key, name, stage, description, tier, committee_date, committee_ref, target_fte, target_time, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      ).run(input.id, input.key, input.name, input.stage, input.description, input.tier, input.committee?.date ?? null, input.committee?.ref ?? null, input.targets.fte, input.targets.time, sort);
    }
    db.query("DELETE FROM project_repos WHERE project_id = ?").run(input.id);
    input.repos.forEach((r, i) => db.query("INSERT INTO project_repos (project_id, name, url, sort) VALUES (?,?,?,?)").run(input.id, r.name, r.url, i));
    db.query("DELETE FROM team_members WHERE project_id = ?").run(input.id);
    input.team.forEach((t, i) => db.query("INSERT INTO team_members (project_id, ini, name, role, sort) VALUES (?,?,?,?,?)").run(input.id, t.ini, t.name, t.role, i));
  })();
};

/** Deletes a project and everything under it (milestones, readings, governance, releases, dev activity). */
export const deleteProject = (db: Database, pid: string): void => {
  const res = db.query("DELETE FROM projects WHERE id = ?").run(pid);
  if (res.changes === 0) throw new NotFound(`project ${pid} not found`);
};

// ---- targets & governance ----------------------------------------------

export const setTargets = (db: Database, pid: string, t: TargetsInput): void => {
  if (!projectExists(db, pid)) throw new NotFound(`project ${pid} not found`);
  db.query("UPDATE projects SET target_fte = ?, target_time = ? WHERE id = ?").run(t.fte, t.time, pid);
};

export const updateGovernance = (db: Database, pid: string, gid: string, g: GovernanceInput, now = new Date()): void => {
  const before = db.query<{ status: GovernanceItem["status"]; name: string }, [string, string]>("SELECT status, name FROM governance_items WHERE project_id = ? AND id = ?").get(pid, gid);
  if (!before) throw new NotFound(`governance item ${pid}/${gid} not found`);
  db.query(
    "UPDATE governance_items SET cat = COALESCE(?, cat), name = COALESCE(?, name), status = ?, owner = ?, date = ?, detail = ?, link = ? WHERE project_id = ? AND id = ?",
  ).run(g.cat ?? null, g.name ?? null, g.status, g.owner, g.date, g.detail, g.link ?? null, pid, gid);
  if (before.status !== g.status) {
    const at = now.toISOString();
    recordEvent(db, { ref: `gov:${pid}/${gid}:${g.status}:${at}`, at, type: "gov", proj: pid, tab: "governance", text: `${g.name ?? before.name} moved to ${GSTATUS_LABEL[g.status]}` });
  }
};

export const createGovernanceItem = (db: Database, pid: string, g: GovernanceItemInput): void => {
  if (!projectExists(db, pid)) throw new NotFound(`project ${pid} not found`);
  const dup = db.query<{ n: number }, [string, string]>("SELECT COUNT(*) AS n FROM governance_items WHERE project_id = ? AND id = ?").get(pid, g.id)?.n ?? 0;
  if (dup > 0) throw new Conflict(`governance item ${pid}/${g.id} already exists`);
  const sort = db.query<{ s: number }, [string]>("SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM governance_items WHERE project_id = ?").get(pid)?.s ?? 0;
  db.query("INSERT INTO governance_items (project_id, id, cat, name, status, owner, date, detail, link, sort) VALUES (?,?,?,?,?,?,?,?,?,?)").run(
    pid,
    g.id,
    g.cat,
    g.name,
    g.status,
    g.owner,
    g.date,
    g.detail,
    g.link ?? null,
    sort,
  );
};

/** Release criteria that reference the item stay in place and resolve to "not tracked". */
export const deleteGovernanceItem = (db: Database, pid: string, gid: string): void => {
  const res = db.query("DELETE FROM governance_items WHERE project_id = ? AND id = ?").run(pid, gid);
  if (res.changes === 0) throw new NotFound(`governance item ${pid}/${gid} not found`);
};

// ---- releases ------------------------------------------------------------

const releaseExists = (db: Database, pid: string, rid: string): boolean =>
  (db.query<{ n: number }, [string, string]>("SELECT COUNT(*) AS n FROM releases WHERE project_id = ? AND id = ?").get(pid, rid)?.n ?? 0) > 0;

/** Create or replace a release: its milestone list and criteria are replaced wholesale (they are references, not state). */
export const upsertRelease = (db: Database, pid: string, input: ReleaseInput, mode: "create" | "update"): void => {
  if (!projectExists(db, pid)) throw new NotFound(`project ${pid} not found`);
  const exists = releaseExists(db, pid, input.id);
  if (mode === "create" && exists) throw new Conflict(`release ${pid}/${input.id} already exists`);
  if (mode === "update" && !exists) throw new NotFound(`release ${pid}/${input.id} not found`);
  db.transaction(() => {
    if (exists) {
      db.query("UPDATE releases SET name = ?, month = ? WHERE project_id = ? AND id = ?").run(input.name, input.month, pid, input.id);
    } else {
      const sort = db.query<{ s: number }, [string]>("SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM releases WHERE project_id = ?").get(pid)?.s ?? 0;
      db.query("INSERT INTO releases (project_id, id, name, month, sort) VALUES (?,?,?,?,?)").run(pid, input.id, input.name, input.month, sort);
    }
    db.query("DELETE FROM release_milestones WHERE project_id = ? AND release_id = ?").run(pid, input.id);
    input.milestoneIds.forEach((mid, i) =>
      db.query("INSERT INTO release_milestones (project_id, release_id, milestone_id, sort) VALUES (?,?,?,?)").run(pid, input.id, mid, i),
    );
    db.query("DELETE FROM release_criteria WHERE project_id = ? AND release_id = ?").run(pid, input.id);
    const crit = db.query("INSERT INTO release_criteria (project_id, release_id, sort, type, milestone_id, governance_id, ok, label) VALUES (?,?,?,?,?,?,?,?)");
    input.criteria.forEach((c, i) => {
      switch (c.type) {
        case "gate":
          crit.run(pid, input.id, i, "gate", c.ms, null, null, c.label);
          break;
        case "gov":
          crit.run(pid, input.id, i, "gov", null, c.gid, null, c.label);
          break;
        case "manual":
          crit.run(pid, input.id, i, "manual", null, null, c.ok ? 1 : 0, c.label);
          break;
      }
    });
  })();
};

export const deleteRelease = (db: Database, pid: string, rid: string): void => {
  const res = db.query("DELETE FROM releases WHERE project_id = ? AND id = ?").run(pid, rid);
  if (res.changes === 0) throw new NotFound(`release ${pid}/${rid} not found`);
};

// ---- JSON documents ------------------------------------------------------

/** Replace the agent definitions; agents that disappear take their runs with them, the rest keep theirs. */
export const setAgents = (db: Database, agents: AgentsInput): void => {
  db.transaction(() => {
    const keep = agents.map((a) => a.id);
    for (const row of db.query<{ id: string }, []>("SELECT id FROM agents").all()) if (!keep.includes(row.id)) db.query("DELETE FROM agents WHERE id = ?").run(row.id);
    const q = db.query(
      "INSERT INTO agents (id, sort, name, grad, purpose, kind, model, owner, caps, schedule) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sort = excluded.sort, name = excluded.name, grad = excluded.grad, purpose = excluded.purpose, kind = excluded.kind, model = excluded.model, owner = excluded.owner, caps = excluded.caps, schedule = excluded.schedule",
    );
    agents.forEach((a, i) => q.run(a.id, i, a.name, a.grad, a.purpose, a.kind, a.model, a.owner, JSON.stringify(a.caps), a.schedule));
  })();
};


