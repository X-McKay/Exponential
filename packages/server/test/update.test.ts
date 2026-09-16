// Update a project from documents: the setup agent stages record changes as
// proposals, no-ops and unknown targets are dropped, and accepting each kind of
// change applies it through the repository (or is refused when the record moved).

import { describe, expect, test } from "bun:test";
import type { AgentRun, AppState, Proposal } from "@valueflow/domain";
import { routes } from "@valueflow/shared";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import type { Llm } from "../src/llm.ts";
import { seed } from "../src/seed.ts";
import { buildUpdateMessages, parseUpdate } from "../src/update.ts";
import { BASE } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

const NOW = new Date("2026-09-10T12:00:00Z");

const REPLY = {
  summary: "Revised charter moves the pilot and names a new SRE",
  notes: ["The charter and the deck disagree on the SLA target."],
  proposals: [
    { type: "project_details", source: "charter-v2.md", rationale: "Charter v2 says the project is now scaling.", description: null, stage: "Scaling", tier: null, committeeDate: null, committeeRef: null },
    { type: "project_details", source: "charter-v2.md", rationale: "Already Pilot.", description: null, stage: "Pilot", tier: null, committeeDate: null, committeeRef: null },
    { type: "targets", source: "charter-v2.md", rationale: "Targets revised to 35/55.", fte: 35, time: 55 },
    { type: "team_member", source: "charter-v2.md", rationale: "New SRE named.", name: "Priya Nair", role: "SRE" },
    { type: "repo", source: "deck.pptx", rationale: "New repo listed.", name: "clause-monitor", url: "github.com/org/clause-monitor" },
    { type: "governance_update", source: "charter-v2.md", rationale: "SLA now drafted with the ops team.", gid: "sla", status: "draft", owner: null, date: null, detail: "Turnaround target: 2 business days." },
    { type: "governance_update", source: "charter-v2.md", rationale: "Nothing new.", gid: "sla", status: "missing", owner: null, date: null, detail: null },
    { type: "governance_item", source: "charter-v2.md", rationale: "Charter requires it.", cat: "Operations", name: "Immutable audit log", status: "missing", owner: "Priya Nair", detail: "Tier 1 exposure." },
    { type: "milestone_update", source: "charter-v2.md", rationale: "Parser slips to December.", mid: "MS-22", name: null, status: null, month: "2026-12", impact: null },
    { type: "milestone_update", source: "charter-v2.md", rationale: "Unknown.", mid: "MS-99", name: null, status: null, month: "2026-12", impact: null },
    { type: "milestone_create", source: "deck.pptx", rationale: "New milestone on slide 4.", name: "Reviewer analytics", status: "backlog", month: "2027-03", impact: { base: { fte: 3, time: 5 }, stretch: { fte: 5, time: 8 } }, metrics: [{ label: "Dashboard adoption", base: 60, stretch: 85 }] },
    { type: "release_update", source: "deck.pptx", rationale: "Shadow mode slips a month.", rid: "R1", name: null, month: "2026-11", milestoneIds: null, criteria: null },
    { type: "release_create", source: "deck.pptx", rationale: "A fourth release is planned.", name: "Analytics rollout", month: "2027-04", milestoneIds: ["Reviewer analytics", "MS-23"], criteria: [{ type: "gate", ref: "MS-23", label: "Workbench gate" }, { type: "gov", ref: "docs", label: "Docs approved" }, { type: "manual", ref: "", label: "Ops sign-off" }] },
    { type: "calendar_event", source: "charter-v2.md", rationale: "Steering review scheduled.", date: "2026-10-02", text: "Steering review of the revised charter", sub: null, tab: "overview" },
    { type: "targets", source: "charter-v2.md", rationale: "duplicate", fte: 35, time: 55 },
  ],
};

const fakeLlm = (reply: unknown): Llm => ({
  model: () => Promise.resolve("fake"),
  chat: () => Promise.resolve({ content: JSON.stringify(reply), model: "fake", usage: { prompt: 1000, completion: 300 }, truncated: false }),
  describe: () => ({ baseUrl: "http://fake", model: "fake", models: ["fake"], judgeModel: null, prices: {} }),
});

