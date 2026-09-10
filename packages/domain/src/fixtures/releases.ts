import type { Release } from "../types.ts";

export const RELEASES: Record<string, Release[]> = {
  onboarding: [
    { id: "R1", name: "Mapping GA", month: "2026-08", milestoneIds: ["MS-15", "MS-12"],
      criteria: [
        { type: "gate", ms: "MS-12", label: "Mapping base gate (accuracy ≥80, coverage ≥80)" },
        { type: "gov", gid: "uat", label: "UAT sign-off" },
        { type: "gov", gid: "sre", label: "SRE runbook approved" },
        { type: "gov", gid: "airc", label: "AI committee approval" },
      ] },
    { id: "R2", name: "Ingestion GA", month: "2026-11", milestoneIds: ["MS-13"],
      criteria: [
        { type: "gate", ms: "MS-13", label: "Ingestion base gate (accuracy ≥85, auto-processed ≥70)" },
        { type: "gov", gid: "mon", label: "Monitoring & drift detection approved" },
        { type: "gov", gid: "docs", label: "Ops documentation approved" },
        { type: "manual", ok: true, label: "Canary cohort selected (2 custodians)" },
      ] },
    { id: "R3", name: "Full auto-reconciliation", month: "2027-01", milestoneIds: ["MS-14"],
      criteria: [
        { type: "gate", ms: "MS-14", label: "Reconciliation base gate (records ≥75, precision ≥80)" },
        { type: "gov", gid: "card", label: "System card approved" },
        { type: "manual", ok: false, label: "Exception-queue staffing plan agreed" },
      ] },
  ],
  ima: [
    { id: "R1", name: "Shadow mode", month: "2026-10", milestoneIds: ["MS-21"],
      criteria: [
        { type: "gate", ms: "MS-21", label: "Extraction base gate (precision ≥92, recall ≥88)" },
        { type: "gov", gid: "sec", label: "Security review & pen test approved" },
        { type: "gov", gid: "mra", label: "Model risk assessment approved" },
        { type: "manual", ok: true, label: "Dual-approval workflow enabled (ARB condition)" },
      ] },
    { id: "R2", name: "Assisted review pilot", month: "2026-12", milestoneIds: ["MS-22"],
      criteria: [
        { type: "gate", ms: "MS-22", label: "Universe parser base gate (coverage ≥75, accuracy ≥90)" },
        { type: "gov", gid: "evalso", label: "Eval suite sign-off (SME recall gate resolved)" },
        { type: "gov", gid: "sla", label: "Product SLA agreed" },
        { type: "gov", gid: "uat", label: "Compliance UAT process defined" },
      ] },
    { id: "R3", name: "Gated activation", month: "2027-02", milestoneIds: ["MS-23"],
      criteria: [
        { type: "gate", ms: "MS-23", label: "Workbench throughput gate (lift ≥40%)" },
        { type: "gov", gid: "docs", label: "User & ops documentation approved" },
        { type: "manual", ok: false, label: "Quarterly committee re-review completed" },
      ] },
  ],
  sector: [
    { id: "R1", name: "Analyst pilot", month: "2026-11", milestoneIds: ["MS-31"],
      criteria: [
        { type: "gate", ms: "MS-31", label: "Draft quality gate (rating ≥70, citations ≥95)" },
        { type: "gov", gid: "airc", label: "AI committee review & tiering" },
        { type: "gov", gid: "evalso", label: "Eval rubric sign-off" },
        { type: "manual", ok: true, label: "Pilot analyst group confirmed (n=6)" },
      ] },
    { id: "R2", name: "Research desk rollout", month: "2027-02", milestoneIds: ["MS-32"],
      criteria: [
        { type: "gate", ms: "MS-32", label: "Freshness gate (staleness <24h ≥90%)" },
        { type: "gov", gid: "sre", label: "SRE plan approved" },
        { type: "gov", gid: "rel", label: "Release process approved" },
      ] },
  ],
};
