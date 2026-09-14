// ================= API contract: request/response schemas =================
//
// Zod schemas validate every mutation body at the server boundary. The
// inferred types are used by the client so both sides share one contract.

import { z } from "zod";
import { AGENT_KINDS, BUDGET_SCOPES, GOV_STATUSES, MILESTONE_STATUSES, PROJECT_TABS, YEAR_MONTH } from "@valueflow/domain";

const pct = z.number().finite().min(0).max(100);
const id = z.string().trim().min(1).max(64);
const short = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(Date.UTC(y!, m! - 1, d!));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
  }, "expected a real calendar date");
const month = z.string().regex(YEAR_MONTH, "expected YYYY-MM");
const enumOf = <T extends string>(values: readonly T[]) => z.enum(values as unknown as [string, ...string[]]).pipe(z.custom<T>());
const uniqueIds = <T extends { id: string }>(items: T[], ctx: z.RefinementCtx, label: string): void => {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (seen.has(item.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "id"], message: `${label} ids must be unique` });
    seen.add(item.id);
  });
};
const safeUrl = (value: string): boolean => {
  if (!value.trim()) return false;
  // Bare hosts are accepted for existing repository fixtures, but an
  // explicitly supplied scheme must be HTTP(S); this rejects javascript:,
  // data:, file:, and other active URL schemes before URL normalization.
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) return false;
  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
};
const url = (max: number) => z.string().trim().max(max).refine(safeUrl, "expected an http(s) URL");

export const ImpactPairSchema = z.object({ fte: pct, time: pct });
const ImpactSchema = z
  .object({ base: ImpactPairSchema, stretch: ImpactPairSchema })
  .superRefine((value, ctx) => {
    for (const d of ["fte", "time"] as const) {
      if (value.base[d] > value.stretch[d]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["stretch", d], message: "stretch must be greater than or equal to base" });
    }
  });

// ---- milestones -----------------------------------------------------------

export const MetricInputSchema = z.object({
  id,
  label: short(120),
  base: pct,
  stretch: pct,
  current: pct,
}).superRefine((value, ctx) => {
  if (value.base > value.stretch) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["stretch"], message: "stretch must be greater than or equal to base" });
});

export const MilestoneInputSchema = z.object({
  id,
  name: short(160),
  status: enumOf(MILESTONE_STATUSES),
  month,
  impact: ImpactSchema,
  metrics: z.array(MetricInputSchema).max(12).superRefine((items, ctx) => uniqueIds(items, ctx, "metric")),
}).superRefine((value, ctx) => {
  if (value.impact.base.fte > value.impact.stretch.fte || value.impact.base.time > value.impact.stretch.time) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["impact", "stretch"], message: "stretch must be greater than or equal to base" });
  }
});
export type MilestoneInput = z.infer<typeof MilestoneInputSchema>;

export const TargetsInputSchema = ImpactPairSchema;
export type TargetsInput = z.infer<typeof TargetsInputSchema>;

// ---- projects -------------------------------------------------------------

export const RepoInputSchema = z.object({ name: short(120), url: url(300) });
export const TeamMemberInputSchema = z.object({ ini: short(3), name: short(80), role: short(80) });

/** A project's editable facts. Milestones, governance items, and releases have their own endpoints. */
export const ProjectInputSchema = z.object({
  id: id.regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes"),
  key: short(16),
  name: short(160),
  stage: short(40),
  description: z.string().max(2000),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  committee: z.object({ date: isoDate, ref: short(40) }).nullable(),
  repos: z.array(RepoInputSchema).max(20),
  team: z.array(TeamMemberInputSchema).max(30),
  targets: ImpactPairSchema,
});
export type ProjectInput = z.infer<typeof ProjectInputSchema>;

// ---- governance -----------------------------------------------------------

/** Status-level edit of an existing item; `cat` and `name` may be renamed when present. */
export const GovernanceInputSchema = z.object({
  cat: short(80).optional(),
  name: short(160).optional(),
  status: enumOf(GOV_STATUSES),
  owner: short(3),
  date: isoDate.nullable(),
  detail: z.string().max(2000),
  link: z.string().trim().max(300).refine((s) => !s || safeUrl(s), "expected an http(s) URL").optional(),
});
export type GovernanceInput = z.infer<typeof GovernanceInputSchema>;

/** A whole governance item, for creation. */
export const GovernanceItemInputSchema = GovernanceInputSchema.extend({ id, cat: short(80), name: short(160) });
export type GovernanceItemInput = z.infer<typeof GovernanceItemInputSchema>;

// ---- releases -------------------------------------------------------------

export const CriterionInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("gate"), ms: id, label: short(200) }),
  z.object({ type: z.literal("gov"), gid: id, label: short(200) }),
  z.object({ type: z.literal("manual"), ok: z.boolean(), label: short(200) }),
]);

export const ReleaseInputSchema = z.object({
  id,
  name: short(120),
  month,
  milestoneIds: z.array(id).max(20).superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      if (seen.has(item)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i], message: "milestone ids must be unique" });
      seen.add(item);
    });
  }),
  criteria: z.array(CriterionInputSchema).max(20),
});
export type ReleaseInput = z.infer<typeof ReleaseInputSchema>;

// ---- readings -------------------------------------------------------------

export const ReadingInputSchema = z.object({
  value: pct,
  source: z.enum(["eval", "manual"]).default("manual"),
});
export type ReadingInput = z.infer<typeof ReadingInputSchema>;

// ---- workspace ------------------------------------------------------------

