import { expect, test } from "@playwright/test";

test("several workspaces: blank new one, switch, survive reload, delete for good", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("process-mapper"));
  await page.reload();

  const wsButton = page.getByTestId("workspace-switcher");
  const items = page.getByRole("menuitemradio");
  const status = page.getByTestId("save-status");

  // Name the first workspace and give it a party and a step.
  await wsButton.click();
  await page.getByLabel("Workspace name").fill("Finance");
  await page.keyboard.press("Enter");
  await expect(wsButton).toHaveText(/Finance/);
  await page.getByTestId("add-step").click();
  await page.getByLabel("Step name").nth(0).fill("Raise invoice");
  await page.getByLabel("Owner").nth(0).fill("Accounts");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Parties" })).toContainText("1");

  // A new workspace is completely blank: no steps, no parties.
  await wsButton.click();
  await page.getByRole("menuitem", { name: "New blank workspace" }).click();
  await expect(wsButton).toHaveText(/Untitled workspace/);
  await expect(page.getByLabel("Step name")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Parties" })).toContainText("0");
  await page.getByTestId("add-step").click();
  await page.getByLabel("Step name").nth(0).fill("Blank side step");
  await expect(status).toHaveText(/Saved/);

  // Both are listed; the first is still whole when switched back to.
  await wsButton.click();
  await expect(items).toHaveText(["Finance", "Untitled workspace"]);
  await items.filter({ hasText: "Finance" }).click();
  await expect(page.getByLabel("Step name")).toHaveValue("Raise invoice");
  await expect(page.getByLabel("Owner").nth(0)).toHaveValue("Accounts");

  // A reload reopens the workspace that was open and keeps the other.
  await page.reload();
  await expect(wsButton).toHaveText(/Finance/);
  await expect(page.getByLabel("Step name")).toHaveValue("Raise invoice");
  await wsButton.click();
  await expect(items).toHaveText(["Finance", "Untitled workspace"]);

  // Deleting asks first, then removes the workspace for good and opens the other.
  await page.getByRole("menuitem", { name: "Delete this workspace…" }).click();
  const dlg = page.getByRole("alertdialog", { name: "Delete workspace" });
  await expect(dlg).toContainText("cannot be undone");
  await dlg.getByRole("button", { name: "Cancel" }).click();
  await expect(wsButton).toHaveText(/Finance/);
  await wsButton.click();
  await page.getByRole("menuitem", { name: "Delete this workspace…" }).click();
  await dlg.getByRole("button", { name: "Delete workspace" }).click();
  await expect(wsButton).toHaveText(/Untitled workspace/);
  await expect(page.getByLabel("Step name")).toHaveValue("Blank side step");
  await wsButton.click();
  await expect(items).toHaveText(["Untitled workspace"]);
  await page.keyboard.press("Escape");

  await page.reload();
  await wsButton.click();
  await expect(items).toHaveText(["Untitled workspace"]);
  await page.keyboard.press("Escape");

  // Deleting the last workspace leaves a fresh empty one.
  await wsButton.click();
  await page.getByRole("menuitem", { name: "Delete this workspace…" }).click();
  await dlg.getByRole("button", { name: "Delete workspace" }).click();
  await expect(page.getByLabel("Step name")).toHaveCount(0);
  await wsButton.click();
  await expect(items).toHaveText(["Untitled workspace"]);

  expect(errors).toEqual([]);
});
