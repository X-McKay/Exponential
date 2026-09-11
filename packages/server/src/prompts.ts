// ================= prompts =================
//
// The proposal shapes every agent shares and the result schema. The built-in
// roles and the prompt version live in the domain package (prompts.ts there)
// so the client can name the version an agent currently runs under.

import { ROLE, fnv, promptVersion } from "@valueflow/domain";

export { ROLE, fnv, promptVersion };

/** One proposal shape: its type plus the fields that type needs, all required. */
const shape = (type: string, fields: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties: { type: { type: "string", enum: [type] }, rationale: { type: "string", description: "One sentence citing the evidence." }, ...fields } as Record<string, unknown>,
  required: ["type", "rationale", ...Object.keys(fields)],
});

/** The five project-fact proposal shapes, shared with the workspace conversation. */
export const PROPOSAL_SHAPES = [
  shape("governance_status", { gid: { type: "string", description: "governance id from the briefing" }, status: { type: "string", enum: ["approved", "in_review", "draft", "missing", "na"] } }),
  shape("milestone_status", { mid: { type: "string", description: "milestone id, MS-n" }, status: { type: "string", enum: ["backlog", "progress", "eval", "shipped"] } }),
  shape("governance_item", {
    cat: { type: "string" },
    name: { type: "string" },
    status: { type: "string", enum: ["approved", "in_review", "draft", "missing", "na"] },
    owner: { type: "string", description: "team initials" },
    detail: { type: "string" },
  }),
  shape("calendar_event", {
    date: { type: "string", description: "YYYY-MM-DD" },
    text: { type: "string" },
    sub: { type: ["string", "null"] },
    tab: { type: "string", enum: ["overview", "value", "roadmap", "development", "governance"] },
  }),
  shape("targets", { fte: { type: "number" }, time: { type: "number" } }),
];

/** The same shapes with an extra required field (a project id for workspace-wide agents, a rule id for the rules agent). */
export const shapesWith = (field: string, description: string) => PROPOSAL_SHAPES.map((s) => ({ ...s, properties: { ...s.properties, [field]: { type: "string", description } }, required: [...s.required, field] }));

/** The shapes as prompt lines, so the model sees the exact fields. */
export const proposalShapeLines = (withRule: boolean): string[] => {
  const extra = withRule ? ',"rule":"<rule id>"' : "";
  return [
    `  {"type":"governance_status","gid":"<governance id from the briefing>","status":"approved|in_review|draft|missing|na","rationale":"…"${extra}}`,
    `  {"type":"milestone_status","mid":"MS-n","status":"backlog|progress|eval|shipped","rationale":"…"${extra}}`,
    `  {"type":"governance_item","cat":"<category>","name":"<item name>","status":"missing|draft|in_review|approved","owner":"<team initials>","detail":"<why it is needed>","rationale":"…"${extra}}`,
    `  {"type":"calendar_event","date":"YYYY-MM-DD","text":"<what happens>","sub":"<context or null>","tab":"governance|value|roadmap|development|overview","rationale":"…"${extra}}`,
    `  {"type":"targets","fte":<number>,"time":<number>,"rationale":"…"${extra}}`,
  ];
};

export const resultSchema = (withRule: boolean) => ({
  name: "agent_result",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string", description: "One line, at most 120 characters, naming what was produced or found." },
      attention: { type: "boolean", description: "True only if a human needs to act on this run this week." },
      body: { type: "string", description: "The full output in markdown." },
      proposals: {
        type: "array",
        maxItems: 6,
        description: "Concrete changes to the project's facts that a person could accept with one click. Empty when nothing should change.",
        items: { anyOf: withRule ? shapesWith("rule", "id of the standing rule that asks for this change") : PROPOSAL_SHAPES },
      },
    },
    required: ["summary", "attention", "body", "proposals"],
  },
});
