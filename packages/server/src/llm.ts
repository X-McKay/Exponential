// ================= LLM client =================
//
// A minimal OpenAI-compatible chat client over fetch (vLLM, OpenAI, Ollama's
// compatible endpoint, LiteLLM…). Configured by environment:
//   LLM_BASE_URL   e.g. https://llm.almckay.io/v1   (unset → agents disabled)
//   LLM_API_KEY    optional bearer token
//   LLM_MODEL      optional; defaults to the first model the server lists
//   LLM_THINKING   "on" to let reasoning models think (slower); default off

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
}

export interface ChatResult {
  content: string;
  model: string;
  usage: { prompt: number; completion: number } | null;
}

export interface Llm {
  /** Model name in use (resolved lazily when LLM_MODEL is unset). */
  model: () => Promise<string>;
  chat: (messages: ChatMessage[], options?: ChatOptions) => Promise<ChatResult>;
  describe: () => { baseUrl: string; model: string | null };
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
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

interface ModelsResponse {
  data: { id: string }[];
}
interface ChatResponse {
  model?: string;
  choices: { message: { content: string | null } }[];
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
    const m = await model();
    const payload: Record<string, unknown> = {
      model: m,
      messages,
      max_tokens: o.maxTokens ?? 1800,
      temperature: o.temperature ?? 0.3,
    };
    if (o.jsonSchema) payload.response_format = { type: "json_schema", json_schema: { name: o.jsonSchema.name, schema: o.jsonSchema.schema, strict: true } };
    if (!options.thinking) payload.chat_template_kwargs = { enable_thinking: false };
    const res = await doFetch(`${base}/chat/completions`, {
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
      model: body.model ?? m,
      usage: body.usage ? { prompt: body.usage.prompt_tokens ?? 0, completion: body.usage.completion_tokens ?? 0 } : null,
    };
  };

  return { model, chat, describe: () => ({ baseUrl: base, model: resolved }) };
};

export const llmFromEnv = (env: Record<string, string | undefined>): Llm | null => {
  if (!env.LLM_BASE_URL) return null;
  return createLlm({ baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL, thinking: env.LLM_THINKING === "on" });
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
