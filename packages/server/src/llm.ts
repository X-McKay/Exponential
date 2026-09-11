// ================= LLM client =================
//
// A minimal OpenAI-compatible chat client over fetch (vLLM, OpenAI, Ollama's
// compatible endpoint, LiteLLM…). Configured by environment:
//   LLM_BASE_URL   e.g. https://llm.almckay.io/v1   (unset → agents disabled)
//   LLM_API_KEY    optional bearer token
//   LLM_MODEL      optional; defaults to the first model the server lists
//   LLM_THINKING   "on" to let reasoning models think (slower); default off
//   LLM_MODELS     optional comma list of candidate models the scout may try;
//                  an entry may be "name@https://other-host/v1" to reach a
//                  second endpoint (same API key)
//   EVAL_JUDGE_MODEL  optional model for the judge (defaults to LLM_MODEL)

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  /** JSON schema the reply must satisfy (response_format json_schema). */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Model for this call instead of the default; "name@base-url" routes to another endpoint. */
  model?: string | null;
}

export interface ChatResult {
  content: string;
  model: string;
  usage: { prompt: number; completion: number } | null;
  /** True when the reply was cut off by the token budget. */
  truncated: boolean;
}

export interface Llm {
  /** Model name in use (resolved lazily when LLM_MODEL is unset). */
  model: () => Promise<string>;
  chat: (messages: ChatMessage[], options?: ChatOptions) => Promise<ChatResult>;
  describe: () => { baseUrl: string; model: string | null; models: string[]; judgeModel: string | null };
}

export class LlmError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface LlmOptions {
  baseUrl: string;
  apiKey?: string | undefined;
  model?: string | undefined;
  thinking?: boolean;
  /** Candidate models beyond the default. */
  candidates?: string[];
  judgeModel?: string | undefined;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

/** "name@https://host/v1" → the model name and the endpoint it lives on. */
export const splitModel = (spec: string, defaultBase: string): { model: string; base: string } => {
  const at = spec.indexOf("@");
  if (at <= 0) return { model: spec, base: defaultBase };
  return { model: spec.slice(0, at), base: spec.slice(at + 1).replace(/\/$/, "") };
};

interface ModelsResponse {
  data: { id: string }[];
}
interface ChatResponse {
  model?: string;
  choices: { message: { content: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export const createLlm = (options: LlmOptions): Llm => {
  const base = options.baseUrl.replace(/\/$/, "");
  const doFetch = options.fetch ?? fetch;
  let resolved: string | null = options.model ?? null;

  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (options.apiKey) h.authorization = `Bearer ${options.apiKey}`;
    return h;
  };

  const model = async (): Promise<string> => {
    if (resolved) return resolved;
    const res = await doFetch(`${base}/models`, { headers: headers() });
    if (!res.ok) throw new LlmError(res.status, `LLM ${res.status} listing models`);
    const body = (await res.json()) as ModelsResponse;
    const first = body.data[0]?.id;
    if (!first) throw new LlmError(500, "LLM lists no models; set LLM_MODEL");
    resolved = first;
    return first;
  };

  const chat = async (messages: ChatMessage[], o: ChatOptions = {}): Promise<ChatResult> => {
    const spec = o.model ? splitModel(o.model, base) : { model: await model(), base };
    const m = spec.model;
    const payload: Record<string, unknown> = {
      model: m,
      messages,
      max_tokens: o.maxTokens ?? 1800,
      temperature: o.temperature ?? 0.3,
    };
    if (o.jsonSchema) payload.response_format = { type: "json_schema", json_schema: { name: o.jsonSchema.name, schema: o.jsonSchema.schema, strict: true } };
    if (!options.thinking) payload.chat_template_kwargs = { enable_thinking: false };
    const res = await doFetch(`${spec.base}/chat/completions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(o.timeoutMs ?? 120_000),
    });
    if (!res.ok) throw new LlmError(res.status, `LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as ChatResponse;
    const content = body.choices[0]?.message.content ?? "";
    return {
      content: content.trim(),
      model: o.model ?? body.model ?? m,
      usage: body.usage ? { prompt: body.usage.prompt_tokens ?? 0, completion: body.usage.completion_tokens ?? 0 } : null,
      truncated: body.choices[0]?.finish_reason === "length",
    };
  };

  const candidates = (options.candidates ?? []).map((c) => c.trim()).filter(Boolean);
  const describe = () => ({ baseUrl: base, model: resolved, models: [...new Set([...(resolved ? [resolved] : []), ...candidates])], judgeModel: options.judgeModel ?? null });
  return { model, chat, describe };
};

export const llmFromEnv = (env: Record<string, string | undefined>): Llm | null => {
  if (!env.LLM_BASE_URL) return null;
  return createLlm({
    baseUrl: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL,
    thinking: env.LLM_THINKING === "on",
    candidates: (env.LLM_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    judgeModel: env.EVAL_JUDGE_MODEL,
  });
};

/** Pull a JSON object out of a reply that may be wrapped in prose or a code fence. */
export const extractJson = (text: string): unknown => {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence?.[1]) return JSON.parse(fence[1]);
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("reply did not contain JSON");
  }
};
