import { expect, test } from "@playwright/test";
import fs from "node:fs";

/**
 * The end-to-end flow required by CLAUDE.md: two parties, a start, a task, a
 * decision with three labelled outcomes and two ends; assert lanes, nodes and
 * labels; flip orientation; switch to BPMN; export SVG and check step names.
 */
test("build a process end to end", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("process-mapper"));
  await page.reload();

  // Two parties via the registry sheet.
  await page.getByRole("button", { name: "Parties" }).click();
  const sheet = page.getByRole("dialog", { name: "Parties" });
  await sheet.getByLabel("New party name").fill("Customer Service");
  await sheet.getByRole("button", { name: "Add" }).click();
  await sheet.getByLabel("New party name").fill("Finance");
  await sheet.getByRole("button", { name: "Add" }).click();
  await expect(sheet.locator("[data-party-id]")).toHaveCount(2);
  await sheet.getByRole("button", { name: "Close" }).click();

  // Steps, keyboard-first: Enter adds the next row.
  const addRow = async (index: number, name: string, owner: string, type: string) => {
    if (index === 0) await page.getByTestId("add-step").click();
    else {
      await page
        .getByLabel("Step name")
        .nth(index - 1)
        .focus();
      await page.keyboard.press("Enter");
    }
    const nameCell = page.getByLabel("Step name").nth(index);
    await expect(nameCell).toBeFocused();
    await nameCell.fill(name);
    await page.keyboard.press("Tab");
    await page.keyboard.type(owner);
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Owner").nth(index)).toHaveValue(owner);
    await page.getByLabel("Step type").nth(index).selectOption(type);
  };
  await addRow(0, "Complaint received", "Customer Service", "start");
  await addRow(1, "Review complaint", "Customer Service", "task");
  await addRow(2, "Outcome?", "Customer Service", "decision");
  await addRow(3, "Refund issued", "Finance", "end");
  await addRow(4, "Complaint rejected", "Customer Service", "end");

  const link = async (row: number, targets: string[]) => {
    await page.getByLabel("Next steps").nth(row).click();
    for (const t of targets) await page.getByRole("option", { name: new RegExp(t) }).click();
    await page.keyboard.press("Escape");
  };
  await link(0, ["Review complaint"]);
  await link(1, ["Outcome\\?"]);
  // Decision: three outcomes, the third created from the picker.
  await page.getByLabel("Next steps").nth(2).click();
  await page.getByRole("option", { name: /Refund issued/ }).click();
  await page.getByRole("option", { name: /Complaint rejected/ }).click();
  await page.getByLabel(/Label for outcome to step 4/).fill("Refund");
  await page.getByLabel(/Label for outcome to step 5/).fill("Reject");
  await page.getByLabel("Default outcome").nth(1).check();
  await page.keyboard.press("Escape");
  await page.getByLabel("Next steps").nth(2).click();
  await page.getByRole("option", { name: /Create new step/ }).click();
  // The new row (step 6) is inserted directly under the decision, owned by the same party.
  await expect(page.getByLabel("Step name").nth(3)).toBeFocused();
  await page.getByLabel("Step name").nth(3).fill("Escalate");
  await expect(page.getByLabel("Owner").nth(3)).toHaveValue("Customer Service");
  await expect(page.getByLabel(/^Step 6/)).toBeVisible();
  await page.getByLabel("Next steps").nth(2).click();
  await page.getByLabel(/Label for outcome to step 6/).fill("Escalate");
  await page.keyboard.press("Escape");
  await link(3, ["Refund issued"]);

  // Validation: everything linked, no issues.
  await expect(page.getByTestId("validation-panel")).toContainText("No issues");

  // Map: two lanes, six nodes, three labelled outcomes with a default tag.
  const map = page.getByTestId("map");
  await expect(map.locator("[data-lane-id]")).toHaveCount(2);
  await expect(map.locator("[data-node-id]")).toHaveCount(6);
  await expect(map.locator("[data-edge-id]")).toHaveCount(6);
  await expect(map.getByRole("button", { name: /Lane Customer Service/ })).toBeVisible();
  await expect(map.getByRole("button", { name: /Lane Finance/ })).toBeVisible();
  for (const label of ["Refund", "Reject", "Escalate"]) {
    await expect(
      map.locator("[data-edge-id] text").filter({ hasText: new RegExp(`^${label}$`) }),
    ).toHaveCount(1);
  }
  await expect(map.locator("[data-edge-id] text").filter({ hasText: "default" })).toHaveCount(1);

  // Flip orientation: lanes go side by side.
  await page.getByRole("button", { name: "Toggle orientation" }).click();
  await expect(page.getByRole("button", { name: "Toggle orientation" })).toHaveText("Vertical");
  await expect
    .poll(async () => {
      const r = await map
        .locator("[data-lane-id] > rect")
        .evaluateAll((els) =>
          els.map((e) => ({ x: Number(e.getAttribute("x")), y: Number(e.getAttribute("y")) })),
        );
      return r.length === 2 && r[0].y === r[1].y && r[0].x < r[1].x;
    })
    .toBe(true);

  // BPMN: exclusive gateway X and a join before the end with two incoming links.
  await page.getByRole("button", { name: "Toggle shape mode" }).click();
  await expect(page.getByRole("button", { name: "Toggle shape mode" })).toHaveText("BPMN");
  await expect(map.locator('[data-node-id^="gw:join:"]')).toHaveCount(1);
  await expect(map.locator("[data-node-id]")).toHaveCount(7);

  // Export SVG with the step names in it.
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Export" })
      .click()
      .then(() => page.getByRole("menuitem", { name: "Map as SVG" }).click()),
  ]);
  const svg = fs.readFileSync((await dl.path())!, "utf8");
  for (const name of ["Complaint", "Review complaint", "Outcome?", "Refund issued", "Escalate"]) {
    expect(svg).toContain(name.replace("?", "?"));
  }
  expect(svg).toContain("Customer Service");
  expect(svg).toContain("Finance");

  // Undo removes the last link; redo restores it.
  await page.keyboard.press("Meta+z");
  await expect(page.getByTestId("validation-panel")).not.toContainText("No issues");
  await page.keyboard.press("Shift+Meta+z");
  await expect(page.getByTestId("validation-panel")).toContainText("No issues");

  expect(errors).toEqual([]);
});
