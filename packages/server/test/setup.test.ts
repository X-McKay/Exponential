// Project setup from documents: text extraction from Word and PowerPoint
// archives built in-test, a fake setup agent, refinement, and creation.

import { describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import type { AppState, Project, SetupDraft } from "@valueflow/domain";
import { routes } from "@valueflow/shared";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { docxText, extractSource, pptxText, zipEntries } from "../src/extract.ts";
import type { Llm } from "../src/llm.ts";
import { seed } from "../src/seed.ts";
import { buildSetupMessages, normalizeDraft } from "../src/setup.ts";
import { BASE } from "./helpers.ts";

// ---- a tiny zip writer, enough for Office files ------------------------------

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff;
  for (const b of buf) c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const zip = (files: Record<string, string>, deflate = true): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, "utf8");
    const data = deflate ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += local.length + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
};

const DOCX = zip({
  "[Content_Types].xml": "<Types/>",
  "word/document.xml":
    '<w:document><w:body><w:p><w:r><w:t>KYC Refresh Automation &amp; Charter</w:t></w:r></w:p><w:p><w:r><w:t>Sponsor: </w:t></w:r><w:r><w:t>Priya Nair</w:t></w:r></w:p><w:p/><w:p><w:r><w:t>Target: cut refresh effort by 35%.</w:t></w:r></w:p></w:body></w:document>',
});
const PPTX = zip(
  {
    "ppt/slides/slide2.xml": '<p:sld><p:txBody><a:p><a:r><a:t>Milestones</a:t></a:r></a:p><a:p><a:r><a:t>Document collection agent — Q4</a:t></a:r></a:p></p:txBody></p:sld>',
    "ppt/slides/slide1.xml": '<p:sld><p:txBody><a:p><a:r><a:t>KYC refresh</a:t></a:r><a:r><a:t> deck</a:t></a:r></a:p></p:txBody></p:sld>',
  },
  false,
);

describe("extraction", () => {
  test("reads deflated and stored zip entries and pulls paragraphs from Word", () => {
    expect(zipEntries(DOCX).map((e) => e.name)).toEqual(["[Content_Types].xml", "word/document.xml"]);
    expect(docxText(DOCX)).toBe("KYC Refresh Automation & Charter\nSponsor: Priya Nair\n\nTarget: cut refresh effort by 35%.");
  });
  test("orders PowerPoint slides numerically and labels them", () => {
    expect(pptxText(PPTX)).toBe("## Slide 1\nKYC refresh deck\n\n## Slide 2\nMilestones\nDocument collection agent — Q4");
  });
  test("dispatches on extension and mime; unsupported and corrupt inputs are reported, not thrown", () => {
    expect(extractSource("charter.docx", "", DOCX)).toMatchObject({ kind: "docx", error: null, chars: docxText(DOCX).length });
    expect(extractSource("deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", PPTX).kind).toBe("pptx");
    expect(extractSource("notes.md", "", Buffer.from("# hi"))).toMatchObject({ kind: "text", text: "# hi" });
    expect(extractSource("scan.pdf", "application/pdf", Buffer.from("%PDF"))).toMatchObject({ kind: "unsupported" });
    expect(extractSource("scan.pdf", "application/pdf", Buffer.from("%PDF")).error).toContain("export PDFs to text first");
    expect(extractSource("broken.docx", "", Buffer.from("nope")).error).toBe("not a zip archive");
    expect(extractSource("empty.docx", "", zip({ "word/document.xml": "<w:document/>" })).error).toBe("no text found");
  });
});

// ---- the setup agent ----------------------------------------------------------

const DRAFT_REPLY = {
  description: { value: "Agentic KYC refresh: collects documents and drafts the refresh file.", rationale: "From the charter.", source: "charter.docx", confidence: "high" },
  stage: { value: "Pilot", rationale: "Charter says pilot in Q4.", source: "charter.docx", confidence: "medium" },
  tier: { value: 2, rationale: "Human in the loop.", source: "", confidence: "medium" },
  committee: { value: { date: "", ref: "" }, rationale: "No approval mentioned.", source: "", confidence: "low" },
  targets: { value: { fte: 35, time: 40 }, rationale: "Charter: cut effort by 35%.", source: "charter.docx", confidence: "high" },
  team: [{ value: { name: "Priya Nair", role: "Sponsor" }, rationale: "Named as sponsor.", source: "charter.docx", confidence: "high" }],
  repos: [{ value: { name: "kyc-agent", url: "" }, rationale: "Deck slide 3.", source: "deck.pptx", confidence: "low" }],
  milestones: [
    { value: { name: "Document collection agent", status: "progress", month: "2026-12", baseFte: 15, baseTime: 20, stretchFte: 20, stretchTime: 25, metrics: [{ label: "Documents auto-collected", base: 70, stretch: 90 }] }, rationale: "Deck slide 2.", source: "deck.pptx", confidence: "high" },
    { value: { name: "Refresh file drafting", status: "backlog", month: "bogus", baseFte: 20, baseTime: 20, stretchFte: 25, stretchTime: 30, metrics: [] }, rationale: "Implied.", source: "", confidence: "low" },
  ],
  governance: [
    { value: { cat: "AI governance", name: "AI approval committee review", status: "missing", owner: "Priya Nair", detail: "Required before pilot." }, rationale: "Tier 2 needs it.", source: "", confidence: "medium" },
    { value: { cat: "Nonsense", name: "Data privacy assessment (DPIA)", status: "approved", owner: "", detail: "" }, rationale: "Deck says DPIA approved.", source: "deck.pptx", confidence: "high" },
  ],
  releases: [{ value: { name: "Pilot", month: "2027-01", milestones: ["Document collection agent"], criteria: [{ type: "gate", ref: "Document collection agent", label: "Collection base gate" }, { type: "gov", ref: "AI approval committee review", label: "Committee approval" }, { type: "manual", ref: "", label: "Ops sign-off" }] }, rationale: "Deck.", source: "deck.pptx", confidence: "medium" }],
  notes: ["The deck does not say who owns monitoring."],
};

