// Bring up an application to test against, a fixture model provider, and a
// synthetic workspace seeded through the public API. Everything created here
// is recorded in results/harness.json for the specs and the teardown.

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AS_OF, STATE_FILE, api } from "./harness.ts";
import type { HarnessState, SyntheticSummary } from "./harness.ts";

const root = resolve(import.meta.dirname, "../..");
const port = Number(process.env.E2E_PORT ?? 3199);
const image = process.env.E2E_IMAGE;
const engine = process.env.CONTAINER_ENGINE ?? "docker";
const containerName = `exponential-ui-${process.pid}`;

const waitFor = async (url: string, child: ChildProcess | null, what: string): Promise<void> => {
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    if (child && child.exitCode !== null) throw new Error(`${what} exited during startup (code ${child.exitCode})`);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${what} did not answer at ${url}`);
};

const readLine = (child: ChildProcess, what: string): Promise<string> =>
  new Promise((resolveLine, reject) => {
    let buffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const line = buffer.split("\n").find((l) => l.trim().startsWith("{"));
      if (line) resolveLine(line);
    });
    child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.on("exit", (code) => reject(new Error(`${what} exited with ${code} before reporting`)));
  });

export default async function globalSetup(): Promise<void> {
  mkdirSync(join(import.meta.dirname, "results"), { recursive: true });
  const tmpDir = mkdtempSync(join(tmpdir(), "exponential-ui-"));
  const pids: HarnessState["pids"] = {};

  // 1. The fixture provider (an OpenAI-compatible endpoint that answers every schema the app uses).
  const providerHost = image ? "0.0.0.0" : "127.0.0.1";
  const providerChild = spawn("bun", ["packages/server/e2e/provider-cli.ts"], { cwd: root, env: { ...process.env, PROVIDER_HOST: providerHost }, stdio: ["pipe", "pipe", "pipe"] });
  pids.provider = providerChild.pid;
  const provider = JSON.parse(await readLine(providerChild, "fixture provider")) as { baseUrl: string; token: string };
  const providerForApp = image ? provider.baseUrl.replace("127.0.0.1", "host.containers.internal").replace("localhost", "host.containers.internal") : provider.baseUrl;

  // 2. The application: an existing URL, a container image, or the production server on a temp database.
  let baseUrl = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
  let server: ChildProcess | null = null;
  if (process.env.E2E_BASE_URL) {
    baseUrl = process.env.E2E_BASE_URL;
  } else if (image) {
    const args = ["run", "-d", "--rm", "--name", containerName, ...(engine === "docker" ? ["--add-host", "host.containers.internal:host-gateway"] : []), "-p", `127.0.0.1:${port}:3000`, "-e", "VALUEFLOW_TRUSTED_WORKSPACE=on", "-e", `VALUEFLOW_ORIGINS=${baseUrl}`, "-e", `VALUEFLOW_NOW=${AS_OF}`, image];
    const run = spawnSync(engine, args, { stdio: "inherit" });
    if (run.status !== 0) throw new Error(`${engine} run failed`);
    pids.container = containerName;
  } else {
    server = spawn(process.execPath.endsWith("bun") ? process.execPath : "bun", ["packages/server/src/index.ts"], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: String(port),
        VALUEFLOW_DB: join(tmpDir, "ui.sqlite"),
        VALUEFLOW_SETTINGS: join(tmpDir, "llm.settings.json"),
        VALUEFLOW_NOW: AS_OF,
        LLM_BASE_URL: "",
        LLM_API_KEY: "",
        VALUEFLOW_ACCESS_TOKEN: "",
        SYNC_SOURCE: "none",
        AGENT_SCHEDULE: "off",
        EVAL_JUDGE: "off",
        GLANCE_CURATE: "off",
      },
      stdio: ["ignore", "inherit", "inherit"],
    });
    pids.server = server.pid;
  }
  await waitFor(`${baseUrl}/api/health`, server, "application server");

  // 3. Connect the model and seed the synthetic workspace through the API, as an administrator.
  const admin = api(baseUrl, { role: "admin" });
  const settings = { enabled: true, baseUrl: providerForApp, model: "release-test-model", apiKey: provider.token, thinking: false, revision: 0 };
  await admin.call("PUT", "/api/settings/llm", settings);
  await admin.call("POST", "/api/settings/llm/test");

  const gen = spawnSync("bun", ["tests/ui/synthetic-json.ts", process.env.UI_SEED ?? "7", process.env.UI_PROJECTS ?? "4"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (gen.status !== 0) throw new Error(`synthetic workspace generation failed: ${gen.stderr}`);
  const seed = JSON.parse(gen.stdout) as { state: SyntheticSummary; charters: Record<string, string> };
  const existing = await admin.call<{ projects: { id: string }[] }>("GET", "/api/state");
  if (existing.projects.length > 0) throw new Error(`refusing to seed a workspace that already has ${existing.projects.length} projects; point E2E_BASE_URL at an empty one`);
  for (const p of seed.state.projects) {
    const { milestones, governance, ...own } = p;
    await admin.call("POST", "/api/projects", own);
    for (const m of milestones) await admin.call("POST", `/api/projects/${p.id}/milestones`, m);
    for (const g of governance) await admin.call("POST", `/api/projects/${p.id}/governance`, g);
    for (const r of seed.state.releases[p.id] ?? []) await admin.call("POST", `/api/projects/${p.id}/releases`, r);
  }
  for (const c of seed.state.calendar) await admin.call("POST", "/api/calendar", c);

  const state: HarnessState = { baseUrl, provider, seed, pids, tmpDir };
  writeFileSync(STATE_FILE, JSON.stringify(state));
  process.env.E2E_BASE_URL = baseUrl;
  // Keep the provider alive for the run; the teardown stops it.
  providerChild.stdout?.removeAllListeners("data");
  providerChild.unref();
  server?.unref();
}
