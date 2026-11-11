import { expect, test } from "@playwright/test";

test("the PDF export sets every text run in the app's fonts, never a built-in fallback", async ({
  page,
}) => {
  const warnings: string[] = [];
  page.on("console", (m) => {
    if (/Unable to look up font/.test(m.text())) warnings.push(m.text());
  });
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
  // Regular, medium, semi-bold, italic and mono text all appear on this map.
  await page.getByLabel("Step name").first().fill("Approve?");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Sales");
  await page.keyboard.press("Enter");
  await page.getByLabel("Step type").first().selectOption("decision");
  await page.getByLabel("Technology").first().fill("Oracle");
  await page.getByLabel("Has a control").first().check();
  await page.getByTestId("map").locator("[data-control]").waitFor();

  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: "Map as PDF" }).click();
  await page.waitForFunction(
    () => (window as unknown as { __blobs: Blob[] }).__blobs.some((b) => b.type.includes("pdf")),
    undefined,
    { timeout: 30000 },
  );
  const pdf = await page.evaluate(async () => {
    const blob = (window as unknown as { __blobs: Blob[] }).__blobs.find((b) =>
      b.type.includes("pdf"),
    )!;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return s;
  });
  expect(pdf.startsWith("%PDF-")).toBe(true);
  // jsPDF numbers its 14 built-in fonts F1 to F14 (Helvetica, Courier, Times,
  // ...); embedded fonts come after. No text may select a built-in one.
  const selected = [...new Set((pdf.match(/\/F\d+ [\d.]+ Tf/g) ?? []).map((m) => m.split(" ")[0]))];
  expect(selected.length).toBeGreaterThan(1);
  for (const f of selected) expect(Number(f.slice(2)), `font ${f}`).toBeGreaterThan(14);
  expect(warnings).toEqual([]);
  // Only the faces in use are embedded, so the file stays small.
  expect(pdf.length).toBeLessThan(900_000);
});
