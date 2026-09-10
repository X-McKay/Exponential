import type { Database } from "bun:sqlite";

// Facts only. Nothing derived (realized value, tiers, readiness, release
// state, Glance) is ever written here.
const MIGRATIONS: readonly string[] = [
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
  INSERT INTO workspace (id, user_name, user_ini) VALUES (1, 'Al McKay', 'AM');
  `,
];

export const migrate = (db: Database): void => {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(db.query<{ version: number }, []>("SELECT version FROM schema_migrations").all().map((r) => r.version));
  db.transaction(() => {
    MIGRATIONS.forEach((sql, i) => {
      const version = i + 1;
      if (applied.has(version)) return;
      db.exec(sql);
      db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
    });
  })();
};
