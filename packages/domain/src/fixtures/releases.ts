import type { Release } from "../types.ts";

export const RELEASES: Record<string, Release[]> = {
  invoice: [
    { id: "R1", name: "Extraction GA", month: "2026-08", milestoneIds: ["MS-15", "MS-12"],
      criteria: [
        { type: "gate", ms: "MS-12", label: "Extraction base gate (accuracy ≥80, coverage ≥80)" },
        { type: "gov", gid: "uat", label: "UAT sign-off" },
        { type: "gov", gid: "sre", label: "Runbook approved" },
        { type: "gov", gid: "airc", label: "AI committee approval" },
      ] },
    { id: "R2", name: "Matching GA", month: "2026-11", milestoneIds: ["MS-13"],
      criteria: [
        { type: "gate", ms: "MS-13", label: "Matching base gate (accuracy ≥85, auto-matched ≥70)" },
        { type: "gov", gid: "mon", label: "Monitoring and drift detection approved" },
        { type: "gov", gid: "docs", label: "Operator documentation approved" },
        { type: "manual", ok: true, label: "Canary cohort selected (2 suppliers)" },
      ] },
    { id: "R3", name: "Full exception routing", month: "2027-01", milestoneIds: ["MS-14"],
      criteria: [
        { type: "gate", ms: "MS-14", label: "Routing base gate (routed ≥75, precision ≥80)" },
        { type: "gov", gid: "card", label: "System card approved" },
        { type: "manual", ok: false, label: "Exception-queue staffing plan agreed" },
      ] },
  ],
  clauses: [
    { id: "R1", name: "Shadow mode", month: "2026-10", milestoneIds: ["MS-21"],
      criteria: [
        { type: "gate", ms: "MS-21", label: "Extraction base gate (precision ≥92, recall ≥88)" },
        { type: "gov", gid: "sec", label: "Security review and pen test approved" },
        { type: "gov", gid: "mra", label: "Model risk assessment approved" },
        { type: "manual", ok: true, label: "Dual-approval workflow enabled (architecture condition)" },
      ] },
    { id: "R2", name: "Assisted review pilot", month: "2026-12", milestoneIds: ["MS-22"],
      criteria: [
        { type: "gate", ms: "MS-22", label: "Parser base gate (coverage ≥75, accuracy ≥90)" },
        { type: "gov", gid: "evalso", label: "Evaluation suite sign-off (recall gate resolved)" },
        { type: "gov", gid: "sla", label: "Service level agreement agreed" },
        { type: "gov", gid: "uat", label: "Legal UAT process defined" },
      ] },
    { id: "R3", name: "Gated activation", month: "2027-02", milestoneIds: ["MS-23"],
      criteria: [
        { type: "gate", ms: "MS-23", label: "Workbench throughput gate (lift ≥40%)" },
        { type: "gov", gid: "docs", label: "User and operator documentation approved" },
        { type: "manual", ok: false, label: "Quarterly committee re-review completed" },
      ] },
  ],
  search: [
    { id: "R1", name: "Team pilot", month: "2026-11", milestoneIds: ["MS-31"],
      criteria: [
        { type: "gate", ms: "MS-31", label: "Answer quality gate (rating ≥70, citations ≥95)" },
        { type: "gov", gid: "airc", label: "AI committee review and tiering" },
        { type: "gov", gid: "evalso", label: "Evaluation rubric sign-off" },
        { type: "manual", ok: true, label: "Pilot group confirmed (n=6)" },
      ] },
    { id: "R2", name: "Company rollout", month: "2027-02", milestoneIds: ["MS-32"],
      criteria: [
        { type: "gate", ms: "MS-32", label: "Freshness gate (staleness under 24h ≥90%)" },
        { type: "gov", gid: "sre", label: "Runbook approved" },
        { type: "gov", gid: "rel", label: "Release process approved" },
      ] },
  ],
  triage: [
    { id: "R1", name: "Support pilot", month: "2026-11", milestoneIds: ["MS-41", "MS-42"],
      criteria: [
        { type: "gate", ms: "MS-41", label: "Classification base gate (accuracy ≥90)" },
        { type: "gate", ms: "MS-42", label: "Draft base gate (grounded ≥95, acceptance ≥60)" },
        { type: "gov", gid: "dpia", label: "Privacy assessment approved" },
        { type: "manual", ok: true, label: "Specialist training session held" },
      ] },
    { id: "R2", name: "All queues", month: "2027-01", milestoneIds: ["MS-43"],
      criteria: [
        { type: "gate", ms: "MS-43", label: "Routing base gate (accuracy ≥85)" },
        { type: "gov", gid: "mon", label: "Monitoring and drift detection approved" },
        { type: "gov", gid: "docs", label: "Operator documentation approved" },
      ] },
  ],
  meetings: [
    { id: "R1", name: "General availability", month: "2026-04", milestoneIds: ["MS-51", "MS-52"],
      criteria: [
        { type: "gate", ms: "MS-51", label: "Summary quality gate (rating ≥80)" },
        { type: "gate", ms: "MS-52", label: "Action item gate (accuracy ≥85, owners ≥80)" },
        { type: "gov", gid: "uat", label: "Pilot teams signed off" },
        { type: "gov", gid: "docs", label: "Handbook guide published" },
      ] },
  ],
};