export const WorkspaceInputSchema = z.object({ user: z.object({ name: short(80), ini: short(3) }) });
export type WorkspaceInput = z.infer<typeof WorkspaceInputSchema>;

// ---- JSON documents mirrored from external systems ------------------------
//
// These validate the whole document on write, so a hand-edited doc can never
// break a page. They mirror the domain types one to one.

const projectTab = enumOf(PROJECT_TABS);

export const AgentSchema = z.object({
  id,
  name: short(40),
  grad: short(200),
  purpose: short(300),
  kind: enumOf(AGENT_KINDS),
  model: z.string().trim().max(80).nullable(),
  owner: short(3),
  caps: z.array(short(60)).max(12),
  schedule: z.enum(["nightly", "weekly"]).nullable(),
  prompt: z.string().trim().max(4000).nullable().default(null),
});
export const AgentsInputSchema = z.array(AgentSchema).max(20);
export type AgentsInput = z.infer<typeof AgentsInputSchema>;

/**
 * What a model may propose. The reply carries a flat object; the type decides
 * which fields matter, so a model that omits or invents fields fails cleanly.
 */
export const ProposalActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("governance_status"), gid: id, status: enumOf(GOV_STATUSES) }),
  z.object({ type: z.literal("milestone_status"), mid: id, status: enumOf(MILESTONE_STATUSES) }),
  z.object({ type: z.literal("governance_item"), cat: short(80), name: short(160), status: enumOf(GOV_STATUSES), owner: short(3), detail: z.string().max(2000).default("") }),
  z.object({ type: z.literal("calendar_event"), date: isoDate, tab: projectTab.default("overview"), text: short(200), sub: z.string().max(200).nullable().default(null) }),
  z.object({ type: z.literal("targets"), fte: pct, time: pct }),
  z.object({ type: z.literal("agent_prompt"), agentId: id, prompt: z.string().trim().max(4000).nullable() }),
  z.object({ type: z.literal("agent_model"), agentId: id, model: z.string().trim().min(1).max(160).nullable() }),
]);
export type ProposalActionInput = z.infer<typeof ProposalActionSchema>;

/** Everything the wizard composes from an accepted draft, created in one transaction. */
export const SetupCreateInputSchema = z.object({
  project: ProjectInputSchema,
  milestones: z.array(MilestoneInputSchema).max(20).superRefine((items, ctx) => uniqueIds(items, ctx, "milestone")),
  governance: z.array(GovernanceItemInputSchema).max(40).superRefine((items, ctx) => uniqueIds(items, ctx, "governance")),
  releases: z.array(ReleaseInputSchema).max(10).superRefine((items, ctx) => uniqueIds(items, ctx, "release")),
});
export type SetupCreateInput = z.infer<typeof SetupCreateInputSchema>;

export const SetupRefineInputSchema = z.object({ feedback: short(2000) });

export const ChatMessageSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(8000) });
export const ChatInputSchema = z.object({
  /** The conversation so far, oldest first; the last message is the question. */
  messages: z.array(ChatMessageSchema).min(1).max(16),
  /** Project the user is looking at, for a fuller briefing. */
  proj: id.nullable().default(null),
});
export type ChatInput = z.infer<typeof ChatInputSchema>;

export const RateRunInputSchema = z.object({ rating: z.union([z.literal(1), z.literal(-1)]).nullable(), note: z.string().trim().max(500).optional() });
export type RateRunInput = z.infer<typeof RateRunInputSchema>;

export const BenchmarkInputSchema = z.object({ agentId: id.optional() });

export const ScoutInputSchema = z.object({ agentId: id.optional(), models: z.array(z.string().trim().min(1).max(160)).max(8).optional() });
export type ScoutInput = z.infer<typeof ScoutInputSchema>;

export const RuleInputSchema = z.object({
  text: z.string().trim().min(12, "say what should happen when a condition holds").max(600),
  proj: id.nullable().default(null),
  enabled: z.boolean().default(true),
  auto: z.boolean().default(false),
  owner: short(3),
});
export type RuleInput = z.infer<typeof RuleInputSchema>;

export const AgentPromptInputSchema = z.object({ prompt: z.string().trim().max(4000).nullable() });

/** Monthly ceilings; the whole list is replaced on write. */
export const BudgetInputSchema = z.object({
  scope: enumOf(BUDGET_SCOPES),
  ref: z.string().trim().max(64).default(""),
  monthlyTokens: z.number().int().min(0).nullable().default(null),
  monthlyUsd: z.number().finite().min(0).nullable().default(null),
});
export const BudgetsInputSchema = z.array(BudgetInputSchema).max(60);
export type BudgetsInput = z.infer<typeof BudgetsInputSchema>;
export type AgentPromptInput = z.infer<typeof AgentPromptInputSchema>;
export type BenchmarkInput = z.infer<typeof BenchmarkInputSchema>;

export const RunAgentInputSchema = z.object({
  agentId: id,
  /** Required for project-scoped kinds; ignored by workspace-scoped ones (brief, tuner, scout). */
  proj: id.optional(),
  tab: projectTab.optional(),
  instruction: z.string().trim().max(2000).optional(),
  /** Agent to tune (tuner) or scout (scout); omitted means every eligible agent. */
  target: id.optional(),
});
export type RunAgentInput = z.infer<typeof RunAgentInputSchema>;

export const CalendarEventInputSchema = z.object({
  id,
  date: isoDate,
  proj: id,
  tab: projectTab,
  text: short(200),
  sub: z.string().trim().max(200).nullable(),
});
export type CalendarEventInput = z.infer<typeof CalendarEventInputSchema>;

export interface ApiError {
  error: string;
  issues?: unknown;
}
