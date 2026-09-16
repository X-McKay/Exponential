import { AsyncLocalStorage } from "node:async_hooks";
import { actorContext, selectActor, listMembers, createMember } from "./identity.ts";
import { LlmSettingsSchema, MemberInputSchema } from "@valueflow/shared";
import type { Settings } from "./settings.ts";
// ================= HTTP app =================
//
// A framework-free router over Bun's fetch handler so the whole API can be
// exercised in tests without opening a port.

import type { Database } from "bun:sqlite";
import { blocksHash, composeGlance, composeGlancePage, calendarOf, overBudget, projectView } from "@valueflow/domain";
import type { Project, ReleaseInput as ReleaseShape } from "./templates.ts";
import {
  AgentsInputSchema,
  CalendarEventInputSchema,
  GovernanceInputSchema,
  GovernanceItemInputSchema,
  MilestoneInputSchema,
  ProjectInputSchema,
  ReadingInputSchema,
  ReleaseInputSchema,
  AgentPromptInputSchema,
  BenchmarkInputSchema,
  BudgetsInputSchema,
  ChatInputSchema,
  RateRunInputSchema,
  RuleInputSchema,
  CommsAssignmentCreateSchema, CommsAssignmentUpdateSchema, CommsRunInputSchema, CommsArtifactApprovalSchema,
  PMAssignmentCreateSchema, PMAssignmentUpdateSchema, PMRunInputSchema,
  RunAgentInputSchema,
  ScoutInputSchema,
  SetupCreateInputSchema,
  SetupRefineInputSchema,
  TargetsInputSchema,
  TemplateCreateInputSchema,
  TemplatesInputSchema,
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
  loadBudgets,
  loadState,
  loadTemplates,
  loadWorkspace,
  setBudgets,
  setTemplates,
  recordReading,
  setAgentPrompt,
  setAgents,
  setTargets,
  setWorkspace,
  updateGovernance,
  upsertCalendarEvent,
  upsertMilestone,
  upsertProject,
  upsertRelease,
} from "./repo.ts";
import { createFromTemplate } from "./templates.ts";
import { proposeProjectUpdates } from "./update.ts";
import { nextRuleId } from "@valueflow/domain";
import type { Rule } from "@valueflow/domain";
import { askWorkspace } from "./chat.ts";
import { briefIsCurrent, curateGlance } from "./curator.ts";
import { liveBus, liveResponse } from "./live.ts";
import { getRun, loadRunEvents } from "./repo.ts";
import { recordGlanceView } from "./repo.ts";
import type { BriefDelivery } from "./brief.ts";
import { promptVersion } from "./prompts.ts";
import { deleteRule, insertRule, loadRules, updateRule } from "./repo.ts";
import { runAny } from "./runner.ts";
import { scoutModels } from "./scout.ts";
import { judgeRun, runBenchmark } from "./evals.ts";
import { extractSource } from "./extract.ts";
import type { ExtractedSource } from "./extract.ts";
import { ProposalRejected, acceptProposal, dismissProposal, findProposal } from "./proposals.ts";
import { loadSetupDraft, rateRun } from "./repo.ts";
import { analyzeSetup, createFromSetup, refineSetup } from "./setup.ts";
import type { RepoSource } from "./connectors/index.ts";
import type { Llm } from "./llm.ts";
import { syncProject } from "./sync.ts";
import { UsageBudgetError } from "./usage.ts";
import { currentRuleStats } from "./proposal-guard.ts";
import * as comms from "./comms.ts";
import { listAssignments, getAssignment, createAssignment, updateAssignment, listRuns, runAssignment } from "./pm.ts";

type Params = Record<string, string>;
type Handler = (req: Request, params: Params) => Promise<Response> | Response;
type Method = "GET" | "POST" | "PUT" | "DELETE";

interface Route {
  method: Method;
  segments: string[];
  handler: Handler;
}

const json = (body: unknown, status = 200): Response => Response.json(body, { status });
const REVISION_HEADER = "x-valueflow-revision";

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
  if (!parsed.success) throw new HttpError(400, validationMessage(parsed.error.issues), parsed.error.issues);
  return parsed.data;
};

