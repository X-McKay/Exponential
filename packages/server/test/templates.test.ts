// Project templates: built-ins install once, the list is editable and validated,
// and creating from a template writes documents, dependencies, and a plan whose
// releases reference the items by the ids assigned on creation.

import { describe, expect, test } from "bun:test";
import { BUILTIN_TEMPLATES, DEPENDENCY_CATEGORY, instantiateTemplate, missingFromTemplate, templateSummary } from "@valueflow/domain";
import type { AppState, Project, ProjectTemplate } from "@valueflow/domain";
import { TemplateSchema, routes } from "@valueflow/shared";
import { openDb } from "../src/db.ts";
import { ensureTemplates, initializeWorkspace } from "../src/seed.ts";
import { testApp } from "./helpers.ts";

const assistant = BUILTIN_TEMPLATES.find((t) => t.id === "assistant")!;

describe("templates (domain)", () => {
  test("instantiating resolves months, ids, and criteria references", () => {
    const inst = instantiateTemplate(assistant, "2026-09", "ME");
    expect(inst.milestones.map((m) => `${m.id}:${m.month}`)).toEqual(["MS-1:2026-11", "MS-2:2027-01", "MS-3:2027-05"]);
    expect(inst.milestones.every((m) => m.status === "backlog" && m.metrics.every((x) => x.current === 0))).toBe(true);
    expect(inst.governance.filter((g) => g.cat === DEPENDENCY_CATEGORY).map((g) => g.name)).toEqual(assistant.dependencies.map((d) => d.name));
    expect(inst.governance.every((g) => g.status === "missing" && g.owner === "ME")).toBe(true);
    const pilot = inst.releases[0]!;
    expect(pilot.milestoneIds).toEqual(["MS-1", "MS-2"]);
    expect(pilot.criteria).toEqual([
      { type: "gate", ms: "MS-2", label: "Pilot base gate" },
      { type: "gov", gid: "ai-committee-review", label: "AI committee approval" },
      { type: "gov", gid: "data-privacy-assessment", label: "Privacy assessment approved" },
      { type: "manual", ok: false, label: "Pilot cohort confirmed" },
    ]);
    expect(templateSummary(assistant)).toBe("15 documents · 4 dependencies · 3 milestones · 2 releases");
  });
  test("every built-in template satisfies the shared schema and every criterion resolves", () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(TemplateSchema.safeParse(t).success).toBe(true);
      const inst = instantiateTemplate(t, "2026-01", "ME");
      const want = t.releases.reduce((n, r) => n + r.criteria.length, 0);
      expect(inst.releases.reduce((n, r) => n + r.criteria.length, 0)).toBe(want);
    }
  });
  test("missingFromTemplate lists only required items the project lacks, case-insensitively", () => {
    const have = [{ name: "ai committee review" }, { name: "Evaluation golden set" }];
    const missing = missingFromTemplate(assistant, have);
    expect(missing.documents.some((d) => d.name === "AI committee review")).toBe(false);
    expect(missing.documents.some((d) => d.name === "Service level agreement")).toBe(false); // optional
    expect(missing.documents.some((d) => d.name === "Runbook and rollback plan")).toBe(true);
    expect(missing.dependencies.map((d) => d.name)).toEqual(["Model access and quota", "Source data access", "Reviewer staffing"]);
  });
  test("the schema rejects dangling criteria and duplicate names", () => {
    const broken: ProjectTemplate = { ...assistant, releases: [{ name: "X", monthsOut: 1, milestones: [9], criteria: [{ type: "document", name: "Nope", label: "x" }] }] };
    const issues = TemplateSchema.safeParse(broken);
    expect(issues.success).toBe(false);
    if (!issues.success) expect(issues.error.issues.map((i) => i.message)).toEqual(["milestone index out of range", "no document or dependency named Nope"]);
    const dup = { ...assistant, dependencies: [...assistant.dependencies, { name: "AI committee review", detail: "", required: true }] };
    expect(TemplateSchema.safeParse(dup).success).toBe(false);
  });
});

describe("templates (server)", () => {
  test("a fresh workspace installs the built-ins once and keeps edits", () => {
    const db = openDb(":memory:");
    initializeWorkspace(db);
    expect(ensureTemplates(db)).toBe(0);
    const app = testApp();
    expect((app.get<ProjectTemplate[]>(routes.templates()) as Promise<{ body: ProjectTemplate[] }>)).resolves.toMatchObject({ body: expect.arrayContaining([expect.objectContaining({ id: "assistant" })]) });
  });
  test("PUT replaces the list after validation; a broken document is refused whole", async () => {
    const app = testApp();
    const one = [{ ...BUILTIN_TEMPLATES.find((t) => t.id === "minimal")!, name: "Tiny" }];
    const ok = await app.send<ProjectTemplate[]>("PUT", routes.templates(), one);
    expect(ok.status).toBe(200);
    expect(ok.body.map((t) => t.name)).toEqual(["Tiny"]);
    const bad = await app.send<{ error: string }>("PUT", routes.templates(), [{ ...one[0], id: "Bad Id" }]);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toStartWith("validation failed: 0.id");
    expect((await app.get<ProjectTemplate[]>(routes.templates())).body.map((t) => t.name)).toEqual(["Tiny"]);
    expect((await app.get<AppState>(routes.state())).body.templates?.map((t) => t.id)).toEqual(["minimal"]);
  });
  test("creating from a template adds documents, dependencies, milestones, and releases in one go", async () => {
    const app = testApp();
    const project = { id: "kyc-refresh", key: "PRJ-10", name: "KYC refresh", stage: "Discovery", description: "", tier: 2 as const, committee: null, repos: [], team: [], targets: { fte: 25, time: 35 } };
    const created = await app.send<Project>("POST", routes.templateCreate("assistant"), { project, owner: "ME" });
    expect(created.status).toBe(201);
    expect(created.body.governance.length).toBe(assistant.documents.length + assistant.dependencies.length);
    expect(created.body.governance.filter((g) => g.cat === DEPENDENCY_CATEGORY).length).toBe(4);
    expect(created.body.milestones.map((m) => m.id)).toEqual(["MS-1", "MS-2", "MS-3"]);
    const state = (await app.get<AppState>(routes.state())).body;
    expect(state.releases["kyc-refresh"]?.map((r) => `${r.id}:${r.criteria.length}`)).toEqual(["R1:4", "R2:4"]);
    expect(state.events[0]?.text).toContain("created from the Human-in-the-loop assistant template");
    // Documents only: no plan, same documents.
    const docsOnly = await app.send<Project>("POST", routes.templateCreate("assistant"), { project: { ...project, id: "kyc-2", key: "PRJ-11" }, owner: "ME", documentsOnly: true });
    expect(docsOnly.status).toBe(201);
    expect(docsOnly.body.milestones).toEqual([]);
    expect(docsOnly.body.governance.length).toBe(created.body.governance.length);
    expect((await app.send("POST", routes.templateCreate("nope"), { project: { ...project, id: "kyc-3" }, owner: "ME" })).status).toBe(404);
    expect((await app.send("POST", routes.templateCreate("assistant"), { project, owner: "ME" })).status).toBe(409);
  });
});
