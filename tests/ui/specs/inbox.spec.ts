import { expect, test } from "@playwright/test";
import { readHarness } from "../harness.ts";

const h = readHarness();
const p = h.seed.state.projects[1]!;

test.describe("update from documents and the inbox", () => {
  test("uploading a revised charter stages changes; the inbox applies and dismisses them", async ({ page }) => {
    await page.goto(`/#/project/${p.id}/overview`);
    await page.getByRole("button", { name: "Update from documents…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(`Update ${p.name} from documents`)).toBeVisible();
    const stage = dialog.getByRole("button", { name: "Stage changes for approval" });
    await expect(stage).toBeDisabled();
    await dialog.locator("input[type=file]").setInputFiles({ name: "charter-v2.md", mimeType: "text/markdown", buffer: Buffer.from(h.seed.charters[p.id]!) });
    await expect(dialog.getByText("charter-v2.md")).toBeVisible();
    await expect(stage).toBeEnabled();
    await stage.click();
    await expect(dialog.getByRole("status")).toContainText(/changes? staged for your approval/);
    const staged = await dialog.locator("ol li").count();
    expect(staged).toBeGreaterThanOrEqual(3);
    await dialog.getByRole("button", { name: /Review \d+ in the inbox/ }).click();
    await expect(page).toHaveURL(/#\/inbox$/);

    // The project group shows what came from documents and offers batch actions.
    const group = page.locator("section, div").filter({ has: page.getByText(new RegExp(`^${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · \\d+$`)) }).first();
    await expect(page.getByText(/from documents/)).toBeVisible();
    // Apply one proposal by hand and see the value preview beforehand.
    await expect(page.getByText("Proposed").first()).toBeVisible();
    await page.getByRole("button", { name: "Apply change" }).first().click();
    await expect(page.getByText(/^Applied:/).first()).toBeVisible();
    // Dismiss the rest at once.
    await page.getByRole("button", { name: "Dismiss all" }).click();
    await expect(page.getByText("You’re caught up.")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /Recently decided/ }).click();
    await expect(page.getByText("Applied", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Dismissed", { exact: true }).first()).toBeVisible();
    void group;
  });

  test("a stale record change is refused with a reason instead of overwriting", async ({ page, request }) => {
    // Stage again, then move the same milestone through the API before accepting.
    await page.goto(`/#/project/${p.id}/overview`);
    await page.getByRole("button", { name: "Update from documents…" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("input[type=file]").setInputFiles({ name: "charter-v3.md", mimeType: "text/markdown", buffer: Buffer.from(h.seed.charters[p.id]!) });
    await dialog.getByRole("button", { name: "Stage changes for approval" }).click();
    await dialog.getByRole("button", { name: /Review \d+ in the inbox/ }).click();
    const state = await (await request.get(`${h.baseUrl}/api/state`)).json() as { projects: { id: string; milestones: { id: string; month: string; [k: string]: unknown }[] }[]; proposals: { id: string; state: string; action: { type: string; mid?: string } }[] };
    const pending = state.proposals.find((x) => x.state === "pending" && x.action.type === "milestone_update");
    expect(pending).toBeTruthy();
    const ms = state.projects.find((x) => x.id === p.id)!.milestones.find((m) => m.id === pending!.action.mid)!;
    const moved = await request.put(`${h.baseUrl}/api/projects/${p.id}/milestones/${ms.id}`, { data: { ...ms, month: "2028-01" }, headers: { "x-valueflow-role": "admin" } });
    expect(moved.ok()).toBeTruthy();
    await page.reload();
    const row = page.locator(`#proposal-${pending!.id}`);
    await row.getByRole("button", { name: "Apply change" }).click();
    await expect(row.getByRole("alert")).toContainText(/stale/);
    await page.getByRole("button", { name: "Dismiss all" }).click();
    await expect(page.getByText("You’re caught up.")).toBeVisible({ timeout: 20_000 });
  });
});
