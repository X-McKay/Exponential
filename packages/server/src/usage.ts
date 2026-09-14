// ================= LLM usage ledger =================
//
// All provider attempts go through this helper. A row is reserved before the
// network call, then reconciled with the provider's reported usage. A reserved
// row survives a process crash and therefore keeps a budget fail-closed until
// an operator can account for it.

import type { Database } from "bun:sqlite";
import { monthStart, priceFor } from "@valueflow/domain";
import type { AgentRun } from "@valueflow/domain";
import type { ChatMessage, ChatOptions, ChatResult, Llm } from "./llm.ts";

/** Add this statement to the next schema migration (it is idempotent for tests and old local DBs). */
export const USAGE_LEDGER_SQL = `
CREATE TABLE IF NOT EXISTS llm_usage_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  agent_id TEXT,
  project_id TEXT,
  model TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'succeeded', 'failed', 'unknown')),
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cost_usd REAL,
  reserved_tokens INTEGER NOT NULL DEFAULT 0,
  reserved_usd REAL NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX IF NOT EXISTS llm_usage_ledger_by_start ON llm_usage_ledger(started_at);
CREATE INDEX IF NOT EXISTS llm_usage_ledger_by_run ON llm_usage_ledger(run_id);
`;

export const ensureUsageLedger = (db: Database): void => {
  db.exec(USAGE_LEDGER_SQL);
};

export interface LlmCallScope {
  agentId: string | null;
  proj: string | null;
  runId: string | null;
}

export class UsageBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageBudgetError";
  }
}

interface BudgetRow {
  scope: "workspace" | "agent" | "project";
  ref: string;
  monthly_tokens: number | null;
  monthly_usd: number | null;
}

interface LegacyUsage {
  id: string;
  agent_id: string;
  project_id: string | null;
  state?: "queued" | "working" | "done" | "attention" | "failed";
  started_at?: string;
  finished_at?: string | null;
  tab?: string;
  instruction?: string | null;
  summary?: string;
  output?: string;
  error?: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
}

interface LedgerUsage {
  id: number;
  run_id: string | null;
  agent_id: string | null;
  project_id: string | null;
  model: string;
  started_at?: string;
  finished_at?: string | null;
  error?: string | null;
  state: "reserved" | "succeeded" | "failed" | "unknown";
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
  reserved_tokens: number;
  reserved_usd: number;
}

interface Totals {
  tokens: number;
  usd: number;
  unknownTokens: boolean;
  unknownUsd: boolean;
}

export interface UsageRun extends AgentRun {
  source: "ledger" | "legacy";
  usageId?: number;
  /** Present for ledger rows and priced legacy rows. Omitted for legacy rows
   * whose cost can still be recomputed from the caller's current price list. */
  costUsd?: number | null;
}

const tokensOf = (row: Pick<LegacyUsage, "prompt_tokens" | "completion_tokens"> | Pick<LedgerUsage, "prompt_tokens" | "completion_tokens">): number | null => {
  const prompt = row.prompt_tokens;
  const completion = row.completion_tokens;
  if (prompt === null || completion === null || !Number.isSafeInteger(prompt) || !Number.isSafeInteger(completion) || prompt < 0 || completion < 0) return null;
  return prompt + completion;
};

const applies = (row: { agent_id: string | null; project_id: string | null }, budget: BudgetRow): boolean =>
  budget.scope === "workspace" || (budget.scope === "agent" && budget.ref === row.agent_id) || (budget.scope === "project" && budget.ref === row.project_id);

const costOf = (row: Pick<LedgerUsage, "model" | "prompt_tokens" | "completion_tokens"> | Pick<LegacyUsage, "model" | "prompt_tokens" | "completion_tokens">, prices: ReturnType<Llm["describe"]>["prices"]): number | null => {
  const p = priceFor(row.model, prices);
  const tokens = tokensOf(row);
  if (!p || tokens === null) return null;
  const input = row.prompt_tokens;
  const output = row.completion_tokens;
  if (input === null || output === null) return null;
  return (input * p.input + output * p.output) / 1_000_000;
};

