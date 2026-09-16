// Sample events and calendar entries, relative to the state's `asOf`. Events
// that a sync would produce (merges, failed builds, deploys) are not listed
// here: they derive from the sample development facts.

import type { CalendarEvent, Event, FeedType, ProjectTab } from "../types.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const SAMPLE_EVENTS: { hoursAgo: number; type: FeedType; proj: string; tab: ProjectTab; text: string; ref: string }[] = [
  { hoursAgo: 4, type: "eval", proj: "clauses", tab: "value", text: "Nightly eval: clause recall at 86% — 2pts below base gate (88%)", ref: "eval:clauses/MS-21/rec:nightly" },
  { hoursAgo: 25, type: "gov", proj: "invoice", tab: "governance", text: "Operator documentation moved to In review — last open item for R2 alongside monitoring", ref: "gov:invoice/docs:in_review" },
  { hoursAgo: 31, type: "eval", proj: "triage", tab: "value", text: "Weekly eval: grounded response rate 96% — clears base gate (95%), acceptance 71%", ref: "eval:triage/MS-42/grd:weekly" },
  { hoursAgo: 60, type: "ship", proj: "invoice", tab: "value", text: "Purchase-order matching entered In eval — gate metrics now tracking", ref: "ship:invoice/MS-13:eval" },
  { hoursAgo: 96, type: "gov", proj: "clauses", tab: "governance", text: "Model risk assessment entered second review round (missed-obligation analysis)", ref: "gov:clauses/mra:in_review" },
  { hoursAgo: 120, type: "eval", proj: "search", tab: "value", text: "Reviewer rubric v2 labelled against 40 baseline answers — quality rating 64%", ref: "eval:search/MS-31/qual:rubric-v2" },
  { hoursAgo: 150, type: "gov", proj: "triage", tab: "governance", text: "Model and system card approved with the pilot results", ref: "gov:triage/card:approved" },
  { hoursAgo: 200, type: "eval", proj: "meetings", tab: "value", text: "Monthly quality sample: owner rating 88%, action item accuracy 96% — both gates hold", ref: "eval:meetings/MS-52/acc:monthly" },
  { hoursAgo: 240, type: "gov", proj: "search", tab: "governance", text: "Evaluation suite sign-off drafted with the knowledge team", ref: "gov:search/evalso:draft" },
];

export const EVENTS = (asOf: string): Event[] =>
  SAMPLE_EVENTS.map(({ hoursAgo, ...e }) => ({ ...e, at: new Date(new Date(asOf).getTime() - hoursAgo * HOUR).toISOString() }));

const SAMPLE_CALENDAR: { daysAhead: number; id: string; proj: string; tab: ProjectTab; text: string; sub: string | null }[] = [
  { daysAhead: 4, id: "pen-test-window", proj: "clauses", tab: "governance", text: "Pen test window opens", sub: "Security review — blocks R1 shadow mode" },
  { daysAhead: 20, id: "recall-gate-review", proj: "clauses", tab: "value", text: "Recall gate review with legal SMEs", sub: "Decision on 88% vs 90% base threshold" },
  { daysAhead: 26, id: "committee-oct-submission", proj: "search", tab: "governance", text: "AI committee submission (October cycle)", sub: "Pre-read drafted · expected Tier 3" },
  { daysAhead: 40, id: "queue-two-go-live", proj: "triage", tab: "roadmap", text: "Second support queue joins the pilot", sub: "Release process: two weeks above gate" },
  { daysAhead: 48, id: "quarterly-rereview", proj: "clauses", tab: "governance", text: "Quarterly committee re-review", sub: "AIC-2026-058 · Tier 1 cadence" },
  { daysAhead: 71, id: "annual-rereview-meetings", proj: "meetings", tab: "governance", text: "Annual committee re-review", sub: "AIC-2025-142 · Tier 3 cadence" },
];

export const CALENDAR = (asOf: string): CalendarEvent[] =>
  SAMPLE_CALENDAR.map(({ daysAhead, ...c }) => ({ ...c, date: new Date(new Date(asOf).getTime() + daysAhead * DAY).toISOString().slice(0, 10) }));
