// The mockup's signature interaction, end to end through the API:
// seed → record a metric across its base gate → the release's go-live criterion
// flips, the Glance "Below gate" card retires, and once governance catches up
// the "Blocking release" card is replaced by "Ready to ship".

import { describe, expect, test } from "bun:test";
import { calendarOf, eligible, releaseState } from "@valueflow/domain";
import type { AppState, Glance, Metric, MetricReading } from "@valueflow/domain";
import { routes } from "@valueflow/shared";
import { testApp } from "./helpers.ts";

const releaseOf = async (app: ReturnType<typeof testApp>, pid: string, rid: string) => {
  const state = (await app.get<AppState>(routes.state())).body;
  const p = state.projects.find((x) => x.id === pid)!;
  const r = state.releases[pid]!.find((x) => x.id === rid)!;
  return releaseState(r, p, calendarOf(state));
};

describe("integration: metric crosses a gate", () => {
  test("IMA R1 goes Blocked → Ready as recall clears base and governance approves", async () => {
    const app = testApp();

    // 1. Seeded state: recall 86 < base 88 → gate not met, R1 blocked, Glance shows it.
    let st = await releaseOf(app, "clauses", "R1");
    expect(st.label).toBe("Blocked");
    expect(st.evals[0]).toMatchObject({ ok: false, pending: false, sub: "Clause precision 94% · Clause recall 86%" });

    let glance = (await app.get<Glance>(routes.glance())).body;
    expect(glance.blocks.find((b) => b.kind === "blocked_release")?.title).toBe("R1 Shadow mode — 1/4 go-live criteria met (target Oct)");
    expect(glance.blocks.filter((b) => b.kind === "below_gate").map((b) => (b.kind === "below_gate" ? b.milestone.id : ""))).toEqual(["MS-13", "MS-31"]);
    expect(glance.narrative[0]).toStartWith("One release is blocked — R1 Shadow mode");

    // 2. Explicitly record recall across the base gate via the measurement API.
    const put = await app.send<{ reading: MetricReading; metric: Metric }>("PUT", routes.readings("clauses", "MS-21", "rec"), { value: 90, source: "manual" });
    expect(put.status).toBe(201);
    expect(put.body.metric.current).toBe(90);

    st = await releaseOf(app, "clauses", "R1");
    expect(st.evals[0]).toMatchObject({ ok: true, sub: "Clause precision 94% · Clause recall 90%" });
    expect(st.met).toBe(2);
    expect(st.label).toBe("Blocked");

    glance = (await app.get<Glance>(routes.glance())).body;
    // MS-21 is no longer a shortfall; the blocking card's first row is now met.
    const blocked = glance.blocks.find((b) => b.kind === "blocked_release");
    expect(blocked?.title).toBe("R1 Shadow mode — 2/4 go-live criteria met (target Oct)");
    expect(blocked && blocked.kind === "blocked_release" ? blocked.rows[0]!.eval.ok : null).toBe(true);
    expect(glance.blocks.some((b) => b.kind === "below_gate" && b.milestone.id === "MS-21")).toBe(false);

    // 3. Governance catches up through the editor API.
    for (const gid of ["sec", "mra"]) {
      const res = await app.send("PUT", routes.governance("clauses", gid), { status: "approved", owner: "TO", date: "2026-09-20", detail: "Approved." });
      expect(res.status).toBe(200);
    }
    st = await releaseOf(app, "clauses", "R1");
    expect(st).toMatchObject({ met: 4, total: 4, label: "Ready", tone: "good" });

    glance = (await app.get<Glance>(routes.glance())).body;
    expect(glance.blocks.some((b) => b.kind === "blocked_release")).toBe(false);
    expect(glance.blocks.some((b) => b.kind === "ready_release")).toBe(true);
    expect(glance.narrative[0]).toBe("2 near-term releases are at risk.");

    // 4. Record a regression below the gate: eligibility follows current evidence.
    await app.send("PUT", routes.readings("clauses", "MS-21", "rec"), { value: 80 });
    st = await releaseOf(app, "clauses", "R1");
    expect(st).toMatchObject({ met: 3, label: "Blocked" });
    glance = (await app.get<Glance>(routes.glance())).body;
    expect(glance.blocks.some((b) => b.id === "ready_release:clauses:R1")).toBe(false);
    expect(glance.blocks.some((b) => b.kind === "below_gate" && b.milestone.id === "MS-21")).toBe(true);

    // The full history is preserved: 30 seeded + 2 manual readings.
    const history = (await app.get<MetricReading[]>(routes.readings("clauses", "MS-21", "rec"))).body;
    expect(history.length).toBe(32);
    expect(history.slice(-2).map((r) => r.value)).toEqual([90, 80]);
  });

  test("shipped milestone crossing stretch raises eligible value on the portfolio", async () => {
    const app = testApp();
    const before = (await app.get<AppState>(routes.state())).body.projects[0]!;
    expect(before.milestones.find((m) => m.id === "MS-12")!.metrics.map((x) => x.current)).toEqual([87, 82]);
    await app.send("PUT", routes.readings("invoice", "MS-12", "acc"), { value: 96 });
    await app.send("PUT", routes.readings("invoice", "MS-12", "cov"), { value: 95 });
    const after = (await app.get<AppState>(routes.state())).body.projects[0]!;
    expect(eligible(after, "fte")).toBe(20);
    // The trajectory card follows whichever project is closest to its target; the crossing shows on the portfolio either way.
    const glance = (await app.get<Glance>(routes.glance())).body;
    const vt = glance.blocks.find((b) => b.kind === "value_trajectory");
    expect(vt?.title).toBe("11% of 12% FTE target eligible");
  });
});
