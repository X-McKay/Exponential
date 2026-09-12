import { join } from "node:path";
import { createApp } from "./app.ts";
import { webhookDelivery } from "./brief.ts";
import { runDue } from "./runner.ts";
import type { Skipped } from "./runner.ts";
import { sourceFromEnv } from "./connectors/index.ts";
import { llmFromEnv } from "./llm.ts";
import { openDb } from "./db.ts";
import { ensureAgents, ensureSeeded } from "./seed.ts";
import { syncAll, syncMissing } from "./sync.ts";
import { loadDotEnv } from "./env.ts";
import { staticHandler } from "./static.ts";
import index from "../../web/src/index.html";

loadDotEnv();

/** `VALUEFLOW_NOW=2026-09-10T09:00:00Z` pins "today" for demos; otherwise the real clock. */
const pinned = process.env.VALUEFLOW_NOW ? new Date(process.env.VALUEFLOW_NOW) : null;
if (pinned && Number.isNaN(pinned.getTime())) throw new Error(`VALUEFLOW_NOW is not a valid date: ${process.env.VALUEFLOW_NOW}`);
const now = () => pinned ?? new Date();

const db = openDb();
if (ensureSeeded(db, now())) console.log(`seeded database with sample data as of ${now().toISOString().slice(0, 10)}`);
const added = ensureAgents(db);
if (added.length) console.log(`installed workspace agents: ${added.join(", ")}`);

/** `SYNC_SOURCE=sample|github|none`; `SYNC_INTERVAL_MIN=30` re-syncs every project on a timer. */
const source = sourceFromEnv(process.env);
/** `LLM_BASE_URL` (OpenAI-compatible) enables agent runs; `AGENT_SCHEDULE=off` disables nightly runs. */
const llm = llmFromEnv(process.env);
/** `BRIEF_WEBHOOK_URL` also posts the weekly brief as JSON ({ text, title, summary, body }) to Slack, Teams, Zapier, or your own endpoint. */
const deliverBrief = process.env.BRIEF_WEBHOOK_URL ? webhookDelivery(process.env.BRIEF_WEBHOOK_URL) : null;
/** `GLANCE_CURATE=off` keeps Glance in the composer's default order instead of re-curating when facts move. */
const app = createApp(db, { now, source, llm, autoJudge: process.env.EVAL_JUDGE !== "off", deliverBrief, autoCurate: process.env.GLANCE_CURATE !== "off" });
if (llm) {
  llm
    .model()
    .then((m) => {
      const d = llm.describe();
      console.log(`agents run against ${m} at ${d.baseUrl}${d.models.length > 1 ? `; scout candidates: ${d.models.filter((x) => x !== m).join(", ")}` : ""}${d.judgeModel ? `; judge: ${d.judgeModel}` : ""}`);
    })
    .catch((e: unknown) => console.error("LLM unreachable:", e instanceof Error ? e.message : e));
  if (process.env.AGENT_SCHEDULE !== "off") {
    const tick = () => {
      const skipped: Skipped[] = [];
      return runDue(db, llm, now(), { deliverBrief }, skipped)
        .then((runs) => {
          if (runs.length) console.log(`scheduled agents: ${runs.length} run${runs.length === 1 ? "" : "s"}, ${runs.filter((r) => r.state === "failed").length} failed`);
          if (skipped.length) console.log(`scheduled agents: ${skipped.length} run${skipped.length === 1 ? "" : "s"} held back by budget (${skipped[0]?.reason})`);
        })
        .catch((e: unknown) => console.error("scheduled agents failed", e));
    };
    setTimeout(tick, 60_000);
    setInterval(tick, 30 * 60_000);
  }
} else {
  console.log("agents disabled: set LLM_BASE_URL to enable runs");
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
const serveStatic = staticHandler(join(import.meta.dir, "../../web/dist"));

const server = Bun.serve({
  port,
  development: !production,
  // Agent runs and the curator answer in one request and can take a minute; Bun closes idle connections after 10 s by default (255 is its maximum).
  idleTimeout: 255,
  // In development Bun bundles the React app on the fly with HMR; in
  // production the pre-built bundle in web/dist is served as static files.
  routes: production ? undefined : { "/": index },
  async fetch(req) {
    const api = await app.handleApi(req);
    if (api) return api;
    return serveStatic(req);
  },
});

console.log(`ValueFlow ${production ? "(production)" : "(dev)"} listening on http://localhost:${server.port}`);
