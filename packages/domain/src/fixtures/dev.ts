import type { DevActivity } from "../types.ts";

export const DEV: Record<string, DevActivity> = {
  onboarding: {
    stats: { coverage: 84, quality: "A−", buildPass: 96, mergedPRs: 41, medianReview: "5h", deploys: 18 },
    repos: [
      { name: "onboarding-mapping-svc", branch: "main", coverage: 88, quality: "A", lang: "Python" },
      { name: "doc-ingest-pipeline", branch: "main", coverage: 79, quality: "B+", lang: "Python" },
      { name: "onboarding-evals", branch: "main", coverage: 91, quality: "A", lang: "Python" },
    ],
    activitySeed: 3, activityLevel: 9,
    prs: [
      { id: "#412", title: "Add drift alert thresholds to ingest metrics", repo: "doc-ingest-pipeline", author: "RS", status: "open", checks: "running", add: 214, del: 38, age: "3h", reviewers: ["NP"] },
      { id: "#409", title: "Batch OCR fallback for scanned custodian statements", repo: "doc-ingest-pipeline", author: "DK", status: "open", checks: "fail", add: 486, del: 92, age: "1d", reviewers: ["AM", "NP"] },
      { id: "#408", title: "Mapping suggestion confidence calibration", repo: "onboarding-mapping-svc", author: "DK", status: "merged", checks: "pass", add: 167, del: 41, age: "2d", reviewers: ["AM"] },
      { id: "#71", title: "Golden set v5: add 2 new custodian formats", repo: "onboarding-evals", author: "AM", status: "merged", checks: "pass", add: 1240, del: 12, age: "3d", reviewers: ["DK"] },
      { id: "#405", title: "Refactor: extract schema inference into module", repo: "onboarding-mapping-svc", author: "NP", status: "merged", checks: "pass", add: 623, del: 587, age: "4d", reviewers: ["DK", "RS"] },
    ],
    builds: [
      { id: "#1148", repo: "doc-ingest-pipeline", branch: "pr/409", status: "fail", note: "test_ocr_fallback: 3 failures", when: "2h ago", dur: "6m 12s" },
      { id: "#1147", repo: "onboarding-mapping-svc", branch: "main", status: "pass", note: "deploy → staging", when: "5h ago", dur: "4m 40s" },
      { id: "#1146", repo: "onboarding-evals", branch: "main", status: "pass", note: "nightly eval run · gates green", when: "9h ago", dur: "22m 03s" },
      { id: "#1145", repo: "doc-ingest-pipeline", branch: "main", status: "pass", note: "deploy → prod (canary)", when: "1d ago", dur: "7m 51s" },
    ],
    people: [
      { ini: "DK", name: "Dan K.", commits: 64, reviews: 22 },
      { ini: "NP", name: "Nish P.", commits: 48, reviews: 31 },
      { ini: "AM", name: "Al McKay", commits: 37, reviews: 45 },
      { ini: "RS", name: "R. Singh", commits: 21, reviews: 12 },
    ],
  },
  ima: {
    stats: { coverage: 76, quality: "B+", buildPass: 91, mergedPRs: 23, medianReview: "11h", deploys: 6 },
    repos: [
      { name: "ima-rule-extractor", branch: "main", coverage: 74, quality: "B+", lang: "Python" },
      { name: "compliance-rule-schema", branch: "main", coverage: 82, quality: "A−", lang: "Rust" },
    ],
    activitySeed: 7, activityLevel: 6,
    prs: [
      { id: "#188", title: "Recall improvements: nested restriction clauses", repo: "ima-rule-extractor", author: "DK", status: "open", checks: "pass", add: 342, del: 118, age: "6h", reviewers: ["AM", "SC"] },
      { id: "#186", title: "Schema v0.9: derivative exposure limits", repo: "compliance-rule-schema", author: "AM", status: "open", checks: "pass", add: 156, del: 22, age: "2d", reviewers: ["SC"] },
      { id: "#184", title: "Add SME disagreement flags to eval output", repo: "ima-rule-extractor", author: "DK", status: "merged", checks: "pass", add: 98, del: 14, age: "3d", reviewers: ["SC"] },
      { id: "#181", title: "Dual-approval state machine for rule activation", repo: "ima-rule-extractor", author: "AM", status: "merged", checks: "pass", add: 411, del: 63, age: "6d", reviewers: ["SC", "MB"] },
    ],
    builds: [
      { id: "#402", repo: "ima-rule-extractor", branch: "main", status: "pass", note: "eval run · recall 86% (below gate)", when: "4h ago", dur: "31m 44s" },
      { id: "#401", repo: "compliance-rule-schema", branch: "main", status: "pass", note: "schema validation suite", when: "1d ago", dur: "2m 18s" },
      { id: "#400", repo: "ima-rule-extractor", branch: "pr/185", status: "fail", note: "clause splitter regression", when: "2d ago", dur: "28m 09s" },
    ],
    people: [
      { ini: "DK", name: "Dan K.", commits: 41, reviews: 8 },
      { ini: "AM", name: "Al McKay", commits: 28, reviews: 19 },
      { ini: "SC", name: "S. Chen", commits: 6, reviews: 27 },
      { ini: "MB", name: "M. Boateng", commits: 0, reviews: 9 },
    ],
  },
  sector: {
    stats: { coverage: 58, quality: "B", buildPass: 82, mergedPRs: 15, medianReview: "1d", deploys: 0 },
    repos: [
      { name: "sector-report-agents", branch: "main", coverage: 58, quality: "B", lang: "Python" },
    ],
    activitySeed: 11, activityLevel: 4,
    prs: [
      { id: "#54", title: "Citation verifier agent with source pinning", repo: "sector-report-agents", author: "DK", status: "open", checks: "running", add: 388, del: 45, age: "1d", reviewers: ["AM"] },
      { id: "#52", title: "Rubric scoring harness for analyst evals", repo: "sector-report-agents", author: "TW", status: "open", checks: "pass", add: 205, del: 0, age: "2d", reviewers: ["DK"] },
      { id: "#49", title: "Draft outline planner: sector template library", repo: "sector-report-agents", author: "DK", status: "merged", checks: "pass", add: 512, del: 88, age: "5d", reviewers: ["AM", "TW"] },
    ],
    builds: [
      { id: "#96", repo: "sector-report-agents", branch: "main", status: "fail", note: "flaky: market data fixture timeout", when: "7h ago", dur: "12m 30s" },
      { id: "#95", repo: "sector-report-agents", branch: "main", status: "pass", note: "unit + rubric smoke tests", when: "1d ago", dur: "9m 02s" },
    ],
    people: [
      { ini: "DK", name: "Dan K.", commits: 33, reviews: 11 },
      { ini: "AM", name: "Al McKay", commits: 19, reviews: 14 },
      { ini: "TW", name: "T. Wu", commits: 12, reviews: 6 },
    ],
  },
};
