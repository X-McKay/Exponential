// ================= project setup agent =================
//
// From a name, a short brief, and whatever documents the user has (charters,
// decks, notes), the setup agent drafts the whole project record: every field
// comes back with a rationale, the source it came from, and a confidence.
// Nothing is created until the person reviews the draft and confirms it.

import type { Database } from "bun:sqlite";
import { GOV_STATUSES, MILESTONE_STATUSES, YEAR_MONTH, addMonths, initialsOf, nextProjectKey, slugId, ymOf } from "@valueflow/domain";
import type { Confidence, ProjectDraft, SetupDraft, SetupSource, Suggested } from "@valueflow/domain";
import type { SetupCreateInput } from "@valueflow/shared";
import type { ExtractedSource } from "./extract.ts";
import { extractJson } from "./llm.ts";
import type { ChatMessage, Llm } from "./llm.ts";
import { createGovernanceItem, deleteSetupDraft, insertSetupDraft, loadSetupDraft, loadState, recordEvent, updateSetupDraft, upsertMilestone, upsertProject, upsertRelease } from "./repo.ts";

const STAGES = ["Discovery", "Pilot", "Scaling", "Sustain"];
const CATEGORIES = ["Design & architecture", "AI governance", "Operations", "Release & adoption"];

// ---- schema the model must satisfy -----------------------------------------

const suggested = (value: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    value,
    rationale: { type: "string", description: "Why, citing the document it came from." },
    source: { type: "string", description: "Name of the source document, or an empty string if inferred." },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["value", "rationale", "source", "confidence"],
});

const DRAFT_SCHEMA = {
  name: "project_draft",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      description: suggested({ type: "string", description: "Two to four sentences: what the system does and what it replaces." }),
      stage: suggested({ type: "string", enum: STAGES }),
      tier: suggested({ type: "integer", description: "AI risk tier 1 (high), 2 (medium), 3 (low), or 0 when it cannot be determined." }),
      committee: suggested({
        type: "object",
        additionalProperties: false,
        properties: { date: { type: "string", description: "YYYY-MM-DD of the AI committee approval, or empty." }, ref: { type: "string", description: "Approval reference, or empty." } },
        required: ["date", "ref"],
      }),
      targets: suggested({
        type: "object",
        additionalProperties: false,
        properties: { fte: { type: "number", description: "FTE reduction target, percent 0-100." }, time: { type: "number", description: "Time reduction target, percent 0-100." } },
        required: ["fte", "time"],
      }),
      team: {
        type: "array",
        maxItems: 12,
        items: suggested({ type: "object", additionalProperties: false, properties: { name: { type: "string" }, role: { type: "string" } }, required: ["name", "role"] }),
      },
      repos: {
        type: "array",
        maxItems: 10,
        items: suggested({ type: "object", additionalProperties: false, properties: { name: { type: "string" }, url: { type: "string", description: "github.com/org/repo or empty." } }, required: ["name", "url"] }),
      },
      milestones: {
        type: "array",
        maxItems: 10,
        items: suggested({
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            status: { type: "string", enum: [...MILESTONE_STATUSES] },
            month: { type: "string", description: "Target month YYYY-MM." },
            baseFte: { type: "number" },
            baseTime: { type: "number" },
            stretchFte: { type: "number" },
            stretchTime: { type: "number" },
            metrics: {
              type: "array",
              maxItems: 4,
              items: {
                type: "object",
                additionalProperties: false,
                properties: { label: { type: "string" }, base: { type: "number", description: "Base gate, percent." }, stretch: { type: "number", description: "Stretch gate, percent." } },
                required: ["label", "base", "stretch"],
              },
            },
          },
          required: ["name", "status", "month", "baseFte", "baseTime", "stretchFte", "stretchTime", "metrics"],
        }),
      },
      governance: {
        type: "array",
        maxItems: 16,
        items: suggested({
          type: "object",
          additionalProperties: false,
          properties: {
            cat: { type: "string", enum: CATEGORIES },
            name: { type: "string" },
            status: { type: "string", enum: [...GOV_STATUSES] },
            owner: { type: "string", description: "Team member name, or empty." },
            detail: { type: "string" },
          },
          required: ["cat", "name", "status", "owner", "detail"],
        }),
      },
      releases: {
        type: "array",
        maxItems: 6,
        items: suggested({
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            month: { type: "string", description: "Target month YYYY-MM." },
            milestones: { type: "array", items: { type: "string" }, description: "Milestone names shipped in this release." },
            criteria: {
              type: "array",
              maxItems: 8,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  type: { type: "string", enum: ["gate", "gov", "manual"] },
                  ref: { type: "string", description: "gate: milestone name; gov: governance item name; manual: empty." },
                  label: { type: "string" },
                },
                required: ["type", "ref", "label"],
              },
            },
          },
          required: ["name", "month", "milestones", "criteria"],
        }),
      },
      notes: { type: "array", maxItems: 10, items: { type: "string" }, description: "Open questions and things the documents did not settle." },
    },
    required: ["description", "stage", "tier", "committee", "targets", "team", "repos", "milestones", "governance", "releases", "notes"],
  },
};

