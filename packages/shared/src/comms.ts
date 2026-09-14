import { z } from "zod";

export const CommsFormats = ["executive_update", "release_notes", "decision_memo", "project_brief"] as const;
export type CommsFormat = (typeof CommsFormats)[number];
export type CommsAssignment = { id: string; projectId: string; objective: string; audience: string; format: CommsFormat; owner: string; enabled: boolean; onChange: boolean; cadence: "manual" | "weekly"; createdAt: string; updatedAt: string; lastInputFingerprint: string | null };
export type CommsRun = { id: string; assignmentId: string; projectId: string; agentRunId: string | null; trigger: "manual" | "scheduled"; mode: "draft" | "conversation"; inputFingerprint: string; state: "queued" | "working" | "done" | "attention" | "failed"; summary: string; output: string; error: string | null; startedAt: string; finishedAt: string | null };
export type CommsMessage = { id: string; assignmentId: string; runId: string; role: "user" | "assistant"; content: string; createdAt: string };
export type CommsArtifact = { id: string; assignmentId: string; projectId: string; runId: string; agentRunId: string; title: string; format: CommsFormat; version: number; body: string; status: "draft" | "approved"; approvedAt: string | null; createdAt: string };
export type CommsWorkspaceDetail = { assignment: CommsAssignment; runs: CommsRun[]; messages: CommsMessage[]; artifacts: CommsArtifact[] };
/** Backwards-compatible name used by the communications client. */
export type CommsAssignmentDetail = CommsWorkspaceDetail;

const id = z.string().trim().min(1).max(64);
const text = (max: number) => z.string().trim().min(1).max(max);
export const CommsAssignmentCreateSchema = z.object({ projectId: id, objective: text(2000), audience: text(500), format: z.enum(CommsFormats), owner: text(80), enabled: z.boolean().default(true), onChange: z.boolean().default(false), cadence: z.enum(["manual", "weekly"]).default("manual") });
export const CommsAssignmentUpdateSchema = CommsAssignmentCreateSchema.partial().omit({ projectId: true }).extend({ expectedUpdatedAt: z.string().datetime() });
export const CommsRunInputSchema = z.object({ instruction: z.string().trim().max(4000).optional(), mode: z.enum(["draft", "conversation"]).default("draft") }).refine(input => input.mode !== "conversation" || !!input.instruction?.trim(), { message: "Enter a message to start a conversation", path: ["instruction"] });
export const CommsArtifactApprovalSchema = z.object({ status: z.enum(["draft", "approved"]) });
export type CommsAssignmentCreate = z.infer<typeof CommsAssignmentCreateSchema>;
export type CommsAssignmentUpdate = z.infer<typeof CommsAssignmentUpdateSchema>;
export type CommsRunInput = z.infer<typeof CommsRunInputSchema>;
export type CommsArtifactApproval = z.infer<typeof CommsArtifactApprovalSchema>;
