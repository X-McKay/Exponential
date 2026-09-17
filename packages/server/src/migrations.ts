import type { Database } from "bun:sqlite";
import { USAGE_LEDGER_SQL } from "./usage.ts";

// Facts only. Nothing derived (eligible value, tiers, readiness, release
// state, Glance) is ever written here.
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    stage TEXT NOT NULL,
    description TEXT NOT NULL,
    tier INTEGER,
    committee_date TEXT,
    committee_ref TEXT,
    target_fte REAL NOT NULL,
    target_time REAL NOT NULL,
    sort INTEGER NOT NULL
  );
  CREATE TABLE project_repos (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL, url TEXT NOT NULL, sort INTEGER NOT NULL,
    PRIMARY KEY (project_id, name)
  );
  CREATE TABLE team_members (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ini TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, sort INTEGER NOT NULL,
    PRIMARY KEY (project_id, ini)
  );
  CREATE TABLE milestones (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('backlog','progress','eval','shipped')),
    month INTEGER NOT NULL,
    base_fte REAL NOT NULL, base_time REAL NOT NULL,
    stretch_fte REAL NOT NULL, stretch_time REAL NOT NULL,
    sort INTEGER NOT NULL,
    PRIMARY KEY (project_id, id)
  );
  CREATE TABLE metrics (
    project_id TEXT NOT NULL,
    milestone_id TEXT NOT NULL,
    id TEXT NOT NULL,
    label TEXT NOT NULL,
    base REAL NOT NULL,
    stretch REAL NOT NULL,
    sort INTEGER NOT NULL,
    PRIMARY KEY (project_id, milestone_id, id),
    FOREIGN KEY (project_id, milestone_id) REFERENCES milestones(project_id, id) ON DELETE CASCADE
  );
  CREATE TABLE metric_readings (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    milestone_id TEXT NOT NULL,
    metric_id TEXT NOT NULL,
    value REAL NOT NULL,
    recorded_at TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('eval','manual')),
    FOREIGN KEY (project_id, milestone_id, metric_id) REFERENCES metrics(project_id, milestone_id, id) ON DELETE CASCADE
  );
  CREATE INDEX metric_readings_by_metric ON metric_readings(project_id, milestone_id, metric_id, recorded_at, seq);
  CREATE TABLE governance_items (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    cat TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('approved','in_review','draft','missing','na')),
    owner TEXT NOT NULL,
    date TEXT,
    detail TEXT NOT NULL,
    link TEXT,
    sort INTEGER NOT NULL,
    PRIMARY KEY (project_id, id)
  );
  CREATE TABLE releases (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    month INTEGER NOT NULL,
    sort INTEGER NOT NULL,
    PRIMARY KEY (project_id, id)
  );
  CREATE TABLE release_milestones (
    project_id TEXT NOT NULL,
    release_id TEXT NOT NULL,
    milestone_id TEXT NOT NULL,
    sort INTEGER NOT NULL,
    PRIMARY KEY (project_id, release_id, milestone_id),
    FOREIGN KEY (project_id, release_id) REFERENCES releases(project_id, id) ON DELETE CASCADE
  );
  -- Criteria are *references*; a gate criterion whose milestone is deleted
  -- stays here and resolves to not-met at read time.
  CREATE TABLE release_criteria (
    project_id TEXT NOT NULL,
    release_id TEXT NOT NULL,
    sort INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('gate','gov','manual')),
    milestone_id TEXT,
    governance_id TEXT,
    ok INTEGER,
    label TEXT NOT NULL,
    PRIMARY KEY (project_id, release_id, sort),
    FOREIGN KEY (project_id, release_id) REFERENCES releases(project_id, id) ON DELETE CASCADE
  );
  -- Read-only integrations (dev activity, agents, feed, calendar) are stored
  -- as validated JSON documents: they are mirrored from external systems and
  -- carry no editable state.
  CREATE TABLE dev_activity (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, doc TEXT NOT NULL);
  CREATE TABLE agents (id TEXT PRIMARY KEY, sort INTEGER NOT NULL, doc TEXT NOT NULL);
  CREATE TABLE feed_days (sort INTEGER PRIMARY KEY, doc TEXT NOT NULL);
  CREATE TABLE upcoming (sort INTEGER PRIMARY KEY, doc TEXT NOT NULL);
  `,
  // Workspace-level facts: the signed-in user shown in the sidebar and greeting.
  `
  CREATE TABLE workspace (id INTEGER PRIMARY KEY CHECK (id = 1), user_name TEXT NOT NULL, user_ini TEXT NOT NULL);
  INSERT INTO workspace (id, user_name, user_ini) VALUES (1, 'Workspace owner', 'ME');
  `,
  // Months become real: the mockup's axis index (0 = Jan 2026) turns into YYYY-MM text.
  `
  ALTER TABLE milestones RENAME COLUMN month TO month_idx;
  ALTER TABLE milestones ADD COLUMN month TEXT NOT NULL DEFAULT '';
  UPDATE milestones SET month = printf('%04d-%02d', 2026 + month_idx / 12, month_idx % 12 + 1);
  ALTER TABLE milestones DROP COLUMN month_idx;
  ALTER TABLE releases RENAME COLUMN month TO month_idx;
  ALTER TABLE releases ADD COLUMN month TEXT NOT NULL DEFAULT '';
  UPDATE releases SET month = printf('%04d-%02d', 2026 + month_idx / 12, month_idx % 12 + 1);
  ALTER TABLE releases DROP COLUMN month_idx;
  `,
  // Development activity becomes facts synced from source control and CI;
  // the KPI tiles, commit chart, and rankings derive from these rows.
  `
  CREATE TABLE repo_stats (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    repo TEXT NOT NULL, branch TEXT NOT NULL, lang TEXT, coverage REAL, quality TEXT, measured_at TEXT NOT NULL,
    PRIMARY KEY (project_id, repo)
  );
  CREATE TABLE pull_requests (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    repo TEXT NOT NULL, number INTEGER NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open','merged','closed')),
    checks TEXT NOT NULL CHECK (checks IN ('pass','fail','running')),
    additions INTEGER NOT NULL, deletions INTEGER NOT NULL,
    opened_at TEXT NOT NULL, merged_at TEXT, updated_at TEXT NOT NULL, reviewers TEXT NOT NULL, url TEXT,
    PRIMARY KEY (project_id, repo, number)
  );
  CREATE TABLE builds (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    repo TEXT NOT NULL, id TEXT NOT NULL, branch TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('ci','deploy','eval')),
    status TEXT NOT NULL CHECK (status IN ('pass','fail','running')),
    note TEXT NOT NULL, started_at TEXT NOT NULL, duration_s INTEGER NOT NULL, url TEXT,
    PRIMARY KEY (project_id, repo, id)
  );
  CREATE TABLE commit_days (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    repo TEXT NOT NULL, day TEXT NOT NULL, author TEXT NOT NULL, count INTEGER NOT NULL,
    PRIMARY KEY (project_id, repo, day, author)
  );
  CREATE TABLE sync_runs (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, ok INTEGER NOT NULL, message TEXT NOT NULL
  );
  CREATE INDEX sync_runs_by_project ON sync_runs(project_id, seq);
  DROP TABLE dev_activity;
  `,
  // The activity feed derives from an append-only event log written by syncs
  // and mutations; the calendar is user-entered dated items.
  `
  CREATE TABLE events (
    ref TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('build','eval','merge','deploy','gov','ship')),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tab TEXT NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX events_by_at ON events(at);
  CREATE TABLE calendar_events (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tab TEXT NOT NULL,
    text TEXT NOT NULL,
    sub TEXT
  );
  DROP TABLE feed_days;
  DROP TABLE upcoming;
  `,
  // Agents become definitions plus a log of runs; status and counts derive from runs.
  `
  DROP TABLE agents;
  CREATE TABLE agents (
    id TEXT PRIMARY KEY, sort INTEGER NOT NULL, name TEXT NOT NULL, grad TEXT NOT NULL, purpose TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('deck','comms','ideation','audit')),
    model TEXT, owner TEXT NOT NULL, caps TEXT NOT NULL, schedule TEXT CHECK (schedule IS NULL OR schedule = 'nightly')
  );
  CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tab TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued','working','done','attention','failed')),
    started_at TEXT NOT NULL, finished_at TEXT, instruction TEXT, summary TEXT NOT NULL, output TEXT NOT NULL, model TEXT, error TEXT
  );
  CREATE INDEX agent_runs_by_start ON agent_runs(started_at);
  `,
  // Proposals: changes an agent suggested, applied only when a person accepts.
  `
  CREATE TABLE proposals (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    rationale TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending','accepted','dismissed')),
    created_at TEXT NOT NULL,
    decided_at TEXT
  );
  CREATE INDEX proposals_by_state ON proposals(state, created_at);
  `,
  // Setup drafts: what the setup agent suggested from documents, kept until the project is created.
  `
  CREATE TABLE setup_drafts (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    name TEXT NOT NULL,
    key TEXT NOT NULL,
    brief TEXT NOT NULL,
    sources TEXT NOT NULL,
    source_text TEXT NOT NULL,
    draft TEXT NOT NULL,
    feedback TEXT NOT NULL,
    model TEXT
  );
  `,
  // Evals: runs record what they cost and which prompt they used; scores hold
  // rule checks, judge verdicts, and human ratings. The agents table is rebuilt
  // to admit the conversational kind (SQLite cannot alter a CHECK constraint).
  `
  ALTER TABLE agent_runs ADD COLUMN prompt_version TEXT;
  ALTER TABLE agent_runs ADD COLUMN latency_ms INTEGER;
  ALTER TABLE agent_runs ADD COLUMN prompt_tokens INTEGER;
  ALTER TABLE agent_runs ADD COLUMN completion_tokens INTEGER;
  ALTER TABLE agent_runs ADD COLUMN benchmark TEXT;
  ALTER TABLE agent_runs ADD COLUMN rating INTEGER;
  ALTER TABLE agent_runs ADD COLUMN rating_note TEXT;
  ALTER TABLE agent_runs ADD COLUMN context TEXT;
  CREATE TABLE run_scores (
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    scorer TEXT NOT NULL CHECK (scorer IN ('rules','judge')),
    dimension TEXT NOT NULL,
    score REAL NOT NULL,
    note TEXT NOT NULL,
    at TEXT NOT NULL,
    PRIMARY KEY (run_id, scorer, dimension)
  );
  CREATE TABLE agents_v2 (
    id TEXT PRIMARY KEY, sort INTEGER NOT NULL, name TEXT NOT NULL, grad TEXT NOT NULL, purpose TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('deck','comms','ideation','audit','chat')),
    model TEXT, owner TEXT NOT NULL, caps TEXT NOT NULL, schedule TEXT CHECK (schedule IS NULL OR schedule = 'nightly')
  );
  INSERT INTO agents_v2 SELECT id, sort, name, grad, purpose, kind, model, owner, caps, schedule FROM agents;
  DROP TABLE agents;
  ALTER TABLE agents_v2 RENAME TO agents;
  `,
  // Closing the loop: agents carry extra instructions (prompt) and may run on
  // a weekly schedule; prompt changes are recorded as versions; standing rules
  // are facts a person writes; runs and proposals may be workspace-scoped
  // (no project), and a proposal remembers the rule that produced it.
  `
  CREATE TABLE agents_v3 (
    id TEXT PRIMARY KEY, sort INTEGER NOT NULL, name TEXT NOT NULL, grad TEXT NOT NULL, purpose TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('deck','comms','ideation','audit','chat','rules','brief','tuner','scout')),
    model TEXT, owner TEXT NOT NULL, caps TEXT NOT NULL,
    schedule TEXT CHECK (schedule IS NULL OR schedule IN ('nightly','weekly')),
    prompt TEXT
  );
  INSERT INTO agents_v3 (id, sort, name, grad, purpose, kind, model, owner, caps, schedule) SELECT id, sort, name, grad, purpose, kind, model, owner, caps, schedule FROM agents;
  DROP TABLE agents;
  ALTER TABLE agents_v3 RENAME TO agents;
  CREATE TABLE prompt_versions (
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    prompt TEXT,
    at TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('person','tuner')),
    PRIMARY KEY (agent_id, at)
  );
  CREATE TABLE rules (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 1,
    auto INTEGER NOT NULL DEFAULT 0,
    owner TEXT NOT NULL,
    created_at TEXT NOT NULL,
    sort INTEGER NOT NULL
  );
  CREATE TABLE agent_runs_v2 (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    tab TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued','working','done','attention','failed')),
    started_at TEXT NOT NULL, finished_at TEXT, instruction TEXT, summary TEXT NOT NULL, output TEXT NOT NULL, model TEXT, error TEXT,
    prompt_version TEXT, latency_ms INTEGER, prompt_tokens INTEGER, completion_tokens INTEGER, benchmark TEXT, rating INTEGER, rating_note TEXT, context TEXT
  );
  INSERT INTO agent_runs_v2 SELECT id, agent_id, project_id, tab, state, started_at, finished_at, instruction, summary, output, model, error, prompt_version, latency_ms, prompt_tokens, completion_tokens, benchmark, rating, rating_note, context FROM agent_runs;
  DROP TABLE agent_runs;
  ALTER TABLE agent_runs_v2 RENAME TO agent_runs;
  CREATE INDEX agent_runs_by_start ON agent_runs(started_at);
  CREATE TABLE proposals_v2 (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    rule_id TEXT,
    action TEXT NOT NULL,
    rationale TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending','accepted','dismissed')),
    created_at TEXT NOT NULL,
    decided_at TEXT
  );
  INSERT INTO proposals_v2 (id, run_id, agent_id, project_id, action, rationale, state, created_at, decided_at) SELECT id, run_id, agent_id, project_id, action, rationale, state, created_at, decided_at FROM proposals;
  DROP TABLE proposals;
  ALTER TABLE proposals_v2 RENAME TO proposals;
  CREATE INDEX proposals_by_state ON proposals(state, created_at);
  `,
  // Generative Glance: the curator's layouts are facts that point at composer
  // blocks by id (never composed content, which stays derived); a person's
  // last page visit starts "since you last looked". The agents table drops
  // its kind CHECK: the API validates kinds, and a new kind should not need a
  // table rebuild.
  `
  CREATE TABLE agents_v4 (
    id TEXT PRIMARY KEY, sort INTEGER NOT NULL, name TEXT NOT NULL, grad TEXT NOT NULL, purpose TEXT NOT NULL,
    kind TEXT NOT NULL,
    model TEXT, owner TEXT NOT NULL, caps TEXT NOT NULL,
    schedule TEXT CHECK (schedule IS NULL OR schedule IN ('nightly','weekly')),
    prompt TEXT
  );
  INSERT INTO agents_v4 SELECT id, sort, name, grad, purpose, kind, model, owner, caps, schedule, prompt FROM agents;
  DROP TABLE agents;
  ALTER TABLE agents_v4 RENAME TO agents;
  CREATE TABLE page_views (
    user_ini TEXT NOT NULL,
    page TEXT NOT NULL,
    at TEXT NOT NULL,
    PRIMARY KEY (user_ini, page)
  );
  CREATE TABLE layouts (
    run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
    user_ini TEXT NOT NULL,
    state_hash TEXT NOT NULL,
    headline TEXT NOT NULL,
    placements TEXT NOT NULL,
    model TEXT,
    at TEXT NOT NULL
  );
  CREATE INDEX layouts_by_user ON layouts(user_ini, at);
  `,
  // The daily brief replaces the card layout: prose sections, each with at
  // most one widget that points at facts by id. Still pointers and text,
  // never composed state.
  `
  DROP TABLE layouts;
  CREATE TABLE daily_briefs (
    run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
    user_ini TEXT NOT NULL,
    state_hash TEXT NOT NULL,
    headline TEXT NOT NULL,
    sections TEXT NOT NULL,
    model TEXT,
    at TEXT NOT NULL
  );
  CREATE INDEX daily_briefs_by_user ON daily_briefs(user_ini, at);
  `,
  // Run logs: every step a run took, as facts, so a person can see what an
  // agent did and how long each part took, live and afterwards.
  `
  CREATE TABLE run_events (
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    at TEXT NOT NULL,
    step TEXT NOT NULL,
    detail TEXT NOT NULL,
    PRIMARY KEY (run_id, seq)
  );
  `,
  // Budgets are facts (a ceiling someone set); spend is derived from runs.
  // A daily brief may be about one project.
  `
  CREATE TABLE budgets (
    scope TEXT NOT NULL CHECK (scope IN ('workspace','agent','project')),
    ref TEXT NOT NULL DEFAULT '',
    monthly_tokens INTEGER,
    monthly_usd REAL,
    PRIMARY KEY (scope, ref)
  );
  ALTER TABLE daily_briefs ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
  `,
  // Evidence integrity: metric definitions are retired instead of deleted so
  // their append-only readings remain queryable; milestone snapshots preserve
  // the definitions and status used by historical derivations. Proposal
  // guards are written by the proposal service and fail closed when absent.
  `
  ALTER TABLE milestones ADD COLUMN retired_at TEXT;
  ALTER TABLE milestones ADD COLUMN created_at TEXT;
  ALTER TABLE metrics ADD COLUMN retired_at TEXT;
  CREATE TABLE milestone_snapshots (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    milestone_id TEXT NOT NULL,
    at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('backlog','progress','eval','shipped')),
    month TEXT NOT NULL,
    base_fte REAL NOT NULL,
    base_time REAL NOT NULL,
    stretch_fte REAL NOT NULL,
    stretch_time REAL NOT NULL,
    metrics TEXT NOT NULL
  );
  CREATE INDEX milestone_snapshots_lookup ON milestone_snapshots(project_id, milestone_id, at, seq);
  CREATE TABLE proposal_guards (
    proposal_id TEXT PRIMARY KEY REFERENCES proposals(id) ON DELETE CASCADE,
    expected TEXT NOT NULL,
    decided_by TEXT,
    decision_mode TEXT
  );
  `,
  // Provider attempts are reserved and reconciled in a durable usage ledger.
  USAGE_LEDGER_SQL,
  // Project manager assignments are durable user intent and their run audit log.
  `
  CREATE TABLE pm_assignments (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    objective TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, on_change INTEGER NOT NULL DEFAULT 1,
    cadence TEXT NOT NULL CHECK (cadence IN ('weekly','manual')), owner TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_input_fingerprint TEXT
  );
  CREATE INDEX pm_assignments_by_project ON pm_assignments(project_id);
  CREATE TABLE pm_commitments (
    id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES pm_assignments(id) ON DELETE CASCADE,
    title TEXT NOT NULL, owner TEXT NOT NULL, due TEXT, status TEXT NOT NULL CHECK (status IN ('open','in_progress','done','blocked')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE pm_runs (
    id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES pm_assignments(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
    trigger TEXT NOT NULL CHECK (trigger IN ('manual','scheduled')), input_fingerprint TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued','working','done','attention','failed')), summary TEXT NOT NULL, output TEXT NOT NULL, error TEXT,
    started_at TEXT NOT NULL, finished_at TEXT
  );
  CREATE INDEX pm_runs_by_assignment ON pm_runs(assignment_id, started_at DESC);
  CREATE UNIQUE INDEX pm_active_assignment ON pm_runs(assignment_id) WHERE state IN ('queued','working');
  `,
  `
  CREATE TABLE comms_assignments (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    objective TEXT NOT NULL, audience TEXT NOT NULL, format TEXT NOT NULL CHECK (format IN ('executive_update','release_notes','decision_memo','project_brief')),
    owner TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, on_change INTEGER NOT NULL DEFAULT 0,
    cadence TEXT NOT NULL CHECK (cadence IN ('manual','weekly')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_input_fingerprint TEXT
  );
  CREATE INDEX comms_assignments_by_project ON comms_assignments(project_id);
  CREATE TABLE comms_runs (
    id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES comms_assignments(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
    trigger TEXT NOT NULL CHECK (trigger IN ('manual','scheduled')), mode TEXT NOT NULL DEFAULT 'draft' CHECK (mode IN ('draft','conversation')), input_fingerprint TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued','working','done','attention','failed')), summary TEXT NOT NULL, output TEXT NOT NULL, error TEXT,
    started_at TEXT NOT NULL, finished_at TEXT
  );
  CREATE INDEX comms_runs_by_assignment ON comms_runs(assignment_id, started_at DESC);
  CREATE UNIQUE INDEX comms_active_assignment ON comms_runs(assignment_id) WHERE state IN ('queued','working');
  CREATE TABLE comms_messages (
    id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES comms_assignments(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES comms_runs(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK (role IN ('user','assistant')), content TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX comms_messages_by_assignment ON comms_messages(assignment_id, created_at, id);
  CREATE TABLE comms_artifacts (
    id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES comms_assignments(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, run_id TEXT NOT NULL REFERENCES comms_runs(id) ON DELETE CASCADE,
    agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE, title TEXT NOT NULL, format TEXT NOT NULL CHECK (format IN ('executive_update','release_notes','decision_memo','project_brief')),
    version INTEGER NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('draft','approved')), approved_at TEXT, created_at TEXT NOT NULL,
    UNIQUE (assignment_id, version)
  );
  CREATE INDEX comms_artifacts_by_project ON comms_artifacts(project_id, created_at DESC);
  `,
  `
  CREATE TABLE workspace_members (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, ini TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('admin','editor','viewer'))
  );
  CREATE TABLE mutation_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, member_id TEXT,
    member_name TEXT NOT NULL, role TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, status INTEGER NOT NULL
  );
  `,
  `
  CREATE TABLE workspace_revision (
    id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL CHECK (revision >= 0)
  );
  INSERT INTO workspace_revision (id, revision) VALUES (1, 0);
  `,
  // Project templates: configurable starting points (documents, dependencies, a first plan) stored as one JSON document each.
  `
  CREATE TABLE project_templates (id TEXT PRIMARY KEY, sort INTEGER NOT NULL, doc TEXT NOT NULL);
  `,
  // A project remembers the template and version it follows so drift can be
  // measured; every saved template revision is kept for audit; a proposal
  // carries the passage it was staged from.
  `
  ALTER TABLE projects ADD COLUMN template_id TEXT;
  ALTER TABLE projects ADD COLUMN template_version INTEGER;
  ALTER TABLE proposals ADD COLUMN evidence TEXT;
  CREATE TABLE project_template_versions (
    template_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    doc TEXT NOT NULL,
    at TEXT NOT NULL,
    PRIMARY KEY (template_id, version)
  );
  `,
];

export const migrate = (db: Database): void => {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(db.query<{ version: number }, []>("SELECT version FROM schema_migrations").all().map((r) => r.version));
  // Foreign keys are off while tables are rebuilt so a DROP never cascades into child rows; the check afterwards proves nothing dangled.
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.transaction(() => {
      MIGRATIONS.forEach((sql, i) => {
        const version = i + 1;
        if (applied.has(version)) return;
        db.exec(sql);
        db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
      });
      const dangling = db.query<{ table: string }, []>("PRAGMA foreign_key_check").all();
      if (dangling.length) throw new Error(`migration left dangling foreign keys in ${[...new Set(dangling.map((d) => d.table))].join(", ")}`);
    })();
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
};
