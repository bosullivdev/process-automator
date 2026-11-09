import fs from "node:fs";
import { expect, test } from "@playwright/test";

test("team variants: tag steps, highlight, isolate and export", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("process-mapper"));
  await page.reload();

  // start -> Review -> [North only] Approve -> Done; Review -> Done for South.
  await page.getByTestId("add-step").click();
  await page.getByLabel("Step name").nth(0).fill("Start month end");
  await page.getByLabel("Owner").nth(0).fill("Management accountant");
  await page.keyboard.press("Enter");
  await page.getByLabel("Step type").nth(0).selectOption("start");
  await page.getByLabel("Step name").nth(0).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Step name").nth(1).fill("Review accruals");
  await page.getByLabel("Step name").nth(1).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Step name").nth(2).fill("Regional approval");
  await page.getByLabel("Step name").nth(2).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Step name").nth(3).fill("Done");
  await page.getByLabel("Step type").nth(3).selectOption("end");

  await page.getByLabel("Next steps").nth(0).click();
  await page.getByRole("option", { name: /Review accruals/ }).click();
  await page.keyboard.press("Escape");
  await page.getByLabel("Next steps").nth(1).click();
  await page.getByRole("option", { name: /Regional approval/ }).click();
  await page.getByRole("option", { name: /Done/ }).click();
  await page.keyboard.press("Escape");
  await page.getByLabel("Next steps").nth(2).click();
  await page.getByRole("option", { name: /Done/ }).click();
  await page.keyboard.press("Escape");

  // Tag the approval step for North (creates the team) and add South via the sheet.
  const teamsCell = page.getByLabel("Teams").nth(2);
  await teamsCell.fill("North");
  await page.getByRole("option", { name: /Create North/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Teams").nth(2).locator("..")).toContainText("North");

  await page.getByTestId("team-menu").click();
  await page.getByRole("menuitem", { name: "Manage teams…" }).click();
  const sheet = page.getByRole("dialog", { name: "Teams" });
  await sheet.getByLabel("New team name").fill("South");
  await sheet.getByRole("button", { name: "Add" }).click();
  await expect(sheet.getByLabel("Rename South")).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();

  // Scope the Review -> Done shortcut to South only.
  await page.getByLabel("Next steps").nth(1).click();
  await page.getByRole("button", { name: "Teams for link to step 4" }).click();
  await page
    .getByRole("group", { name: "Team choices for link to step 4" })
    .getByLabel("South")
    .check();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Next steps").nth(1)).toContainText("South");

  const map = page.getByTestId("map");
  await expect(map.locator("[data-node-id]")).toHaveCount(4);
  await expect(map.locator("[data-edge-id]")).toHaveCount(4);
  await expect(map.locator("text").filter({ hasText: /^North$/ })).toBeVisible();

  // Highlight South: the North-only step and its links fade, the table row dims.
  await page.getByTestId("team-menu").click();
  await page.getByRole("menuitemradio", { name: "South" }).click();
  await expect(page.getByTestId("team-menu")).toHaveText("Team: South");
  await expect(map.locator("[data-node-id][data-dimmed]")).toHaveCount(1);
  await expect(map.locator("[data-edge-id][data-dimmed]")).toHaveCount(2);
  await expect(page.locator("tr[data-in-team='false']")).toHaveCount(1);
  await expect(page.getByTestId("validation-team")).toHaveText("South");

  // Isolate South: three nodes, two edges, three rows.
  await page.getByTestId("team-menu").click();
  await page.getByRole("button", { name: "Only this team" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("team-menu")).toHaveText("Team: South only");
  await expect(map.locator("[data-node-id]")).toHaveCount(3);
  await expect(map.locator("[data-edge-id]")).toHaveCount(2);
  await expect(page.getByLabel("Step name")).toHaveCount(3);

  // A row added while isolating belongs to South.
  await page.getByLabel("Step name").nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Step name")).toHaveCount(4);
  await expect(page.getByLabel("Teams").nth(2).locator("..")).toContainText("South");
  await page.keyboard.press("Meta+z");

  // SVG export carries the team line and only the isolated steps.
  const [svgDl] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Export" })
      .click()
      .then(() => page.getByRole("menuitem", { name: "Map as SVG" }).click()),
  ]);
  expect(svgDl.suggestedFilename()).toContain("South");
  const svg = fs.readFileSync((await svgDl.path())!, "utf8");
  expect(svg).toContain("Team: South only");
  expect(svg).toContain("Review accruals");
  expect(svg).not.toContain("Regional approval");

  // Back to all teams shows everything again.
  await page.getByTestId("team-menu").click();
  await page.getByRole("menuitemradio", { name: "All teams" }).click();
  await expect(map.locator("[data-node-id]")).toHaveCount(4);
  expect(errors).toEqual([]);
});

