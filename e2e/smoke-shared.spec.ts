import { expect, test } from "@playwright/test";

test("a step given two teams is copied into both lanes with the same links", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("process-mapper"));
  await page.reload();

  // start (Sales) -> review (Sales) -> end (Sales)
  await page.getByTestId("add-step").click();
  await page.getByLabel("Step name").nth(0).fill("Receive contract");
  await page.getByLabel("Owner").nth(0).fill("Sales");
  await page.keyboard.press("Enter");
  await page.getByLabel("Step type").nth(0).selectOption("start");
  await page.getByLabel("Step name").nth(0).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Step name").nth(1).fill("Review contract");
  await page.getByLabel("Step name").nth(1).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Step name").nth(2).fill("Signed");
  await page.getByLabel("Step type").nth(2).selectOption("end");
  await page.getByLabel("Next steps").nth(0).click();
  await page.getByRole("option", { name: /Review contract/ }).click();
  await page.keyboard.press("Escape");
  await page.getByLabel("Next steps").nth(1).click();
  await page.getByRole("option", { name: /Signed/ }).click();
  await page.keyboard.press("Escape");

  // Type two teams into the Owner cell of the review step.
  const owner = page.getByLabel("Owner").nth(1);
  await owner.fill("Sales, Legal");
  await expect(page.getByRole("option", { name: /Sales owns/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Copy to Legal \(new\)/ })).toBeVisible();
  await page.keyboard.press("Enter");

  // A copy appears right under the original, owned by Legal.
  await expect(page.getByLabel("Step name")).toHaveCount(4);
  await expect(page.getByLabel("Owner").nth(1)).toHaveValue("Sales");
  await expect(page.getByLabel("Step name").nth(2)).toHaveValue("Review contract");
  await expect(page.getByLabel("Owner").nth(2)).toHaveValue("Legal");
  await expect(page.getByLabel("Next steps").nth(2)).toContainText("Signed");
  await expect(page.getByLabel("Next steps").nth(0)).toContainText("Review contract");
  await expect(page.getByRole("status")).toContainText("Copied step 2 to Legal (step 4)");

  // Map: two lanes, four nodes, fork from start and join into the end.
  const map = page.getByTestId("map");
  await expect(map.locator("[data-lane-id]")).toHaveCount(2);
  await expect(map.locator("[data-node-id]")).toHaveCount(4);
  await expect(map.locator("[data-edge-id]")).toHaveCount(4);
  await expect(map.getByText("Legal")).toBeVisible();

  // The "Also X" option shares with an existing party.
  await page.getByLabel("Owner").nth(0).fill("Legal");
  await page.getByRole("option", { name: /Also Legal/ }).click();
  await expect(page.getByLabel("Step name")).toHaveCount(5);
  await expect(page.getByLabel("Owner").nth(0)).toHaveValue("Sales");
  await expect(page.getByLabel("Owner").nth(1)).toHaveValue("Legal");
  await expect(page.getByLabel("Step name").nth(1)).toHaveValue("Receive contract");

  // One undo reverts the whole share.
  await page.getByRole("button", { name: "Undo" }).first().click();
  await expect(page.getByLabel("Step name")).toHaveCount(4);
  expect(errors).toEqual([]);
});