const fakeLlm = (replies: unknown[]): Llm => {
  let i = 0;
  return {
    model: () => Promise.resolve("fake"),
    chat: () => Promise.resolve({ content: JSON.stringify(replies[Math.min(i++, replies.length - 1)]), model: "fake", usage: null, truncated: false }),
    describe: () => ({ baseUrl: "http://fake", model: "fake" }),
  };
};

const NOW = new Date("2026-09-10T12:00:00Z");

describe("normalizeDraft", () => {
  test("keeps good values, repairs bad ones, derives initials and repo urls", () => {
    const d = normalizeDraft(DRAFT_REPLY, "2026-09");
    expect(d.tier.value).toBe(2);
    expect(d.committee.value).toBeNull();
    expect(d.team[0]?.value).toEqual({ name: "Priya Nair", role: "Sponsor", ini: "PN" });
    expect(d.repos[0]?.value).toEqual({ name: "kyc-agent", url: "github.com/org/kyc-agent" });
    expect(d.milestones[1]?.value.month).toBe("2026-12");
    expect(d.governance[1]?.value.cat).toBe("AI governance");
    expect(d.releases[0]?.value.criteria.length).toBe(3);
    expect(normalizeDraft("garbage", "2026-09").milestones).toEqual([]);
    // Mislabelled criteria are re-typed from what they reference; equal stretch and base impact is lifted.
    const sloppy = normalizeDraft(
      {
        milestones: [{ value: { name: "Extract", status: "backlog", month: "2026-11", baseFte: 20, baseTime: 20, stretchFte: 20, stretchTime: 25, metrics: [] } }],
        governance: [{ value: { cat: "AI governance", name: "Security review", status: "missing", owner: "", detail: "" } }],
        releases: [{ value: { name: "Shadow", month: "2026-12", milestones: ["Extract"], criteria: [{ type: "gate", ref: "security review", label: "" }, { type: "gov", ref: "Extract", label: "Extraction gate" }, { type: "gate", ref: "Nobody", label: "Sign-off" }] } }],
      },
      "2026-09",
    );
    expect(sloppy.milestones[0]?.value.impact.stretch).toEqual({ fte: 26, time: 25 });
    expect(sloppy.releases[0]?.value.criteria).toEqual([
      { type: "gov", ref: "Security review", label: "Security review" },
      { type: "gate", ref: "Extract", label: "Extraction gate" },
      { type: "manual", ref: "", label: "Sign-off" },
    ]);
    expect(normalizeDraft({ tier: { value: 7 } }, "2026-09").tier).toEqual({ value: null, rationale: "", source: null, confidence: "low" });
  });
  test("the briefing includes the documents and, on refinement, the previous draft and feedback", () => {
    const src = [extractSource("charter.docx", "", DOCX)];
    const first = buildSetupMessages("KYC refresh", "PRJ-10", "Automate KYC refresh", src, "2026-09");
    expect(first[0]?.content).toContain("today is 2026-09");
    expect(first[1]?.content).toContain("### Source: charter.docx (docx)\nKYC Refresh Automation & Charter");
    const again = buildSetupMessages("KYC refresh", "PRJ-10", "", src, "2026-09", normalizeDraft(DRAFT_REPLY, "2026-09"), ["Make it Tier 1"]);
    expect(again[1]?.content).toContain("### Previous draft (JSON)");
    expect(again[1]?.content).toContain("1. Make it Tier 1");
  });
});