/** "validation failed: milestones.2.impact.stretch: stretch must be …" so a form can say what is wrong without decoding issues. */
const validationMessage = (issues: { path: PropertyKey[]; message: string }[]): string => {
  const first = issues[0];
  if (!first) return "validation failed";
  const path = first.path.map(String).join(".");
  return `validation failed: ${path ? `${path}: ` : ""}${first.message}${issues.length > 1 ? ` (+${issues.length - 1} more)` : ""}`;
};

/** A release may only reference milestones and governance items the project has right now. */
const checkReleaseRefs = (project: Project, body: ReleaseShape): void => {
  for (const mid of body.milestoneIds) if (!project.milestones.some((m) => m.id === mid)) throw new HttpError(400, `validation failed: milestoneIds: milestone ${mid} does not exist on ${project.name}`);
  body.criteria.forEach((c, i) => {
    if (c.type === "gate" && !project.milestones.some((m) => m.id === c.ms)) throw new HttpError(400, `validation failed: criteria.${i}: milestone ${c.ms} does not exist on ${project.name}`);
    if (c.type === "gov" && !project.governance.some((g) => g.id === c.gid)) throw new HttpError(400, `validation failed: criteria.${i}: governance item ${c.gid} does not exist on ${project.name}`);
  });
};

/** Multipart documents shared by project setup and project update: name, brief/note, snippet[] and file[] parts. */
const readSources = async (req: Request): Promise<{ form: FormData; sources: ExtractedSource[] }> => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "expected multipart/form-data");
  }
  const sources: ExtractedSource[] = [];
  if (form.getAll("snippet").length + form.getAll("file").length > 20) throw new HttpError(400, "at most 20 sources per request");
  for (const [i, snippet] of form.getAll("snippet").entries()) {
    const text = String(snippet).trim();
    if (text) sources.push({ name: `snippet ${i + 1}`, kind: "text", text: text.slice(0, 40_000), chars: text.length, error: null, truncated: text.length > 40_000 });
  }
  for (const f of form.getAll("file")) {
    if (!(f instanceof File)) continue;
    if (f.size > 25_000_000) {
      sources.push({ name: f.name.slice(0, 200), kind: "unsupported", text: "", chars: 0, error: "file is larger than 25 MB", truncated: false });
      continue;
    }
    sources.push(extractSource(f.name.slice(0, 200), f.type, Buffer.from(await f.arrayBuffer())));
  }
  return { form, sources };
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
  /** The model agents run against; null disables runs. */
  llm?: Llm | null;
  settings?: Settings;
  /** Grade every finished run with the LLM judge in the background (default on when a model is configured). */
  autoJudge?: boolean;
  /** Where the weekly brief goes besides the app; null keeps it in-app only. */
  deliverBrief?: BriefDelivery | null;
  /** Re-curate Glance in the background whenever the composer's cards change (default off; the server turns it on with a model). */
  autoCurate?: boolean;
}

export interface JobStatus {
  running: boolean;
  kind: "benchmark" | "scout" | null;
  done: number;
  total: number;
  startedAt: string | null;
  error: string | null;
}

