import type { AppState } from "../types.ts";
import { AGENTS, RUNS } from "./agents.ts";
import { DEV, DEV_SAMPLE, sampleCommitDays, sampleDevFacts } from "./dev.ts";
import { CALENDAR, EVENTS } from "./feed.ts";
import { deriveDevEvents, sortEvents } from "../feed.ts";
import { PROJECTS } from "./projects.ts";
import { RELEASES } from "./releases.ts";
import { WORKSPACE } from "./workspace.ts";

export { AGENTS, CALENDAR, DEV, DEV_SAMPLE, EVENTS, PROJECTS, RELEASES, RUNS, WORKSPACE, sampleCommitDays, sampleDevFacts };

/** Every event the seed carries at `asOf`: the sample log plus what a sync of the sample facts would add. */
export const seedEvents = (asOf: string) =>
  sortEvents([...EVENTS(asOf), ...Object.entries(DEV(asOf)).flatMap(([pid, facts]) => deriveDevEvents(pid, facts, asOf))]);

/** The instant the fixtures describe: a Thursday morning in the month the mockup pinned as "today". */
export const SEED_ASOF = "2026-09-10T09:00:00.000Z";

/** Deep-cloned seed state, safe to mutate in tests. */
export const seedState = (): AppState =>
  structuredClone({ asOf: SEED_ASOF, syncSource: "sample", workspace: WORKSPACE, projects: PROJECTS, releases: RELEASES, dev: DEV(SEED_ASOF), agents: AGENTS, runs: RUNS(SEED_ASOF), llm: null, proposals: [], events: seedEvents(SEED_ASOF), calendar: CALENDAR(SEED_ASOF) });
