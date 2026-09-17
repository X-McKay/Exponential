// ================= update a project from documents =================
//
// A newer charter, a revised deck, a decision email: the setup agent compares
// the documents with the project's current record and stages every change it
// finds as a proposal. Nothing is applied here. Each proposal waits in the
// inbox with the document it came from, and accepting one applies it through
// the same repository functions the editors use, guarded against the record
// having moved in the meantime.

import type { Database } from "bun:sqlite";
import { GOV_STATUSES, MILESTONE_STATUSES, calendarOf, evidenceFor, ymOf } from "@valueflow/domain";
import type { Agent, AgentRun, AppState, Project, Proposal, ProposalAction, ProposalEvidence, Release } from "@valueflow/domain";
import { ProposalActionSchema } from "@valueflow/shared";
import { projectContext } from "./agents.ts";
import { ruleScores } from "./evals.ts";
import type { ExtractedSource } from "./extract.ts";
import { nextStoredProposalId, nextStoredRunId } from "./ids.ts";
import { replyDetail, trace } from "./live.ts";
import { extractJson } from "./llm.ts";
import type { ChatMessage, Llm } from "./llm.ts";
import { promptVersion } from "./prompts.ts";
import { registerProposalGuard } from "./proposal-guard.ts";
import { Conflict, findProject, insertProposal, insertRun, loadState, updateRun, upsertScore } from "./repo.ts";
import { callLlm } from "./usage.ts";

export const MAX_UPDATE_PROPOSALS = 24;

// ---- the shapes the model may return -------------------------------------------

const shape = (type: string, fields: Record<string, unknown>, required: string[]) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: [type] },
    source: { type: "string", description: "Name of the document this change comes from, exactly as given in the briefing." },
    quote: { type: "string", description: "The passage from that document that supports the change, copied verbatim (one or two sentences, at most 300 characters). Empty when the change follows from the note alone." },
    rationale: { type: "string", description: "One sentence saying why the passage means the record should change." },
    ...fields,
  },
  required: ["type", "source", "quote", "rationale", ...required],
});
const impact = {
  type: "object",
  additionalProperties: false,
  properties: {
    base: { type: "object", additionalProperties: false, properties: { fte: { type: "number" }, time: { type: "number" } }, required: ["fte", "time"] },
    stretch: { type: "object", additionalProperties: false, properties: { fte: { type: "number" }, time: { type: "number" } }, required: ["fte", "time"] },
  },
  required: ["base", "stretch"],
};
const criterion = {
  type: "object",
  additionalProperties: false,
  properties: { type: { type: "string", enum: ["gate", "gov", "manual"] }, ref: { type: "string", description: "gate: milestone id (MS-n); gov: governance id; manual: empty." }, label: { type: "string" } },
  required: ["type", "ref", "label"],
};
const nullable = (t: string) => ({ type: [t, "null"] });

