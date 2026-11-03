import { expect, test } from "@playwright/test";

test("map renders lanes, syncs selection and flips orientation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("process-mapper"));
  await page.reload();

  // start (Sales) -> task (Ops) -> end (Ops)
  await page.getByTestId("add-step").click();
  await page.getByLabel("Step name").nth(0).fill("Receive order");
  await page.getByLabel("Owner").nth(0).fill("Sales");
  await page.keyboard.press("Enter");
  await page.getByLabel("Step type").nth(0).selectOption("start");
  await page.getByLabel("Step name").nth(0).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Step name").nth(1).fill("Pick items");
  await page.getByLabel("Owner").nth(1).fill("Ops");
  await page.keyboard.press("Enter");
  await page.getByLabel("Step name").nth(1).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Step name").nth(2).fill("Done");
  await page.getByLabel("Step type").nth(2).selectOption("end");
  // links
  await page.getByLabel("Next steps").nth(0).click();
  await page.getByRole("option", { name: /Pick items/ }).click();
  await page.keyboard.press("Escape");
  await page.getByLabel("Next steps").nth(1).click();
  await page.getByRole("option", { name: /Done/ }).click();
  await page.keyboard.press("Escape");

  const map = page.getByTestId("map");
  await expect(map.locator("[data-lane-id]")).toHaveCount(2);
  await expect(map.locator("[data-node-id]")).toHaveCount(3);
  await expect(map.locator("[data-edge-id]")).toHaveCount(2);
  await expect(map.getByText("Sales")).toBeVisible();
  await expect(map.getByText("Ops")).toBeVisible();
  await expect(map.locator("tspan", { hasText: "Pick items" })).toBeVisible();

  // selection: map -> table
  await map.locator("[data-node-id]").nth(1).click();
  await expect(page.locator("tr[data-selected='true']")).toHaveCount(1);
  await expect(page.locator("tr[data-selected='true']").getByLabel("Step name")).toHaveValue(
    "Pick items",
  );

  // lanes stacked vertically in horizontal mode
  const lanesH = await map
    .locator("[data-lane-id] > rect")
    .evaluateAll((els) =>
      els.map((e) => ({ x: Number(e.getAttribute("x")), y: Number(e.getAttribute("y")) })),
    );
  expect(lanesH[0].x).toBe(lanesH[1].x);
  expect(lanesH[0].y).toBeLessThan(lanesH[1].y);

  await page.getByRole("button", { name: "Toggle orientation" }).click();
  await expect(page.getByRole("button", { name: "Toggle orientation" })).toHaveText("Vertical");
  await page.waitForTimeout(400);
  const lanesV = await map
    .locator("[data-lane-id] > rect")
    .evaluateAll((els) =>
      els.map((e) => ({ x: Number(e.getAttribute("x")), y: Number(e.getAttribute("y")) })),
    );
  expect(lanesV[0].y).toBe(lanesV[1].y);
  expect(lanesV[0].x).toBeLessThan(lanesV[1].x);

  // keyboard lane reorder
  await map.getByRole("button", { name: /Lane Sales/ }).focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  const order = await map
    .locator("[data-lane-id]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-lane-id")));
  const salesIdx = order.findIndex((id) => id !== null);
  expect(salesIdx).toBe(0);
  await expect(map.locator("[data-lane-id]").nth(0).locator("text")).toHaveText("Ops");

  expect(errors).toEqual([]);
});
