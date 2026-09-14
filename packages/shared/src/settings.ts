import { z } from "zod";

export const LlmSettingsSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().trim().max(500).refine(raw => {
    try { const u = new URL(raw); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash; }
    catch { return false; }
  }, "Use an HTTP(S) API base URL without credentials, query or fragment."),
  model: z.string().trim().min(1).max(200).refine(s => !s.includes("@"), "Configure the endpoint separately from the model name."),
  apiKey: z.string().max(8000).optional(),
  clearToken: z.boolean().optional(),
  thinking: z.boolean().default(false),
  revision: z.number().int().min(0),
});
export type LlmSettingsInput = z.infer<typeof LlmSettingsSchema>;
export interface LlmSettingsStatus {
  enabled: boolean; baseUrl: string; model: string; thinking: boolean;
  hasToken: boolean; revision: number; source: "saved" | "environment" | "none";
}
export const MemberInputSchema = z.object({ name: z.string().trim().min(1).max(80), role: z.enum(["admin", "editor", "viewer"]).default("editor") });
