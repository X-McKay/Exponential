// ================= API contract: request/response schemas =================
//
// Zod schemas validate every mutation body at the server boundary. The
// inferred types are used by the client so both sides share one contract.

import { z } from "zod";
import { FEED_TYPES, GOV_STATUSES, MILESTONE_STATUSES, PROJECT_TABS, YEAR_MONTH } from "@valueflow/domain";

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

export const DevActivitySchema = z.object({
  stats: z.object({
    coverage: pct,
    quality: short(4),
    buildPass: pct,
    mergedPRs: z.number().int().min(0),
    medianReview: short(20),
    deploys: z.number().int().min(0),
  }),
  repos: z.array(z.object({ name: short(120), branch: short(80), coverage: pct, quality: short(4), lang: short(40) })).max(30),
  activitySeed: z.number().finite(),
  activityLevel: z.number().finite().min(0).max(100),
  prs: z
    .array(
      z.object({
        id: short(20),
        title: short(200),
        repo: short(120),
        author: short(3),
        status: z.enum(["open", "merged"]),
        checks: z.enum(["pass", "fail", "running"]),
        add: z.number().int().min(0),
        del: z.number().int().min(0),
        age: short(20),
        reviewers: z.array(short(3)).max(8),
      }),
    )
    .max(50),
  builds: z
    .array(z.object({ id: short(20), repo: short(120), branch: short(80), status: z.enum(["pass", "fail"]), note: short(200), when: short(20), dur: short(20) }))
    .max(50),
  people: z.array(z.object({ ini: short(3), name: short(80), commits: z.number().int().min(0), reviews: z.number().int().min(0) })).max(30),
});
export type DevActivityInput = z.infer<typeof DevActivitySchema>;

export const AgentSchema = z.object({
  id,
  name: short(40),
  grad: short(200),
  purpose: short(300),
  status: z.enum(["working", "idle", "scheduled"]),
  model: short(40),
  runs: z.number().int().min(0),
  success: pct,
  last: short(20),
  owner: short(3),
  caps: z.array(short(60)).max(12),
  sessions: z.array(z.object({ when: short(20), state: z.enum(["done", "working", "attention"]), text: short(300), proj: id, tab: projectTab })).max(20),
});
export const AgentsInputSchema = z.array(AgentSchema).max(20);
export type AgentsInput = z.infer<typeof AgentsInputSchema>;

export const FeedDaySchema = z.object({
  day: short(40),
  items: z.array(z.object({ t: short(20), type: enumOf(FEED_TYPES), proj: id, tab: projectTab, text: short(300) })).max(30),
});
export const FeedInputSchema = z.array(FeedDaySchema).max(14);
export type FeedInput = z.infer<typeof FeedInputSchema>;

export const UpcomingSchema = z.object({
  date: short(20),
  proj: id,
  tab: projectTab,
  text: short(200),
  sub: z.string().max(200).nullable(),
  release: z.object({ pid: id, rid: id }).optional(),
});
export const UpcomingInputSchema = z.array(UpcomingSchema).max(30);
export type UpcomingInput = z.infer<typeof UpcomingInputSchema>;

export interface ApiError {
  error: string;
  issues?: unknown;
}