// ---- prompt -------------------------------------------------------------------

const SYSTEM = (todayYm: string) =>
  [
    "You are the ValueFlow project-setup agent. From a project name, a brief, and the documents provided, draft the complete project record for an AI-project delivery platform.",
    "ValueFlow tracks value that is only realized when milestones ship AND their eval metrics clear a gate. Model the project that way:",
    `- stage: one of ${STAGES.join(", ")}.`,
    "- tier: AI risk tier 1 (high: regulated, irreversible, external), 2 (medium: human-in-the-loop, internal), 3 (low), or 0 if undeterminable.",
    "- targets: percentage reductions the project claims (FTE, time). Use the documents' numbers; if none, estimate conservatively and say so.",
    `- milestones: 3-8 deliverables with a target month (YYYY-MM; today is ${todayYm}), a status (backlog unless the documents say work has started, shipped only if they say it shipped), base and stretch impact (percent of the targets each contributes; bases should roughly sum to the targets), and 1-3 measurable eval metrics with base and stretch gates in percent.`,
    `- governance: the items a project like this needs across ${CATEGORIES.join(", ")} (design doc, architecture review, security review, AI committee review, model risk assessment, eval sign-off, DPIA, system card, runbook, SLA, monitoring, release process, UAT, documentation). Status is approved ONLY when a document states it was approved; in_review or draft when work is described; otherwise missing.`,
    "- releases: 1-4 releases grouping milestones, each with go-live criteria. A criterion of type gate references a milestone name (its eval gate must clear); type gov references a governance item name (it must be approved); type manual is a sign-off with no reference. Never point a gate at a governance item.",
    "- stretch impact must exceed base impact for every milestone.",
    "- team: people named in the documents with their roles. repos: repositories named in the documents. Governance owners are people from the team (or empty), not departments.",
    "Every field carries a rationale citing the source document by name, the source name (empty if inferred), and a confidence. Prefer low confidence with an honest rationale over invention. Put open questions in notes.",
    "Reply with a single JSON object matching the schema.",
  ].join("\n");

const userMessage = (name: string, key: string, brief: string, sources: ExtractedSource[], previous: ProjectDraft | null, feedback: string[]): string => {
  const parts: string[] = [`Project name: ${name}`, `Key: ${key}`];
  if (brief.trim()) parts.push(`Brief from the user:\n${brief.trim()}`);
  const usable = sources.filter((s) => s.text);
  if (usable.length) parts.push(...usable.map((s) => `### Source: ${s.name} (${s.kind})\n${s.text}`));
  else parts.push("No documents were provided; draft from the name and brief alone with low confidence.");
  if (previous) {
    parts.push(`### Previous draft (JSON)\n${JSON.stringify(previous)}`);
    parts.push(`### Feedback from the user\n${feedback.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\nUpdate the draft to apply the feedback. Keep every other field as it was unless the feedback changes it.`);
  }
  return parts.join("\n\n");
};

export const buildSetupMessages = (name: string, key: string, brief: string, sources: ExtractedSource[], todayYm: string, previous: ProjectDraft | null = null, feedback: string[] = []): ChatMessage[] => [
  { role: "system", content: SYSTEM(todayYm) },
  { role: "user", content: userMessage(name, key, brief, sources, previous, feedback) },
];

// ---- normalising the reply ------------------------------------------------------

const str = (v: unknown, max = 2000): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, lo: number, hi: number, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 10) / 10)) : fallback);
const conf = (v: unknown): Confidence => (v === "high" || v === "medium" || v === "low" ? v : "low");
const month = (v: unknown, fallback: string): string => (typeof v === "string" && YEAR_MONTH.test(v) ? v : fallback);
const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T => (values as readonly string[]).includes(String(v)) ? (v as T) : fallback;

