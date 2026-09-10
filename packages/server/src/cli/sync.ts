// Sync development facts for every project from the configured source.
//   SYNC_SOURCE=github GITHUB_TOKEN=… bun run sync
import { sourceFromEnv } from "../connectors/index.ts";
import { openDb } from "../db.ts";
import { syncAll } from "../sync.ts";

const source = sourceFromEnv(process.env);
if (!source) {
  console.error("SYNC_SOURCE=none: nothing to sync");
  process.exit(1);
}
const db = openDb();
const runs = await syncAll(db, source, new Date());
for (const [pid, run] of Object.entries(runs)) console.log(`${run.ok ? "✓" : "✗"} ${pid}: ${run.message}`);
process.exit(Object.values(runs).every((r) => r.ok) ? 0 : 1);
