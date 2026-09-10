// ================= API contract: request/response schemas =================
//
// Zod schemas validate every mutation body at the server boundary. The
// inferred types are used by the client so both sides share one contract.

import { z } from "zod";
import { GOV_STATUSES, MILESTONE_STATUSES, MONTHS } from "@valueflow/domain";

const pct = z.number().finite().min(0).max(100);
const id = z.string().trim().min(1).max(64);

export const ImpactPairSchema = z.object({ fte: z.number().finite().min(0).max(100), time: z.number().finite().min(0).max(100) });

export const MetricInputSchema = z.object({
  id,
  label: z.string().trim().min(1).max(120),
  base: pct,
  stretch: pct,
  current: pct,
});

export const MilestoneInputSchema = z.object({
  id,
  name: z.string().trim().min(1).max(160),
  status: z.enum(MILESTONE_STATUSES as [string, ...string[]]).pipe(z.custom<(typeof MILESTONE_STATUSES)[number]>()),
  month: z.number().int().min(0).max(MONTHS.length - 1),
  impact: z.object({ base: ImpactPairSchema, stretch: ImpactPairSchema }),
  metrics: z.array(MetricInputSchema).max(12),
});
export type MilestoneInput = z.infer<typeof MilestoneInputSchema>;

export const TargetsInputSchema = ImpactPairSchema;
export type TargetsInput = z.infer<typeof TargetsInputSchema>;

export const GovernanceInputSchema = z.object({
  status: z.enum(GOV_STATUSES as [string, ...string[]]).pipe(z.custom<(typeof GOV_STATUSES)[number]>()),
  owner: z.string().trim().min(1).max(3),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
    .nullable(),
  detail: z.string().max(2000),
  link: z.string().trim().max(300).optional(),
});
export type GovernanceInput = z.infer<typeof GovernanceInputSchema>;

export const ReadingInputSchema = z.object({
  value: pct,
  source: z.enum(["eval", "manual"]).default("manual"),
});
export type ReadingInput = z.infer<typeof ReadingInputSchema>;

export interface ApiError {
  error: string;
  issues?: unknown;
}
