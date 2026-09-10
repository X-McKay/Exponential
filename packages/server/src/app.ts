// ================= HTTP app =================
//
// A framework-free router over Bun's fetch handler so the whole API can be
// exercised in tests without opening a port.

import type { Database } from "bun:sqlite";
import { composeGlancePage } from "@valueflow/domain";
import {
  AgentsInputSchema,
  CalendarEventInputSchema,
  GovernanceInputSchema,
  GovernanceItemInputSchema,
  MilestoneInputSchema,
  ProjectInputSchema,
  ReadingInputSchema,
  ReleaseInputSchema,
  TargetsInputSchema,
  WorkspaceInputSchema,
  patterns,
} from "@valueflow/shared";
import type { ZodTypeAny, z } from "zod";
import {
  Conflict,
  NotFound,
  createGovernanceItem,
  deleteCalendarEvent,
  deleteGovernanceItem,
  deleteMilestone,
  deleteProject,
  deleteRelease,
  findMilestone,
  findProject,
  listReadings,
  loadState,
  loadWorkspace,
  recordReading,
  setAgents,
  setTargets,
  setWorkspace,
  updateGovernance,
  upsertCalendarEvent,
  upsertMilestone,
  upsertProject,
  upsertRelease,
} from "./repo.ts";
import type { RepoSource } from "./connectors/index.ts";
import { syncProject } from "./sync.ts";

type Params = Record<string, string>;
type Handler = (req: Request, params: Params) => Promise<Response> | Response;
type Method = "GET" | "POST" | "PUT" | "DELETE";

interface Route {
  method: Method;
  segments: string[];
  handler: Handler;
}

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues?: unknown,
  ) {
    super(message);
  }
}

const parseBody = async <S extends ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> => {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "validation failed", parsed.error.issues);
  return parsed.data;
};

const match = (route: Route, path: string[]): Params | null => {
  if (route.segments.length !== path.length) return null;
  const params: Params = {};
  for (let i = 0; i < path.length; i++) {
    const s = route.segments[i] ?? "";
    const v = path[i] ?? "";
    if (s.startsWith(":")) params[s.slice(1)] = decodeURIComponent(v);
    else if (s !== v) return null;
  }
  return params;
};

export interface App {
  /** Handle an API request; returns null when the path is not an API route. */
  handleApi: (req: Request) => Promise<Response | null>;
  db: Database;
  /** The clock every derivation uses as "today". */
  now: () => Date;
}

export interface AppOptions {
  /** Override the clock (tests, demos: `VALUEFLOW_NOW`). */
  now?: () => Date;
  /** Where development facts come from; null disables syncing. */
  source?: RepoSource | null;
}

