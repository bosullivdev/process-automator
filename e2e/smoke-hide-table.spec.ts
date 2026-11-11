import { expect, test } from "@playwright/test";

test("hide the table so the map fills the window, and bring it back", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto("/");
  await page.getByTestId("add-step").click();
  await page.getByLabel("Step name").first().fill("Receive order");
  const map = page.getByTestId("map");
  const toggle = page.getByTestId("toggle-left-pane");
  const split = (await map.boundingBox())!;
  expect(split.width).toBeLessThan(1400 * 0.85);

  await toggle.click();
  await expect(page.getByLabel("Step name")).toHaveCount(0);
  const full = (await map.boundingBox())!;
  expect(full.x).toBe(0);
  expect(full.width).toBe(1400);
  await expect(map.locator("[data-node-id]")).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-label", "Show table");
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });

  // The choice is remembered across a reload.
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByLabel("Step name")).toHaveCount(0);

  // Ctrl+\ brings the table back with the step still there.
  await page.keyboard.press("Control+\\");
  await expect(page.getByLabel("Step name").first()).toHaveValue("Receive order");
  await expect(toggle).toHaveAttribute("aria-label", "Hide table");

  // Narrow screens keep their Table / Map tabs regardless.
  await toggle.click();
  await page.setViewportSize({ width: 800, height: 800 });
  await expect(page.getByRole("button", { name: "Table", exact: true })).toBeVisible();
  await expect(page.getByLabel("Step name").first()).toBeVisible();
  expect(errors).toEqual([]);
});
