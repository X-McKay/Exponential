// ================= projects from templates =================
//
// Creating a project from a template writes the project's own facts and then
// the template's documents, dependencies, milestones, and releases in one
// transaction, through the same repository functions the editors use. The
// instantiation itself is a pure domain derivation (templates.ts there).

import type { Database } from "bun:sqlite";
import { instantiateTemplate, ymOf } from "@valueflow/domain";
import type { ProjectTemplate } from "@valueflow/domain";
import type { ReleaseInput, TemplateCreateInput } from "@valueflow/shared";
import { createGovernanceItem, recordEvent, upsertMilestone, upsertProject, upsertRelease } from "./repo.ts";

export type { Project } from "@valueflow/domain";
export type { ReleaseInput } from "@valueflow/shared";

/** Create the project and everything the template adds; returns the project id. */
export const createFromTemplate = (db: Database, template: ProjectTemplate, input: TemplateCreateInput, now: Date): string => {
  const instance = instantiateTemplate(template, ymOf(now), input.owner);
  const milestones = input.documentsOnly ? [] : instance.milestones;
  const releases: ReleaseInput[] = input.documentsOnly ? [] : instance.releases;
  db.transaction(() => {
    upsertProject(db, input.project, "create");
    for (const m of milestones) upsertMilestone(db, input.project.id, m, "create", now);
    for (const g of instance.governance) createGovernanceItem(db, input.project.id, g);
    for (const r of releases) upsertRelease(db, input.project.id, r, "create");
    const at = now.toISOString();
    const docs = template.documents.length;
    const deps = template.dependencies.length;
    recordEvent(db, {
      ref: `template:${input.project.id}:${at}`,
      at,
      type: "ship",
      proj: input.project.id,
      tab: "governance",
      text: `${input.project.name} created from the ${template.name} template: ${docs} document${docs === 1 ? "" : "s"}, ${deps} dependenc${deps === 1 ? "y" : "ies"}${milestones.length ? `, ${milestones.length} milestone${milestones.length === 1 ? "" : "s"}` : ""}${releases.length ? `, ${releases.length} release${releases.length === 1 ? "" : "s"}` : ""}`,
    });
  })();
  return input.project.id;
};
