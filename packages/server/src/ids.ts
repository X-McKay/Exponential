import type { Database } from "bun:sqlite";

/** Allocate immediately before insertion, using all retained facts, not UI windows. */
export const nextStoredRunId = (db: Database): string =>
  `run-${(db.query<{ n: number }, []>("SELECT COALESCE(MAX(CAST(SUBSTR(id, 5) AS INTEGER)), 0) AS n FROM agent_runs").get()?.n ?? 0) + 1}`;

export const nextStoredProposalId = (db: Database): string =>
  `prop-${(db.query<{ n: number }, []>("SELECT COALESCE(MAX(CAST(SUBSTR(id, 6) AS INTEGER)), 0) AS n FROM proposals").get()?.n ?? 0) + 1}`;
