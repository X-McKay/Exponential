import { expect, test } from "@playwright/test";
import { readHarness } from "../harness.ts";

const h = readHarness();

test.describe("agent economics", () => {
  test("the economics section totals spend and outcomes and regroups by agent, project, and template", async ({ page, request }) => {
    const live = await (await request.get(`${h.baseUrl}/api/state`)).json() as { projects: { id: string; template?: { id: string } | null }[]; templates: { id: string; name: string }[] };
    const followed = live.templates.find((t) => t.id === live.projects.find((x) => x.id === h.seed.state.projects[0]!.id)?.template?.id)!;
    await page.goto("/#/agents/economics");
    await expect(page.getByRole("tab", { name: "Economics" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Accepted changes", { exact: true })).toBeVisible();
    await expect(page.getByText("Cost per accepted change", { exact: true })).toBeVisible();
    const byAgent = page.getByRole("region", { name: "By agent" });
    await expect(byAgent).toBeVisible();
    // The drift spec staged and decided template proposals through the setup agent, so it has outcomes to show.
    const setup = byAgent.getByRole("row").filter({ hasText: /Setup/ });
    await expect(setup).toBeVisible();
    await expect(setup.getByRole("cell").nth(3)).toContainText(/\d+/);
    await page.getByRole("button", { name: "By project" }).click();
    const byProject = page.getByRole("region", { name: "By project" });
    await expect(byProject).toBeVisible();
    await expect(byProject.getByRole("rowheader", { name: h.seed.state.projects[0]!.name })).toBeVisible();
    await page.getByRole("button", { name: "By template" }).click();
    await expect(page.getByRole("region", { name: "By template" }).getByRole("rowheader", { name: followed.name })).toBeVisible();
    await expect(page.getByRole("button", { name: "By template" })).toHaveAttribute("aria-pressed", "true");
    // Jump to the section through the palette.
    await page.goto("/#/glance");
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Jump to" }).fill("economics");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/agents\/economics$/);
  });
});
