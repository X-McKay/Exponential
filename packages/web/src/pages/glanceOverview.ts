import { monthLabel, releaseState } from "@valueflow/domain";
import type { AppState, Calendar } from "@valueflow/domain";
import { focusRelease } from "../releaseFocus.ts";

/** Structured current facts keep presentation separate from the summary's meaning. */
export const glanceOverview = (state: AppState, cal: Calendar) => {
  const milestones = state.projects.flatMap((p) => p.milestones);
  const shipped = milestones.filter((m) => m.status === "shipped").length;
  const releases = state.projects.flatMap((project) => (state.releases[project.id] ?? []).map((release) => releaseState(release, project, cal)));
  const ready = releases.filter((release) => release.label === "Ready").length;
  return {
    closing: releases.length ? `${ready ? `${ready === 1 ? "One release meets" : `${ready} releases meet`} all configured go-live criteria.` : "No releases currently meet all configured go-live criteria."} The priorities below highlight where attention is needed next.` : "",
    summary: state.projects.length
      ? `Across ${state.projects.length} project${state.projects.length === 1 ? "" : "s"}, ${shipped} of ${milestones.length} milestones are marked shipped. Here’s where each project stands.`
      : "No projects are being tracked yet. Add a project to get started.",
    remaining: Math.max(0, state.projects.length - 3),
    projects: state.projects.slice(0, 3).map((project) => {
      const release = focusRelease(state.releases[project.id] ?? [], project, cal);
      const status = release ? releaseState(release, project, cal) : null;
      const unmet = status ? status.total - status.met : 0;
      return {
        id: project.id,
        name: project.name,
        stage: project.stage.trim() || "Stage not set",
        delivery: project.milestones.length
          ? `${project.milestones.filter((m) => m.status === "shipped").length} of ${project.milestones.length} milestones shipped`
          : "No milestones defined",
        release: release && status ? {
          id: release.id,
          name: release.name,
          target: monthLabel(release.month, cal.todayYm),
          status: status.label,
          tone: status.label === "Ready" ? "good" as const : status.label === "Blocked" ? "bad" as const : "warn" as const,
          detail: status.label === "Not configured" ? "Go-live criteria not configured"
            : status.label === "Ready" ? "All configured go-live criteria met"
            : `${unmet} go-live ${unmet === 1 ? "criterion" : "criteria"} unmet`,
        } : null,
      };
    }),
  };
};
