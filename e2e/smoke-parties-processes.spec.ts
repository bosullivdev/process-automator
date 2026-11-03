import { expect, test } from "@playwright/test";

test("party registry and process actions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("process-mapper"));
  await page.reload();

  await page.getByTestId("add-step").click();
  await page.getByLabel("Step name").nth(0).fill("A");
  await page.getByLabel("Owner").nth(0).fill("Sales");
  await page.keyboard.press("Enter");
  await page.getByLabel("Step name").nth(0).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Step name").nth(1).fill("B");
  await page.getByLabel("Owner").nth(1).fill("Finance");
  await page.keyboard.press("Enter");

  // open sheet
  await page.getByRole("button", { name: "Parties" }).click();
  const sheet = page.getByRole("dialog", { name: "Parties" });
  await expect(sheet.locator("[data-party-id]")).toHaveCount(2);

  // rename is workspace-wide
  await sheet.getByLabel("Rename Sales").fill("Sales Team");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Owner").nth(0)).toHaveValue("Sales Team");

  // delete blocked while referenced
  await sheet.getByLabel("Delete Finance").click();
  await expect(sheet.getByText(/is used in/)).toBeVisible();

  // merge Finance into Sales Team
  await sheet.getByRole("button", { name: "Merge instead" }).click();
  await sheet
    .getByLabel("Merge Finance into", { exact: true })
    .selectOption({ label: "Sales Team" });
  await expect(sheet.locator("[data-party-id]")).toHaveCount(1);
  await expect(page.getByLabel("Owner").nth(1)).toHaveValue("Sales Team");

  // add unused party, then delete it
  await sheet.getByLabel("New party name").fill("Legal");
  await sheet.getByRole("button", { name: "Add" }).click();
  await expect(sheet.getByRole("heading", { name: "Unused" })).toBeVisible();
  await sheet.getByLabel("Delete Legal").click();
  await expect(sheet.locator("[data-party-id]")).toHaveCount(1);
  await sheet.getByRole("button", { name: "Close" }).click();

  // processes: add, rename, duplicate, delete
  const switcher = page.getByTestId("process-switcher");
  await switcher.getByRole("button", { name: "Add process" }).click();
  await expect(switcher.getByLabel("Active process")).toHaveValue(/.+/);
  await expect(page.getByLabel("Step name")).toHaveCount(0);
  await switcher.getByRole("button", { name: "Process details" }).click();
  await page.getByLabel("Process name").fill("Onboarding");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(switcher.getByLabel("Active process").locator("option:checked")).toHaveText(
    "Onboarding",
  );
  await expect(switcher.getByLabel("Active process").locator("option")).toHaveCount(2);

  await switcher.getByLabel("Active process").selectOption({ label: "Process 1" });
  await expect(page.getByLabel("Step name")).toHaveCount(2);
  await switcher.getByRole("button", { name: "Duplicate process" }).click();
  await expect(switcher.getByLabel("Active process").locator("option:checked")).toHaveText(
    "Process 1 (copy)",
  );
  await expect(page.getByLabel("Step name")).toHaveCount(2);

  await switcher.getByRole("button", { name: "Delete process" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(switcher.getByLabel("Active process").locator("option")).toHaveCount(2);

  expect(errors).toEqual([]);
});
