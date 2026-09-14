import { releaseState } from "@valueflow/domain";
import type { Calendar, Criterion, CriterionEval, Project, ProjectTab, Release } from "@valueflow/domain";

/** A past target with unfinished criteria deserves attention before future plans. */
export const focusRelease = (releases: Release[], project: Project, cal: Calendar): Release | undefined => {
  const sorted = [...releases].sort((a, b) => a.month.localeCompare(b.month) || a.id.localeCompare(b.id));
  return sorted.find((r) => r.month < cal.todayYm && releaseState(r, project, cal).label !== "Ready")
    ?? sorted.find((r) => r.month >= cal.todayYm)
    ?? sorted.at(-1);
};

export interface ReleaseBlocker {
  criterion: Criterion;
  index: number;
  evaluation: CriterionEval;
  tab: ProjectTab;
  focusId: string;
  label: string;
  owner?: string;
}

/** Destinations are derived from references, never inferred from a criterion's prose. */
export const releaseBlockers = (release: Release, project: Project, cal: Calendar): ReleaseBlocker[] => {
  const state = releaseState(release, project, cal);
  return release.criteria.flatMap((criterion, index): ReleaseBlocker[] => {
    const evaluation = state.evals[index];
    if (!evaluation || evaluation.ok) return [];
    const base = { criterion, index, evaluation };
    if (criterion.type === "gov") {
      const item = project.governance.find((g) => g.id === criterion.gid);
      if (item) return [{ ...base, tab: "governance", focusId: item.id, label: "Review approval", ...(item.owner ? { owner: item.owner } : {}) }];
    }
    if (criterion.type === "gate" && project.milestones.some((m) => m.id === criterion.ms)) {
      return [{ ...base, tab: "value", focusId: criterion.ms, label: "Review gate" }];
    }
    return [{ ...base, tab: "roadmap", focusId: release.id, label: criterion.type === "manual" ? "Review criterion" : "Fix criterion reference" }];
  });
};
