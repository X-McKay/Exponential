import { expect, test } from "@playwright/test";
import { readHarness } from "../harness.ts";

const h = readHarness();
const p = h.seed.state.projects[0]!;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
type Live = { projects: { id: string; template?: { id: string; version: number | null } | null }[]; templates: { id: string; name: string }[]; templateVersions: { templateId: string; version: number }[]; proposals: { id: string; proj: string | null; state: string; action: { type: string; name?: string }; evidence?: { source: string | null; quote: string | null; verified: boolean } | null }[] };

test.describe("template drift", () => {
  test("a project created from a template starts aligned; a new required item in the template is staged for every follower and lands as Missing once accepted", async ({ page, request }) => {
    const admin = { headers: { "x-valueflow-role": "admin" } };
    // Earlier specs may have renamed a template; read the live one the project follows.
    const live = await (await request.get(`${h.baseUrl}/api/state`)).json() as Live;
    const template = live.templates.find((t) => t.id === live.projects.find((x) => x.id === p.id)?.template?.id)!;
    const versionBefore = Math.max(1, ...live.templateVersions.filter((v) => v.templateId === template.id).map((v) => v.version));
    await page.goto(`/#/project/${p.id}/governance`);
    const card = page.getByRole("region", { name: "Required by template" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Every required item is present");
    await expect(card).toContainText(template.name);

    // Edit the template on the Data page: one more required document.
    await page.goto("/#/data");
    await page.locator("div").filter({ hasText: /^Project templates/ }).getByRole("button", { name: "Edit JSON" }).click();
    const dialog = page.getByRole("dialog");
    const editor = dialog.locator("textarea");
    const doc = JSON.parse(await editor.inputValue()) as { id: string; documents: unknown[] }[];
    const edited = doc.map((t) => (t.id === template.id ? { ...t, documents: [...t.documents, { cat: "AI governance", name: "Browser bias review", detail: "Checked before any rollout, per the browser suite.", required: true }] } : t));
    await editor.fill(JSON.stringify(edited, null, 2));
    await dialog.getByRole("button", { name: /Save/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(new RegExp(`${escape(template.name)} v${versionBefore + 1}`))).toBeVisible();
    await expect(page.getByText(/of \d+ missing required items/)).toBeVisible();

    // Every project following the template now waits on the same item.
    const state = await (await request.get(`${h.baseUrl}/api/state`)).json() as Live;
    const followers = state.projects.filter((x) => x.template?.id === template.id).map((x) => x.id);
    const staged = state.proposals.filter((x) => x.state === "pending" && x.action.type === "governance_item" && x.action.name === "Browser bias review");
    expect(staged.map((x) => x.proj).sort()).toEqual(followers.sort());
    expect(staged[0]?.evidence).toEqual({ source: `template:${template.id}`, quote: "Checked before any rollout, per the browser suite.", verified: true });

    // The governance page says the item is waiting, and that the template moved on since the project was created.
    await page.goto(`/#/project/${p.id}/governance`);
    await expect(card).toContainText("1 required item missing");
    await expect(card.getByText(/template changed since v\d+/)).toBeVisible();
    const row = card.locator(".vf-drift-row").filter({ hasText: "Browser bias review" });
    await expect(row).toContainText("Waiting in the inbox");
    await row.getByRole("button", { name: "Review ↗" }).click();
    await expect(page).toHaveURL(/#\/inbox$/);

    // In the inbox: a new-record diff with the template named as the source, then keyboard triage with focus following the selection.
    const proposal = page.locator(`#proposal-${staged.find((x) => x.proj === p.id)!.id}`);
    await expect(proposal).toContainText("New record");
    await expect(proposal).toContainText(`Required by the ${template.name} template`);
    await expect(proposal.getByRole("columnheader", { name: "Proposed" })).toBeVisible();
    await expect(proposal.getByRole("rowheader", { name: "Name" })).toBeVisible();
    await page.locator("main").click({ position: { x: 10, y: 10 } });
    await page.keyboard.press("j");
    await expect(page.locator(".vf-proposal button.vf-row:focus")).toHaveCount(1);
    await page.keyboard.press("k");
    await expect(page.locator(".vf-proposal button.vf-row:focus")).toHaveCount(1);
    await expect(page.locator(".vf-proposal button.vf-row").first()).toBeFocused();
    await proposal.getByRole("button", { name: "Apply change" }).click();
    await expect(page.getByText(/^Applied:/).first()).toBeVisible();
    await page.goto(`/#/project/${p.id}/governance`);
    await expect(card).toContainText("Every required item is present");
    await expect(page.getByText("Browser bias review").first()).toBeVisible();

    // Leave the inbox as it was for the specs that follow.
    const rest = (await (await request.get(`${h.baseUrl}/api/state`)).json() as { proposals: { id: string; state: string }[] }).proposals.filter((x) => x.state === "pending");
    for (const x of rest) await request.post(`${h.baseUrl}/api/proposals/${x.id}/dismiss`, admin);
  });

  test("a project without a template can be linked from the governance page and checked at once", async ({ page, request }) => {
    const admin = { headers: { "x-valueflow-role": "admin" } };
    const created = await request.post(`${h.baseUrl}/api/projects`, { data: { id: "drift-check", key: "DRF", name: "Drift check", stage: "Discovery", description: "", tier: null, committee: null, repos: [], team: [], targets: { fte: 10, time: 10 } }, ...admin });
    expect(created.ok(), await created.text()).toBeTruthy();
    await page.goto("/#/project/drift-check/governance");
    const card = page.getByRole("region", { name: "Required by template" });
    await expect(card).toContainText("follows no template");
    await card.getByLabel("Follow template").selectOption("minimal");
    await card.getByRole("button", { name: "Link and check" }).click();
    await expect(card).toContainText(/\d+ required items? missing/);
    await expect(card.locator(".vf-drift-row").first()).toContainText("Waiting in the inbox");
    const state = await (await request.get(`${h.baseUrl}/api/state`)).json() as Live;
    expect(state.projects.find((x) => x.id === "drift-check")?.template).toEqual({ id: "minimal", version: Math.max(...state.templateVersions.filter((v) => v.templateId === "minimal").map((v) => v.version)) });
    for (const x of state.proposals.filter((y) => y.state === "pending" && y.proj === "drift-check")) await request.post(`${h.baseUrl}/api/proposals/${x.id}/dismiss`, admin);
    await request.delete(`${h.baseUrl}/api/projects/drift-check`, admin);
  });
});
