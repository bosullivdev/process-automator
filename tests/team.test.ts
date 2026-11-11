import { describe, expect, it } from "vitest";
import {
  deleteTeam,
  isTeamReferenced,
  linkInTeam,
  processForTeam,
  renameTeam,
  scopesOverlap,
  stepInTeam,
  teamNames,
  teamUsage,
  teamView,
} from "../src/model/team";
import { validateProcess } from "../src/model/validate";
import { processToCsv } from "../src/export/csv";
import { party, process, step, workspace } from "./fixtures";
import type { Team } from "../src/model/types";

const north: Team = { id: "north", name: "North", colourIndex: 0 };
const south: Team = { id: "south", name: "South", colourIndex: 1 };
const teams = [north, south];

/**
 * start(1) -> review(2) -> [North only] approve(3) -> end(4)
 *                       -> [South only] -------------> end(4)
 * decision(5) -> "Yes" -> approve(3) {North}, "Yes" -> end(4) {South}
 */
function fixture() {
  return process([
    step({ id: "s1", displayNo: 1, type: "start", next: [{ targetId: "s2" }] }),
    step({
      id: "s2",
      displayNo: 2,
      name: "Review",
      next: [{ targetId: "s3" }, { targetId: "s4", teamIds: ["south"] }],
    }),
    step({
      id: "s3",
      displayNo: 3,
      name: "Approve",
      teamIds: ["north"],
      next: [{ targetId: "s4" }],
    }),
    step({ id: "s4", displayNo: 4, type: "end" }),
    step({
      id: "s5",
      displayNo: 5,
      type: "decision",
      next: [
        { targetId: "s3", label: "Yes", teamIds: ["north"] },
        { targetId: "s4", label: "Yes", teamIds: ["south"] },
        { targetId: "s2", label: "No" },
      ],
    }),
  ]);
}

describe("team membership", () => {
  it("an untagged step or link applies to every team", () => {
    expect(stepInTeam({ teamIds: [] }, "north")).toBe(true);
    expect(stepInTeam({ teamIds: ["south"] }, "north")).toBe(false);
    expect(linkInTeam({}, "north")).toBe(true);
    expect(linkInTeam({ teamIds: [] }, "north")).toBe(true);
    expect(linkInTeam({ teamIds: ["north"] }, "north")).toBe(true);
    expect(linkInTeam({ teamIds: ["south"] }, "north")).toBe(false);
  });

  it("scopes overlap unless both are non-empty and disjoint", () => {
    expect(scopesOverlap(undefined, ["north"])).toBe(true);
    expect(scopesOverlap([], [])).toBe(true);
    expect(scopesOverlap(["north"], ["north", "south"])).toBe(true);
    expect(scopesOverlap(["north"], ["south"])).toBe(false);
  });

  it("names teams in registry order and ignores unknown ids", () => {
    expect(teamNames(["south", "north", "ghost"], teams)).toEqual(["North", "South"]);
    expect(teamNames([], teams)).toEqual([]);
    expect(teamNames(undefined, teams)).toEqual([]);
  });
});

