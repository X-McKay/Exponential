import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readHarness } from "../harness.ts";

const h = readHarness();
const p = h.seed.state.projects[0]!;

/** No page may scroll sideways: every layout has to fit the viewport it was given. */
const noHorizontalOverflow = async (page: Page): Promise<void> => {
  const { scrollWidth, clientWidth, offenders } = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders: string[] = [];
    const scrolls = (el: Element): boolean => {
      // Content inside a deliberate horizontal scroll container (a wide chart, a table, the narrow-screen nav) may extend past the edge.
      for (let node: Element | null = el.parentElement; node && node !== document.body; node = node.parentElement) {
        const o = getComputedStyle(node).overflowX;
        if (o === "auto" || o === "scroll") return true;
      }
      return false;
    };
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (el.closest(".vf-topnav") || scrolls(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > width + 1 && getComputedStyle(el).visibility !== "hidden") offenders.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className)} right=${Math.round(r.right)} “${(el.textContent ?? "").replace(/\s+/g, " ").slice(0, 50)}”`);
    }
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: width, offenders: offenders.slice(0, 8) };
  });
  expect(offenders, "elements past the viewport edge").toEqual([]);
  expect(scrollWidth, "document scrollWidth").toBeLessThanOrEqual(clientWidth + 1);
};

test.describe("phone-width layouts", () => {
  for (const [name, hash] of [
    ["glance", "/#/glance"],
    ["portfolio", "/#/portfolio"],
    ["inbox", "/#/inbox"],
    ["agents", "/#/agents"],
    ["data", "/#/data"],
    ["overview", `/#/project/${p.id}/overview`],
    ["value", `/#/project/${p.id}/value`],
    ["roadmap", `/#/project/${p.id}/roadmap`],
    ["governance", `/#/project/${p.id}/governance`],
    ["development", `/#/project/${p.id}/development`],
  ] as const) {
    test(`${name} fits a 390px viewport`, async ({ page }) => {
      await page.goto(hash);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForTimeout(250);
      await noHorizontalOverflow(page);
      // The sidebar gives way to a top navigation on narrow screens.
      await expect(page.getByRole("navigation", { name: "Pages" })).toBeVisible();
    });
  }

  test("editor field grids stack into one column and the dialog stays within the screen", async ({ page }) => {
    await page.goto("/#/portfolio");
    await page.getByRole("button", { name: "+ New project" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const columns = await dialog.locator(".vf-fields").first().evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    expect(columns.split(" ").length, `grid columns: ${columns}`).toBe(1);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390 + 1);
    await noHorizontalOverflow(page);
  });

  test("a very long project name wraps instead of pushing the page wide", async ({ page, request }) => {
    const name = "Averyveryverylongprojectnamewithoutanyspacesatalltoexerciseoverflowhandling";
    const created = await request.post(`${h.baseUrl}/api/projects`, { data: { id: "overflow-check", key: "OVF", name, stage: "Discovery", description: "x".repeat(300), tier: null, committee: null, repos: [{ name: "repo-with-a-very-long-name-that-goes-on-and-on", url: "github.com/org/repo-with-a-very-long-name-that-goes-on-and-on" }], team: [], targets: { fte: 10, time: 10 } }, headers: { "x-valueflow-role": "admin" } });
    expect(created.ok(), await created.text()).toBeTruthy();
    await page.goto("/#/project/overflow-check/overview");
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.goto("/#/portfolio");
    await noHorizontalOverflow(page);
    await request.delete(`${h.baseUrl}/api/projects/overflow-check`, { headers: { "x-valueflow-role": "admin" } });
  });
});
