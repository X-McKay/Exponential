import { describe, expect, test } from "bun:test";
import { ruleStats } from "@valueflow/domain";
import type { Proposal } from "@valueflow/domain";
import { openDb } from "../src/db.ts";
import { seed, SEED_NOW } from "../src/seed.ts";
import { runAgent } from "../src/agents.ts";
import type { Llm } from "../src/llm.ts";
import { acceptProposal, dismissProposal } from "../src/proposals.ts";
import { loadState, updateGovernance } from "../src/repo.ts";
import { createApp } from "../src/app.ts";

const llm: Llm = {
  model: async () => "fixture",
  describe: () => ({ baseUrl: "http://fixture", model: "fixture", models: ["fixture"], judgeModel: null, prices: {} }),
  chat: async () => ({ content: JSON.stringify({ summary: "Start SLA", attention: false, body: "A draft is ready.", proposals: [{ type: "governance_status", gid: "sla", status: "draft", rationale: "Draft supplied" }] }), model: "fixture", usage: null, truncated: false }),
};
const setup = async () => {
  const db = openDb(":memory:");
  seed(db);
  const run = await runAgent(db, llm, { agentId: "audie", proj: "ima" }, SEED_NOW);
  const proposal = loadState(db, SEED_NOW).proposals.find((p) => p.runId === run.id)!;
  return { db, proposal };
};

describe("proposal evidence guards", () => {
  test("rejects an intervening edit and keeps the newer fact", async () => {
    const { db, proposal } = await setup();
    const item = loadState(db, SEED_NOW).projects.find((p) => p.id === "ima")!.governance.find((g) => g.id === "sla")!;
    updateGovernance(db, "ima", "sla", { ...item, status: "approved" }, SEED_NOW);
    expect(() => acceptProposal(db, proposal, SEED_NOW)).toThrow("stale");
    expect(loadState(db, SEED_NOW).projects.find((p) => p.id === "ima")!.governance.find((g) => g.id === "sla")!.status).toBe("approved");
    expect(loadState(db, SEED_NOW).proposals.find((p) => p.id === proposal.id)?.state).toBe("pending");
    db.close();
  });
  test("rolls back the fact if recording the decision fails", async () => {
    const { db, proposal } = await setup();
    const before = loadState(db, SEED_NOW).projects.find((p) => p.id === "ima")!.governance.find((g) => g.id === "sla")!.status;
    db.exec("CREATE TRIGGER refuse_decision BEFORE UPDATE ON proposal_guards BEGIN SELECT RAISE(ABORT, 'fixture rejection'); END");
    expect(() => acceptProposal(db, proposal, SEED_NOW)).toThrow("fixture rejection");
    expect(loadState(db, SEED_NOW).projects.find((p) => p.id === "ima")!.governance.find((g) => g.id === "sla")!.status).toBe(before);
    expect(loadState(db, SEED_NOW).proposals.find((p) => p.id === proposal.id)?.state).toBe("pending");
    db.close();
  });
  test("re-reads decisions, rejects expired/legacy evidence, and allows dismissal", async () => {
    const { db, proposal } = await setup();
    expect(() => acceptProposal(db, proposal, new Date(SEED_NOW.getTime() + 8 * 86_400_000))).toThrow("expired");
    db.query("DELETE FROM proposal_guards WHERE proposal_id = ?").run(proposal.id);
    expect(() => acceptProposal(db, proposal, SEED_NOW)).toThrow("predates evidence checks");
    dismissProposal(db, proposal, SEED_NOW);
    expect(() => acceptProposal(db, proposal, SEED_NOW)).toThrow("already dismissed");
    const guard = db.query("SELECT decided_by, decision_mode FROM proposal_guards WHERE proposal_id = ?").get(proposal.id);
    expect(guard).toEqual({ decided_by: "AM", decision_mode: "human" });
    db.close();
  });
  test("automatic accepts cannot establish earned autonomy", () => {
    const proposals = Array.from({ length: 10 }, (_, i) => ({ id: String(i), ruleId: "r", state: "accepted", decisionMode: "automatic" })) as Proposal[];
    expect(ruleStats({ id: "r" }, proposals).earnedAutonomy).toBe(false);
  });
  test("only earned calendar reminders run automatically; approval proposals remain pending", async () => {
    const db = openDb(":memory:");
    seed(db);
    let sequence = 0;
    let approval = false;
    const rulesLlm: Llm = { ...llm, chat: async () => ({ content: JSON.stringify({ summary: "Rule fired", attention: false, body: "Reminder needed", proposals: [approval ? { type: "governance_status", gid: "sla", status: "approved", rule: "rule-1" } : { type: "calendar_event", date: "2026-10-01", text: `Reminder ${++sequence}`, tab: "overview", sub: null, rule: "rule-1" }] }), model: "fixture", usage: null, truncated: false }) };
    for (let i = 0; i < 5; i++) {
      const run = await runAgent(db, rulesLlm, { agentId: "sentry", proj: "ima" }, SEED_NOW);
      acceptProposal(db, loadState(db, SEED_NOW).proposals.find((p) => p.runId === run.id)!, SEED_NOW);
    }
    let rule = loadState(db, SEED_NOW).rules.find((r) => r.id === "rule-1")!;
    const app = createApp(db, { now: () => SEED_NOW, autoJudge: false });
    const edited = await app.handleApi(new Request("http://fixture/api/rules/rule-1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...rule, text: `${rule.text} (edited)`, auto: false }) }));
    expect(edited?.status).toBe(200);
    const reenableEdited = await app.handleApi(new Request("http://fixture/api/rules/rule-1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...rule, text: `${rule.text} (edited)`, auto: true }) }));
    expect(reenableEdited?.status).toBe(409);
    const restored = await app.handleApi(new Request("http://fixture/api/rules/rule-1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...rule, auto: false }) }));
    expect(restored?.status).toBe(200);
    rule = loadState(db, SEED_NOW).rules.find((r) => r.id === "rule-1")!;
    const enable = await app.handleApi(new Request("http://fixture/api/rules/rule-1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...rule, auto: true }) }));
    expect(enable?.status).toBe(200);
    const automatic = await runAgent(db, rulesLlm, { agentId: "sentry", proj: "ima" }, SEED_NOW);
    const accepted = loadState(db, SEED_NOW).proposals.find((p) => p.runId === automatic.id)!;
    expect(accepted.state).toBe("accepted");
    expect(accepted.decisionMode).toBe("automatic");
    expect(ruleStats(rule, loadState(db, SEED_NOW).proposals).accepted).toBe(5);
    approval = true;
    const approvalRun = await runAgent(db, rulesLlm, { agentId: "sentry", proj: "ima" }, SEED_NOW);
    expect(loadState(db, SEED_NOW).proposals.find((p) => p.runId === approvalRun.id)?.state).toBe("pending");
    expect(loadState(db, SEED_NOW).projects.find((p) => p.id === "ima")!.governance.find((g) => g.id === "sla")!.status).not.toBe("approved");
    db.close();
  });
});
