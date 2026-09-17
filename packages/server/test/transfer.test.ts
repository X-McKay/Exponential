// A workspace travels as one JSON document and lands in an empty workspace
// (or replaces one on request) with its facts, readings, and inbox intact.

import { describe, expect, test } from "bun:test";
import type { AppState, MetricReading } from "@valueflow/domain";
import { WorkspaceExportSchema, routes } from "@valueflow/shared";
import type { WorkspaceExport } from "@valueflow/shared";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { SEED_NOW, initializeWorkspace, seedProposals } from "../src/seed.ts";
import type { ImportSummary } from "../src/transfer.ts";
import { BASE, testApp } from "./helpers.ts";

const emptyApp = (withMembers = false) => {
  const db = openDb(":memory:");
  if (withMembers) initializeWorkspace(db);
  const app = createApp(db, { now: () => SEED_NOW });
  const call = async <T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.handleApi(new Request(BASE + path, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
    if (!res) throw new Error("not an api route");
    return { status: res.status, body: (await res.json()) as T };
  };
  return { app, call };
};

describe("workspace export and import", () => {
  test("the export validates against the shared schema and carries no secrets", async () => {
    const app = testApp();
    seedProposals(app.db, SEED_NOW);
    const res = await app.handleApi(new Request(BASE + routes.workspaceExport()));
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-disposition")).toContain("exponential-workspace-2026-09-10.json");
    const text = await res!.text();
    expect(text).not.toContain("apiKey");
    const parsed = WorkspaceExportSchema.safeParse(JSON.parse(text));
    expect(parsed.success).toBe(true);
    const doc = parsed.success ? parsed.data : null;
    expect(doc?.projects.length).toBe(5);
    expect(doc?.projects.find((p) => p.id === "clauses")?.template).toEqual({ id: "automation", version: 1 });
    expect(doc?.proposals.filter((p) => p.state === "pending").length).toBeGreaterThan(0);
    expect(doc?.projects.find((p) => p.id === "invoice")?.readings.length).toBeGreaterThan(30);
  });
  test("importing into an empty workspace reproduces projects, releases, readings, calendar, and the inbox; a populated one is refused unless replaced", async () => {
    const source = testApp();
    seedProposals(source.db, SEED_NOW);
    const doc = (await (await source.handleApi(new Request(BASE + routes.workspaceExport())))!.json()) as WorkspaceExport;
    const before = (await source.get<AppState>(routes.state())).body;

    const target = emptyApp();
    const imported = await target.call<ImportSummary>("POST", routes.workspaceImport(), { document: doc });
    expect(imported.status).toBe(201);
    expect(imported.body).toMatchObject({ replaced: false, projects: 5, proposals: before.proposals.length, skipped: 0 });
    const after = (await target.call<AppState>("GET", routes.state())).body;
    const strip = (s: AppState) => ({
      workspace: s.workspace.user,
      projects: s.projects.map((p) => ({ ...p, milestones: p.milestones.map(({ snapshots: _s, createdAt: _c, ...m }) => m) })),
      releases: s.releases,
      calendar: s.calendar,
      agents: s.agents,
      templates: s.templates,
      rules: s.rules,
      pending: s.proposals.filter((p) => p.state === "pending").map((p) => ({ id: p.id, action: p.action, evidence: p.evidence ?? null })),
    });
    expect(strip(after)).toEqual(strip(before));
    const readings = await target.call<MetricReading[]>("GET", routes.readings("invoice", "MS-12", "acc"));
    expect(readings.body.length).toBe((await source.get<MetricReading[]>(routes.readings("invoice", "MS-12", "acc"))).body.length);
    expect(readings.body.at(-1)?.value).toBe(87);
    // Guards were registered against the imported facts, so a pending proposal is still acceptable.
    const pending = after.proposals.find((p) => p.state === "pending" && p.action.type === "governance_status")!;
    expect((await target.call("POST", routes.proposalAccept(pending.id))).status).toBe(200);

    const refused = await target.call<{ error: string }>("POST", routes.workspaceImport(), { document: doc });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain("already has 5 projects");
    const replaced = await target.call<ImportSummary>("POST", routes.workspaceImport(), { document: { ...doc, projects: doc.projects.slice(0, 2) }, replace: true });
    expect(replaced.status).toBe(201);
    expect(replaced.body.replaced).toBe(true);
    expect(replaced.body.skipped).toBeGreaterThan(0);
    expect((await target.call<AppState>("GET", routes.state())).body.projects.map((p) => p.id)).toEqual(["invoice", "clauses"]);
  });
  test("a malformed document is refused whole and only an administrator may import", async () => {
    const target = emptyApp(true);
    const bad = await target.call<{ error: string }>("POST", routes.workspaceImport(), { document: { format: "something-else" } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toStartWith("validation failed: document.");
    const source = testApp();
    const doc = (await (await source.handleApi(new Request(BASE + routes.workspaceExport())))!.json()) as WorkspaceExport;
    const denied = await target.call<{ error: string }>("POST", routes.workspaceImport(), { document: doc }, { "x-valueflow-role": "editor" });
    expect(denied.status).toBe(403);
    expect((await target.call<AppState>("GET", routes.state())).body.projects).toEqual([]);
    expect((await target.call("POST", routes.workspaceImport(), { document: doc }, { "x-valueflow-role": "admin" })).status).toBe(201);
  });
});
