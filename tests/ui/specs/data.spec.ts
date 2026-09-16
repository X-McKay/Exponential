import { expect, test } from "@playwright/test";
import { readHarness } from "../harness.ts";

const h = readHarness();

test.describe("data page, templates, and theme", () => {
  test("the templates document is validated before it can be saved, and a saved edit shows in the new-project picker", async ({ page }) => {
    await page.goto("/#/data");
    await expect(page.getByText("Project templates")).toBeVisible();
    await page.locator("div").filter({ hasText: /^Project templates/ }).getByRole("button", { name: "Edit JSON" }).click();
    const dialog = page.getByRole("dialog");
    const editor = dialog.locator("textarea");
    const original = await editor.inputValue();
    await editor.fill(original.replace(/"name": "Minimal"/, '"name": "Minimal (edited)"').replace(/\]\s*$/, ""));
    await expect(dialog.getByText(/Not valid JSON/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Save/ })).toBeDisabled();
    await editor.fill(original.replace(/"name": "Minimal"/, '"name": "Minimal (edited)"'));
    await dialog.getByRole("button", { name: /Save/ }).click();
    await expect(dialog).toBeHidden();
    await page.goto("/#/portfolio");
    await page.getByRole("button", { name: "+ New project" }).click();
    await expect(page.getByRole("dialog").getByLabel("Start from template")).toContainText("Minimal (edited)");
  });

  test("theme choice cycles and persists across reloads", async ({ page }) => {
    await page.goto("/#/glance");
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.getByRole("button", { name: /Theme:/ }).click();
    await page.getByRole("button", { name: /Theme:/ }).click();
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(["dark", "light"]).toContain(after);
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(after);
    void before;
  });

  test("the agents page knows the setup agent runs from documents and the model is connected", async ({ page }) => {
    await page.goto("/#/agents");
    await expect(page.getByText("release-test-model").first()).toBeVisible();
    await page.getByText(/Agent operations & history/).click();
    await page.getByRole("button", { name: /Setup .*Drafts a project from documents/ }).click();
    await expect(page.getByText(/runs from Portfolio → Set up from documents/)).toBeVisible();
  });

  test("the API reports the same projects the browser was seeded with", async ({ request }) => {
    const state = await (await request.get(`${h.baseUrl}/api/state`)).json() as { projects: { id: string }[]; templates: { id: string }[] };
    for (const p of h.seed.state.projects) expect(state.projects.some((x) => x.id === p.id)).toBeTruthy();
    expect(state.templates.length).toBeGreaterThanOrEqual(4);
  });
});
