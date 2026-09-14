import { z } from "zod";

export const PMCommitmentStatus = ["open", "in_progress", "done", "blocked"] as const;
export type PMCommitmentStatus = (typeof PMCommitmentStatus)[number];
export type PMCommitment = { id: string; title: string; owner: string; due: string | null; status: PMCommitmentStatus; createdAt: string; updatedAt: string };
export type PMAssignment = { id: string; projectId: string; objective: string; enabled: boolean; onChange: boolean; cadence: "weekly" | "manual"; owner: string; commitments: PMCommitment[]; createdAt: string; updatedAt: string; lastInputFingerprint: string | null };
export type PMRun = { id: string; assignmentId: string; projectId: string; agentRunId: string | null; trigger: "manual" | "scheduled"; inputFingerprint: string; state: "queued" | "working" | "done" | "attention" | "failed"; summary: string; output: string; error: string | null; startedAt: string; finishedAt: string | null };

const id = z.string().trim().min(1).max(64);
const short = (n: number) => z.string().trim().min(1).max(n);
export const PMCommitmentInputSchema = z.object({ id: id.optional(), title: short(240), owner: short(80), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const date = new Date(value); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }, "Invalid calendar date").nullable().default(null), status: z.enum(PMCommitmentStatus).default("open") });
export const PMAssignmentCreateSchema = z.object({ projectId: id, objective: short(2000), enabled: z.boolean().default(true), onChange: z.boolean().default(false), cadence: z.enum(["weekly", "manual"]).default("manual"), owner: short(80), commitments: z.array(PMCommitmentInputSchema).max(100).default([]) });
export const PMAssignmentUpdateSchema = PMAssignmentCreateSchema.partial().omit({ projectId: true }).extend({ expectedUpdatedAt: z.string().datetime().optional() });
export const PMRunInputSchema = z.object({ instruction: z.string().trim().max(4000).optional() });
export type PMAssignmentCreate = z.infer<typeof PMAssignmentCreateSchema>;
export type PMAssignmentUpdate = z.infer<typeof PMAssignmentUpdateSchema>;
export type PMRunInput = z.infer<typeof PMRunInputSchema>;
