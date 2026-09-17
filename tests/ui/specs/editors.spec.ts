import { expect, test } from "@playwright/test";
import { readHarness } from "../harness.ts";

const h = readHarness();
const projects = h.seed.state.projects;

test.describe("editors and validation", () => {
  test("a new project needs a valid key and initials before it can be created, and a template adds its base set", async ({ page }) => {
    await page.goto("/#/portfolio");
    await page.getByRole("button", { name: "+ New project" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("New project")).toBeVisible();
    const create = dialog.getByRole("button", { name: "Create project" });
    await expect(create).toBeDisabled();
    await dialog.getByLabel("Name").fill("Browser-created project");
    await expect(create).toBeEnabled();
    // A key over 16 characters is refused up front (the field caps input, so a blank key is the observable failure).
    const key = dialog.getByLabel("Key");
    await key.fill("");
    await expect(create).toBeDisabled();
    await key.fill("UI-1");
    await expect(create).toBeEnabled();
    // Team initials must be one to three letters or digits.
    await dialog.getByRole("button", { name: "+ Add member" }).click();
    await dialog.getByPlaceholder("e.g. Dan K.").fill("Test Person");
    await dialog.getByPlaceholder("e.g. ML Engineer").fill("Tester");
    const ini = dialog.getByLabel("Initials");
    await ini.fill("T-P");
    await expect(create).toBeDisabled();
    await ini.fill("TP");
    await expect(create).toBeEnabled();
    // Pick the automation template; the summary says what it adds.
    const template = dialog.getByLabel("Start from template");
    await template.selectOption("automation");
    await expect(dialog.getByText(/Adds \d+ documents · \d+ dependencies · \d+ milestones · \d+ releases/)).toBeVisible();
    await create.click();
    await expect(page.getByRole("heading", { name: "Browser-created project" })).toBeVisible();
    await page.getByRole("tab", { name: /^Governance( ·)?$/ }).click();
    await expect(page.getByText("Immutable audit log").first()).toBeVisible();
    await expect(page.getByText("Manual fallback process").first()).toBeVisible();
    await expect(page.getByText(/Dependencies · general register/)).toBeVisible();
    await page.getByRole("tab", { name: "Roadmap" }).click();
    await expect(page.locator("main")).toContainText("Shadow mode");
  });

  test("the milestone editor refuses a stretch gate below base and explains why", async ({ page }) => {
    const p = projects[0]!;
    await page.goto(`/#/project/${p.id}/value`);
    await page.getByRole("button", { name: /\+ (New|Add) milestone/ }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("e.g. Entity resolution service").fill("Browser milestone");
    const create = dialog.getByRole("button", { name: "Create milestone" });
    await expect(create).toBeEnabled();
    await dialog.getByRole("button", { name: "+ Add criterion" }).click();
    await dialog.getByPlaceholder("e.g. Mapping accuracy").fill("Browser metric");
    await dialog.getByLabel("Stretch gate").fill("50");
    await expect(create).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Create milestone" }).locator("xpath=..")).toContainText(/stretch at or above base/);
    await dialog.getByLabel("Stretch gate").fill("95");
    await expect(create).toBeEnabled();
    await create.click();
    await expect(page.getByText("Browser milestone")).toBeVisible();
  });

  test("a server-side rejection keeps the draft and names the field", async ({ page }) => {
    // The calendar editor checks the date's shape; the server also checks it is a real date.
    await page.goto("/#/data");
    await page.getByRole("button", { name: "+ Add event" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("e.g. Pen test window opens").fill("Impossible date check");
    await dialog.getByPlaceholder("YYYY-MM-DD").fill("2026-02-30");
    await dialog.getByRole("button", { name: "Add event" }).click();
    await expect(dialog.getByRole("alert")).toContainText(/date: expected a real calendar date/);
    await expect(dialog.getByPlaceholder("e.g. Pen test window opens")).toHaveValue("Impossible date check");
    await dialog.getByPlaceholder("YYYY-MM-DD").fill("2026-10-30");
    await dialog.getByRole("button", { name: "Add event" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/Impossible date check/)).toBeVisible();
  });

  test("viewer mode is read-only in the browser and at the API", async ({ page }) => {
    await page.goto("/#/portfolio");
    await page.evaluate(() => {
      sessionStorage.setItem("valueflow.role", "viewer");
    });
    await page.reload();
    await expect(page.getByRole("status")).toContainText("Viewer mode");
    await page.getByRole("button", { name: "+ New project" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Should not save");
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect(dialog.getByRole("alert")).toContainText(/read-only/);
    await page.evaluate(() => sessionStorage.removeItem("valueflow.role"));
  });
});