export const UPDATE_SCHEMA = {
  name: "project_update",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string", description: "One line, at most 120 characters, on what the documents change." },
      notes: { type: "array", maxItems: 10, items: { type: "string" }, description: "Things the documents say that do not fit a change shape, and contradictions between documents." },
      proposals: {
        type: "array",
        maxItems: MAX_UPDATE_PROPOSALS,
        items: {
          anyOf: [
            shape("project_details", { description: nullable("string"), stage: { type: ["string", "null"], enum: ["Discovery", "Pilot", "Scaling", "Sustain", null] }, tier: { type: ["integer", "null"], description: "1, 2, 3, or null to leave unchanged." }, committeeDate: nullable("string"), committeeRef: nullable("string") }, ["description", "stage", "tier", "committeeDate", "committeeRef"]),
            shape("targets", { fte: { type: "number" }, time: { type: "number" } }, ["fte", "time"]),
            shape("team_member", { name: { type: "string" }, role: { type: "string" } }, ["name", "role"]),
            shape("repo", { name: { type: "string" }, url: { type: "string" } }, ["name", "url"]),
            shape("governance_update", { gid: { type: "string", description: "governance id from the briefing" }, status: { type: ["string", "null"], enum: [...GOV_STATUSES, null] }, owner: { type: ["string", "null"], description: "team member name or initials" }, date: nullable("string"), detail: nullable("string") }, ["gid", "status", "owner", "date", "detail"]),
            shape("governance_item", { cat: { type: "string" }, name: { type: "string" }, status: { type: "string", enum: [...GOV_STATUSES] }, owner: { type: "string", description: "team member name or initials, or empty" }, detail: { type: "string" } }, ["cat", "name", "status", "owner", "detail"]),
            shape("milestone_create", { name: { type: "string" }, status: { type: "string", enum: [...MILESTONE_STATUSES] }, month: { type: "string", description: "YYYY-MM" }, impact, metrics: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, properties: { label: { type: "string" }, base: { type: "number" }, stretch: { type: "number" } }, required: ["label", "base", "stretch"] } } }, ["name", "status", "month", "impact", "metrics"]),
            shape("milestone_update", { mid: { type: "string", description: "milestone id, MS-n" }, name: nullable("string"), status: { type: ["string", "null"], enum: [...MILESTONE_STATUSES, null] }, month: { type: ["string", "null"], description: "YYYY-MM or null" }, impact: { anyOf: [impact, { type: "null" }] } }, ["mid", "name", "status", "month", "impact"]),
            shape("release_create", { name: { type: "string" }, month: { type: "string" }, milestoneIds: { type: "array", items: { type: "string" } }, criteria: { type: "array", maxItems: 8, items: criterion } }, ["name", "month", "milestoneIds", "criteria"]),
            shape("release_update", { rid: { type: "string", description: "release id, R-n" }, name: nullable("string"), month: nullable("string"), milestoneIds: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] }, criteria: { anyOf: [{ type: "array", maxItems: 8, items: criterion }, { type: "null" }] } }, ["rid", "name", "month", "milestoneIds", "criteria"]),
            shape("calendar_event", { date: { type: "string", description: "YYYY-MM-DD" }, text: { type: "string" }, sub: nullable("string"), tab: { type: "string", enum: ["overview", "value", "roadmap", "development", "governance"] } }, ["date", "text", "sub", "tab"]),
          ],
        },
      },
    },
    required: ["summary", "notes", "proposals"],
  },
};

const SHAPE_LINES = [
  '  {"type":"project_details","description":"…|null","stage":"Discovery|Pilot|Scaling|Sustain|null","tier":1|2|3|null,"committeeDate":"YYYY-MM-DD|null","committeeRef":"…|null"} — null leaves a field as it is',
  '  {"type":"targets","fte":<number>,"time":<number>}',
  '  {"type":"team_member","name":"…","role":"…"} — adds a person or updates their role',
  '  {"type":"repo","name":"…","url":"github.com/org/repo"}',
  '  {"type":"governance_update","gid":"<id from the briefing>","status":"approved|in_review|draft|missing|na|null","owner":"<name or null>","date":"YYYY-MM-DD|null","detail":"…|null"} — null leaves a field as it is',
  '  {"type":"governance_item","cat":"…","name":"…","status":"missing|draft|in_review|approved|na","owner":"<name or empty>","detail":"…"} — only for an item the project does not have',
  '  {"type":"milestone_create","name":"…","status":"backlog|progress|eval|shipped","month":"YYYY-MM","impact":{"base":{"fte":n,"time":n},"stretch":{"fte":n,"time":n}},"metrics":[{"label":"…","base":n,"stretch":n}]}',
  '  {"type":"milestone_update","mid":"MS-n","name":"…|null","status":"…|null","month":"YYYY-MM|null","impact":{…}|null}',
  '  {"type":"release_create","name":"…","month":"YYYY-MM","milestoneIds":["MS-n"],"criteria":[{"type":"gate","ref":"MS-n","label":"…"},{"type":"gov","ref":"<governance id>","label":"…"},{"type":"manual","ref":"","label":"…"}]}',
  '  {"type":"release_update","rid":"R-n","name":"…|null","month":"YYYY-MM|null","milestoneIds":[…]|null,"criteria":[…]|null} — a non-null list replaces the whole list',
  '  {"type":"calendar_event","date":"YYYY-MM-DD","text":"…","sub":"…|null","tab":"overview|value|roadmap|development|governance"}',
];

