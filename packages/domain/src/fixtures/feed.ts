import type { FeedDay, Upcoming } from "../types.ts";

export const FEED: FeedDay[] = [
  { day: "Today", items: [
    { t: "2h ago", type: "build", proj: "onboarding", tab: "development", text: "Build #1148 failed on doc-ingest-pipeline pr/409 — test_ocr_fallback: 3 failures" },
    { t: "4h ago", type: "eval", proj: "ima", tab: "value", text: "Nightly eval: restriction extraction recall at 86% — 2pts below base gate (88%)" },
    { t: "5h ago", type: "deploy", proj: "onboarding", tab: "development", text: "onboarding-mapping-svc deployed to staging (build #1147)" },
  ] },
  { day: "Yesterday", items: [
    { t: "Sep 9", type: "merge", proj: "ima", tab: "development", text: "PR #188 opened: recall improvements for nested restriction clauses (DK)" },
    { t: "Sep 9", type: "gov", proj: "onboarding", tab: "governance", text: "Ops documentation moved to In review — last open item for R2 alongside monitoring" },
    { t: "Sep 9", type: "deploy", proj: "onboarding", tab: "development", text: "Canary deploy to prod completed for doc-ingest-pipeline" },
  ] },
  { day: "Earlier this week", items: [
    { t: "Sep 8", type: "merge", proj: "onboarding", tab: "development", text: "PR #408 merged: mapping suggestion confidence calibration (+167 −41)" },
    { t: "Sep 7", type: "ship", proj: "onboarding", tab: "value", text: "Document ingestion pipeline entered In eval — gate metrics now tracking" },
    { t: "Sep 7", type: "merge", proj: "onboarding", tab: "development", text: "Golden set v5 merged: +2 custodian formats, 1,400 labeled mappings" },
    { t: "Sep 6", type: "gov", proj: "ima", tab: "governance", text: "Model risk assessment entered second review round (false-negative analysis)" },
    { t: "Sep 5", type: "eval", proj: "sector", tab: "value", text: "Analyst rubric v2 labeled against 40 baseline reports — quality rating 64%" },
  ] },
];

export const UPCOMING: Upcoming[] = [
  { date: "Sep 14", proj: "ima", tab: "governance", text: "Pen test window opens", sub: "Security review — blocks R1 shadow mode" },
  { date: "Sep 30", proj: "ima", tab: "value", text: "Recall gate review with compliance SMEs", sub: "Decision on 88% vs 90% base threshold" },
  { date: "Oct", proj: "onboarding", tab: "roadmap", text: "R2 · Ingestion GA target", sub: null, release: { pid: "onboarding", rid: "R2" } },
  { date: "Oct", proj: "sector", tab: "governance", text: "AI committee submission (Oct cycle)", sub: "Pre-read drafted · expected Tier 3" },
  { date: "Oct 28", proj: "ima", tab: "governance", text: "Quarterly committee re-review", sub: "AIRC-2026-058 · Tier 1 cadence" },
  { date: "Nov", proj: "ima", tab: "roadmap", text: "R2 · Assisted review pilot target", sub: null, release: { pid: "ima", rid: "R2" } },
  { date: "Dec", proj: "onboarding", tab: "roadmap", text: "R3 · Full auto-reconciliation target", sub: null, release: { pid: "onboarding", rid: "R3" } },
];
