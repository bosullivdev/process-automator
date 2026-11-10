import { expect, test } from "@playwright/test";

test("a step given two parties stays one row and is drawn in both lanes", async ({ page }) => {
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
  await expect(page.getByRole("option", { name: /Also Legal \(new\)/ })).toBeVisible();
  await page.keyboard.press("Enter");

  // Still three rows; the cell names both parties.
  await expect(page.getByLabel("Step name")).toHaveCount(3);
  await expect(page.getByLabel("Owner").nth(1)).toHaveValue("Sales, Legal");
  await expect(page.getByRole("status")).toContainText("also drawn in Legal's lane");

  // Map: two lanes, the review drawn twice, fork from the start and join into the end.
  const map = page.getByTestId("map");
  await expect(map.locator("[data-lane-id]")).toHaveCount(2);
  await expect(map.locator("[data-node-id]")).toHaveCount(4);
  await expect(map.locator("[data-edge-id]")).toHaveCount(4);
  await expect(map.getByText("Legal")).toBeVisible();

  // Both copies belong to the one step.
  const stepIds = await map
    .locator("[data-node-id]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-step-id")));
  expect(new Set(stepIds).size).toBe(3);

  // The "Also X" option adds a co-owner to a step that already has an owner.
  await page.getByLabel("Owner").nth(0).fill("Legal");
  await page.getByRole("option", { name: /Also Legal/ }).click();
  await expect(page.getByLabel("Step name")).toHaveCount(3);
  await expect(page.getByLabel("Owner").nth(0)).toHaveValue("Sales, Legal");
  await expect(map.locator("[data-node-id]")).toHaveCount(5);

  // Picking one party again clears the co-owner; undo brings it back.
  await page.getByLabel("Owner").nth(0).fill("Sales");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Owner").nth(0)).toHaveValue("Sales");
  await expect(map.locator("[data-node-id]")).toHaveCount(4);
  await page.getByRole("button", { name: "Undo" }).first().click();
  await expect(page.getByLabel("Owner").nth(0)).toHaveValue("Sales, Legal");
  expect(errors).toEqual([]);
});