export const createApp = (db: Database, options: AppOptions = {}): App => {
  const now = options.now ?? (() => new Date());
  const source = options.source ?? null;
  const state = () => ({ ...loadState(db, now()), syncSource: source?.name ?? null });
  const routes: Route[] = [];
  const on = (method: Method, pattern: string, handler: Handler): void => {
    routes.push({ method, segments: pattern.split("/").filter(Boolean), handler });
  };
  const p = (params: Params, k: string): string => params[k] ?? "";

  on("GET", patterns.state, () => json(state()));
  on("GET", patterns.glance, () => json(composeGlancePage(state())));

  on("PUT", patterns.workspace, async (req) => {
    setWorkspace(db, await parseBody(req, WorkspaceInputSchema));
    return json(loadWorkspace(db));
  });

  on("POST", patterns.projects, async (req) => {
    const body = await parseBody(req, ProjectInputSchema);
    upsertProject(db, body, "create");
    return json(findProject(state(), body.id), 201);
  });
  on("PUT", patterns.project, async (req, params) => {
    const body = await parseBody(req, ProjectInputSchema);
    if (body.id !== p(params, "pid")) throw new HttpError(400, "project id in body must match the URL");
    upsertProject(db, body, "update");
    return json(findProject(state(), body.id));
  });
  on("DELETE", patterns.project, (_req, params) => {
    deleteProject(db, p(params, "pid"));
    return json({ ok: true });
  });

  on("GET", patterns.readings, (_req, params) => json(listReadings(db, p(params, "pid"), p(params, "mid"), p(params, "xid"))));
  on("PUT", patterns.readings, async (req, params) => {
    const body = await parseBody(req, ReadingInputSchema);
    const reading = recordReading(db, p(params, "pid"), p(params, "mid"), p(params, "xid"), body.value, body.source);
    const metric = findMilestone(state(), p(params, "pid"), p(params, "mid")).metrics.find((x) => x.id === p(params, "xid"));
    return json({ reading, metric }, 201);
  });

  on("POST", patterns.milestones, async (req, params) => {
    const body = await parseBody(req, MilestoneInputSchema);
    upsertMilestone(db, p(params, "pid"), body, "create");
    return json(findMilestone(state(), p(params, "pid"), body.id), 201);
  });
  on("PUT", patterns.milestone, async (req, params) => {
    const body = await parseBody(req, MilestoneInputSchema);
    if (body.id !== p(params, "mid")) throw new HttpError(400, "milestone id in body must match the URL");
    upsertMilestone(db, p(params, "pid"), body, "update");
    return json(findMilestone(state(), p(params, "pid"), body.id));
  });
  on("DELETE", patterns.milestone, (_req, params) => {
    deleteMilestone(db, p(params, "pid"), p(params, "mid"));
    return json({ ok: true });
  });

  on("PUT", patterns.targets, async (req, params) => {
    const body = await parseBody(req, TargetsInputSchema);
    setTargets(db, p(params, "pid"), body);
    return json(findProject(state(), p(params, "pid")).targets);
  });

  on("PUT", patterns.governance, async (req, params) => {
    const body = await parseBody(req, GovernanceInputSchema);
    updateGovernance(db, p(params, "pid"), p(params, "gid"), body, now());
    const item = findProject(state(), p(params, "pid")).governance.find((g) => g.id === p(params, "gid"));
    return json(item);
  });
  on("POST", patterns.governanceItems, async (req, params) => {
    const body = await parseBody(req, GovernanceItemInputSchema);
    createGovernanceItem(db, p(params, "pid"), body);
    const item = findProject(state(), p(params, "pid")).governance.find((g) => g.id === body.id);
    return json(item, 201);
  });
  on("DELETE", patterns.governance, (_req, params) => {
    deleteGovernanceItem(db, p(params, "pid"), p(params, "gid"));
    return json({ ok: true });
  });

  const releaseOf = (pid: string, rid: string) => (state().releases[pid] ?? []).find((r) => r.id === rid);
  on("POST", patterns.releases, async (req, params) => {
    const body = await parseBody(req, ReleaseInputSchema);
    upsertRelease(db, p(params, "pid"), body, "create");
    return json(releaseOf(p(params, "pid"), body.id), 201);
  });
  on("PUT", patterns.release, async (req, params) => {
    const body = await parseBody(req, ReleaseInputSchema);
    if (body.id !== p(params, "rid")) throw new HttpError(400, "release id in body must match the URL");
    upsertRelease(db, p(params, "pid"), body, "update");
    return json(releaseOf(p(params, "pid"), body.id));
  });
  on("DELETE", patterns.release, (_req, params) => {
    deleteRelease(db, p(params, "pid"), p(params, "rid"));
    return json({ ok: true });
  });

  on("GET", patterns.syncStatus, () => {
    const s = state();
    return json({ source: s.syncSource, projects: Object.fromEntries(s.projects.map((pr) => [pr.id, s.dev[pr.id]?.lastSync ?? null])) });
  });
  on("POST", patterns.sync, async (_req, params) => {
    if (!source) throw new HttpError(409, "no sync source configured (set SYNC_SOURCE)");
    const project = findProject(state(), p(params, "pid"));
    const run = await syncProject(db, source, project, now());
    return json({ run, facts: state().dev[project.id] ?? null }, run.ok ? 200 : 502);
  });
  on("PUT", patterns.agents, async (req) => {
    setAgents(db, await parseBody(req, AgentsInputSchema));
    return json(state().agents);
  });
  on("POST", patterns.calendar, async (req) => {
    const body = await parseBody(req, CalendarEventInputSchema);
    upsertCalendarEvent(db, body, "create");
    return json(state().calendar.find((c) => c.id === body.id), 201);
  });
  on("PUT", patterns.calendarEvent, async (req, params) => {
    const body = await parseBody(req, CalendarEventInputSchema);
    if (body.id !== p(params, "id")) throw new HttpError(400, "calendar event id in body must match the URL");
    upsertCalendarEvent(db, body, "update");
    return json(state().calendar.find((c) => c.id === body.id));
  });
  on("DELETE", patterns.calendarEvent, (_req, params) => {
    deleteCalendarEvent(db, p(params, "id"));
    return json({ ok: true });
  });

  const handleApi = async (req: Request): Promise<Response | null> => {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return null;
    const path = url.pathname.split("/").filter(Boolean);
    let pathMatched = false;
    for (const r of routes) {
      const params = match(r, path);
      if (!params) continue;
      pathMatched = true;
      if (r.method !== req.method) continue;
      try {
        return await r.handler(req, params);
      } catch (err) {
        if (err instanceof HttpError) return json({ error: err.message, issues: err.issues }, err.status);
        if (err instanceof NotFound) return json({ error: err.message }, 404);
        if (err instanceof Conflict) return json({ error: err.message }, 409);
        console.error(err);
        return json({ error: "internal error" }, 500);
      }
    }
    return json({ error: pathMatched ? "method not allowed" : "not found" }, pathMatched ? 405 : 404);
  };

  return { handleApi, db, now };
};
