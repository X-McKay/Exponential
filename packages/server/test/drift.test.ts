// Template drift: a project remembers the template it follows, every saved
// template revision is versioned, and what the project lacks is staged as
// governance-item proposals rather than written.

import { describe, expect, test } from "bun:test";
import { BUILTIN_TEMPLATES, templateDrift, workspaceDrift } from "@valueflow/domain";
import type { AppState, Project, ProjectTemplate, Proposal, TemplateVersion } from "@valueflow/domain";
import { routes } from "@valueflow/shared";
import type { DriftResult } from "../src/drift.ts";
import { testApp } from "./helpers.ts";

const automation = BUILTIN_TEMPLATES.find((t) => t.id === "automation")!;

describe("template drift (domain)", () => {
  test("lists required items the project lacks, open ones, and extras", async () => {
    const app = testApp();
    const state = (await app.get<AppState>(routes.state())).body;
    const clauses = state.projects.find((p) => p.id === "clauses")!;
    expect(clauses.template).toEqual({ id: "automation", version: 1 });
    const drift = templateDrift(clauses, automation, state.templateVersions ?? []);
    expect(drift.createdFrom).toBe(1);
    expect(drift.current).toBe(1);
    expect(drift.aligned).toBe(false);
    expect(drift.missingRequired.map((i) => i.name)).toEqual(["Security review", "Exception queue design", "Audit log design", "Evaluation golden set", "Model access and quota", "Reconciliation data source", "Manual fallback process", "Immutable audit log"]);
    expect(drift.open.map((i) => i.name)).toEqual(["User acceptance testing"]);
    expect(drift.extra.map((g) => g.name)).toContain("Security review and pen test");
    expect(drift.items[0]?.required).toBe(true);
    expect(workspaceDrift(state).map((d) => d.project.id)).toEqual(["invoice", "clauses", "search", "triage", "meetings"]);
  });
});

describe("template drift (server)", () => {
  test("staging is idempotent, attributed to the setup agent, and accepting a backfill adds the item as Missing", async () => {
    const app = testApp();
    const first = await app.send<DriftResult>("POST", routes.projectDrift("clauses"), {});
    expect(first.status).toBe(201);
    expect(first.body.proposals.length).toBe(8);
    expect(first.body.run?.agentId).toBe("setup");
    expect(first.body.proposals[0]).toMatchObject({ proj: "clauses", state: "pending", action: { type: "governance_item", name: "Security review", status: "missing", owner: "JA" }, evidence: { source: "template:automation", verified: true } });
    const again = await app.send<DriftResult>("POST", routes.projectDrift("clauses"), {});
    expect(again.status).toBe(200);
    expect(again.body.proposals).toEqual([]);
    expect(again.body.alreadyStaged).toBe(8);
    const dep = first.body.proposals.find((p) => p.action.type === "governance_item" && p.action.name === "Immutable audit log")!;
    const accepted = await app.send<Proposal>("POST", routes.proposalAccept(dep.id));
    expect(accepted.status).toBe(200);
    const clauses = (await app.get<AppState>(routes.state())).body.projects.find((p) => p.id === "clauses")!;
    expect(clauses.governance.some((g) => g.name === "Immutable audit log" && g.cat === "Dependencies" && g.status === "missing")).toBe(true);
  });
  test("a project without a template is refused until one is linked in the same call", async () => {
    const app = testApp();
    const state = (await app.get<AppState>(routes.state())).body;
    const search = state.projects.find((p) => p.id === "search")!;
    const { milestones: _m, governance: _g, historicalMilestones: _h, ...own } = search;
    void _m; void _g; void _h;
    expect((await app.send("PUT", routes.project("search"), { ...own, template: null })).status).toBe(200);
    const projectOf = async (id: string): Promise<Project> => (await app.get<AppState>(routes.state())).body.projects.find((p) => p.id === id)!;
    expect((await projectOf("search")).template).toBeUndefined();
    const refused = await app.send<{ error: string }>("POST", routes.projectDrift("search"), {});
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain("follows no template");
    const linked = await app.send<DriftResult>("POST", routes.projectDrift("search"), { template: "minimal" });
    expect(linked.status).toBe(201);
    expect(linked.body.drift.template.id).toBe("minimal");
    expect((await projectOf("search")).template).toEqual({ id: "minimal", version: 1 });
    expect((await app.send("POST", routes.projectDrift("search"), { template: "nope" })).status).toBe(409);
  });
  test("saving a changed template records a version and stages the new requirement on every project that follows it", async () => {
    const app = testApp();
    const templates = (await app.get<ProjectTemplate[]>(routes.templates())).body;
    const edited = templates.map((t) => (t.id === "insight" ? { ...t, documents: [...t.documents, { cat: "AI governance", name: "Bias review", detail: "Checked before rollout.", required: true }] } : t));
    expect((await app.send("PUT", routes.templates(), edited)).status).toBe(200);
    const versions = (await app.get<AppState>(routes.state())).body.templateVersions ?? [];
    expect(versions.find((v) => v.templateId === "insight")?.version).toBe(2);
    expect(versions.filter((v) => v.templateId === "assistant").map((v) => v.version)).toEqual([1]);
    const history = (await app.get<(TemplateVersion & { doc: ProjectTemplate })[]>(routes.templateVersions("insight"))).body;
    expect(history.map((h) => h.version)).toEqual([2, 1]);
    expect(history[0]?.doc.documents.some((d) => d.name === "Bias review")).toBe(true);
    const pending = (await app.get<AppState>(routes.state())).body.proposals.filter((p) => p.state === "pending" && p.action.type === "governance_item" && p.action.name === "Bias review");
    expect(pending.map((p) => p.proj).sort()).toEqual(["meetings", "search"]);
    expect(pending[0]?.rationale).toContain("Analysis and drafting copilot template v2");
    expect((await app.get(routes.templateVersions("missing-template"))).status).toBe(404);
    // Saving again without changes records nothing new.
    await app.send("PUT", routes.templates(), edited);
    expect(((await app.get<AppState>(routes.state())).body.templateVersions ?? []).find((v) => v.templateId === "insight")?.version).toBe(2);
  });
});
