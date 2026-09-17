import { expect, test } from "@playwright/test";
import { readHarness } from "../harness.ts";

const h = readHarness();
const projects = h.seed.state.projects;

test.describe("portfolio and navigation", () => {
  test("lists every seeded project with its current stage and delivery count", async ({ page, request }) => {
    // Earlier specs may have applied staged changes; compare with the API's view rather than the seed.
    const live = (await (await request.get(`${h.baseUrl}/api/state`)).json()) as { projects: { id: string; name: string; stage: string; milestones: unknown[] }[] };
    await page.goto("/#/portfolio");
    await expect(page.getByRole("heading", { name: "AI project portfolio" })).toBeVisible();
    for (const p of projects) {
      const current = live.projects.find((x) => x.id === p.id)!;
      const card = page.getByRole("button", { name: new RegExp(p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
      await expect(card).toBeVisible();
      await expect(card).toContainText(current.stage);
      await expect(card).toContainText(`/ ${current.milestones.length}milestones shipped`);
    }
  });

  test("opens a project, walks its tabs, and the URL follows", async ({ page }) => {
    const p = projects[0]!;
    await page.goto("/#/portfolio");
    await page.getByRole("button", { name: new RegExp(p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
    await expect(page.getByRole("heading", { name: p.name })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#/project/${p.id}/overview$`));
    for (const tab of ["Value", "Roadmap", "Development", "Governance"]) {
      await page.getByRole("tab", { name: new RegExp(`^${tab}( ·)?$`) }).click();
      await expect(page).toHaveURL(new RegExp(`#/project/${p.id}/${tab.toLowerCase()}$`));
    }
    await expect(page.getByText("Release-linked controls")).toBeVisible();
  });

  test("keyboard chords move between pages and the palette jumps to a project", async ({ page }) => {
    await page.goto("/#/glance");
    await expect(page.getByRole("heading", { name: "Glance" })).toBeVisible();
    await page.keyboard.press("g");
    await page.keyboard.press("i");
    await expect(page).toHaveURL(/#\/inbox$/);
    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page).toHaveURL(/#\/portfolio$/);
    await page.keyboard.press("Control+k");
    const box = page.getByRole("combobox", { name: "Jump to" });
    await expect(box).toBeVisible();
    await box.fill(projects[1]!.name);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`#/project/${projects[1]!.id}/`));
  });

  test("glance composes a narrative and an empty inbox says so", async ({ page, request }) => {
    const state = await (await request.get(`${h.baseUrl}/api/state`)).json() as { proposals: { id: string; state: string }[] };
    for (const x of state.proposals.filter((y) => y.state === "pending")) await request.post(`${h.baseUrl}/api/proposals/${x.id}/dismiss`, { headers: { "x-valueflow-role": "admin" } });
    await page.goto("/#/glance");
    await expect(page.getByRole("heading", { name: "Glance" })).toBeVisible();
    await expect(page.locator("main")).toContainText(/release|gate|calendar|build/i);
    await page.goto("/#/inbox");
    await expect(page.getByText("You’re caught up.")).toBeVisible();
  });
});
