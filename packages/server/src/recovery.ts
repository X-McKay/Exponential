import type { Database } from "bun:sqlite";

/** No jobs survive this single-process server's restart. Keep the failure visible. */
export const recoverInterruptedRuns = (db: Database, now: Date): number => {
  const at = now.toISOString();
  const n = db.query("UPDATE agent_runs SET state = 'failed', finished_at = ?, error = 'Server restarted before this run completed; run it again.', summary = 'Interrupted by server restart' WHERE state IN ('working', 'queued')").run(at).changes;
  db.query("UPDATE pm_runs SET state='failed', finished_at=?, error='Server restarted before this run completed; run it again.', summary='Interrupted by server restart' WHERE state IN ('working','queued')").run(at);
  db.query("UPDATE comms_runs SET state='failed', finished_at=?, error='Server restarted before this run completed; run it again.', summary='Interrupted by server restart' WHERE state IN ('working','queued')").run(at);
  return n;
};