const sug = <T>(raw: unknown, value: T): Suggested<T> => {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { value, rationale: str(o.rationale, 600), source: str(o.source, 200) || null, confidence: conf(o.confidence) };
};
const val = (raw: unknown): Record<string, unknown> => {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return typeof o.value === "object" && o.value !== null ? (o.value as Record<string, unknown>) : {};
};
const list = (raw: unknown, max: number): unknown[] => (Array.isArray(raw) ? raw.slice(0, max) : []);

/** Turn whatever the model returned into a well-formed draft; bad values become safe defaults with low confidence. */
export const normalizeDraft = (raw: unknown, todayYm: string): ProjectDraft => {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const g = (k: string): Record<string, unknown> => (typeof o[k] === "object" && o[k] !== null ? (o[k] as Record<string, unknown>) : {});
  const tierRaw = g("tier").value;
  const tier = tierRaw === 1 || tierRaw === 2 || tierRaw === 3 ? tierRaw : null;
  const cm = val(o.committee);
  const committeeDate = str(cm.date, 10);
  const committee = /^\d{4}-\d{2}-\d{2}$/.test(committeeDate) && str(cm.ref, 40) ? { date: committeeDate, ref: str(cm.ref, 40) } : null;
  const tg = val(o.targets);
  const defaultMonth = addMonths(todayYm, 3);
  const milestoneNames = new Set(list(o.milestones, 10).map((m) => str(val(m).name, 160)));
  const govNames = new Set(list(o.governance, 16).map((item) => str(val(item).name, 160)));
  const findName = (names: Set<string>, ref: string): string | null => {
    if (names.has(ref)) return ref;
    const lower = ref.toLowerCase();
    for (const n of names) if (n.toLowerCase() === lower) return n;
    return null;
  };
  return {
    description: sug(o.description, str(g("description").value, 2000)),
    stage: sug(o.stage, oneOf(g("stage").value, STAGES, "Discovery")),
    tier: sug(o.tier, tier),
    committee: sug(o.committee, committee),
    targets: sug(o.targets, { fte: num(tg.fte, 0, 100, 30), time: num(tg.time, 0, 100, 30) }),
    team: list(o.team, 12)
      .map((t) => {
        const v = val(t);
        const name = str(v.name, 80);
        return sug(t, { name, role: str(v.role, 80) || "Team member", ini: initialsOf(name) });
      })
      .filter((t) => t.value.name !== ""),
    repos: list(o.repos, 10)
      .map((r) => {
        const v = val(r);
        const name = str(v.name, 120);
        return sug(r, { name, url: str(v.url, 300) || (name ? `github.com/org/${name}` : "") });
      })
      .filter((r) => r.value.name !== ""),
    milestones: list(o.milestones, 10)
      .map((m) => {
        const v = val(m);
        const base = { fte: num(v.baseFte, 0, 100, 5), time: num(v.baseTime, 0, 100, 5) };
        // Stretch never sits below base; a model that repeats base gets a modest step up.
        const lift = (b: number, s: number): number => (s > b ? s : Math.min(100, Math.round(b * 1.3 * 10) / 10 || b + 2));
        return sug(m, {
          name: str(v.name, 160),
          status: oneOf(v.status, MILESTONE_STATUSES, "backlog"),
          month: month(v.month, defaultMonth),
          impact: { base, stretch: { fte: lift(base.fte, num(v.stretchFte, 0, 100, 0)), time: lift(base.time, num(v.stretchTime, 0, 100, 0)) } },
          metrics: list(v.metrics, 4)
            .map((x) => {
              const mv = typeof x === "object" && x !== null ? (x as Record<string, unknown>) : {};
              return { label: str(mv.label, 120), base: num(mv.base, 0, 100, 80), stretch: num(mv.stretch, 0, 100, 95) };
            })
            .filter((x) => x.label !== ""),
        });
      })
      .filter((m) => m.value.name !== ""),
    governance: list(o.governance, 16)
      .map((gi) => {
        const v = val(gi);
        return sug(gi, { cat: oneOf(v.cat, CATEGORIES, "AI governance"), name: str(v.name, 160), status: oneOf(v.status, GOV_STATUSES, "missing"), owner: str(v.owner, 80), detail: str(v.detail, 2000) });
      })
      .filter((x) => x.value.name !== ""),
    releases: list(o.releases, 6)
      .map((r) => {
        const v = val(r);
        return sug(r, {
          name: str(v.name, 120),
          month: month(v.month, defaultMonth),
          milestones: list(v.milestones, 20).map((x) => str(x, 160)).filter(Boolean),
          criteria: list(v.criteria, 8)
            .map((c) => {
              const cv = typeof c === "object" && c !== null ? (c as Record<string, unknown>) : {};
              let type = oneOf(cv.type, ["gate", "gov", "manual"] as const, "manual");
              let ref = str(cv.ref, 160);
              // A reference decides the type when the model mislabelled it: milestone names are gates, governance names are gov.
              const ms = findName(milestoneNames, ref);
              const gv = findName(govNames, ref);
              if (type !== "manual" && ms) {
                type = "gate";
                ref = ms;
              } else if (type !== "manual" && gv) {
                type = "gov";
                ref = gv;
              } else if (type !== "manual" && !ms && !gv) type = "manual";
              return { type, ref: type === "manual" ? "" : ref, label: str(cv.label, 200) || ref };
            })
            .filter((c) => c.label !== ""),
        });
      })
      .filter((r) => r.value.name !== ""),
    notes: list(o.notes, 10).map((n) => str(n, 400)).filter(Boolean),
  };
};

