import { expect, test } from "@playwright/test";

test("ctrl+wheel over the map zooms the map, not the page; plain wheel pans it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto("/");
  await page.getByTestId("add-step").click();
  await page.getByLabel("Step name").first().fill("Receive order");
  const map = page.getByTestId("map");
  const node = map.locator("[data-node-id]").first();
  await expect(node).toBeVisible();
  const box = (await map.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // The browser is told not to handle the event itself (which is what zooms the page).
  const prevented = () =>
    page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          window.addEventListener("wheel", (e) => resolve(e.defaultPrevented), { once: true });
        }),
    );

  const before = (await node.boundingBox())!;
  let handled = prevented();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  expect(await handled).toBe(true);
  await expect.poll(async () => (await node.boundingBox())!.width).toBeGreaterThan(before.width);
  const zoomed = (await node.boundingBox())!;
  // One notch is a gentle step, not a jump.
  expect(zoomed.width / before.width).toBeLessThan(1.3);

  handled = prevented();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 100);
  await page.keyboard.up("Control");
  expect(await handled).toBe(true);
  await expect.poll(async () => (await node.boundingBox())!.width).toBeCloseTo(before.width, 0);

  // Without Ctrl the wheel pans: same size, moved up.
  const y0 = (await node.boundingBox())!.y;
  await page.mouse.wheel(0, 60);
  await expect.poll(async () => (await node.boundingBox())!.y).toBeCloseTo(y0 - 60, 0);
  expect((await node.boundingBox())!.width).toBeCloseTo(before.width, 0);
});
