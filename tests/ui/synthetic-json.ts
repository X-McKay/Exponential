// Print a synthetic workspace as JSON for the Playwright global setup (which runs under Node and
// seeds it through the public API). Run with Bun: `bun tests/ui/synthetic-json.ts [seed] [projects]`.
import { syntheticCharter, syntheticState } from "../../packages/domain/src/index.ts";

const seed = Number(process.argv[2] ?? process.env.UI_SEED ?? 7) || 7;
const projects = Number(process.argv[3] ?? process.env.UI_PROJECTS ?? 4) || 4;
const state = syntheticState({ seed, projects, asOf: process.env.UI_AS_OF ?? "2026-09-10T09:00:00.000Z" });
const charters = Object.fromEntries(state.projects.map((p) => [p.id, syntheticCharter(p, state.releases[p.id] ?? [])]));
console.log(JSON.stringify({ state, charters }));
