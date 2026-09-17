import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { readHarness } from "../harness.ts";

const h = readHarness();

test.describe("workspace export and import", () => {
  test("the Data page downloads the workspace as JSON and imports it back, replacing the workspace only after confirmation", async ({ page, request }) => {
    const before = await (await request.get(`${h.baseUrl}/api/state`)).json() as { projects: { id: string }[]; calendar: unknown[]; proposals: { state: string }[] };
    await page.goto("/#/data");
    const download = page.waitForEvent("download");
    await page.locator("div").filter({ hasText: /^Export this workspace/ }).getByRole("button", { name: "Download JSON" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^exponential-workspace-\d{4}-\d{2}-\d{2}\.json$/);
    const path = await file.path();
    const doc = JSON.parse(readFileSync(path, "utf8")) as { format: string; version: number; projects: { id: string; readings: unknown[] }[]; proposals: unknown[] };
    expect(doc.format).toBe("exponential-workspace");
    expect(doc.projects.map((p) => p.id).sort()).toEqual(before.projects.map((p) => p.id).sort());
    expect(doc.projects.some((p) => p.readings.length > 0)).toBe(true);

    await page.locator("div").filter({ hasText: /^Import a workspace/ }).getByRole("button", { name: "Import…" }).click();
    const dialog = page.getByRole("dialog", { name: "Import a workspace" });
    await dialog.getByLabel("Workspace file").setInputFiles({ name: "not-a-workspace.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "other" })) });
    await expect(dialog.getByRole("alert")).toContainText("Not a workspace export");
    await dialog.getByLabel("Workspace file").setInputFiles(path);
    await expect(dialog).toContainText(`${before.projects.length} projects`);
    const replace = dialog.getByRole("button", { name: /Import|Replace this workspace/ });
    await expect(replace).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    await expect(replace).toHaveText("Replace this workspace");
    await replace.click();
    await expect(dialog.getByRole("status")).toContainText(new RegExp(`Imported ${before.projects.length} projects`));
    await dialog.getByRole("button", { name: "Done" }).click();
    const after = await (await request.get(`${h.baseUrl}/api/state`)).json() as { projects: { id: string }[]; calendar: unknown[]; proposals: { state: string }[] };
    expect(after.projects.map((p) => p.id).sort()).toEqual(before.projects.map((p) => p.id).sort());
    expect(after.calendar.length).toBe(before.calendar.length);
    expect(after.proposals.filter((p) => p.state === "pending").length).toBe(before.proposals.filter((p) => p.state === "pending").length);
  });
});
