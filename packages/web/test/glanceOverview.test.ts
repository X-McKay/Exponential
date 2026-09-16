import { expect, test } from "bun:test";
import { calendarOf, seedState } from "@valueflow/domain";
import { glanceOverview } from "../src/pages/glanceOverview.ts";

test("overview distinguishes recorded shipment, readiness and near-term risk", () => {
  const state = seedState();
  const overview = glanceOverview(state, calendarOf(state));
  expect(overview.summary).toContain("milestones are marked shipped");
  expect(overview.projects[0]).toMatchObject({ name: "Invoice Review Assistant", stage: "Scaling", release: { name: "Matching GA", status: "At risk" } });
  expect(overview.projects[1]).toMatchObject({ name: "Contract Clause Review", stage: "Pilot", release: { name: "Shadow mode", status: "Blocked", detail: "3 go-live criteria unmet" } });
  expect(overview.projects[2]?.name).toBe("Internal Knowledge Search");
});

test("empty release criteria and missing plans never imply readiness", () => {
  const state = seedState();
  state.releases = { invoice: [{ id: "empty", name: "Empty", month: "2026-01", milestoneIds: [], criteria: [] }] };
  expect(glanceOverview(state, calendarOf(state)).projects[0]?.release).toMatchObject({ status: "Not configured", detail: "Go-live criteria not configured" });
  state.releases = {};
  expect(glanceOverview(state, calendarOf(state)).projects.every((p) => p.release === null)).toBe(true);
  state.projects = [];
  expect(glanceOverview(state, calendarOf(state)).summary).toContain("No projects are being tracked yet");
});
