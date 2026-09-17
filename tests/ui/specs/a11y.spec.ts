import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { readHarness } from "../harness.ts";

const h = readHarness();
const p = h.seed.state.projects[0]!;

/** WCAG 2.1 A and AA, as axe checks them; a violation lists the rule, its impact, and the first offending node. */
const audit = async (page: import("@playwright/test").Page, label: string): Promise<void> => {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => `${n.html.slice(0, 160)}\n      ${(n.failureSummary ?? "").split("\n").slice(0, 2).join(" ")}`).join("\n    ")}`);
  expect(summary, `${label}: axe violations`).toEqual([]);
};

test.describe("accessibility", () => {
  for (const [name, hash] of [
    ["glance", "/#/glance"],
    ["inbox", "/#/inbox"],
    ["portfolio", "/#/portfolio"],
    ["agents", "/#/agents"],
    ["agents quality", "/#/agents/quality"],
    ["agents economics", "/#/agents/economics"],
    ["data", "/#/data"],
    ["project overview", `/#/project/${p.id}/overview`],
    ["project value", `/#/project/${p.id}/value`],
    ["project roadmap", `/#/project/${p.id}/roadmap`],
    ["project governance", `/#/project/${p.id}/governance`],
    ["project development", `/#/project/${p.id}/development`],
  ] as const) {
    test(`${name} has no WCAG A/AA violations`, async ({ page }) => {
      await page.goto(hash);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForTimeout(200);
      await audit(page, name);
    });
  }

  test("dialogs and the palette are labelled and free of violations", async ({ page }) => {
    await page.goto("/#/portfolio");
    await page.getByRole("button", { name: "+ New project" }).click();
    const dialog = page.getByRole("dialog", { name: "New project" });
    await expect(dialog).toBeVisible();
    await audit(page, "new project dialog");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.keyboard.press("Control+k");
    const box = page.getByRole("combobox", { name: "Jump to" });
    await expect(box).toBeVisible();
    await expect(page.getByRole("listbox", { name: "Destinations" })).toBeVisible();
    await box.fill("econ");
    await expect(page.getByRole("option", { name: /Economics/ })).toBeVisible();
    await audit(page, "palette");
    await page.keyboard.press("Escape");
  });

  test("keyboard flow: skip link, shortcuts list, and arrow keys along the project tabs", async ({ page }) => {
    await page.goto(`/#/project/${p.id}/overview`);
    await expect(page.getByRole("heading", { name: p.name })).toBeVisible();
    // The first Tab stop is the skip link; activating it lands focus on the page content.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
    // Landmarks a screen reader can move between.
    await expect(page.getByRole("navigation", { name: "Pages" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Workspace" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Project brief" })).toBeVisible();
    // ? lists every shortcut; Escape closes it and returns focus.
    await page.keyboard.press("?");
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(help).toBeVisible();
    await expect(help).toContainText("Apply the selected proposal");
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();
    // Arrow keys move along the tab bar and open the neighbouring tab.
    const tabs = page.getByRole("tablist", { name: "Project views" });
    await tabs.getByRole("tab", { name: "Value" }).click();
    await expect(page).toHaveURL(new RegExp(`#/project/${p.id}/value$`));
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(new RegExp(`#/project/${p.id}/roadmap$`));
    await expect(tabs.getByRole("tab", { name: "Roadmap" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(page).toHaveURL(new RegExp(`#/project/${p.id}/governance$`));
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(new RegExp(`#/project/${p.id}/overview$`));
  });
});