// ---- running the agent -------------------------------------------------------------

export const toSetupSources = (sources: ExtractedSource[]): SetupSource[] => sources.map((s) => ({ name: s.name, kind: s.kind, chars: s.chars, error: s.error }));

export const analyzeSetup = async (db: Database, llm: Llm, input: { name: string; key?: string; brief: string; sources: ExtractedSource[] }, now: Date): Promise<SetupDraft> => {
  const state = loadState(db, now);
  const key = input.key?.trim() || nextProjectKey(state.projects);
  const todayYm = ymOf(now);
  const res = await llm.chat(buildSetupMessages(input.name, key, input.brief, input.sources, todayYm), { jsonSchema: DRAFT_SCHEMA, maxTokens: 6000, temperature: 0.2, timeoutMs: 240_000 });
  const draft = normalizeDraft(extractJson(res.content), todayYm);
  const record: SetupDraft = {
    id: slugId(`${input.name}-${now.getTime().toString(36)}`, [], "draft"),
    createdAt: now.toISOString(),
    name: input.name.trim(),
    key,
    brief: input.brief.trim(),
    sources: toSetupSources(input.sources),
    draft,
    feedback: [],
    model: res.model,
  };
  insertSetupDraft(db, record, input.sources);
  return record;
};

export const refineSetup = async (db: Database, llm: Llm, id: string, feedback: string, now: Date): Promise<SetupDraft> => {
  const { draft: record, sources } = loadSetupDraft(db, id);
  const todayYm = ymOf(now);
  const allFeedback = [...record.feedback, feedback.trim()];
  const res = await llm.chat(buildSetupMessages(record.name, record.key, record.brief, sources, todayYm, record.draft, allFeedback), {
    jsonSchema: DRAFT_SCHEMA,
    maxTokens: 6000,
    temperature: 0.2,
    timeoutMs: 240_000,
  });
  const updated: SetupDraft = { ...record, draft: normalizeDraft(extractJson(res.content), todayYm), feedback: allFeedback, model: res.model };
  updateSetupDraft(db, updated);
  return updated;
};

/** Create the project and everything under it in one transaction, then drop the draft. */
export const createFromSetup = (db: Database, id: string, input: SetupCreateInput, now: Date): string => {
  const { draft } = loadSetupDraft(db, id);
  db.transaction(() => {
    upsertProject(db, input.project, "create");
    for (const m of input.milestones) upsertMilestone(db, input.project.id, m, "create", now);
    for (const g of input.governance) createGovernanceItem(db, input.project.id, g);
    for (const r of input.releases) upsertRelease(db, input.project.id, r, "create");
    const at = now.toISOString();
    const n = draft.sources.filter((s) => !s.error).length;
    recordEvent(db, {
      ref: `setup:${input.project.id}:${at}`,
      at,
      type: "ship",
      proj: input.project.id,
      tab: "overview",
      text: `${input.project.name} set up from ${n} document${n === 1 ? "" : "s"}: ${input.milestones.length} milestones, ${input.governance.length} governance items, ${input.releases.length} releases`,
    });
    deleteSetupDraft(db, id);
  })();
  return input.project.id;
};
