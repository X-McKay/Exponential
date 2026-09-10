import { join } from "node:path";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { ensureSeeded } from "./seed.ts";
import { staticHandler } from "./static.ts";
import index from "../../web/src/index.html";

/** `VALUEFLOW_NOW=2026-09-10T09:00:00Z` pins "today" for demos; otherwise the real clock. */
const pinned = process.env.VALUEFLOW_NOW ? new Date(process.env.VALUEFLOW_NOW) : null;
if (pinned && Number.isNaN(pinned.getTime())) throw new Error(`VALUEFLOW_NOW is not a valid date: ${process.env.VALUEFLOW_NOW}`);
const now = () => pinned ?? new Date();

const db = openDb();
if (ensureSeeded(db, now())) console.log(`seeded database with sample data as of ${now().toISOString().slice(0, 10)}`);
const app = createApp(db, { now });
const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 3000);
const serveStatic = staticHandler(join(import.meta.dir, "../../web/dist"));

const server = Bun.serve({
  port,
  development: !production,
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