describe("processForTeam", () => {
  it("keeps only the team's steps and links, with ids and numbers unchanged", () => {
    const north = processForTeam(fixture(), "north");
    expect(north.steps.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(north.steps[1].next).toEqual([{ targetId: "s3" }]);
    expect(north.steps[4].next).toEqual([
      { targetId: "s3", label: "Yes", teamIds: ["north"] },
      { targetId: "s2", label: "No" },
    ]);

    const south = processForTeam(fixture(), "south");
    expect(south.steps.map((s) => s.id)).toEqual(["s1", "s2", "s4", "s5"]);
    expect(south.steps[1].next).toEqual([{ targetId: "s4", teamIds: ["south"] }]);
    expect(south.steps[3].next).toEqual([
      { targetId: "s4", label: "Yes", teamIds: ["south"] },
      { targetId: "s2", label: "No" },
    ]);
  });

  it("each variant validates cleanly even though the master repeats a label", () => {
    const master = fixture();
    const ws = { parties: [], teams };
    expect(validateProcess(master, ws).filter((f) => f.severity === "error")).toEqual([]);
    for (const t of teams) {
      const flags = validateProcess(processForTeam(master, t.id), ws);
      expect(flags.filter((f) => f.severity === "error")).toEqual([]);
    }
  });

  it("teamView lists the member steps and link keys", () => {
    const v = teamView(fixture(), "south");
    expect([...v.stepIds]).toEqual(["s1", "s2", "s4", "s5"]);
    expect([...v.linkKeys].sort()).toEqual(["s1->s2", "s2->s4", "s5->s2", "s5->s4"]);
  });
});

describe("team registry", () => {
  it("usage counts step and link tags per process", () => {
    const usage = teamUsage("north", [fixture()]);
    expect(usage).toEqual([
      { processId: usage[0].processId, processName: "Proc", steps: 1, links: 1 },
    ]);
    expect(isTeamReferenced("north", [fixture()])).toBe(true);
    expect(isTeamReferenced("ghost", [fixture()])).toBe(false);
  });

  it("rename trims, delete is blocked while referenced and clears the highlight", () => {
    const ws = { ...workspace([], [fixture()]), teams: [...teams] };
    expect(renameTeam(ws, "north", "  North East ").teams[0].name).toBe("North East");
    expect(deleteTeam(ws, "north")).toBe(ws);

    const spare = { ...ws, teams: [...teams, { id: "west", name: "West", colourIndex: 2 }] };
    spare.view = { ...spare.view, highlightTeamId: "west" };
    const out = deleteTeam(spare, "west");
    expect(out.teams.map((t) => t.id)).toEqual(["north", "south"]);
    expect(out.view.highlightTeamId).toBeNull();
  });
});

describe("validation with teams", () => {
  it("flags an unknown team on a step or link only when a registry is given", () => {
    const p = process([
      step({ id: "a", displayNo: 1, type: "start", teamIds: ["ghost"], next: [{ targetId: "z" }] }),
      step({ id: "z", displayNo: 2, type: "end" }),
    ]);
    expect(validateProcess(p, { parties: [] }).map((f) => f.code)).not.toContain("unknown-team");
    const flags = validateProcess(p, { parties: [], teams });
    expect(flags.filter((f) => f.code === "unknown-team")).toHaveLength(1);
    expect(flags.find((f) => f.code === "unknown-team")).toMatchObject({
      stepId: "a",
      severity: "error",
    });

    const q = process([
      step({
        id: "d",
        displayNo: 1,
        type: "decision",
        next: [{ targetId: "z", label: "Yes", teamIds: ["ghost"] }],
      }),
      step({ id: "z", displayNo: 2, type: "end" }),
    ]);
    expect(validateProcess(q, { parties: [], teams }).some((f) => f.code === "unknown-team")).toBe(
      true,
    );
  });

  it("repeated labels are an error only when their team scopes can both apply", () => {
    const dup = (teamsA: string[] | undefined, teamsB: string[] | undefined) =>
      validateProcess(
        process([
          step({
            id: "d",
            displayNo: 1,
            type: "decision",
            next: [
              { targetId: "x", label: "Yes", teamIds: teamsA },
              { targetId: "y", label: "yes ", teamIds: teamsB },
            ],
          }),
          step({ id: "x", displayNo: 2, type: "end" }),
          step({ id: "y", displayNo: 3, type: "end" }),
        ]),
        { parties: [], teams },
      ).some((f) => f.code === "decision-duplicate-label");
    expect(dup(undefined, undefined)).toBe(true);
    expect(dup(["north"], undefined)).toBe(true);
    expect(dup(["north"], ["north", "south"])).toBe(true);
    expect(dup(["north"], ["south"])).toBe(false);
  });
});

describe("csv with teams", () => {
  it("adds a Teams column and link scopes", () => {
    const p = party("Ops");
    const csv = processToCsv(fixture(), [p], teams);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(
      "No,Name,Owner,Type,Next,Technology,Contributors,Teams,Notes,Control,Control ref",
    );
    expect(lines[2]).toBe("2,Review,,task,3: Approve; 4: Step 4 {South},,,,,,");
    expect(lines[3]).toBe("3,Approve,,task,4: Step 4,,,North,,,");
    expect(lines[5]).toContain("3: Approve [Yes] {North}; 4: Step 4 [Yes] {South}; 2: Review [No]");
  });
});
