import { join } from "node:path";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { ensureSeeded } from "./seed.ts";
import { staticHandler } from "./static.ts";
import index from "../../web/src/index.html";

const db = openDb();
if (ensureSeeded(db)) console.log("seeded database with mockup fixtures");
const app = createApp(db);
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