const appWith = (llm: Llm | null): TestApp => {
  const db = openDb(":memory:");
  seed(db);
  const app = createApp(db, { now: () => NOW, llm, autoJudge: false });
  const call = async <T>(method: string, path: string, body?: unknown) => {
    const form = body instanceof FormData;
    const res = await app.handleApi(new Request(BASE + path, { method, headers: body === undefined || form ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) }));
    if (!res) throw new Error("not an api route");
    return { status: res.status, body: (await res.json()) as T };
  };
  return { ...app, get: (path) => call("GET", path), send: (method, path, body) => call(method, path, body) };
};

const upload = (note = "") => {
  const form = new FormData();
  form.set("note", note);
  form.append("file", new File(["Stage: Scaling. Targets: 35% FTE, 55% time. New SRE: Priya Nair."], "charter-v2.md", { type: "text/markdown" }));
  form.append("snippet", "Slide 4: Reviewer analytics milestone, March 2027.");
  return form;
};

describe("parseUpdate", () => {
  test("keeps changes the project can take, drops no-ops, duplicates, and unknown targets, and resolves names to ids", () => {
    const state = (() => { const db = openDb(":memory:"); seed(db); const { loadState } = require("../src/repo.ts") as typeof import("../src/repo.ts"); return loadState(db, NOW); })();
    const ima = state.projects.find((p) => p.id === "clauses")!;
    const parsed = parseUpdate(REPLY, ima, state.releases.clauses ?? [], "JA");
    expect(parsed.returned).toBe(15);
    expect(parsed.proposals.map((p) => p.action.type)).toEqual([
      "project_details", "targets", "team_member", "repo", "governance_update", "governance_item", "milestone_update", "milestone_create", "release_update", "release_create", "calendar_event",
    ]);
    const byType = Object.fromEntries(parsed.proposals.map((p) => [p.action.type, p.action]));
    expect(byType.project_details).toEqual({ type: "project_details", stage: "Scaling" });
    expect(byType.team_member).toEqual({ type: "team_member", ini: "PN", name: "Priya Nair", role: "SRE" });
    expect(byType.governance_update).toEqual({ type: "governance_update", gid: "sla", status: "draft", detail: "Turnaround target: 2 business days." });
    expect(byType.governance_item).toMatchObject({ owner: "PN" });
    expect(byType.release_create).toMatchObject({ milestoneIds: ["MS-23"], criteria: [{ type: "gate", ms: "MS-23", label: "Workbench gate" }, { type: "gov", gid: "docs", label: "Docs approved" }, { type: "manual", ok: false, label: "Ops sign-off" }] });
    expect(parsed.proposals[0]?.rationale).toBe("charter-v2.md: Charter v2 says the project is now scaling.");
    expect(parsed.notes).toEqual(["The charter and the deck disagree on the SLA target."]);
    expect(parseUpdate("garbage", ima, [], "JA").proposals).toEqual([]);
  });
  test("the briefing carries the current record, the documents, and the note", () => {
    const db = openDb(":memory:"); seed(db);
    const { loadState } = require("../src/repo.ts") as typeof import("../src/repo.ts");
    const state = loadState(db, NOW);
    const ima = state.projects.find((p) => p.id === "clauses")!;
    const msgs = buildUpdateMessages({ name: "Setup", prompt: "Prefer small changes." }, state, ima, [{ name: "charter-v2.md", kind: "text", text: "Stage: Scaling.", chars: 15, error: null, truncated: false }], "Please check the SLA.", "2026-09");
    expect(msgs[0]?.content).toContain("Prefer small changes.");
    expect(msgs[1]?.content).toContain("Note from the person uploading the documents:\nPlease check the SLA.");
    expect(msgs[1]?.content).toContain("# Current project record");
    expect(msgs[1]?.content).toContain("### Source: charter-v2.md (text)\nStage: Scaling.");
  });
});

