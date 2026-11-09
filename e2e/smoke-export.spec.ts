import { expect, test } from "@playwright/test";
import fs from "node:fs";

test("export svg/json and import with replace confirm", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("process-mapper"));
  await page.reload();
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByRole("note")).toHaveCount(0);

  await page.getByTestId("add-step").click();
  await page.getByLabel("Step name").nth(0).fill("Receive order");
  await page.getByLabel("Owner").nth(0).fill("Sales");
  await page.keyboard.press("Enter");
  await page.getByLabel("Step type").nth(0).selectOption("start");
  await page.getByLabel("Step name").nth(0).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Step name").nth(1).fill("Archive");
  await page.getByLabel("Step type").nth(1).selectOption("end");
  await page.getByLabel("Next steps").nth(0).click();
  await page.getByRole("option", { name: /Archive/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("map").locator("[data-node-id]")).toHaveCount(2);
  await expect(page.getByTestId("save-status")).toHaveText(/Saved/);

  // SVG export
  const [svgDl] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Export" })
      .click()
      .then(() => page.getByRole("menuitem", { name: "Map as SVG" }).click()),
  ]);
  const svgPath = await svgDl.path();
  const svg = fs.readFileSync(svgPath!, "utf8");
  expect(svgDl.suggestedFilename()).toMatch(/^Process-1-\d{4}-\d{2}-\d{2}\.svg$/);
  expect(svg).toContain("Receive");
  expect(svg).toContain("Archive");
  expect(svg).toContain("Sales");
  expect(svg).toContain("@font-face");
  expect(svg).not.toContain("var(--");

  // PNG export
  const [pngDl] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Export" })
      .click()
      .then(() => page.getByRole("menuitem", { name: "Map as PNG (2x)" }).click()),
  ]);
  expect(pngDl.suggestedFilename()).toMatch(/\.png$/);
  expect(fs.statSync((await pngDl.path())!).size).toBeGreaterThan(1000);

  // PDF export
  const [pdfDl] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    page
      .getByRole("button", { name: "Export" })
      .click()
      .then(() => page.getByRole("menuitem", { name: "Map as PDF" }).click()),
  ]);
  const pdfBytes = fs.readFileSync((await pdfDl.path())!);
  expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdfBytes.toString("latin1")).toContain("Inter");

  // Visio export: a zip package whose page names the steps.
  const [vsdxDl] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Export" })
      .click()
      .then(() => page.getByRole("menuitem", { name: "Map as Visio (.vsdx)" }).click()),
  ]);
  expect(vsdxDl.suggestedFilename()).toMatch(/.vsdx$/);
  const vsdxBytes = fs.readFileSync((await vsdxDl.path())!);
  expect(vsdxBytes.subarray(0, 2).toString()).toBe("PK");
  expect(vsdxBytes.toString("latin1")).toContain("visio/pages/page1.xml");

  // JSON export
  const [jsonDl] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Export" })
      .click()
      .then(() => page.getByRole("menuitem", { name: "Workspace JSON" }).click()),
  ]);
  const jsonPath = (await jsonDl.path())!;
  const exported = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  expect(exported.schemaVersion).toBe(1);
  expect(exported.processes[0].steps).toHaveLength(2);

  // Import into a non-empty workspace asks to replace
  exported.meta.name = "Imported WS";
  exported.processes[0].name = "Imported process";
  const importPath = jsonPath + ".import.json";
  fs.writeFileSync(importPath, JSON.stringify(exported));
  await page.getByLabel("Import workspace file").setInputFiles(importPath);
  const dlg = page.getByRole("alertdialog", { name: "Replace workspace" });
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByTestId("process-switcher").getByLabel("Active process").locator("option:checked"),
  ).toHaveText("Process 1");
  await page.getByLabel("Import workspace file").setInputFiles(importPath);
  await dlg.getByRole("button", { name: "Replace" }).click();
  await expect(
    page.getByTestId("process-switcher").getByLabel("Active process").locator("option:checked"),
  ).toHaveText("Imported process");

  // Invalid file is rejected with a readable message
  const badPath = jsonPath + ".bad.json";
  fs.writeFileSync(badPath, JSON.stringify({ schemaVersion: 7 }));
  await page.getByLabel("Import workspace file").setInputFiles(badPath);
  await expect(page.getByRole("status").filter({ hasText: "Import failed" })).toContainText(
    "Unsupported schemaVersion 7",
  );

  expect(errors).toEqual([]);
});
