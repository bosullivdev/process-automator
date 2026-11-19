import { expect, test } from "@playwright/test";

/** start -> Review -> Approve (North and East only) -> Done; South goes Review -> Done. */
const workspace = {
  schemaVersion: 1,
  meta: {
    name: "Compare",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  parties: [{ id: "fin", name: "Finance", colourIndex: 0 }],
  teams: [
    { id: "north", name: "North", colourIndex: 0 },
    { id: "south", name: "South", colourIndex: 1 },
    { id: "east", name: "East", colourIndex: 2 },
  ],
  processes: [
    {
      id: "p1",
      name: "Month end",
      laneOrder: ["fin"],
      steps: [
        { id: "s1", displayNo: 1, name: "Begin", type: "start", next: [{ targetId: "s2" }] },
        {
          id: "s2",
          displayNo: 2,
          name: "Review",
          type: "task",
          next: [
            { targetId: "s3", teamIds: ["north", "east"] },
            { targetId: "s4", teamIds: ["south"] },
          ],
        },
        {
          id: "s3",
          displayNo: 3,
          name: "Approve",
          type: "task",
          teamIds: ["north", "east"],
          next: [{ targetId: "s4" }],
        },
        { id: "s4", displayNo: 4, name: "Done", type: "end", next: [] },
      ].map((s) => ({
        ownerId: "fin",
        coOwnerIds: [],
        technology: "",
        contributorIds: [],
        notes: "",
        teamIds: [],
        ...s,
      })),
    },
  ],
  view: {
    orientation: "horizontal",
    shapeMode: "simple",
    theme: "light",
    splitRatio: 0.5,
    activeProcessId: "p1",
    annotations: "full",
    highlightTeamId: null,
    teamFocus: "highlight",
  },
};

test("compare teams: see how alike they are, apply a suggestion, undo it", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("process-mapper"));
  await page.reload();

  const file = testInfo.outputPath("compare.json");
  (await import("node:fs")).writeFileSync(file, JSON.stringify(workspace));
  await page.getByLabel("Import workspace file").setInputFiles(file);
  await expect(page.getByLabel("Step name").nth(2)).toHaveValue("Approve");

  await page.getByTestId("team-menu").click();
  await page.getByRole("menuitem", { name: "Compare teams…" }).click();
  const panel = page.getByTestId("compare-teams");
  await expect(panel.getByTestId("team-similarity")).toContainText("72% alike");
  await expect(panel.getByText("1 suggestion, most effective first")).toBeVisible();
  await expect(panel.getByText("Add step 3 to South")).toBeVisible();

  // The panel does not cover the table or map: the step can be looked at first.
  await panel.getByRole("button", { name: "Show step" }).click();
  await expect(page.locator('tr[data-step-id="s3"]')).toHaveAttribute("data-selected", "true");

  await panel.getByRole("button", { name: "Apply" }).click();
  await expect(panel.getByTestId("team-similarity")).toContainText("100% alike");
  await expect(panel.getByText("Every team follows the same route.")).toBeVisible();

  // One undo brings the difference, and the suggestion, back.
  await page
    .getByRole("status")
    .filter({ hasText: "Add step 3 to South" })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(panel.getByTestId("team-similarity")).toContainText("72% alike");
  await expect(panel.getByText("Add step 3 to South")).toBeVisible();

  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});
