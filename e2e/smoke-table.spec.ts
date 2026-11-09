import { expect, test } from "@playwright/test";

test("table keyboard flow", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.getByTestId("add-step").click();
  const name = page.getByLabel("Step name").first();
  await expect(name).toBeFocused();
  await name.fill("Receive order");
  await page.keyboard.press("Tab"); // owner
  await page.keyboard.type("Sales");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Owner").first()).toHaveValue("Sales");
  await page.getByLabel("Step name").first().focus();
  await page.keyboard.press("Enter"); // new row
  await expect(page.getByLabel("Step name")).toHaveCount(2);
  await expect(page.getByLabel("Step name").nth(1)).toBeFocused();
  await page.getByLabel("Step name").nth(1).fill("Check stock");
  // owner should be inherited (Sales)
  await expect(page.getByLabel("Owner").nth(1)).toHaveValue("Sales");
  // near match prompt
  await page.getByLabel("Owner").nth(1).fill("Sale");
  await expect(page.getByRole("option", { name: "Use Sales?" })).toBeVisible();
  await page.keyboard.press("Escape");
  // next picker on row 1
  await page.getByLabel("Next steps").first().click();
  await page.getByRole("option", { name: /Check stock/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Next steps").first()).toContainText("Check stock");
  // set row 1 type start, row 2 decision with labelled outcome via create new step
  await page.getByLabel("Step type").first().selectOption("start");
  await page.getByLabel("Step type").nth(1).selectOption("decision");
  await page.getByLabel("Next steps").nth(1).click();
  await page.getByRole("option", { name: /Create new step/ }).click();
  await expect(page.getByLabel("Step name")).toHaveCount(3);
  await expect(page.getByLabel("Step name").nth(2)).toBeFocused();
  // undo
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(100);
  // delete with toast undo
  await page.getByLabel(/^Step 1[.,]/).click();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("status")).toContainText("Deleted step 1");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByLabel("Step name").first()).toHaveValue("Receive order");
  // persisted after reload
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByLabel("Step name").first()).toHaveValue("Receive order");
  expect(errors).toEqual([]);
});

test("column widths resize by drag and keyboard, reset on double-click, and persist", async ({
  page,
}) => {
  await page.goto("/");
  const col = page.locator("colgroup col").nth(1);
  const handle = page.locator("th", { hasText: "Name" }).getByRole("separator");
  const before = await col.evaluate((el) => parseFloat((el as HTMLElement).style.width));

  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(col).toHaveCSS("width", `${before + 80}px`);

  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(col).toHaveCSS("width", `${before + 80 - 16}px`);

  await page.reload();
  await expect(page.locator("colgroup col").nth(1)).toHaveCSS("width", `${before + 64}px`);

  await page.locator("th", { hasText: "Name" }).getByRole("separator").dblclick();
  await expect(page.locator("colgroup col").nth(1)).toHaveCSS("width", `${before}px`);
});
