/** Local, token-protected OpenAI-compatible fixture. Never used by production startup. */
export const startTestProvider = (hostname = "127.0.0.1") => {
  const token = "release-test-token";
  const suggested = (value: unknown) => ({ value, rationale: "From the fictional charter.", source: "support-triage-charter.md", confidence: "high" });
  const draft = {
    description: suggested("Suggest ticket categories and response drafts for human review. No automatic sending."),
    stage: suggested("Pilot"), tier: suggested(2), committee: suggested({ date: "", ref: "" }),
    targets: suggested({ fte: 20, time: 35 }),
    team: [suggested({ name: "Alex Rivera", role: "Project manager" })], repos: [],
    milestones: [suggested({ name: "Ticket classification", status: "planned", month: "2026-10", baseFte: 8, baseTime: 15, stretchFte: 12, stretchTime: 20, metrics: [{ label: "Classification accuracy", base: 90, stretch: 95 }] })],
    governance: [suggested({ cat: "AI governance", name: "Privacy assessment", status: "missing", owner: "Alex Rivera", detail: "Complete before the pilot." })],
    releases: [suggested({ name: "Support Pilot", month: "2026-11", milestones: ["Ticket classification"], criteria: [{ type: "gate", ref: "Ticket classification", label: "Pass classification gate" }, { type: "gov", ref: "Privacy assessment", label: "Privacy approval" }] })],
  };
  let calls = 0;
  const server = Bun.serve({ hostname, port: 0, async fetch(req) {
    if (req.headers.get("authorization") !== `Bearer ${token}`) return Response.json({ error: "Invalid test token" }, { status: 401 });
    const url = new URL(req.url);
    if (url.pathname === "/v1/models") return Response.json({ data: [{ id: "release-test-model" }] });
    if (url.pathname !== "/v1/chat/completions") return new Response(null, { status: 404 });
    calls++;
    const payload = await req.json() as { response_format?: { json_schema?: { name?: string } }; stream?: boolean };
    const content = JSON.stringify(payload.response_format?.json_schema?.name === "project_draft" ? draft : {
      summary: "Review the pilot gates before release.", attention: false, body: "# Pilot assessment\n\nThe project is planned. No observed savings or deployment are claimed. Complete the privacy assessment and measure the classification gate before release.",
      answer: "Complete the privacy assessment and measure the classification gate before release.", proposals: [], links: [],
    });
    const usage = { prompt_tokens: 180, completion_tokens: 120 };
    if (payload.stream) return new Response(`data: ${JSON.stringify({ model: "release-test-model", choices: [{ delta: { content }, finish_reason: "stop" }], usage })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    return Response.json({ model: "release-test-model", choices: [{ message: { content }, finish_reason: "stop" }], usage });
  } });
  return { token, baseUrl: `http://127.0.0.1:${server.port}/v1`, calls: () => calls, stop: () => server.stop(true) };
};