export const createApp = (db: Database, options: AppOptions = {}): App => {
  const now = options.now ?? (() => new Date());
  const revision = (): number => db.query<{ revision: number }, []>("SELECT revision FROM workspace_revision WHERE id=1").get()?.revision ?? 0;
  const versioned = (response: Response): Response => {
    response.headers.set(REVISION_HEADER, String(revision()));
    return response;
  };
  /** Atomically claim the next shared-workspace revision before a mutation starts.
   * Browser clients send the revision from their latest response, so stale tabs
   * fail instead of silently replacing newer facts. Headerless internal clients
   * remain supported for tests and trusted integrations. */
  const claimRevision = (req: Request): number => {
    const supplied = req.headers.get(REVISION_HEADER);
    if (supplied !== null && !/^\d+$/.test(supplied)) throw new HttpError(400, "Invalid workspace revision.");
    const claimed = supplied === null
      ? db.query<{ revision: number }, []>("UPDATE workspace_revision SET revision=revision+1 WHERE id=1 RETURNING revision").get()
      : db.query<{ revision: number }, [number]>("UPDATE workspace_revision SET revision=revision+1 WHERE id=1 AND revision=? RETURNING revision").get(Number(supplied));
    if (!claimed) throw new Conflict("Workspace data changed in another session. Your draft was not saved; review the latest data and try again.");
    return claimed.revision;
  };
  /** A rejected mutation returns its claim when no later mutation has used it. */
  const releaseRevision = (claimed: number): void => {
    db.query("UPDATE workspace_revision SET revision=revision-1 WHERE id=1 AND revision=?").run(claimed);
  };
  const source = options.source ?? null;
  const providers = new AsyncLocalStorage<{ llm: Llm | null }>();
  const configuredLlm = () => options.settings ? options.settings.getLlm() : options.llm ?? null;
  const getLlm = () => providers.getStore()?.llm === undefined ? configuredLlm() : providers.getStore()!.llm;
  const validateModel = (spec: string | null | undefined): void => {
    const llm = getLlm();
    if (spec?.includes("@") && !llm?.validateModel) throw new HttpError(400, "model endpoints must be configured on the server");
    try { llm?.validateModel?.(spec); }
    catch (e) { throw new HttpError(400, e instanceof Error ? e.message : "invalid model selection"); }
  };
  const autoJudge = options.autoJudge ?? true;
  const judgeLater = (runId: string) => {
    const llm = getLlm();
    if (!llm || !autoJudge) return;
    const model = llm;
    setTimeout(() => {
      judgeRun(db, model, runId, now()).catch((e: unknown) => console.error(`judge ${runId} failed`, e instanceof Error ? e.message : e));
    }, 0);
  };
  const deliverBrief = options.deliverBrief ?? null;
  const autoCurate = options.autoCurate ?? false;
  let curating = false;
  let lastCurationHash: string | null = null;
  /** One curation at a time, never twice for the same facts (a failed attempt is not retried until facts move). */
  const curateLater = (s: ReturnType<typeof loadState>) => {
    const llm = getLlm();
    if (!llm || !autoCurate || curating) return;
    const curator = s.agents.find((a) => a.kind === "curator");
    if (!curator || briefIsCurrent(s)) return;
    const hash = JSON.stringify([s.proposals.filter((p) => p.state === "pending").map((p) => p.id), s.events[0]?.ref ?? null, s.runs[0]?.id ?? null]);
    if (hash === lastCurationHash) return;
    lastCurationHash = hash;
    curating = true;
    const model = llm;
    setTimeout(() => {
      curateGlance(db, model, curator, now())
        .catch((e: unknown) => console.error("curation failed", e instanceof Error ? e.message : e))
        .finally(() => {
          curating = false;
        });
    }, 0);
  };
  let benchmarkStatus: JobStatus = { running: false, kind: null, done: 0, total: 0, startedAt: null, error: null };
  /** Long evaluation jobs run one at a time in the background; the status is polled. */
  const startJob = (kind: "benchmark" | "scout", job: (progress: (done: number, total: number) => void) => Promise<unknown>): JobStatus => {
    if (benchmarkStatus.running) throw new HttpError(409, `a ${benchmarkStatus.kind ?? "job"} is already running`);
    benchmarkStatus = { running: true, kind, done: 0, total: 0, startedAt: now().toISOString(), error: null };
    setTimeout(() => {
      job((done, total) => {
        benchmarkStatus = { ...benchmarkStatus, done, total };
      })
        .catch((e: unknown) => {
          benchmarkStatus = { ...benchmarkStatus, error: e instanceof Error ? e.message : String(e) };
          console.error(`${kind} failed`, benchmarkStatus.error);
        })
        .finally(() => {
          benchmarkStatus = { ...benchmarkStatus, running: false };
        });
    }, 0);
    return benchmarkStatus;
  };
  const state = () => { const llm = getLlm(); return { ...loadState(db, now(), llm?.describe().prices), syncSource: source?.name ?? null, llm: llm ? llm.describe() : null }; };
  /** A run that would take a budget past its ceiling is refused with the reason. */
  const withinBudget = (agentId: string, proj: string | null): void => {
    const llm = getLlm();
    if (!llm) return;
    const reason = overBudget(state(), llm.describe().prices, agentId, proj);
    if (reason) throw new HttpError(409, `over budget: ${reason}`);
  };
  /** One project brief at a time per project; a stale one is rewritten only when asked (the page asks on open). */
  const curatingProjects = new Set<string>();
  const routes: Route[] = [];
  const on = (method: Method, pattern: string, handler: Handler): void => {
    routes.push({ method, segments: pattern.split("/").filter(Boolean), handler });
  };
  const p = (params: Params, k: string): string => params[k] ?? "";

  on("GET", "/api/health", () => json({ ok: true, version: "0.1.0", auth: "deferred" }));
  on("GET", "/api/members", () => json({ members: listMembers(db), actor: actorContext.getStore() ?? null }));
  on("POST", "/api/members", async req => {
    const input = await parseBody(req, MemberInputSchema);
    return json(createMember(db, input.name, input.role), 201);
  });
  on("GET", "/api/settings/llm", () => {
    if (!options.settings) throw new HttpError(409, "Runtime settings are not enabled.");
    return json(options.settings.status());
  });
  on("PUT", "/api/settings/llm", async req => {
    if (!options.settings) throw new HttpError(409, "Runtime settings are not enabled.");
    const input = await parseBody(req, LlmSettingsSchema);
    try { return json(options.settings.save(input)); }
    catch { throw new HttpError(409, "Could not save settings. Reopen settings and check the configuration and server storage."); }
  });
  on("POST", "/api/settings/llm/test", async () => {
    if (!options.settings) throw new HttpError(409, "Runtime settings are not enabled.");
    try { return json(await options.settings.test()); }
    catch { throw new HttpError(400, "Connection failed. Check the API base URL, token, model name and provider availability."); }
  });
  on("GET", patterns.state, () => {
    const s = state();
    curateLater(s);
    return json(s);
  });
  on("GET", patterns.commsAssignments, () => json(comms.listAssignments(db)));
  on("POST", patterns.commsAssignments, async req => json(comms.createAssignment(db, await parseBody(req, CommsAssignmentCreateSchema), now()), 201));
  on("GET", patterns.commsAssignment, (_req, params) => json(comms.getDetail(db, p(params, "id"))));
  on("PUT", patterns.commsAssignment, async (req, params) => json(comms.updateAssignment(db, p(params, "id"), await parseBody(req, CommsAssignmentUpdateSchema), now())));
  on("POST", patterns.commsRun, async (req, params) => {
    const llm = getLlm();
    if (!llm) throw new HttpError(409, "No model configured. Connect a model to draft communications.");
    const body = await parseBody(req, CommsRunInputSchema);
    return json(await comms.runAssignment(db, llm, p(params, "id"), now(), "manual", body.instruction, body.mode), 201);
  });
  on("GET", patterns.commsArtifacts, req => json(comms.listArtifacts(db, new URL(req.url).searchParams.get("projectId") ?? undefined)));
  on("PUT", patterns.commsArtifact, async (req, params) => {
    const body = await parseBody(req, CommsArtifactApprovalSchema);
    return json(comms.approveArtifact(db, p(params, "id"), body.status, now()));
  });
  on("GET", patterns.commsDownload, (req, params) => {
    const artifact = comms.getArtifact(db, p(params, "id"));
    const format = new URL(req.url).searchParams.get("format") ?? "md";
    if (format !== "md" && format !== "txt") throw new HttpError(400, "Choose md or txt format.");
    const filename = `${artifact.format}-v${artifact.version}-${artifact.id.replace(/[^a-zA-Z0-9-]/g, "")}.${format}`;
    return new Response(artifact.body, { headers: {
      "content-type": format === "md" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-content-type-options": "nosniff", "cache-control": "private, no-store",
    } });
  });
  on("GET", patterns.pmAssignments, () => json(listAssignments(db)));
  on("POST", patterns.pmAssignments, async (req) => json(createAssignment(db, await parseBody(req, PMAssignmentCreateSchema), now()), 201));
  on("GET", patterns.pmAssignment, (_req, params) => json(getAssignment(db, p(params, "id"))));
  on("PUT", patterns.pmAssignment, async (req, params) => json(updateAssignment(db, p(params, "id"), await parseBody(req, PMAssignmentUpdateSchema), now())));
  on("GET", patterns.pmRuns, (_req, params) => json(listRuns(db, p(params, "id"))));
  on("POST", patterns.pmRun, async (req, params) => {
    const llm = getLlm();
    if (!llm) throw new HttpError(409, "no LLM configured (set LLM_BASE_URL)");
    const body = await parseBody(req, PMRunInputSchema);
    return json(await runAssignment(db, llm, p(params, "id"), now(), "manual", body.instruction), 201);
  });
  on("GET", patterns.glance, () => json(composeGlancePage(state())));
  on("POST", patterns.glanceSeen, () => {
    recordGlanceView(db, loadWorkspace(db).user.ini, now().toISOString());
    return json(loadWorkspace(db));
  });
  on("POST", patterns.glanceCurate, async () => {
    const llm = getLlm();
    if (!llm) throw new HttpError(409, "no LLM configured (set LLM_BASE_URL)");
    const curator = state().agents.find((a) => a.kind === "curator");
    if (!curator) throw new HttpError(409, "no curator agent is installed");
    withinBudget(curator.id, null);
    const run = await curateGlance(db, llm, curator, now());
    if (run.state !== "failed") judgeLater(run.id);
    return json({ run, brief: state().brief });
  });
  // The project brief: `?force=1` rewrites; otherwise a brief that still matches the facts is returned as is, without a model call.
  on("POST", patterns.projectBrief, async (req, params) => {
    const llm = getLlm();
    if (!llm) throw new HttpError(409, "no LLM configured (set LLM_BASE_URL)");
    const s = state();
    const project = findProject(s, p(params, "pid"));
    const curator = s.agents.find((a) => a.kind === "curator");
    if (!curator) throw new HttpError(409, "no curator agent is installed");
    const force = new URL(req.url).searchParams.get("force") === "1";
    const view = projectView(s, project.id);
    const current = view.brief && view.brief.stateHash === blocksHash(composeGlance(view, calendarOf(view)));
    if (current && !force) return json({ run: null, brief: view.brief });
    if (curatingProjects.has(project.id)) throw new HttpError(409, `${curator.name} is already writing the brief on ${project.name}`);
    withinBudget(curator.id, project.id);
    curatingProjects.add(project.id);
    try {
      const run = await curateGlance(db, llm, curator, now(), { proj: project.id });
      if (run.state !== "failed") judgeLater(run.id);
      return json({ run, brief: state().projectBriefs[project.id] ?? null });
    } finally {
      curatingProjects.delete(project.id);
    }
  });
  on("GET", patterns.budgets, () => json(loadBudgets(db)));
  on("PUT", patterns.budgets, async (req) => {
    const body = await parseBody(req, BudgetsInputSchema);
    const s = state();
    for (const b of body) {
      if (b.scope === "agent" && !s.agents.some((a) => a.id === b.ref)) throw new HttpError(400, `agent ${b.ref} not found`);
      if (b.scope === "project" && !s.projects.some((pr) => pr.id === b.ref)) throw new HttpError(400, `project ${b.ref} not found`);
    }
    setBudgets(db, body);
    return json(loadBudgets(db));
  });

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
    const reading = recordReading(db, p(params, "pid"), p(params, "mid"), p(params, "xid"), body.value, body.source, now());
    const metric = findMilestone(state(), p(params, "pid"), p(params, "mid")).metrics.find((x) => x.id === p(params, "xid"));
    return json({ reading, metric }, 201);
  });

  on("POST", patterns.milestones, async (req, params) => {
    const body = await parseBody(req, MilestoneInputSchema);
    upsertMilestone(db, p(params, "pid"), body, "create", now());
    return json(findMilestone(state(), p(params, "pid"), body.id), 201);
  });
  on("PUT", patterns.milestone, async (req, params) => {
    const body = await parseBody(req, MilestoneInputSchema);
    if (body.id !== p(params, "mid")) throw new HttpError(400, "milestone id in body must match the URL");
    upsertMilestone(db, p(params, "pid"), body, "update", now());
    return json(findMilestone(state(), p(params, "pid"), body.id));
  });
  on("DELETE", patterns.milestone, (_req, params) => {
    deleteMilestone(db, p(params, "pid"), p(params, "mid"), now());
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
    checkReleaseRefs(findProject(state(), p(params, "pid")), body);
    upsertRelease(db, p(params, "pid"), body, "create");
    return json(releaseOf(p(params, "pid"), body.id), 201);
  });
  on("PUT", patterns.release, async (req, params) => {
    const body = await parseBody(req, ReleaseInputSchema);
    if (body.id !== p(params, "rid")) throw new HttpError(400, "release id in body must match the URL");
    checkReleaseRefs(findProject(state(), p(params, "pid")), body);
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
    const body = await parseBody(req, AgentsInputSchema);
    for (const agent of body) validateModel(agent.model);
    const before = new Map(state().agents.map((a) => [a.id, a]));
    setAgents(db, body);
    // Hand-edited instructions are a prompt version too.
    for (const a of body) if ((before.get(a.id)?.prompt ?? null) !== (a.prompt ?? null)) setAgentPrompt(db, a.id, a.prompt ?? null, promptVersion(a.kind, a.prompt ?? null, a.id), "person", now().toISOString());
    return json(state().agents);
  });
  on("POST", patterns.agentPrompt, async (req, params) => {
    const body = await parseBody(req, AgentPromptInputSchema);
    const agent = state().agents.find((a) => a.id === p(params, "aid"));
    if (!agent) throw new NotFound(`agent ${p(params, "aid")} not found`);
    setAgentPrompt(db, agent.id, body.prompt, promptVersion(agent.kind, body.prompt, agent.id), "person", now().toISOString());
    return json(state().agents.find((a) => a.id === agent.id));
  });

  on("GET", patterns.rules, () => json(loadRules(db)));
  on("POST", patterns.rules, async (req) => {
    const body = await parseBody(req, RuleInputSchema);
    if (body.auto) throw new HttpError(409, "new rules require human review before autonomy can be enabled");
    if (body.proj && !state().projects.some((pr) => pr.id === body.proj)) throw new HttpError(400, `project ${body.proj} not found`);
    const rule: Rule = { id: nextRuleId(loadRules(db)), text: body.text, proj: body.proj, enabled: body.enabled, auto: body.auto, owner: body.owner, createdAt: now().toISOString() };
    insertRule(db, rule);
    return json(rule, 201);
  });
  on("PUT", patterns.rule, async (req, params) => {
    const body = await parseBody(req, RuleInputSchema);
    const s = state();
    const previous = s.rules.find((r) => r.id === p(params, "id"));
    if (!previous) throw new NotFound("rule not found");
    if (body.auto && (!currentRuleStats(db, previous, s.proposals).earnedAutonomy || previous.text !== body.text || previous.proj !== body.proj)) {
      throw new HttpError(409, "autonomy requires enough human decisions on the unchanged rule; save edited rules with autonomy off");
    }
    if (body.proj && !state().projects.some((pr) => pr.id === body.proj)) throw new HttpError(400, `project ${body.proj} not found`);
    updateRule(db, p(params, "id"), body);
    return json(loadRules(db).find((r) => r.id === p(params, "id")));
  });
  on("DELETE", patterns.rule, (_req, params) => {
    deleteRule(db, p(params, "id"));
    return json({ ok: true });
  });
  // Project setup from documents: multipart with name, brief, snippet[] and file[] parts.
  on("POST", patterns.setup, async (req) => {
    const llm = getLlm();
    if (!llm) throw new HttpError(409, "no LLM configured (set LLM_BASE_URL)");
    const { form, sources } = await readSources(req);
    const name = String(form.get("name") ?? "").trim();
    if (!name) throw new HttpError(400, "name is required");
    const key = form.get("key");
    const brief = String(form.get("brief") ?? "");
    if (name.length > 160 || brief.length > 40_000) throw new HttpError(400, "setup name or brief is too long");
    if (typeof key === "string" && key.trim().length > 16) throw new HttpError(400, "project key is too long (16 characters at most)");
    const templateId = form.get("template");
    const template = typeof templateId === "string" && templateId.trim() ? loadTemplates(db).find((t) => t.id === templateId.trim()) : undefined;
    if (typeof templateId === "string" && templateId.trim() && !template) throw new HttpError(400, `template ${templateId} not found`);
    const draft = await analyzeSetup(db, llm, { name, key: typeof key === "string" ? key : undefined, brief, sources, template: template ?? null }, now());
    return json(draft, 201);
  });
  // Update an existing project from newer documents: every change is staged as a proposal for the inbox.
  on("POST", patterns.projectUpdate, async (req, params) => {
    const llm = getLlm();
    if (!llm) throw new HttpError(409, "no LLM configured (set LLM_BASE_URL)");
    const project = findProject(state(), p(params, "pid"));
    const { form, sources } = await readSources(req);
    const note = String(form.get("note") ?? "");
    if (note.length > 4000) throw new HttpError(400, "note is too long (4000 characters at most)");
    const setup = state().agents.find((a) => a.kind === "setup");
    withinBudget(setup?.id ?? "setup", project.id);
    const result = await proposeProjectUpdates(db, llm, project.id, sources, note, now());
    if (result.run.state !== "failed") judgeLater(result.run.id);
    return json({ run: result.run, proposals: result.proposals, dropped: result.dropped, sources: sources.map((s) => ({ name: s.name, kind: s.kind, chars: s.chars, error: s.error })) }, result.run.state === "failed" ? 502 : 201);
  });
  on("GET", patterns.templates, () => json(loadTemplates(db)));
  on("PUT", patterns.templates, async (req) => {
    setTemplates(db, await parseBody(req, TemplatesInputSchema));
    return json(loadTemplates(db));
  });
  on("POST", patterns.templateCreate, async (req, params) => {
    const template = loadTemplates(db).find((t) => t.id === p(params, "tid"));
    if (!template) throw new NotFound(`template ${p(params, "tid")} not found`);
    const body = await parseBody(req, TemplateCreateInputSchema);
    const pid = createFromTemplate(db, template, body, now());
    return json(findProject(state(), pid), 201);
  });
  on("GET", patterns.setupDraft, (_req, params) => json(loadSetupDraft(db, p(params, "id")).draft));
  on("POST", patterns.setupRefine, async (req, params) => {
    const llm = getLlm();
    if (!llm) throw new HttpError(409, "no LLM configured (set LLM_BASE_URL)");
    const body = await parseBody(req, SetupRefineInputSchema);
    return json(await refineSetup(db, llm, p(params, "id"), body.feedback, now()));
  });
  on("POST", patterns.setupCreate, async (req, params) => {
    const body = await parseBody(req, SetupCreateInputSchema);
    const pid = createFromSetup(db, p(params, "id"), body, now());
    return json(findProject(state(), pid), 201);
  });

  on("POST", patterns.proposalAccept, (_req, params) => {
    const llm = getLlm();
    const proposal = findProposal(db, p(params, "id"), now());
    if (proposal.action.type === "agent_model") validateModel(proposal.action.model);
    const accepted = acceptProposal(db, proposal, now());
    // A new prompt version gets its numbers straight away, so the version table never shows a blank row for long.
    if (accepted.action.type === "agent_prompt" && llm && !benchmarkStatus.running) {
      const model = llm;
      const target = accepted.action.agentId;
      startJob("benchmark", (progress) => runBenchmark(db, model, now(), target, progress));
    }
    return json(accepted);
  });
  on("POST", patterns.proposalDismiss, (_req, params) => json(dismissProposal(db, findProposal(db, p(params, "id"), now()), now())));
  on("POST", patterns.agentRuns, async (req, params) => {
    const llm = getLlm();
    if (!llm) throw new HttpError(409, "no LLM configured (set LLM_BASE_URL)");
    const body = await parseBody(req, RunAgentInputSchema.omit({ agentId: true }));
    withinBudget(p(params, "aid"), body.proj ?? null);
    const runs = await runAny(db, llm, { ...body, agentId: p(params, "aid") }, now(), { deliverBrief });
    for (const run of runs) if (run.state !== "failed" && run.model !== null) judgeLater(run.id);
    const run = runs[0];
    if (!run) throw new HttpError(409, "nothing to run: no eligible target");
    return json(run, 201);
  });
  on("POST", patterns.chat, async (req) => {
    const llm = getLlm();
    if (!llm) throw new HttpError(409, "no LLM configured (set LLM_BASE_URL)");
    const body = await parseBody(req, ChatInputSchema);
    withinBudget(state().agents.find((a) => a.kind === "chat")?.id ?? "ask", body.proj);
    const reply = await askWorkspace(db, llm, body, now());
    judgeLater(reply.runId);
    return json(reply);
  });
  on("GET", patterns.run, (_req, params) => json(getRun(db, p(params, "id"))));
  on("GET", patterns.runEvents, (_req, params) => json(loadRunEvents(db, p(params, "id"))));
  on("GET", patterns.live, () => liveResponse());
  on("POST", patterns.runRate, async (req, params) => {
    const body = await parseBody(req, RateRunInputSchema);
    rateRun(db, p(params, "id"), body.rating, body.note ?? null);
    return json(state().runs.find((r) => r.id === p(params, "id")) ?? null);
  });
  on("POST", patterns.runJudge, async (_req, params) => {
    const llm = getLlm();
    if (!llm) throw new HttpError(409, "no LLM configured (set LLM_BASE_URL)");
    return json(await judgeRun(db, llm, p(params, "id"), now()));
  });
  on("GET", patterns.benchmark, () => json(benchmarkStatus));
  on("POST", patterns.benchmark, async (req) => {
    const llm = getLlm();
    if (!llm) throw new HttpError(409, "no LLM configured (set LLM_BASE_URL)");
    const body = await parseBody(req, BenchmarkInputSchema);
    withinBudget(body.agentId ?? "", null);
    const model = llm;
    return json(startJob("benchmark", (progress) => runBenchmark(db, model, now(), body.agentId, progress)), 202);
  });
  on("POST", patterns.scout, async (req) => {
    const llm = getLlm();
    if (!llm) throw new HttpError(409, "no LLM configured (set LLM_BASE_URL)");
    const body = await parseBody(req, ScoutInputSchema);
    for (const spec of body.models ?? []) validateModel(spec);
    const scout = state().agents.find((a) => a.kind === "scout");
    if (!scout) throw new HttpError(409, "no scout agent is installed");
    withinBudget(scout.id, null);
    const model = llm;
    return json(startJob("scout", (progress) => scoutModels(db, model, scout, now(), { agentId: body.agentId, models: body.models, onProgress: progress })), 202);
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
      let claimedRevision: number | null = null;
      try {
        let actor;
        try { actor = selectActor(db, req); } catch { throw new HttpError(400, "Select a valid workspace user and role."); }
        const reading = req.method === "GET";
        const presence = url.pathname === patterns.glanceSeen;
        if (actor?.role === "viewer" && !reading && !presence) throw new HttpError(403, "Viewer mode is read-only. Switch role to make changes.");
        if (actor && actor.role !== "admin" && (url.pathname.startsWith("/api/settings/") || (!reading && url.pathname === "/api/members"))) throw new HttpError(403, "Switch to Administrator to manage workspace settings.");
        if (!reading && !presence) claimedRevision = claimRevision(req);
        const response = await providers.run({ llm: configuredLlm() }, () => actorContext.run(actor, async () => {
          const handled = await r.handler(req, params);
          if (!reading && !presence) db.query("INSERT INTO mutation_audit (at,member_id,member_name,role,method,path,status) VALUES (?,?,?,?,?,?,?)")
            .run(now().toISOString(), actor?.id ?? null, actor?.name ?? "Workspace", actor?.role ?? "admin", req.method, url.pathname, handled.status);
          if (!reading && !presence && handled.ok) liveBus.emit({ kind: "changed" });
          return handled;
        }));
        return versioned(response);
      } catch (err) {
        if (claimedRevision !== null) releaseRevision(claimedRevision);
        if (err instanceof HttpError) return versioned(json({ error: err.message, issues: err.issues }, err.status));
        if (err instanceof NotFound) return versioned(json({ error: err.message }, 404));
        if (err instanceof Conflict) return versioned(json({ error: err.message }, 409));
        if (err instanceof ProposalRejected) return versioned(json({ error: err.message }, 409));
        if (err instanceof UsageBudgetError) return versioned(json({ error: err.message }, 409));
        console.error(err);
        return versioned(json({ error: "internal error" }, 500));
      }
    }
    return versioned(json({ error: pathMatched ? "method not allowed" : "not found" }, pathMatched ? 405 : 404));
  };

  return { handleApi, db, now };
};
