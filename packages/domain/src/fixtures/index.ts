import type { AppState } from "../types.ts";
import { AGENTS } from "./agents.ts";
import { DEV } from "./dev.ts";
import { FEED, UPCOMING } from "./feed.ts";
import { PROJECTS } from "./projects.ts";
import { RELEASES } from "./releases.ts";
import { WORKSPACE } from "./workspace.ts";

export { AGENTS, DEV, FEED, PROJECTS, RELEASES, UPCOMING, WORKSPACE };

/** The instant the fixtures describe: a Thursday morning in the month the mockup pinned as "today". */
export const SEED_ASOF = "2026-09-10T09:00:00.000Z";

/** Deep-cloned seed state, safe to mutate in tests. */
export const seedState = (): AppState =>
  structuredClone({ asOf: SEED_ASOF, workspace: WORKSPACE, projects: PROJECTS, releases: RELEASES, dev: DEV, agents: AGENTS, feed: FEED, upcoming: UPCOMING });