describe("POST /api/projects/:pid/update", () => {
  test("stages proposals in the inbox without changing the project, then each accepted change applies", async () => {
    const app = appWith(fakeLlm(REPLY));
    const before = (await app.get<AppState>(routes.state())).body;
    const res = await app.send<{ run: AgentRun; proposals: Proposal[]; dropped: number; sources: { name: string; error: string | null }[] }>("POST", routes.projectUpdate("clauses"), upload("Charter v2 attached."));
    expect(res.status).toBe(201);
    expect(res.body.run.state).toBe("done");
    expect(res.body.run.agentId).toBe("setup");
    expect(res.body.run.summary).toStartWith("Staged 11 changes from 2 documents");
    expect(res.body.dropped).toBe(4);
    expect(res.body.sources.map((s) => s.name)).toEqual(["snippet 1", "charter-v2.md"]);
    expect(res.body.proposals.every((p) => p.state === "pending" && p.proj === "clauses" && p.agentId === "setup")).toBe(true);
    const staged = (await app.get<AppState>(routes.state())).body;
    // Nothing applied yet.
    expect(staged.projects.find((p) => p.id === "clauses")).toEqual(before.projects.find((p) => p.id === "clauses"));
    expect(staged.proposals.filter((p) => p.state === "pending").length).toBe(11);

    for (const p of res.body.proposals) {
      const accepted = await app.send<Proposal | { error: string }>("POST", routes.proposalAccept(p.id));
      expect([accepted.status, p.action.type]).toEqual([200, p.action.type]);
    }
    const after = (await app.get<AppState>(routes.state())).body;
    const ima = after.projects.find((p) => p.id === "clauses")!;
    expect(ima.stage).toBe("Scaling");
    expect(ima.targets).toEqual({ fte: 35, time: 55 });
    expect(ima.team.some((t) => t.ini === "PN" && t.role === "SRE")).toBe(true);
    expect(ima.repos.some((r) => r.name === "clause-monitor")).toBe(true);
    expect(ima.governance.find((g) => g.id === "sla")).toMatchObject({ status: "draft", detail: "Turnaround target: 2 business days." });
    expect(ima.governance.some((g) => g.id === "immutable-audit-log" && g.owner === "PN")).toBe(true);
    expect(ima.milestones.find((m) => m.id === "MS-22")?.month).toBe("2026-12");
    const created = ima.milestones.find((m) => m.name === "Reviewer analytics")!;
    expect(created.id).toBe("MS-24");
    expect(created.metrics).toEqual([{ id: "dashboard-adoption", label: "Dashboard adoption", base: 60, stretch: 85, current: 0, readAt: null, readSource: null }]);
    expect(after.releases.clauses?.find((r) => r.id === "R1")?.month).toBe("2026-11");
    expect(after.releases.clauses?.find((r) => r.id === "R4")).toMatchObject({ name: "Analytics rollout", milestoneIds: ["MS-23"] });
    expect(after.calendar.some((c) => c.text === "Steering review of the revised charter")).toBe(true);
    expect(after.events.some((e) => e.text.includes("Service level agreement moved to Draft"))).toBe(true);
  });
  test("a change is refused once the record it would overwrite has moved", async () => {
    const app = appWith(fakeLlm({ summary: "x", notes: [], proposals: [{ type: "milestone_update", source: "a", rationale: "b", mid: "MS-22", name: null, status: null, month: "2026-12", impact: null }] }));
    const res = await app.send<{ proposals: Proposal[] }>("POST", routes.projectUpdate("clauses"), upload());
    const [p] = res.body.proposals;
    const ms = (await app.get<AppState>(routes.state())).body.projects.find((x) => x.id === "clauses")!.milestones.find((m) => m.id === "MS-22")!;
    await app.send("PUT", routes.milestone("clauses", "MS-22"), { ...ms, month: "2027-01" });
    const refused = await app.send<{ error: string }>("POST", routes.proposalAccept(p!.id));
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain("stale");
  });
  test("refuses without a model, with nothing to read, and for an unknown project", async () => {
    expect((await appWith(null).send("POST", routes.projectUpdate("clauses"), upload())).status).toBe(409);
    const app = appWith(fakeLlm(REPLY));
    const empty = new FormData();
    expect((await app.send<{ error: string }>("POST", routes.projectUpdate("clauses"), empty)).status).toBe(409);
    expect((await app.send("POST", routes.projectUpdate("nope"), upload())).status).toBe(404);
    expect((await app.send("POST", routes.projectUpdate("clauses"), { note: "json" })).status).toBe(400);
  });
});