export const buildUpdateMessages = (agent: Pick<Agent, "name" | "prompt">, state: AppState, project: Project, sources: ExtractedSource[], note: string, todayYm: string): ChatMessage[] => {
  const cal = calendarOf(state);
  const usable = sources.filter((s) => s.text);
  return [
    {
      role: "system",
      content: [
        `You are ${agent.name}, the project-setup agent in Exponential, an AI-project delivery platform. New documents have arrived for an existing project. Compare them with the project's current record and stage the changes they support. A person reviews every change before it is applied.`,
        `Today is ${todayYm}. Exponential tracks value that is only eligible when milestones ship AND their eval metrics clear a gate; releases go live only when every criterion is met.`,
        "Rules:",
        "- Propose only what a document states or plainly implies; name the document in every proposal's source and copy the supporting passage into quote, verbatim. Never invent people, dates, numbers, or approvals.",
        "- Compare with the current record first. Do not propose a value the record already has, and do not repeat the same change twice.",
        "- Use the ids from the briefing (MS-n for milestones, R-n for releases, governance ids as given). Create a new milestone, release, or governance item only when nothing in the record matches it; otherwise update the existing one.",
        "- A status becomes approved or shipped only when a document says it happened. Plans, intentions, and targets are not approvals.",
        "- Committee approval needs an explicit date AND reference in a document; otherwise leave it unchanged.",
        "- Fields set to null are left as they are. Keep proposals small and specific; several small proposals are better than one that changes everything.",
        "- Put contradictions and anything that does not fit a shape in notes.",
        "Each proposal uses exactly one of these shapes, plus a source, a verbatim quote, and a one-sentence rationale:",
        ...SHAPE_LINES,
        'Reply with a JSON object: {"summary": string, "notes": [...], "proposals": [...]}.',
        ...(agent.prompt ? [`\nAdditional instructions from the workspace (follow these; they refine the task above):\n${agent.prompt}`] : []),
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        note.trim() ? `Note from the person uploading the documents:\n${note.trim()}\n` : "",
        "# Current project record\n",
        projectContext(state, project, cal),
        "\n# New documents\n",
        usable.length ? usable.map((s) => `### Source: ${s.name} (${s.kind})\n${s.text}`).join("\n\n") : "No document text was usable; propose nothing unless the note alone justifies a change.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
};

// ---- turning the reply into proposals ----------------------------------------------

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const isNil = (v: unknown): boolean => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

const sameImpact = (a: Project["milestones"][number]["impact"], b: Project["milestones"][number]["impact"]): boolean =>
  a.base.fte === b.base.fte && a.base.time === b.base.time && a.stretch.fte === b.stretch.fte && a.stretch.time === b.stretch.time;
const sameCriteria = (a: Release["criteria"], b: Release["criteria"]): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Team initials for a name the model wrote; falls back to initials of the name itself when nobody matches. */
const iniFor = (project: Project, raw: string | undefined, fallback: string): string => {
  const v = (raw ?? "").trim();
  if (!v) return fallback;
  if (/^[\p{L}\p{N}]{1,3}$/u.test(v)) return v.toUpperCase();
  const hit = project.team.find((t) => t.name.toLowerCase() === v.toLowerCase());
  if (hit) return hit.ini;
  const words = v.split(/\s+/).filter(Boolean);
  return (words.length === 1 ? (words[0] ?? "").slice(0, 2) : words.slice(0, 3).map((w) => w[0] ?? "").join("")).toUpperCase() || fallback;
};

/** Re-shape one raw item into the stored action shape, dropping null fields; returns null when nothing would change. */
const normalizeAction = (raw: Record<string, unknown>, project: Project, releases: Release[], defaultOwner: string): unknown => {
  const type = str(raw.type);
  switch (type) {
    case "project_details": {
      const out: Record<string, unknown> = { type };
      if (!isNil(raw.description) && str(raw.description) !== project.description) out.description = str(raw.description);
      if (!isNil(raw.stage) && str(raw.stage) !== project.stage) out.stage = str(raw.stage);
      if (typeof raw.tier === "number" && raw.tier !== project.tier) out.tier = raw.tier;
      if (!isNil(raw.committeeDate) && !isNil(raw.committeeRef)) {
        const committee = { date: str(raw.committeeDate), ref: str(raw.committeeRef) };
        if (committee.date !== project.committee?.date || committee.ref !== project.committee?.ref) out.committee = committee;
      }
      return Object.keys(out).length > 1 ? out : null;
    }
    case "targets": {
      const fte = raw.fte;
      const time = raw.time;
      if (fte === project.targets.fte && time === project.targets.time) return null;
      return { type, fte, time };
    }
    case "team_member": {
      const name = str(raw.name);
      const role = str(raw.role);
      if (!name) return null;
      const existing = project.team.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (existing && (!role || existing.role === role)) return null;
      return { type, ini: existing?.ini ?? iniFor(project, name, defaultOwner), name, role: role ?? existing?.role ?? "Team member" };
    }
    case "repo": {
      const name = str(raw.name);
      if (!name) return null;
      const url = str(raw.url) ?? `github.com/org/${name}`;
      const existing = project.repos.find((r) => r.name.toLowerCase() === name.toLowerCase());
      if (existing && existing.url === url) return null;
      return { type, name: existing?.name ?? name, url };
    }
    case "governance_update": {
      const item = project.governance.find((g) => g.id === raw.gid) ?? project.governance.find((g) => g.name.toLowerCase() === String(raw.gid ?? "").toLowerCase());
      if (!item) return null;
      const out: Record<string, unknown> = { type, gid: item.id };
      if (!isNil(raw.status) && raw.status !== item.status) out.status = raw.status;
      if (!isNil(raw.owner)) {
        const owner = iniFor(project, str(raw.owner), item.owner);
        if (owner !== item.owner) out.owner = owner;
      }
      if (!isNil(raw.date) && raw.date !== item.date) out.date = raw.date;
      if (!isNil(raw.detail) && str(raw.detail) !== item.detail) out.detail = str(raw.detail);
      return Object.keys(out).length > 2 ? out : null;
    }
    case "governance_item": {
      const name = str(raw.name);
      if (!name || project.governance.some((g) => g.name.toLowerCase() === name.toLowerCase())) return null;
      return { type, cat: str(raw.cat) ?? "Governance", name, status: raw.status, owner: iniFor(project, str(raw.owner), defaultOwner), detail: str(raw.detail) ?? "" };
    }
    case "milestone_create": {
      const name = str(raw.name);
      if (!name || project.milestones.some((m) => m.name.toLowerCase() === name.toLowerCase())) return null;
      const metrics = Array.isArray(raw.metrics) ? raw.metrics : [];
      return { type, name, status: raw.status, month: raw.month, impact: raw.impact, metrics };
    }
    case "milestone_update": {
      const m = project.milestones.find((x) => x.id === raw.mid) ?? project.milestones.find((x) => x.name.toLowerCase() === String(raw.mid ?? "").toLowerCase());
      if (!m) return null;
      const out: Record<string, unknown> = { type, mid: m.id };
      if (!isNil(raw.name) && str(raw.name) !== m.name) out.name = str(raw.name);
      if (!isNil(raw.status) && raw.status !== m.status) out.status = raw.status;
      if (!isNil(raw.month) && raw.month !== m.month) out.month = raw.month;
      if (raw.impact && typeof raw.impact === "object") {
        const parsed = ProposalActionSchema.safeParse({ type: "milestone_update", mid: m.id, impact: raw.impact });
        if (parsed.success && parsed.data.type === "milestone_update" && parsed.data.impact && !sameImpact(parsed.data.impact, m.impact)) out.impact = parsed.data.impact;
      }
      return Object.keys(out).length > 2 ? out : null;
    }
    case "release_create":
    case "release_update": {
      const toCriteria = (list: unknown): unknown[] =>
        (Array.isArray(list) ? list : []).flatMap((c): unknown[] => {
          const cv = typeof c === "object" && c !== null ? (c as Record<string, unknown>) : {};
          const ref = str(cv.ref) ?? "";
          const label = str(cv.label) ?? ref;
          if (cv.type === "gate") {
            const ms = project.milestones.find((x) => x.id === ref) ?? project.milestones.find((x) => x.name.toLowerCase() === ref.toLowerCase());
            return ms ? [{ type: "gate", ms: ms.id, label: label || `${ms.name} base gate` }] : [];
          }
          if (cv.type === "gov") {
            const g = project.governance.find((x) => x.id === ref) ?? project.governance.find((x) => x.name.toLowerCase() === ref.toLowerCase());
            return g ? [{ type: "gov", gid: g.id, label: label || `${g.name} approved` }] : [];
          }
          return label ? [{ type: "manual", ok: false, label }] : [];
        });
      const toMilestoneIds = (list: unknown): string[] =>
        [...new Set((Array.isArray(list) ? list : []).map((v) => project.milestones.find((x) => x.id === v)?.id ?? project.milestones.find((x) => x.name.toLowerCase() === String(v).toLowerCase())?.id).filter((v): v is string => v !== undefined))];
      if (type === "release_create") {
        const name = str(raw.name);
        if (!name || releases.some((r) => r.name.toLowerCase() === name.toLowerCase())) return null;
        return { type, name, month: raw.month, milestoneIds: toMilestoneIds(raw.milestoneIds), criteria: toCriteria(raw.criteria) };
      }
      const rel = releases.find((r) => r.id === raw.rid) ?? releases.find((r) => r.name.toLowerCase() === String(raw.rid ?? "").toLowerCase());
      if (!rel) return null;
      const out: Record<string, unknown> = { type, rid: rel.id };
      if (!isNil(raw.name) && str(raw.name) !== rel.name) out.name = str(raw.name);
      if (!isNil(raw.month) && raw.month !== rel.month) out.month = raw.month;
      if (Array.isArray(raw.milestoneIds)) {
        const ids = toMilestoneIds(raw.milestoneIds);
        if (ids.join() !== rel.milestoneIds.join()) out.milestoneIds = ids;
      }
      if (Array.isArray(raw.criteria)) {
        const parsed = ProposalActionSchema.safeParse({ type: "release_update", rid: rel.id, criteria: toCriteria(raw.criteria) });
        if (parsed.success && parsed.data.type === "release_update" && parsed.data.criteria && !sameCriteria(parsed.data.criteria, rel.criteria)) out.criteria = parsed.data.criteria;
      }
      return Object.keys(out).length > 2 ? out : null;
    }
    case "calendar_event":
      return { type, date: raw.date, text: raw.text, sub: raw.sub ?? null, tab: raw.tab ?? "overview" };
    default:
      return null;
  }
};

export interface ParsedUpdate {
  summary: string;
  notes: string[];
  proposals: { action: ProposalAction; rationale: string; evidence: ProposalEvidence | null }[];
  returned: number;
}

/** Keep only well-formed proposals that change something the project has; the rest are counted, not stored. Each keeps the passage it cites, verified against the documents it was read from. */
export const parseUpdate = (raw: unknown, project: Project, releases: Release[], defaultOwner: string, sources: readonly { name: string; text: string }[] = []): ParsedUpdate => {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const items = Array.isArray(o.proposals) ? o.proposals.slice(0, MAX_UPDATE_PROPOSALS) : [];
  const seen = new Set<string>();
  const proposals: ParsedUpdate["proposals"] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const { rationale, source, quote, ...rest } = item as Record<string, unknown>;
    const shaped = normalizeAction(rest, project, releases, defaultOwner);
    if (!shaped) continue;
    const parsed = ProposalActionSchema.safeParse(shaped);
    if (!parsed.success) continue;
    const key = JSON.stringify(parsed.data);
    if (seen.has(key)) continue;
    seen.add(key);
    const why = [typeof source === "string" && source.trim() ? `${source.trim()}: ` : "", typeof rationale === "string" ? rationale.trim() : ""].join("").slice(0, 400);
    proposals.push({ action: parsed.data, rationale: why, evidence: evidenceFor(typeof source === "string" ? source : null, typeof quote === "string" ? quote : null, sources) });
  }
  return {
    summary: (typeof o.summary === "string" && o.summary.trim() ? o.summary.trim() : "Reviewed the documents").slice(0, 140),
    notes: (Array.isArray(o.notes) ? o.notes : []).filter((n): n is string => typeof n === "string" && n.trim() !== "").map((n) => n.trim().slice(0, 400)).slice(0, 10),
    proposals,
    returned: items.length,
  };
};

// ---- running ---------------------------------------------------------------------------

export interface UpdateResult {
  run: AgentRun;
  proposals: Proposal[];
  /** Well-formed proposals the model returned that were dropped: no-ops, duplicates, or unknown targets. */
  dropped: number;
}

/** Read the documents against the project and stage what changes as pending proposals; never applies anything. */
export const proposeProjectUpdates = async (db: Database, llm: Llm, pid: string, sources: ExtractedSource[], note: string, now: Date): Promise<UpdateResult> => {
  const state = loadState(db, now);
  const project = findProject(state, pid);
  const agent = state.agents.find((a) => a.kind === "setup");
  if (!agent) throw new Conflict("no setup agent is installed; add one on the Agents page");
  const usable = sources.filter((s) => s.text);
  if (usable.length === 0 && !note.trim()) throw new Conflict("nothing to read: add a document with text, a snippet, or a note");
  const messages = buildUpdateMessages(agent, state, project, sources, note, ymOf(now));
  const briefing = messages[1]?.content ?? "";
  const started = Date.now();
  const n = usable.length;
  const run: AgentRun = {
    id: nextStoredRunId(db),
    agentId: agent.id,
    proj: project.id,
    tab: "overview",
    state: "working",
    startedAt: now.toISOString(),
    finishedAt: null,
    instruction: note.trim() || null,
    summary: `${agent.name} is reading ${n} document${n === 1 ? "" : "s"} for ${project.name}…`,
    output: "",
    model: null,
    error: null,
    promptVersion: promptVersion(agent.kind, agent.prompt, agent.id),
    latencyMs: null,
    promptTokens: null,
    completionTokens: null,
    benchmark: null,
    rating: null,
    ratingNote: null,
  };
  insertRun(db, run, briefing);
  const t = trace(db, run);
  t.step("briefing", `${project.name}: ${n} document${n === 1 ? "" : "s"}, ${briefing.length.toLocaleString()} characters`);
  try {
    t.step("request", `${agent.model ?? llm.describe().model ?? "default model"}, JSON schema, up to 6000 tokens`);
    const asked = Date.now();
    const res = await callLlm(db, llm, { agentId: agent.id, proj: project.id, runId: run.id }, messages, { jsonSchema: UPDATE_SCHEMA, maxTokens: 6000, temperature: 0.2, timeoutMs: 240_000, model: agent.model, onToken: t.token }, now);
    t.step("reply", replyDetail(res.usage, Date.now() - asked, res.truncated));
    const parsed = parseUpdate(extractJson(res.content), project, state.releases[project.id] ?? [], state.workspace.user.ini, usable);
    t.step("parsed", parsed.summary);
    const dropped = parsed.returned - parsed.proposals.length;
    t.step("proposals", parsed.returned ? `kept ${parsed.proposals.length} of ${parsed.returned} returned${dropped ? " (the rest changed nothing, repeated another, or named things the project does not have)" : ""}` : "none returned");
    const lines = [
      `## ${parsed.summary}`,
      "",
      `Read ${n} document${n === 1 ? "" : "s"}: ${usable.map((s) => s.name).join(", ") || "none"}.`,
      "",
      parsed.proposals.length ? `### Staged for approval (${parsed.proposals.length})` : "### Nothing to change",
      ...parsed.proposals.map((p) => `- ${p.rationale || p.action.type}`),
      ...(parsed.notes.length ? ["", "### Notes", ...parsed.notes.map((x) => `- ${x}`)] : []),
    ];
    const finished: AgentRun = {
      ...run,
      state: "done",
      finishedAt: new Date().toISOString(),
      summary: parsed.proposals.length ? `Staged ${parsed.proposals.length} change${parsed.proposals.length === 1 ? "" : "s"} from ${n} document${n === 1 ? "" : "s"}: ${parsed.summary}`.slice(0, 140) : `No changes found in ${n} document${n === 1 ? "" : "s"}: ${parsed.summary}`.slice(0, 140),
      output: lines.join("\n"),
      model: res.model,
      latencyMs: Date.now() - started,
      promptTokens: res.usage?.prompt ?? null,
      completionTokens: res.usage?.completion ?? null,
    };
    updateRun(db, finished);
    const proposals: Proposal[] = [];
    db.transaction(() => {
      for (const pr of parsed.proposals) {
        const proposal: Proposal = { id: nextStoredProposalId(db), runId: run.id, agentId: agent.id, proj: project.id, ruleId: null, action: pr.action, rationale: pr.rationale, state: "pending", createdAt: now.toISOString(), decidedAt: null, evidence: pr.evidence };
        insertProposal(db, proposal);
        registerProposalGuard(db, proposal, state);
        proposals.push(proposal);
      }
    })();
    const scores = ruleScores({ run: finished, briefing, proposalsReturned: parsed.returned, proposalsKept: parsed.proposals.length }, finished.finishedAt ?? now.toISOString());
    for (const s of scores) upsertScore(db, s);
    t.step("done", `staged ${proposals.length} proposal${proposals.length === 1 ? "" : "s"} in ${((finished.latencyMs ?? 0) / 1000).toFixed(1)}s`);
    t.finished(finished.state);
    return { run: finished, proposals, dropped };
  } catch (e) {
    const failed: AgentRun = { ...run, state: "failed", finishedAt: new Date().toISOString(), summary: `${agent.name} could not read the documents`, error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - started };
    updateRun(db, failed);
    t.step("failed", failed.error ?? "unknown error");
    t.finished("failed");
    return { run: failed, proposals: [], dropped: 0 };
  }
};
