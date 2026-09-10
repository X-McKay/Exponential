// ================= API contract: request/response schemas =================
//
// Zod schemas validate every mutation body at the server boundary. The
// inferred types are used by the client so both sides share one contract.

import { z } from "zod";
import { AGENT_KINDS, GOV_STATUSES, MILESTONE_STATUSES, PROJECT_TABS, YEAR_MONTH } from "@valueflow/domain";

const pct = z.number().finite().min(0).max(100);
const id = z.string().trim().min(1).max(64);
const short = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const month = z.string().regex(YEAR_MONTH, "expected YYYY-MM");
const enumOf = <T extends string>(values: readonly T[]) => z.enum(values as unknown as [string, ...string[]]).pipe(z.custom<T>());

export const ImpactPairSchema = z.object({ fte: pct, time: pct });

// ---- milestones -----------------------------------------------------------

export const MetricInputSchema = z.object({
  id,
  label: short(120),
  base: pct,
  stretch: pct,
  current: pct,
});

export const MilestoneInputSchema = z.object({
  id,
  name: short(160),
  status: enumOf(MILESTONE_STATUSES),
  month,
  impact: z.object({ base: ImpactPairSchema, stretch: ImpactPairSchema }),
  metrics: z.array(MetricInputSchema).max(12),
});
export type MilestoneInput = z.infer<typeof MilestoneInputSchema>;

export const TargetsInputSchema = ImpactPairSchema;
export type TargetsInput = z.infer<typeof TargetsInputSchema>;

// ---- projects -------------------------------------------------------------

export const RepoInputSchema = z.object({ name: short(120), url: short(300) });
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
  link: z.string().trim().max(300).optional(),
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
  milestoneIds: z.array(id).max(20),
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
  schedule: z.enum(["nightly"]).nullable(),
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
]);
export type ProposalActionInput = z.infer<typeof ProposalActionSchema>;

export const RunAgentInputSchema = z.object({
  agentId: id,
  proj: id,
  tab: projectTab.optional(),
  instruction: z.string().trim().max(2000).optional(),
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
