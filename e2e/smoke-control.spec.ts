import { expect, test } from "@playwright/test";

test("tick a step as having a control, give it a reference, see it on the map", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1700, height: 800 });
  await page.goto("/");
  await page.getByTestId("add-step").click();
  await page.getByLabel("Step name").first().fill("Reconcile ledger");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Finance");
  await page.keyboard.press("Enter");
  const map = page.getByTestId("map");
  const ref = page.getByLabel("Control reference").first();
  await expect(ref).toBeDisabled();
  await expect(map.locator("[data-control]")).toHaveCount(0);
  await page.getByLabel("Has a control").first().check();
  await expect(map.locator("[data-control] text")).toHaveText("Control");
  await ref.fill("FIN-012");
  await expect(map.locator("[data-control] text")).toHaveText("Control · FIN-012");
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  // Unticking clears the reference; undo brings both back.
  await page.getByLabel("Has a control").first().uncheck();
  await expect(map.locator("[data-control]")).toHaveCount(0);
  await expect(ref).toHaveValue("");
  await page.keyboard.press("Control+z");
  await expect(map.locator("[data-control] text")).toHaveText("Control · FIN-012");
  expect(errors).toEqual([]);
});
