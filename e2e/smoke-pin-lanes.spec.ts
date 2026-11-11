import { expect, test } from "@playwright/test";

test("pinned lane titles stay at the edge of the map while it is panned", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto("/");
  await page.getByTestId("add-step").click();
  await page.getByLabel("Step name").first().fill("Receive order");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Sales");
  await page.keyboard.press("Enter");
  const map = page.getByTestId("map");
  await expect(map.locator("[data-lane-id]")).toHaveCount(1);
  const pin = page.getByRole("button", { name: "Pin lanes" });
  const pinned = map.locator("[data-pinned-lane]");
  const box = (await map.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // Pan so the lane's title is off the left edge but half the lane is still in view.
  const lane = map.locator("[data-lane-id] rect").first();
  const l0 = (await lane.boundingBox())!;
  const dx = Math.round(l0.x - box.x + l0.width / 2);
  // Off by default: panning the title out of view leaves nothing behind.
  await page.mouse.wheel(dx, 0);
  await expect(pinned).toHaveCount(0);

  // On: the title sits at the map's left edge once its own band has scrolled off.
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await expect(pinned).toHaveCount(1);
  await expect(pinned.locator("text")).toHaveText("Sales");
  const band = (await pinned.locator("rect").first().boundingBox())!;
  expect(band.x).toBeCloseTo(box.x, 0);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });

  // Panning back brings the real title into view and the pinned copy goes away.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(-dx, 0);
  await expect(pinned).toHaveCount(0);

  // Vertical flow pins the titles to the top edge instead.
  await page.getByRole("button", { name: "Toggle orientation" }).click();
  await expect(map.locator("[data-lane-id]")).toHaveCount(1);
  const l1 = (await lane.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, Math.round(l1.y - box.y + l1.height / 2));
  await expect(pinned).toHaveCount(1);
  const top = (await pinned.locator("rect").first().boundingBox())!;
  expect(top.y).toBeCloseTo(box.y, 0);

  // The setting is remembered.
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByRole("button", { name: "Pin lanes" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(errors).toEqual([]);
});
