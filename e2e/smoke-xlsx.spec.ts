import { expect, test } from "@playwright/test";

test("the Export menu produces an Excel workbook of the map", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Keep hold of the exported blob so the test can read it without a download.
  await page.addInitScript(() => {
    const w = window as unknown as { __blobs: Blob[] };
    w.__blobs = [];
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b: Blob | MediaSource) => {
      if (b instanceof Blob) w.__blobs.push(b);
      return create(b);
    };
  });
  await page.goto("/");
  await page.getByTestId("add-step").click();
  await page.getByLabel("Step name").first().fill("Receive order");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Sales");
  await page.keyboard.press("Enter");
  await page.getByTestId("map").locator("[data-node-id]").first().waitFor();

  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: "Map as Excel (.xlsx)" }).click();
  await page.waitForFunction(
    () =>
      (window as unknown as { __blobs: Blob[] }).__blobs.some((b) =>
        b.type.includes("spreadsheetml"),
      ),
    undefined,
    { timeout: 20000 },
  );
  const head = await page.evaluate(async () => {
    const blob = (window as unknown as { __blobs: Blob[] }).__blobs.find((b) =>
      b.type.includes("spreadsheetml"),
    )!;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { size: bytes.length, magic: String.fromCharCode(bytes[0], bytes[1]) };
  });
  // A zip package of a sensible size.
  expect(head.magic).toBe("PK");
  expect(head.size).toBeGreaterThan(1500);
  expect(errors).toEqual([]);
});
