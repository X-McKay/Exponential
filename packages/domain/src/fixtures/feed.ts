// Sample events and calendar entries, relative to the state's `asOf`. Events
// that a sync would produce (merges, failed builds, deploys) are not listed
// here: they derive from the sample development facts.

import type { CalendarEvent, Event, FeedType, ProjectTab } from "../types.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const SAMPLE_EVENTS: { hoursAgo: number; type: FeedType; proj: string; tab: ProjectTab; text: string; ref: string }[] = [
  { hoursAgo: 4, type: "eval", proj: "ima", tab: "value", text: "Nightly eval: restriction extraction recall at 86% — 2pts below base gate (88%)", ref: "eval:ima/MS-21/rec:nightly" },
  { hoursAgo: 25, type: "gov", proj: "onboarding", tab: "governance", text: "Ops documentation moved to In review — last open item for R2 alongside monitoring", ref: "gov:onboarding/docs:in_review" },
  { hoursAgo: 60, type: "ship", proj: "onboarding", tab: "value", text: "Document ingestion pipeline entered In eval — gate metrics now tracking", ref: "ship:onboarding/MS-13:eval" },
  { hoursAgo: 96, type: "gov", proj: "ima", tab: "governance", text: "Model risk assessment entered second review round (false-negative analysis)", ref: "gov:ima/mra:in_review" },
  { hoursAgo: 120, type: "eval", proj: "sector", tab: "value", text: "Analyst rubric v2 labeled against 40 baseline reports — quality rating 64%", ref: "eval:sector/MS-31/qual:rubric-v2" },
];

export const EVENTS = (asOf: string): Event[] =>
  SAMPLE_EVENTS.map(({ hoursAgo, ...e }) => ({ ...e, at: new Date(new Date(asOf).getTime() - hoursAgo * HOUR).toISOString() }));

const SAMPLE_CALENDAR: { daysAhead: number; id: string; proj: string; tab: ProjectTab; text: string; sub: string | null }[] = [
  { daysAhead: 4, id: "pen-test-window", proj: "ima", tab: "governance", text: "Pen test window opens", sub: "Security review — blocks R1 shadow mode" },
  { daysAhead: 20, id: "recall-gate-review", proj: "ima", tab: "value", text: "Recall gate review with compliance SMEs", sub: "Decision on 88% vs 90% base threshold" },
  { daysAhead: 26, id: "airc-oct-submission", proj: "sector", tab: "governance", text: "AI committee submission (Oct cycle)", sub: "Pre-read drafted · expected Tier 3" },
  { daysAhead: 48, id: "quarterly-rereview", proj: "ima", tab: "governance", text: "Quarterly committee re-review", sub: "AIRC-2026-058 · Tier 1 cadence" },
];

export const CALENDAR = (asOf: string): CalendarEvent[] =>
  SAMPLE_CALENDAR.map(({ daysAhead, ...c }) => ({ ...c, date: new Date(new Date(asOf).getTime() + daysAhead * DAY).toISOString().slice(0, 10) }));
