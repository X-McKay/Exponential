import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { LlmSettingsSchema } from "@valueflow/shared";
import type { LlmSettingsInput, LlmSettingsStatus } from "@valueflow/shared";
import { llmFromEnv } from "./llm.ts";
import type { Llm } from "./llm.ts";

/** Credentials are kept in a server-only 0600 file, never in workspace facts or API responses. */
export const createSettings = (path: string, env: Record<string, string | undefined> = {}) => {
  let saved: LlmSettingsInput | null = existsSync(path) ? LlmSettingsSchema.parse(JSON.parse(readFileSync(path, "utf8"))) : null;
  if (saved) chmodSync(path, 0o600);
  const build = (s: LlmSettingsInput): Llm | null => s.enabled ? llmFromEnv({
    ...env, LLM_BASE_URL: s.baseUrl, LLM_MODEL: s.model, LLM_API_KEY: s.apiKey ?? "", LLM_THINKING: s.thinking ? "on" : "off",
  }) : null;
  let current = saved ? build(saved) : llmFromEnv(env);
  const status = (): LlmSettingsStatus => ({
    enabled: saved?.enabled ?? Boolean(current), baseUrl: saved?.baseUrl ?? env.LLM_BASE_URL ?? "",
    model: saved?.model ?? env.LLM_MODEL ?? current?.describe().model ?? "", thinking: saved?.thinking ?? env.LLM_THINKING === "on",
    hasToken: Boolean(saved ? saved.apiKey : env.LLM_API_KEY), revision: saved?.revision ?? 0,
    source: saved ? "saved" : current ? "environment" : "none",
  });
  const save = (input: LlmSettingsInput): LlmSettingsStatus => {
    if (input.revision !== status().revision) throw new Error("Settings changed in another session. Reopen settings before saving.");
    const old = status();
    const sameEndpoint = input.baseUrl.replace(/\/+$/, "") === old.baseUrl.replace(/\/+$/, "");
    // A token is never implicitly carried to a different endpoint.
    const apiKey = input.clearToken ? "" : input.apiKey?.trim() || (sameEndpoint ? (saved ? saved.apiKey : env.LLM_API_KEY) : "") || "";
    const next = { ...input, apiKey, revision: old.revision + 1, clearToken: undefined };
    const provider = build(next);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
    renameSync(temp, path);
    saved = next;
    current = provider;
    return status();
  };
  const test = async (): Promise<{ ok: true; model: string }> => {
    const info = status();
    if (!info.enabled) throw new Error("Enable and save an endpoint before testing.");
    const token = saved ? saved.apiKey : env.LLM_API_KEY;
    const response = await fetch(`${info.baseUrl.replace(/\/+$/, "")}/models`, {
      headers: token ? { authorization: `Bearer ${token}` } : {}, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}. Check the endpoint and token.`);
    const data = await response.json() as { data?: { id: string }[] };
    if (!Array.isArray(data.data) || !data.data.length) throw new Error("Provider returned no models.");
    if (info.model && !data.data.some(m => m.id === info.model)) throw new Error("Configured model was not listed by the provider. Check the model name.");
    return { ok: true, model: info.model || data.data[0]!.id };
  };
  return { status, save, test, getLlm: () => current };
};
export type Settings = ReturnType<typeof createSettings>;