test("build Team A, start Team B from it, edit B's route alone, see coloured arrows", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("process-mapper"));
  await page.reload();

  // Team A's process, untagged: start -> Review -> Approve -> Done.
  await page.getByTestId("add-step").click();
  await page.getByLabel("Step name").nth(0).fill("Start");
  await page.getByLabel("Step type").nth(0).selectOption("start");
  for (const [i, name] of ["Review", "Approve", "Done"].entries()) {
    await page.getByLabel("Step name").nth(i).focus();
    await page.keyboard.press("Enter");
    await page
      .getByLabel("Step name")
      .nth(i + 1)
      .fill(name);
  }
  await page.getByLabel("Step type").nth(3).selectOption("end");
  for (const [i, target] of ["Review", "Approve", "Done"].entries()) {
    await page.getByLabel("Next steps").nth(i).click();
    await page.getByRole("option", { name: new RegExp(target) }).click();
    await page.keyboard.press("Escape");
  }

  // Teams: A, then B started from A.
  await page.getByTestId("team-menu").click();
  await page.getByRole("menuitem", { name: "Manage teams…" }).click();
  const sheet = page.getByRole("dialog", { name: "Teams" });
  await sheet.getByLabel("New team name").fill("Team A");
  await sheet.getByRole("button", { name: "Add" }).click();
  await sheet.getByLabel("New team name").fill("Team B");
  await sheet
    .getByLabel("Start the new team from")
    .selectOption({ label: "Team A's route in Process 1" });
  await sheet.getByRole("button", { name: "Add" }).click();
  await expect(sheet.getByLabel("Rename Team B")).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();

  // Look at Team B alone and take Approve off its route.
  await page.getByTestId("team-menu").click();
  await page.getByRole("menuitemradio", { name: "Team B" }).click();
  await page.getByTestId("team-menu").click();
  await page.getByRole("button", { name: "Only this team" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Step name")).toHaveCount(4);
  await page.getByRole("button", { name: "Remove step 3 from Team B's route" }).click();
  await expect(page.getByRole("status")).toContainText("no longer on Team B's route");
  await expect(page.getByLabel("Step name")).toHaveCount(3);
  const map = page.getByTestId("map");
  await expect(map.locator("[data-node-id]")).toHaveCount(3);
  await expect(map.locator("[data-edge-id]")).toHaveCount(2);

  // Give Team B its own copy of Review.
  await page.getByRole("button", { name: "Team actions for step 2" }).click();
  await page.getByRole("menuitem", { name: /Make a Team B copy/ }).click();
  // The copy replaces the shared step in Team B's view; Team A keeps the original.
  await expect(page.getByRole("status").last()).toContainText("Team B's own copy");
  await expect(page.getByLabel("Step name")).toHaveCount(3);
  await expect(page.getByLabel("Step name").nth(1)).toHaveValue("Review");
  await expect(page.getByLabel("Teams").nth(1).locator("..")).toContainText("Team B");

  // Everything together: Team A still has four steps; team-specific arrows are coloured.
  await page.getByTestId("team-menu").click();
  await page.getByRole("menuitemradio", { name: "All teams" }).click();
  await expect(map.locator("[data-node-id]")).toHaveCount(5);
  await expect(map.locator("[data-edge-id][data-team-lines]")).toHaveCount(5);
  await page.getByTestId("team-menu").click();
  await page.getByRole("menuitemradio", { name: "Team A" }).click();
  await page.getByTestId("team-menu").click();
  await page.getByRole("button", { name: "Highlight" }).click();
  await page.keyboard.press("Escape");
  await expect(map.locator("[data-node-id][data-dimmed]")).toHaveCount(1);

  // Export legend names the teams.
  const [svgDl] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Export" })
      .click()
      .then(() => page.getByRole("menuitem", { name: "Map as SVG" }).click()),
  ]);
  const svg = fs.readFileSync((await svgDl.path())!, "utf8");
  expect(svg).toContain("TEAMS (arrow colours)");
  expect(svg).toContain("Team B");
  expect(errors).toEqual([]);
});