const totalsFor = (legacy: LegacyUsage[], ledger: LedgerUsage[], budget: BudgetRow, prices: ReturnType<Llm["describe"]>["prices"]): Totals => {
  let tokens = 0;
  let usd = 0;
  let unknownTokens = false;
  let unknownUsd = false;
  for (const row of legacy) {
    if (!applies(row, budget)) continue;
    const t = tokensOf(row);
    if (t === null) {
      unknownTokens = true;
      unknownUsd = true;
    } else {
      tokens += t;
      const c = costOf(row, prices);
      if (c === null && (row.prompt_tokens ?? 0) + (row.completion_tokens ?? 0) > 0) unknownUsd = true;
      else usd += c ?? 0;
    }
  }
  for (const row of ledger) {
    if (!applies(row, budget)) continue;
    if (row.state === "reserved") {
      // A reservation left by a crashed or concurrent call is not proof that
      // its usage is known. Hold the budget until the attempt is reconciled.
      unknownTokens = true;
      unknownUsd = true;
      continue;
    }
    if (row.state === "unknown") {
      // Older rows may have been marked unknown only because pricing was
      // unavailable. Preserve their measured token usage for token-only
      // budgets while keeping the dollar side held.
      const t = tokensOf(row);
      if (t === null) {
        unknownTokens = true;
        unknownUsd = true;
      } else {
        tokens += t;
        if (row.cost_usd === null) unknownUsd = true;
        else usd += row.cost_usd;
      }
      continue;
    }
    const t = tokensOf(row);
    if (t === null) {
      unknownTokens = true;
      unknownUsd = true;
    } else {
      tokens += t;
      if (row.cost_usd === null) unknownUsd = true;
      else usd += row.cost_usd;
    }
  }
  return { tokens, usd, unknownTokens, unknownUsd };
};

const applicableBudgets = (db: Database, scope: LlmCallScope): BudgetRow[] => {
  const rows = db.query<BudgetRow, []>("SELECT scope, ref, monthly_tokens, monthly_usd FROM budgets ORDER BY scope, ref").all();
  return rows.filter((row) => row.scope === "workspace" || (row.scope === "agent" && row.ref === scope.agentId) || (row.scope === "project" && row.ref === scope.proj));
};

const checkReservation = (budgets: BudgetRow[], totals: (budget: BudgetRow) => Totals, model: string, reserveTokens: number, softInputTokens: number, maxTokens: number, prices: ReturnType<Llm["describe"]>["prices"]): void => {
  for (const budget of budgets) {
    const t = totals(budget);
    if (budget.monthly_tokens !== null) {
      if (budget.monthly_tokens <= 0 || t.unknownTokens) throw new UsageBudgetError(`${budget.scope} budget has no known token capacity for this call`);
      if (t.tokens + reserveTokens > budget.monthly_tokens) throw new UsageBudgetError(`${budget.scope} token budget would be exceeded by this call`);
    }
    if (budget.monthly_usd !== null) {
      const p = priceFor(model, prices);
      if (budget.monthly_usd <= 0 || t.unknownUsd || !p) throw new UsageBudgetError(`${budget.scope} dollar budget has no known cost for this call`);
      const estimate = (softInputTokens * p.input + maxTokens * p.output) / 1_000_000;
      if (t.usd + estimate > budget.monthly_usd) throw new UsageBudgetError(`${budget.scope} dollar budget would be exceeded by this call`);
    }
  }
};

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 1000);

/**
 * Reserve and record one provider attempt. The max-token reservation is a
 * deliberately documented soft cap: without a tokenizer, input tokens cannot
 * be reserved exactly. Reported usage is reconciled after the call.
 */
