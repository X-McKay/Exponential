// Production-process HTTP acceptance suite. Runs only against its own disposable database.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { strict as assert } from "node:assert";
import type { AppState, Project, SetupDraft, WorkspaceMember } from "@valueflow/domain";
import type { LlmSettingsStatus, PMAssignment, PMRun, CommsAssignment, CommsRun, CommsArtifact } from "@valueflow/shared";
import { compose, fromDraft } from "../../web/src/editors/SetupWizard.tsx";
import { startTestProvider } from "./provider.ts";

const root = resolve(import.meta.dir, "../../..");
const dir = mkdtempSync(join(tmpdir(), "valueflow-e2e-"));
const image = process.env.E2E_IMAGE;
const engine = process.env.CONTAINER_ENGINE ?? "podman";
const containerName = `valueflow-e2e-${process.pid}`;
const volumeName = `${containerName}-data`;
const provider = startTestProvider(image ? "0.0.0.0" : "127.0.0.1");
const providerUrl = image ? provider.baseUrl.replace("127.0.0.1", "host.containers.internal").replace("localhost", "host.containers.internal") : provider.baseUrl;
const port = Number(process.env.E2E_PORT ?? 3197);
const base = `http://localhost:${port}`;
let server: ReturnType<typeof Bun.spawn> | undefined;
let role = "admin";
let user = "owner";
let checks = 0;
const check = (condition: unknown, name: string) => { assert.ok(condition, name); checks++; console.log(`PASS ${name}`); };
const containerCommand = async (...args: string[]) => {
  const child = Bun.spawn([engine, ...args], { stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`${engine} ${args[0]} failed`);
};
const start = async () => {
  server = image ? Bun.spawn([engine, "run", "--rm", "--name", containerName,
    ...(engine === "docker" ? ["--add-host", "host.containers.internal:host-gateway"] : []),
    "-p", `127.0.0.1:${port}:3000`, "-v", `${volumeName}:/app/data`,
    "-e", "VALUEFLOW_TRUSTED_WORKSPACE=on", "-e", `VALUEFLOW_ORIGINS=${base}`, image], { stdout: "inherit", stderr: "inherit" })
    : Bun.spawn([process.execPath, "packages/server/src/index.ts"], { cwd: root, env: {
    ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port), VALUEFLOW_DB: join(dir, "test.sqlite"),
    VALUEFLOW_SETTINGS: join(dir, "llm.settings.json"), LLM_BASE_URL: "", LLM_API_KEY: "", VALUEFLOW_ACCESS_TOKEN: "", VALUEFLOW_NOW: "", SYNC_SOURCE: "none", AGENT_SCHEDULE: "off", EVAL_JUDGE: "off", GLANCE_CURATE: "off",
  }, stdout: "inherit", stderr: "inherit" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* wait for socket */ }
    if (server.exitCode !== null) throw new Error("Release server exited during startup");
    await Bun.sleep(100);
  }
  throw new Error("Release server did not start");
};
const stop = async () => { if (server) {
  if (image && server.exitCode === null) await containerCommand("stop", "--time", "20", containerName);
  else if (!image) server.kill("SIGTERM");
  await server.exited; server = undefined;
} };
const raw = (method: string, path: string, body?: unknown) => fetch(base + path, { method,
  headers: { "x-valueflow-user": user, "x-valueflow-role": role, ...(body instanceof FormData || body === undefined ? {} : { "content-type": "application/json" }) },
  ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(180_000),
});
const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const response = await raw(method, path, body);
  const result = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(result)}`);
  return result as T;
};
try {
  await start();
  check((await fetch(base)).ok, "production HTML serves");
  const html = await (await fetch(base)).text();
  const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|woff2))"/g)].map(match => new URL(match[1]!, base));
  check(assets.length > 0 && (await Promise.all(assets.map(async url => (await fetch(url)).ok))).every(Boolean), "production assets serve");
  if (image) {
    await containerCommand("exec", containerName, "bun", "-e", "const r=await fetch('http://localhost:3000/api/health');process.exit(r.ok?0:1)");
    check(true, "container health endpoint passes");
  }
  let state = await call<AppState>("GET", "/api/state");
  check(state.projects.length === 0 && state.runs.length === 0 && state.events.length === 0, "fresh install contains no demo facts");
  check(state.agents.some(a => a.id === "project-manager") && state.syncSource === null, "built-in agents installed; synthetic sync disabled");
  const staleRevision = (await fetch(`${base}/api/state`)).headers.get("x-valueflow-revision")!;
  const editWorkspace = (name: string) => fetch(`${base}/api/workspace`, { method: "PUT", headers: {
    "content-type": "application/json", "x-valueflow-user": user, "x-valueflow-role": role, "x-valueflow-revision": staleRevision,
  }, body: JSON.stringify({ user: { name, ini: state.workspace.user.ini } }) });
  check((await editWorkspace("Release Owner")).ok && (await editWorkspace("Stale Owner")).status === 409, "stale workspace edit cannot overwrite a newer session");
  state = await call<AppState>("GET", "/api/state");
  check(state.workspace.user.name === "Release Owner", "conflict preserves the first workspace edit");
  const settingsInput = { enabled: true, baseUrl: providerUrl, model: "release-test-model", apiKey: "wrong-token", thinking: false, revision: 0 };
  await call("PUT", "/api/settings/llm", settingsInput);
  check((await raw("POST", "/api/settings/llm/test")).status === 400, "invalid token is rejected");
  const settings = await call<LlmSettingsStatus>("PUT", "/api/settings/llm", { ...settingsInput, apiKey: provider.token, revision: 1 });
  check(settings.hasToken && !JSON.stringify(settings).includes(provider.token), "saved token is masked");
  check((await raw("POST", "/api/settings/llm/test")).ok, "token-authenticated provider connection succeeds");
  await call("PUT", "/api/settings/llm", { ...settingsInput, apiKey: undefined, revision: 2 });
  check((await raw("POST", "/api/settings/llm/test")).ok, "blank token preserves the saved token on the same endpoint");
  check((await raw("PUT", "/api/settings/llm", settingsInput)).status === 409, "stale settings save is rejected");
  const manual = await call<Project>("POST", "/api/projects", { id: "manual", key: "MAN", name: "Manual onboarding", stage: "Discovery", description: "Created without AI", tier: null, committee: null, repos: [], team: [], targets: { fte: 0, time: 0 } });
  check(manual.id === "manual", "create a project manually");
  const names = [["support-triage-charter.md", "Support Triage Assistant"], ["invoice-review-charter.md", "Invoice Review Assistant"], ["knowledge-search-charter.md", "Internal Knowledge Search"]];
  const created: Project[] = [];
  for (const [file, name] of names) {
    const form = new FormData(); form.set("name", name!); form.set("key", `E2E-${created.length + 1}`);
    form.append("file", Bun.file(join(root, "docs/samples", file!)), file);
    const draft = await call<SetupDraft>("POST", "/api/setup", form);
    check(draft.sources.some(s => s.name === file && !s.error) && draft.draft.milestones.length > 0, `upload and analyze ${file}`);
    const input = compose(name!, `E2E-${created.length + 1}`, fromDraft(draft.draft), new Set(), created.map(p => p.id), "ME");
    const project = await call<Project>("POST", `/api/setup/${draft.id}/create`, input); created.push(project);
    check(project.milestones.every(m => m.metrics.every(x => x.current === 0 && x.readAt === null)), `review and create ${name} without fabricated readings`);
  }
  const project = created[0]!;
  const ms = project.milestones[0]!;
  await call("PUT", `/api/projects/${project.id}/milestones/${ms.id}`, { ...ms, status: "shipped" });
  const metric = ms.metrics[0]!;
  await call("PUT", `/api/projects/${project.id}/milestones/${ms.id}/metrics/${metric.id}/readings`, { value: 96, source: "manual" });
  check((await call<unknown[]>("GET", `/api/projects/${project.id}/milestones/${ms.id}/metrics/${metric.id}/readings`)).length === 1, "record and retrieve a measurement");
  const pm = await call<PMAssignment>("POST", "/api/pm/assignments", { projectId: project.id, objective: "Assess pilot readiness", owner: "ME" });
  const pmRun = await call<PMRun>("POST", `/api/pm/assignments/${pm.id}/run`, {});
  check(pmRun.state !== "failed" && Boolean(pmRun.output), "PM assessment runs through configured provider");
  const comms = await call<CommsAssignment>("POST", "/api/comms/assignments", { projectId: project.id, objective: "Draft a pilot update", audience: "Pilot team", format: "executive_update", owner: "ME" });
  const commsRun = await call<CommsRun>("POST", `/api/comms/assignments/${comms.id}/run`, {});
  check(commsRun.state !== "failed" && Boolean(commsRun.output), "communications draft runs");
  const artifacts = await call<CommsArtifact[]>("GET", `/api/comms/artifacts?projectId=${project.id}`);
  check(artifacts.length === 1 && artifacts[0]!.status === "draft", "communications artifact starts unapproved");
  await call("PUT", `/api/comms/artifacts/${artifacts[0]!.id}`, { status: "approved" });
  check((await raw("GET", `/api/comms/artifacts/${artifacts[0]!.id}/download`)).headers.get("content-disposition")?.includes("attachment"), "approved artifact downloads");
  await call("PUT", "/api/budgets", [{ scope: "workspace", ref: "", monthlyTokens: 0, monthlyUsd: null }]);
  check((await raw("POST", "/api/agents/audie/runs", { proj: project.id })).status === 409, "zero budget pauses provider work");
  await call("PUT", "/api/budgets", []);
  const member = await call<WorkspaceMember>("POST", "/api/members", { name: "Second Person", role: "editor" });
  user = member.id; role = "viewer";
  check((await call<AppState>("GET", "/api/state")).workspace.user.name === member.name, "second browser actor gets own identity");
  check((await raw("DELETE", `/api/projects/${project.id}`)).status === 403, "viewer cannot delete projects");
  role = "editor";
  check((await raw("PUT", "/api/settings/llm", settingsInput)).status === 403, "editor cannot change connection settings");
  await stop(); await start();
  state = await call<AppState>("GET", "/api/state");
  check(state.projects.length === 4 && state.workspace.user.name === member.name, "restart preserves shared projects and selected identity");
  role = "admin";
  check((await raw("POST", "/api/settings/llm/test")).ok, "restart preserves provider token");
  for (const p of state.projects) await call("DELETE", `/api/projects/${p.id}`);
  await stop(); await start();
  check((await call<AppState>("GET", "/api/state")).projects.length === 0, "restart after final deletion stays empty");
  console.log(`Release E2E passed: ${checks} checks, ${provider.calls()} fixture-provider calls.`);
} finally {
  try { await stop(); }
  finally {
    await provider.stop(); rmSync(dir, { recursive: true, force: true });
    if (image) await containerCommand("volume", "rm", "--force", volumeName);
  }
}
