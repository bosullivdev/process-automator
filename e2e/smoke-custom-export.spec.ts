import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

/** Bytes of the first captured blob of a type, once it exists. */
async function blobBytes(page: Page, type: string): Promise<Uint8Array> {
  await page.waitForFunction(
    (t) => (window as unknown as { __blobs: Blob[] }).__blobs.some((b) => b.type.includes(t)),
    type,
    { timeout: 30000 },
  );
  const bytes = await page.evaluate(async (t) => {
    const blob = (window as unknown as { __blobs: Blob[] }).__blobs.find((b) =>
      b.type.includes(t),
    )!;
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, type);
  return new Uint8Array(bytes);
}

test("custom export: every map in one Visio file, then a map per team as a zip", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Keep hold of the exported blobs so the test can read them without a download.
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
  await page.evaluate(() => indexedDB.deleteDatabase("process-mapper"));
  await page.evaluate(() => localStorage.removeItem("process-mapper:custom-export"));
  await page.reload();

  // Two processes with a step each, and two teams.
  await page.getByTestId("add-step").click();
  await page.getByLabel("Step name").first().fill("Receive order");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Sales");
  await page.keyboard.press("Enter");
  await page.getByTestId("map").locator("[data-node-id]").first().waitFor();
  await page.getByRole("button", { name: "Add process" }).click();
  await page.getByTestId("add-step").click();
  await page.getByLabel("Step name").first().fill("Close ledger");
  await page.getByTestId("map").locator("[data-node-id]").first().waitFor();
  await page.getByTestId("team-menu").click();
  await page.getByRole("menuitem", { name: "Manage teams…" }).click();
  const sheet = page.getByRole("dialog", { name: "Teams" });
  for (const name of ["North", "South"]) {
    await sheet.getByLabel("New team name").fill(name);
    await sheet.getByRole("button", { name: "Add" }).click();
    await expect(sheet.getByLabel(`Rename ${name}`)).toBeVisible();
  }
  await sheet.getByRole("button", { name: "Close" }).click();

  // Defaults: every process, whole, in one Visio file with a page each.
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: "Custom export…" }).click();
  const dialog = page.getByRole("dialog", { name: "Custom export" });
  await expect(dialog.getByLabel("Visio (.vsdx)")).toBeChecked();
  await expect(dialog.getByTestId("export-summary")).toContainText("2 maps in 1 file");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const vsdx = unzipSync(await blobBytes(page, "ms-visio"));
  expect(strFromU8(vsdx["visio/pages/page1.xml"])).toContain("Receive order");
  expect(strFromU8(vsdx["visio/pages/page2.xml"])).toContain("Close ledger");
  expect(vsdx["visio/pages/page3.xml"]).toBeUndefined();
  await expect(dialog).toBeHidden();

  // Nothing ticked that can be exported: the dialog says why and will not run.
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: "Custom export…" }).click();
  await dialog.getByLabel("Visio (.vsdx)").uncheck();
  await expect(dialog.getByTestId("export-summary")).toContainText("Tick at least one format");
  await expect(dialog.getByRole("button", { name: "Export", exact: true })).toBeDisabled();

  // A map for each team, as SVG files plus one PDF, bundled into a zip. The
  // second process is not the one on screen, so its picture is drawn off-screen.
  await dialog.getByLabel("SVG", { exact: true }).check();
  await dialog.getByLabel("PDF", { exact: true }).check();
  await dialog.getByLabel("A map for each ticked team").check();
  await dialog.getByLabel("North", { exact: true }).check();
  await dialog.getByLabel("South", { exact: true }).check();
  await expect(dialog.getByTestId("export-summary")).toContainText("4 maps in 5 files");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const zip = unzipSync(await blobBytes(page, "application/zip"));
  const names = Object.keys(zip);
  const svgs = names.filter((n) => n.endsWith(".svg"));
  expect(svgs).toHaveLength(4);
  expect(names.filter((n) => n.endsWith(".pdf"))).toHaveLength(1);
  const text = (pattern: RegExp) => strFromU8(zip[svgs.find((n) => pattern.test(n))!]);
  for (const team of ["North", "South"]) {
    const mine = svgs.filter((n) => n.includes(team)).map((n) => strFromU8(zip[n]));
    expect(mine).toHaveLength(2);
    expect(mine.some((s) => s.includes("Receive order"))).toBe(true);
    expect(mine.some((s) => s.includes("Close ledger"))).toBe(true);
    expect(mine.every((s) => s.includes(`Team: ${team} only`))).toBe(true);
  }
  expect(text(/North/)).toContain("<svg");
  const pdf = strFromU8(zip[names.find((n) => n.endsWith(".pdf"))!], true);
  expect(pdf.startsWith("%PDF")).toBe(true);
  expect(pdf).toContain("/Count 4");
  // The off-screen drawing left nothing behind: still one map on the page.
  await expect(page.getByTestId("map")).toHaveCount(1);
  expect(errors).toEqual([]);
});
