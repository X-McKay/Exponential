// Provenance: every derived number explains itself down to the facts, and the
// explanation agrees with the derivation it traces.

import { describe, expect, test } from "bun:test";
import { SEED_ASOF, calendarFor, explainGatesCleared, explainReadiness, explainRealized, explainRelease, explainRuns, explainTier, readiness, realized, releaseState, seedState, tierOf, touches } from "../src/index.ts";
import type { Explanation, Proposal } from "../src/index.ts";

const cal = calendarFor(SEED_ASOF, ["2026-01", "2027-03"]);
const state = seedState();
const ima = state.projects.find((p) => p.id === "ima")!;
const onboarding = state.projects.find((p) => p.id === "onboarding")!;

const leaves = (e: Explanation): Explanation[] => (e.fact ? [e] : []).concat(e.inputs.flatMap(leaves));

describe("explanations trace the derivation", () => {
  test("readiness lists every governance item and counts what the derivation counts", () => {
    const e = explainReadiness(ima);
    expect(e.value).toBe(`${Math.round(readiness(ima) * 100)}%`);
    expect(e.inputs.length).toBe(ima.governance.length);
    expect(e.inputs.every((i) => i.fact?.kind === "governance")).toBe(true);
    expect(e.rule).toMatch(/approved of \d+ required/);
  });

  test("a milestone's gate explains the status and every metric against its thresholds", () => {
    const m = ima.milestones.find((x) => x.id === "MS-21")!;
    const e = explainTier(ima, m);
    expect(tierOf(m)).toBe(0);
    expect(e.value).toBe("Below the base gate");
    expect(e.rule).toMatch(/^1 of 2 metrics below its base threshold/);
    expect(e.inputs.map((i) => i.fact?.kind)).toEqual(["milestone", "metric", "metric"]);
    expect(e.inputs[2]?.value).toMatch(/^86% · below base \(base ≥ 88%/);
  });

  test("realized value sums the shipped milestones' gated impact and ends in facts", () => {
    const e = explainRealized(onboarding, "fte");
    expect(e.value).toBe(`${realized(onboarding, "fte")}%`);
    expect(e.inputs[0]?.fact).toEqual({ kind: "targets", proj: "onboarding" });
    const contributing = e.inputs.slice(1).filter((i) => i.value !== "0%");
    expect(contributing.length).toBeGreaterThan(0);
    expect(contributing.every((i) => /clearing the (base|stretch) gate/.test(i.rule ?? ""))).toBe(true);
    const unshipped = e.inputs.slice(1).find((i) => i.rule?.startsWith("not shipped"));
    expect(unshipped?.value).toBe("0%");
    expect(leaves(e).every((l) => l.fact !== null)).toBe(true);
  });

  test("a release explains each criterion with the gate or governance item behind it", () => {
    const r = state.releases.ima!.find((x) => x.id === "R1")!;
    const e = explainRelease(ima, r, cal);
    const st = releaseState(r, ima, cal);
    expect(e.value).toBe(`${st.label} · ${st.met} of ${st.total} criteria met`);
    expect(e.inputs.length).toBe(r.criteria.length);
    const gate = e.inputs.find((i) => i.fact?.kind === "criterion" && i.inputs[0]?.label.endsWith("· gate"));
    expect(gate).toBeDefined();
    expect(e.inputs.every((i) => i.fact?.kind === "criterion")).toBe(true);
    expect(explainGatesCleared(ima).inputs.every((i) => i.label.endsWith("· gate"))).toBe(true);
  });

  test("touches name the accepted proposal that changed a fact and the reading behind a metric", () => {
    const accepted: Proposal = { id: "prop-9", runId: "run-1", agentId: "audie", proj: "ima", ruleId: "rule-2", action: { type: "governance_status", gid: "sla", status: "approved" }, rationale: "", state: "accepted", createdAt: SEED_ASOF, decidedAt: SEED_ASOF };
    const pending: Proposal = { ...accepted, id: "prop-10", state: "pending", decidedAt: null };
    const s = { ...state, proposals: [accepted, pending] };
    const t = touches(s, { kind: "governance", proj: "ima", gid: "sla" });
    expect(t.map((x) => [x.who, x.what])).toEqual([["Audie", "rule rule-2 via proposal prop-9, accepted"]]);
    expect(touches(s, { kind: "governance", proj: "ima", gid: "other" })).toEqual([]);
    const withReading = { ...s, projects: s.projects.map((p) => (p.id !== "ima" ? p : { ...p, milestones: p.milestones.map((m) => (m.id !== "MS-21" ? m : { ...m, metrics: m.metrics.map((x) => (x.id === "rec" ? { ...x, readAt: "2026-09-09T10:00:00Z", readSource: "eval" as const } : x)) })) })) };
    expect(touches(withReading, { kind: "metric", proj: "ima", mid: "MS-21", xid: "rec" }).map((x) => x.what)).toEqual(["reading 86% recorded"]);
  });

  test("spend explains per agent, then per run, each run a fact", () => {
    const e = explainRuns("Spend", "$1", "runs this month", state.runs.slice(0, 5), state, (r) => r.id);
    expect(e.inputs.length).toBeGreaterThan(0);
    expect(e.inputs.every((a) => a.inputs.every((r) => r.fact?.kind === "run"))).toBe(true);
  });

  test("ledger usage rows do not link to a nonexistent agent run", () => {
    const source = state.runs[0]!;
    const usage = { ...source, id: "usage-42", summary: "LLM succeeded attempt" };
    const e = explainRuns("Spend", "$1", "ledger usage", [usage], state, (r) => r.id);
    expect(e.inputs[0]?.inputs[0]?.fact).toBeNull();
  });
});
