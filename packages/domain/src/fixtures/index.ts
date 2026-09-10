import type { AppState } from "../types.ts";
import { AGENTS } from "./agents.ts";
import { DEV } from "./dev.ts";
import { FEED, UPCOMING } from "./feed.ts";
import { PROJECTS } from "./projects.ts";
import { RELEASES } from "./releases.ts";

export { AGENTS, DEV, FEED, PROJECTS, RELEASES, UPCOMING };

/** Deep-cloned seed state, safe to mutate in tests. */
export const seedState = (): AppState =>
  structuredClone({ projects: PROJECTS, releases: RELEASES, dev: DEV, agents: AGENTS, feed: FEED, upcoming: UPCOMING });