export const callLlm = async (db: Database, llm: Llm, scope: LlmCallScope, messages: ChatMessage[], options: ChatOptions = {}, now: Date): Promise<ChatResult> => {
  ensureUsageLedger(db);
  const model = options.model ?? (await llm.model());
  llm.validateModel?.(model);
  const prices = llm.describe().prices;
  const maxTokens = Number.isSafeInteger(options.maxTokens) && (options.maxTokens ?? 0) >= 0 ? options.maxTokens ?? 0 : 1800;
  // Approximate input at four characters/token. This is a conservative soft
  // reservation only; provider tokenization can differ and actual usage wins.
  const softInputTokens = Math.ceil(messages.reduce((n, message) => n + message.content.length, 0) / 4);
  const reserveTokens = softInputTokens + maxTokens;
  const since = monthStart(now.toISOString());
  const reserved = db.transaction(() => {
    const budgets = applicableBudgets(db, scope);
    const legacy = db.query<LegacyUsage, [string]>("SELECT id, agent_id, project_id, state, started_at, finished_at, tab, instruction, summary, output, error, model, prompt_tokens, completion_tokens FROM agent_runs WHERE started_at >= ?").all(since);
    const linked = new Set(db.query<{ run_id: string | null }, [string]>("SELECT run_id FROM llm_usage_ledger WHERE started_at >= ? AND run_id IS NOT NULL").all(since).map((r) => r.run_id));
    const ledger = db.query<LedgerUsage, [string]>("SELECT id, run_id, agent_id, project_id, model, state, prompt_tokens, completion_tokens, cost_usd, reserved_tokens, reserved_usd FROM llm_usage_ledger WHERE started_at >= ?").all(since);
    const unlinkedLegacy = legacy.filter((r) => !linked.has(r.id));
    // Callers commonly create the working agent_run before invoking us. Do
    // not treat that empty placeholder as unknown usage. For a completed
    // legacy run (for example, a judge added after an upgrade), import its
    // measured usage once so linking it to the ledger cannot erase spend.
    const current = scope.runId ? unlinkedLegacy.find((r) => r.id === scope.runId) : undefined;
    if (current && current.state !== "working" && current.state !== "queued") {
      const importedTokens = tokensOf(current);
      const importedCost = importedTokens === null ? null : costOf(current, prices);
      const importedState = importedTokens === null ? "unknown" : "succeeded";
      db.query("INSERT INTO llm_usage_ledger (run_id, agent_id, project_id, model, started_at, finished_at, state, prompt_tokens, completion_tokens, cost_usd, reserved_tokens, reserved_usd, error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(current.id, current.agent_id, current.project_id, current.model ?? "unknown", current.started_at ?? now.toISOString(), current.finished_at ?? now.toISOString(), importedState, current.prompt_tokens, current.completion_tokens, importedCost, 0, 0, importedTokens === null ? "legacy run has unknown usage" : importedCost === null ? "legacy run has unknown price" : null);
      linked.add(current.id);
      ledger.push({ id: -1, run_id: current.id, agent_id: current.agent_id, project_id: current.project_id, model: current.model ?? "unknown", state: importedState, prompt_tokens: current.prompt_tokens, completion_tokens: current.completion_tokens, cost_usd: importedCost, reserved_tokens: 0, reserved_usd: 0 });
    }
    const usableLegacy = unlinkedLegacy.filter((r) => r.id !== scope.runId && r.state !== "working" && r.state !== "queued");
    checkReservation(budgets, (budget) => totalsFor(usableLegacy, ledger, budget, prices), model, reserveTokens, softInputTokens, maxTokens, prices);
    const result = db.query("INSERT INTO llm_usage_ledger (run_id, agent_id, project_id, model, started_at, state, reserved_tokens, reserved_usd) VALUES (?,?,?,?,?,?,?,?)").run(scope.runId, scope.agentId, scope.proj, model, now.toISOString(), "reserved", reserveTokens, (() => {
      const p = priceFor(model, prices);
      return p ? (softInputTokens * p.input + maxTokens * p.output) / 1_000_000 : 0;
    })());
    return Number(result.lastInsertRowid);
  })();

  let reconciled = false;
  try {
    const result = await llm.chat(messages, options);
    const prompt = result.usage?.prompt ?? null;
    const completion = result.usage?.completion ?? null;
    const measured = result.usage !== null && prompt !== null && completion !== null && Number.isSafeInteger(prompt) && Number.isSafeInteger(completion) && prompt >= 0 && completion >= 0 ? { prompt, completion } : null;
    const validUsage = measured !== null;
    const cost = measured ? costOf({ model, prompt_tokens: measured.prompt, completion_tokens: measured.completion }, prices) : null;
    const budgets = applicableBudgets(db, scope);
    const unknownUsage = !validUsage;
    const unknownCost = validUsage && budgets.some((b) => b.monthly_usd !== null) && cost === null;
    const held = unknownUsage || unknownCost;
    db.query("UPDATE llm_usage_ledger SET state = ?, finished_at = ?, prompt_tokens = ?, completion_tokens = ?, cost_usd = ?, reserved_tokens = 0, reserved_usd = 0, error = ? WHERE id = ?").run(unknownUsage ? "unknown" : "succeeded", new Date().toISOString(), measured?.prompt ?? null, measured?.completion ?? null, cost, held ? unknownUsage ? "provider returned unknown usage" : "provider returned unknown price" : null, reserved);
    reconciled = true;
    if (held && budgets.length) throw new UsageBudgetError("LLM usage or price was unknown; the applicable budget is held until reconciled");
    return result;
  } catch (e) {
    if (!reconciled) {
      const budgets = applicableBudgets(db, scope);
      db.query("UPDATE llm_usage_ledger SET state = ?, finished_at = ?, reserved_tokens = 0, reserved_usd = 0, error = ? WHERE id = ?").run(budgets.length ? "unknown" : "failed", new Date().toISOString(), errorText(e), reserved);
    }
    throw e;
  }
};

/**
 * Return month-to-date usage as run-shaped records for existing spend views.
 * A ledger attempt replaces its legacy agent_run by run_id; unlinked legacy
 * runs are retained so upgrades do not make historical spend disappear.
 */
export const loadUsageRuns = (db: Database, now: Date, prices: ReturnType<Llm["describe"]>["prices"] = {}): UsageRun[] => {
  ensureUsageLedger(db);
  const since = monthStart(now.toISOString());
  const ledger = db.query<LedgerUsage, [string]>("SELECT id, run_id, agent_id, project_id, model, started_at, finished_at, state, prompt_tokens, completion_tokens, cost_usd, reserved_tokens, reserved_usd, error FROM llm_usage_ledger WHERE started_at >= ? ORDER BY started_at, id").all(since);
  const linked = new Set(ledger.map((row) => row.run_id).filter((id): id is string => id !== null));
  const legacy = db.query<LegacyUsage, [string]>("SELECT id, agent_id, project_id, state, started_at, finished_at, tab, instruction, summary, output, error, model, prompt_tokens, completion_tokens FROM agent_runs WHERE started_at >= ? ORDER BY started_at, id").all(since);
  const fromLedger: UsageRun[] = ledger.map((row) => ({
    id: `usage-${row.id}`,
    agentId: row.agent_id ?? "usage",
    proj: row.project_id,
    tab: "overview" as AgentRun["tab"],
    state: row.state === "succeeded" ? "done" : row.state === "reserved" ? "working" : "failed",
    startedAt: row.started_at ?? now.toISOString(),
    finishedAt: row.finished_at ?? null,
    instruction: null,
    summary: `LLM ${row.state} attempt`,
    output: "",
    model: row.model,
    error: row.error ?? null,
    promptVersion: null,
    latencyMs: null,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    benchmark: null,
    rating: null,
    ratingNote: null,
    source: "ledger",
    usageId: row.id,
    costUsd: row.cost_usd,
  }));
  const fromLegacy: UsageRun[] = legacy.filter((row) => !linked.has(row.id)).map((row) => {
    const costUsd = costOf(row, prices);
    return {
      id: row.id,
      agentId: row.agent_id,
      proj: row.project_id,
      tab: (row.tab ?? "overview") as AgentRun["tab"],
      state: row.state ?? "failed",
      startedAt: row.started_at ?? now.toISOString(),
      finishedAt: row.finished_at ?? null,
      instruction: row.instruction ?? null,
      summary: row.summary ?? "",
      output: row.output ?? "",
      model: row.model,
      error: row.error ?? null,
      promptVersion: null,
      latencyMs: null,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      benchmark: null,
      rating: null,
      ratingNote: null,
      source: "legacy" as const,
      ...(costUsd === null ? {} : { costUsd }),
    };
  });
  return [...fromLedger, ...fromLegacy];
};
