// Synthetic workspaces: deterministic, valid against every shared schema,
// loadable through the seed path, and consistent with the derivations and the
// API on any seed. These are property-style checks over many generated
// workspaces rather than assertions about one hand-written fixture.

import { describe, expect, test } from "bun:test";
import { blockers, calendarOf, composeGlancePage, eligible, readiness, releaseState, syntheticCharter, syntheticState } from "@valueflow/domain";
import type { AppState, Proposal } from "@valueflow/domain";
import { GovernanceItemInputSchema, MilestoneInputSchema, ProjectInputSchema, ReleaseInputSchema, routes } from "@valueflow/shared";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { loadState } from "../src/repo.ts";
import { seed, seedProposals } from "../src/seed.ts";
import { BASE } from "./helpers.ts";

const SEEDS = [1, 2, 3, 7, 11, 42, 99, 123, 2024, 31337];
const NOW = new Date("2026-09-10T12:00:00Z");

describe("syntheticState", () => {
  test("is deterministic for a seed and differs across seeds", () => {
    expect(syntheticState({ seed: 7, projects: 4 })).toEqual(syntheticState({ seed: 7, projects: 4 }));
    expect(syntheticState({ seed: 7, projects: 4 }).projects.map((p) => p.id)).not.toEqual(syntheticState({ seed: 8, projects: 4 }).projects.map((p) => p.id));
    expect(syntheticState({ projects: 40 }).projects.length).toBe(40);
    expect(syntheticState({ projects: 0 }).projects.length).toBe(1);
  });

  test("every generated fact satisfies the shared request schemas", () => {
    for (const s of SEEDS) {
      const st = syntheticState({ seed: s, projects: 8 });
      const ids = new Set<string>();
      for (const p of st.projects) {
        expect(ids.has(p.id)).toBe(false);
        ids.add(p.id);
        const { milestones: _m, governance: _g, ...own } = p;
        expect(ProjectInputSchema.safeParse(own).success).toBe(true);
        for (const m of p.milestones) expect(MilestoneInputSchema.safeParse(m).success).toBe(true);
        expect(new Set(p.team.map((t) => t.ini)).size).toBe(p.team.length);
        for (const g of p.governance) expect(GovernanceItemInputSchema.safeParse(g).success).toBe(true);
        for (const r of st.releases[p.id] ?? []) {
          expect(ReleaseInputSchema.safeParse(r).success).toBe(true);
          for (const mid of r.milestoneIds) expect(p.milestones.some((m) => m.id === mid)).toBe(true);
          for (const c of r.criteria) {
            if (c.type === "gate") expect(p.milestones.some((m) => m.id === c.ms)).toBe(true);
            if (c.type === "gov") expect(p.governance.some((g) => g.id === c.gid)).toBe(true);
          }
        }
      }
    }
  });

  test("derivations hold their invariants on every seed", () => {
    for (const s of SEEDS) {
      const st = syntheticState({ seed: s, projects: 10 });
      const cal = calendarOf(st);
      for (const p of st.projects) {
        for (const d of ["fte", "time"] as const) {
          const stretchSum = p.milestones.reduce((n, m) => n + m.impact.stretch[d], 0);
          expect(eligible(p, d)).toBeGreaterThanOrEqual(0);
          expect(eligible(p, d)).toBeLessThanOrEqual(Math.round(stretchSum * 10) / 10 + 1e-6);
          // Unshipped milestones never contribute.
          const shippedStretch = p.milestones.filter((m) => m.status === "shipped").reduce((n, m) => n + m.impact.stretch[d], 0);
          expect(eligible(p, d)).toBeLessThanOrEqual(Math.round(shippedStretch * 10) / 10 + 1e-6);
        }
        const r = readiness(p);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(1);
        expect(blockers(p)).toBe(p.governance.filter((g) => g.status === "missing").length);
        for (const rel of st.releases[p.id] ?? []) {
          const state = releaseState(rel, p, cal);
          expect(state.total).toBe(rel.criteria.length);
          expect(state.met).toBeLessThanOrEqual(state.total);
          if (state.met === state.total && state.total > 0) expect(state.label).toBe("Ready");
        }
      }
      const glance = composeGlancePage(st, cal);
      expect(glance.projectCount).toBe(st.projects.length);
      expect(glance.narrative.length).toBeGreaterThan(0);
      for (let i = 1; i < glance.blocks.length; i++) expect(glance.blocks[i]!.priority).toBeLessThanOrEqual(glance.blocks[i - 1]!.priority);
    }
  });

  test("a charter mentions every milestone, person, and release of its project", () => {
    const st = syntheticState({ seed: 5, projects: 3 });
    for (const p of st.projects) {
      const text = syntheticCharter(p, st.releases[p.id] ?? []);
      for (const m of p.milestones) expect(text).toContain(m.name);
      for (const t of p.team) expect(text).toContain(t.name);
      for (const r of st.releases[p.id] ?? []) expect(text).toContain(r.name);
      expect(text).toContain("synthetic document");
    }
  });
});

describe("seeding a synthetic workspace", () => {
  test("round-trips through the database and the API on several seeds, and seeded proposals can be decided", async () => {
    for (const s of [3, 42, 2024]) {
      const st = syntheticState({ seed: s, projects: 5, asOf: NOW.toISOString() });
      const db = openDb(":memory:");
      seed(db, st, NOW);
      const loaded = loadState(db, NOW);
      expect(loaded.projects.map((p) => p.id)).toEqual(st.projects.map((p) => p.id));
      expect(loaded.projects.map((p) => p.milestones.length)).toEqual(st.projects.map((p) => p.milestones.length));
      expect(loaded.projects.map((p) => p.governance.length)).toEqual(st.projects.map((p) => p.governance.length));
      expect(Object.values(loaded.releases).flat().length).toBe(Object.values(st.releases).flat().length);
      expect(Object.keys(loaded.dev).sort()).toEqual(Object.keys(st.dev).sort());
      // Readings: shipped and eval metrics with a current value carry a trajectory; the rest carry nothing.
      for (const p of loaded.projects) for (const m of p.milestones) for (const x of m.metrics) {
        const expected = (m.status === "eval" || m.status === "shipped") ? (st.projects.find((q) => q.id === p.id)!.milestones.find((q) => q.id === m.id)!.metrics.find((q) => q.id === x.id)!.current) : 0;
        expect(x.current).toBe(expected);
      }
      const proposals = seedProposals(db, NOW);
      expect(proposals.length).toBeGreaterThanOrEqual(st.projects.length);
      const app = createApp(db, { now: () => NOW });
      const call = async <T>(method: string, path: string) => {
        const res = await app.handleApi(new Request(BASE + path, { method }));
        return { status: res!.status, body: (await res!.json()) as T };
      };
      const state = (await call<AppState>("GET", routes.state())).body;
      expect(state.proposals.filter((p) => p.state === "pending").length).toBe(proposals.length);
      for (const p of proposals) {
        const decided = await call<Proposal>("POST", p.action.type === "calendar_event" ? routes.proposalDismiss(p.id) : routes.proposalAccept(p.id));
        expect([decided.status, p.action.type]).toEqual([200, p.action.type]);
      }
      const after = (await call<AppState>("GET", routes.state())).body;
      expect(after.proposals.filter((p) => p.state === "pending").length).toBe(0);
      expect(after.projects.every((p) => p.team.some((t) => t.ini === "QA") || p.team.length >= 6)).toBe(true);
      db.close();
    }
  });
});
