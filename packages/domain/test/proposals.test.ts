// Proposal diffs, evidence checks, and agent economics are pure derivations.

import { describe, expect, test } from "bun:test";
import { economics, evidenceFor, proposalDiff, quoteAppearsIn, seedState } from "../src/index.ts";
import type { AgentRun, Proposal } from "../src/index.ts";

describe("proposalDiff", () => {
  const state = seedState();
  test("an update lists only the fields the proposal sets, marking the ones that change", () => {
    const d = proposalDiff({ type: "governance_update", gid: "sla", status: "draft", owner: "AR", detail: "Turnaround: 2 days." }, state, "clauses");
    expect(d.kind).toBe("update");
    expect(d.target).toBe("Operations · Service level agreement");
    expect(d.rows).toEqual([
      { label: "Status", before: "Missing", after: "Draft", changed: true },
      { label: "Owner", before: "AR", after: "AR", changed: false },
      { label: "Detail", before: "Not started. Needed before pilot exit; extraction turnaround target to be agreed with legal operations.", after: "Turnaround: 2 days.", changed: true },
    ]);
  });
  test("a create has no before values; a missing target is reported rather than guessed", () => {
    const c = proposalDiff({ type: "milestone_create", name: "Analytics", status: "backlog", month: "2027-01", impact: { base: { fte: 1, time: 2 }, stretch: { fte: 3, time: 4 } }, metrics: [{ label: "Adoption", base: 50, stretch: 80 }] }, state, "clauses");
    expect(c.kind).toBe("create");
    expect(c.rows.every((r) => r.before === null && r.changed)).toBe(true);
    expect(c.rows.map((r) => r.label)).toEqual(["Name", "Status", "Month", "Impact", "Metrics"]);
    const gone = proposalDiff({ type: "milestone_update", mid: "MS-99", month: "2027-01" }, state, "clauses");
    expect(gone.missing).toBe(true);
    expect(gone.rows).toEqual([]);
    const rel = proposalDiff({ type: "release_update", rid: "R1", month: "2026-12" }, state, "clauses");
    expect(rel.target).toStartWith("Release R1 · ");
    expect(rel.rows).toEqual([{ label: "Month", before: "2026-10", after: "2026-12", changed: true }]);
  });
});

describe("evidence", () => {
  const sources = [{ name: "charter-v2.md", text: "The pilot moves to Scaling in Q1.\nQuinn Abara joins as Quality Analyst — from next sprint." }];
  test("a quote counts as verified only when it appears verbatim, ignoring case, spacing, and dashes", () => {
    expect(quoteAppearsIn("the pilot moves to scaling in Q1", sources[0]!.text)).toBe(true);
    expect(quoteAppearsIn("Quinn Abara joins as Quality Analyst - from next   sprint", sources[0]!.text)).toBe(true);
    expect(quoteAppearsIn("pilot", sources[0]!.text)).toBe(false);
    expect(quoteAppearsIn("The pilot moves to Sustain in Q1.", sources[0]!.text)).toBe(false);
  });
  test("evidenceFor keeps the source and quote, checks the named document first, and is null when nothing was cited", () => {
    expect(evidenceFor("charter-v2.md", "The pilot moves to Scaling in Q1.", sources)).toEqual({ source: "charter-v2.md", quote: "The pilot moves to Scaling in Q1.", verified: true });
    expect(evidenceFor("deck.pptx", "The pilot moves to Scaling in Q1.", sources)?.verified).toBe(true);
    expect(evidenceFor("charter-v2.md", "The pilot is cancelled.", sources)?.verified).toBe(false);
    expect(evidenceFor("charter-v2.md", "", sources)).toEqual({ source: "charter-v2.md", quote: null, verified: false });
    expect(evidenceFor(null, null, sources)).toBeNull();
  });
});

describe("economics", () => {
  const state = seedState();
  const run = (id: string, agentId: string, proj: string | null, tokens: number, model = "m"): AgentRun => ({ id, agentId, proj, tab: "overview", state: "done", startedAt: "2026-09-09T10:00:00.000Z", finishedAt: "2026-09-09T10:01:00.000Z", instruction: null, summary: "", output: "", model, error: null, promptVersion: null, latencyMs: 1000, promptTokens: tokens, completionTokens: 0, benchmark: null, rating: null, ratingNote: null });
  const proposal = (id: string, runId: string, agentId: string, proj: string | null, st: Proposal["state"]): Proposal => ({ id, runId, agentId, proj, ruleId: null, action: { type: "targets", fte: 1, time: 1 }, rationale: "", state: st, createdAt: "2026-09-09T10:01:00.000Z", decidedAt: null });
  test("spend, outcomes, and cost per accepted proposal by agent, project, and template", () => {
    const runs = [run("r1", "audie", "clauses", 1_000_000), run("r2", "audie", "invoice", 1_000_000), run("r3", "setup", "search", 2_000_000, "unpriced"), run("r4", "monday", null, 500_000)];
    const proposals = [proposal("p1", "r1", "audie", "clauses", "accepted"), proposal("p2", "r1", "audie", "clauses", "dismissed"), proposal("p3", "r2", "audie", "invoice", "accepted"), proposal("p4", "r3", "setup", "search", "pending")];
    const e = economics({ ...state, runs, proposals }, { m: { input: 1, output: 2 } }, state.asOf);
    expect(e.priced).toBe(true);
    expect(e.total).toMatchObject({ runs: 4, tokens: 4_500_000, usd: 2.5, unpriced: 1, proposals: 4, accepted: 2, dismissed: 1, pending: 1, acceptanceRate: 2 / 3, usdPerAccepted: 1.25 });
    const audie = e.byAgent.find((l) => l.id === "audie")!;
    expect(audie).toMatchObject({ runs: 2, usd: 2, accepted: 2, usdPerAccepted: 1, tokensPerAccepted: 1_000_000, share: 0.8 });
    expect(e.byAgent.map((l) => l.id)).toEqual(["audie", "monday", "setup"]);
    expect(e.byProject.find((l) => l.id === "")).toMatchObject({ name: "Workspace-wide", runs: 1 });
    expect(e.byTemplate.map((l) => [l.id, l.runs])).toEqual([["assistant", 1], ["automation", 1], ["insight", 1]]);
    // Without prices the share is by tokens.
    const t = economics({ ...state, runs, proposals }, {}, state.asOf);
    expect(t.priced).toBe(false);
    expect(t.byAgent.find((l) => l.id === "setup")?.share).toBeCloseTo(2_000_000 / 4_500_000);
  });
});
