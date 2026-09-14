import { join } from "node:path";
import { createApp } from "./app.ts";
import { webhookDelivery } from "./brief.ts";
import { runDue } from "./runner.ts";
import { runDueComms } from "./comms.ts";
import { runDuePm } from "./pm.ts";
import type { Skipped } from "./runner.ts";
import { sourceFromEnv } from "./connectors/index.ts";
import { createSettings } from "./settings.ts";
import { DEFAULT_DB_PATH, openDb } from "./db.ts";
import { initializeWorkspace } from "./seed.ts";
import { syncAll, syncMissing } from "./sync.ts";
import { loadDotEnv } from "./env.ts";
import { staticHandler } from "./static.ts";
import { accessFromEnv } from "./access.ts";
import { recoverInterruptedRuns } from "./recovery.ts";

loadDotEnv();

/** `VALUEFLOW_NOW=2026-09-10T09:00:00Z` pins "today" for demos; otherwise the real clock. */
const pinned = process.env.VALUEFLOW_NOW ? new Date(process.env.VALUEFLOW_NOW) : null;
if (pinned && Number.isNaN(pinned.getTime())) throw new Error(`VALUEFLOW_NOW is not a valid date: ${process.env.VALUEFLOW_NOW}`);
const now = () => pinned ?? new Date();

const db = openDb();
initializeWorkspace(db);
const interrupted = recoverInterruptedRuns(db, now());
if (interrupted) console.log(`marked ${interrupted} interrupted run(s) failed`);

/** `SYNC_SOURCE=sample|github|none`; `SYNC_INTERVAL_MIN=30` re-syncs every project on a timer. */
const source = sourceFromEnv(process.env);
/** `LLM_BASE_URL` (OpenAI-compatible) enables agent runs; `AGENT_SCHEDULE=off` disables nightly runs. */
const settings = createSettings(process.env.VALUEFLOW_SETTINGS ?? `${process.env.VALUEFLOW_DB ?? DEFAULT_DB_PATH}.settings.json`, process.env);
/** `BRIEF_WEBHOOK_URL` also posts the weekly brief as JSON ({ text, title, summary, body }) to Slack, Teams, Zapier, or your own endpoint. */
const deliverBrief = process.env.BRIEF_WEBHOOK_URL ? webhookDelivery(process.env.BRIEF_WEBHOOK_URL) : null;
/** `GLANCE_CURATE=off` keeps Glance in the composer's default order instead of re-curating when facts move. */
const app = createApp(db, { now, source, settings, autoJudge: process.env.EVAL_JUDGE === "on", deliverBrief, autoCurate: process.env.GLANCE_CURATE === "on" });
// Scheduling is opt-in. Capture one provider for the whole tick and coalesce overlaps.
let ticking = false;
const tick = async () => {
  const llm = settings.getLlm();
  if (!llm || ticking) return;
  ticking = true;
  try {
    const skipped: Skipped[] = [];
    const runs = await runDue(db, llm, now(), { deliverBrief }, skipped);
    await runDuePm(db, llm, now());
    await runDueComms(db, llm, now());
    if (runs.length || skipped.length) console.log(`scheduled agents: ${runs.length} runs, ${skipped.length} held by budget`);
  } catch (e) { console.error("scheduled agents failed", e); }
  finally { ticking = false; }
};
if (process.env.AGENT_SCHEDULE === "on") {
  setTimeout(() => void tick(), 60_000);
  setInterval(() => void tick(), 30 * 60_000);
}
if (source) {
  const first = await syncMissing(db, source, now());
  for (const [pid, run] of Object.entries(first)) console.log(`sync ${pid} via ${source.name}: ${run.ok ? run.message : "failed — " + run.message}`);
  const every = Number(process.env.SYNC_INTERVAL_MIN ?? 0);
  if (every > 0) {
    setInterval(() => {
      syncAll(db, source, now())
        .then((runs) => console.log(`sync: ${Object.values(runs).filter((r) => r.ok).length}/${Object.keys(runs).length} projects ok`))
        .catch((e: unknown) => console.error("sync failed", e));
    }, every * 60_000);
    console.log(`syncing every ${every} min via ${source.name}`);
  }
}
const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 3000);
const access = accessFromEnv(process.env, port);
const serveStatic = staticHandler(join(import.meta.dir, "../../web/dist"));

const server = Bun.serve({
  port,
  hostname: access.hostname,
  development: !production,
  // Agent runs and the curator answer in one request and can take a minute; Bun closes idle connections after 10 s by default (255 is its maximum).
  idleTimeout: 255,
  // In development Bun bundles the React app on the fly with HMR; in
  // production the pre-built bundle in web/dist is served as static files.
  // Authenticated instances serve the built app through the access guard.
  routes: process.env.NODE_ENV === "production" || process.env.VALUEFLOW_ACCESS_TOKEN ? undefined : { "/": (await import("../../web/src/index.html")).default },
  async fetch(req) {
    const denied = access.check(req);
    if (denied) return denied;
    const api = await app.handleApi(req);
    if (api) return api;
    return serveStatic(req);
  },
});

console.log(`Exponential ${production ? "(production)" : "(dev)"} listening on http://localhost:${server.port}`);

// Allow in-flight HTTP work to drain before closing SQLite on deployment shutdown.
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(0), 15_000);
  deadline.unref();
  await server.stop(false);
  if (!ticking) { db.close(); process.exit(0); }
  // Background work holds reservations; interruption remains visible on next startup.
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