describe("setup API", () => {
  const appWith = (llm: Llm | null) => {
    const db = openDb(":memory:");
    seed(db);
    const app = createApp(db, { now: () => NOW, llm });
    const call = async <T>(req: Request): Promise<{ status: number; body: T }> => {
      const res = await app.handleApi(req);
      if (!res) throw new Error("not an api route");
      return { status: res.status, body: (await res.json()) as T };
    };
    const json = <T>(method: string, path: string, body: unknown) => call<T>(new Request(BASE + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    return { app, call, json };
  };

  test("multipart upload → draft with sources; refine applies feedback; create makes the whole project in one go", async () => {
    const refined = { ...DRAFT_REPLY, tier: { value: 1, rationale: "User said Tier 1.", source: "", confidence: "high" } };
    const { app, call, json } = appWith(fakeLlm([DRAFT_REPLY, refined]));
    const form = new FormData();
    form.set("name", "KYC refresh automation");
    form.set("brief", "Automate the periodic KYC refresh.");
    form.append("snippet", "Owner: Priya Nair. Budget approved.");
    form.append("file", new File([new Uint8Array(DOCX)], "charter.docx"));
    form.append("file", new File([new Uint8Array(PPTX)], "deck.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }));
    form.append("file", new File(["%PDF"], "scan.pdf", { type: "application/pdf" }));
    const created = await call<SetupDraft>(new Request(BASE + routes.setup(), { method: "POST", body: form }));
    expect(created.status).toBe(201);
    const draft = created.body;
    expect(draft.name).toBe("KYC refresh automation");
    expect(draft.key).toBe("PRJ-10");
    expect(draft.sources.map((s) => `${s.name}:${s.kind}:${s.error ? "err" : "ok"}`)).toEqual(["snippet 1:text:ok", "charter.docx:docx:ok", "deck.pptx:pptx:ok", "scan.pdf:unsupported:err"]);
    expect(draft.draft.targets.value).toEqual({ fte: 35, time: 40 });
    expect(draft.draft.tier.value).toBe(2);

    const fetched = await call<SetupDraft>(new Request(BASE + routes.setupDraft(draft.id)));
    expect(fetched.body.id).toBe(draft.id);

    const ref = await json<SetupDraft>("POST", routes.setupRefine(draft.id), { feedback: "Make it Tier 1" });
    expect(ref.status).toBe(200);
    expect(ref.body.draft.tier.value).toBe(1);
    expect(ref.body.feedback).toEqual(["Make it Tier 1"]);

    const create = await json<Project>("POST", routes.setupCreate(draft.id), {
      project: { id: "kyc-refresh-automation", key: "PRJ-10", name: "KYC refresh automation", stage: "Pilot", description: "Agentic KYC refresh.", tier: 1, committee: null, repos: [{ name: "kyc-agent", url: "github.com/org/kyc-agent" }], team: [{ ini: "PN", name: "Priya Nair", role: "Sponsor" }], targets: { fte: 35, time: 40 } },
      milestones: [{ id: "MS-1", name: "Document collection agent", status: "progress", month: "2026-12", impact: { base: { fte: 15, time: 20 }, stretch: { fte: 20, time: 25 } }, metrics: [{ id: "m1", label: "Documents auto-collected", base: 70, stretch: 90, current: 0 }] }],
      governance: [{ id: "ai-approval-committee-review", cat: "AI governance", name: "AI approval committee review", status: "missing", owner: "PN", date: null, detail: "Required before pilot." }],
      releases: [{ id: "R1", name: "Pilot", month: "2027-01", milestoneIds: ["MS-1"], criteria: [{ type: "gate", ms: "MS-1", label: "Collection base gate" }, { type: "gov", gid: "ai-approval-committee-review", label: "Committee approval" }, { type: "manual", ok: false, label: "Ops sign-off" }] }],
    });
    expect(create.status).toBe(201);
    expect(create.body.milestones.length).toBe(1);
    const state = (await call<AppState>(new Request(BASE + routes.state()))).body;
    expect(state.projects.map((p) => p.id)).toContain("kyc-refresh-automation");
    expect(state.releases["kyc-refresh-automation"]?.[0]?.criteria.length).toBe(3);
    expect(state.events[0]?.text).toBe("KYC refresh automation set up from 3 documents: 1 milestones, 1 governance items, 1 releases");
    expect((await call(new Request(BASE + routes.setupDraft(draft.id)))).status).toBe(404);
    expect(app.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM setup_drafts").get()?.n).toBe(0);
  });

  test("refuses without a model, without a name, and with a non-multipart body", async () => {
    const { call } = appWith(null);
    const form = new FormData();
    form.set("name", "x");
    expect((await call(new Request(BASE + routes.setup(), { method: "POST", body: form }))).status).toBe(409);
    const withLlm = appWith(fakeLlm([DRAFT_REPLY]));
    const empty = new FormData();
    expect((await withLlm.call(new Request(BASE + routes.setup(), { method: "POST", body: empty }))).status).toBe(400);
    expect((await withLlm.call(new Request(BASE + routes.setup(), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }))).status).toBe(400);
  });
});
