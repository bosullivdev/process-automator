import { describe, expect, it } from "vitest";
import {
  addStepToTeam,
  applyAlignment,
  compareTeams,
  dropStep,
  namesAlike,
  suggestAlignments,
  teamSimilarity,
} from "../src/model/align";
import { processForTeam } from "../src/model/team";
import { validateProcess } from "../src/model/validate";
import { party, process, step } from "./fixtures";
import type { Team } from "../src/model/types";

const north: Team = { id: "north", name: "North", colourIndex: 0 };
const south: Team = { id: "south", name: "South", colourIndex: 1 };
const east: Team = { id: "east", name: "East", colourIndex: 2 };
const three = [north, south, east];
const two = [north, south];
const ids = (teams: Team[]) => teams.map((t) => t.id);

/** start(1) -> review(2) -> approve(3) -> end(4); `skipping` teams go review -> end. */
function approval(doing: string[], skipping: string[]) {
  return process([
    step({ id: "s1", displayNo: 1, type: "start", next: [{ targetId: "s2" }] }),
    step({
      id: "s2",
      displayNo: 2,
      name: "Review",
      next: [
        { targetId: "s3", teamIds: doing },
        { targetId: "s4", teamIds: skipping },
      ],
    }),
    step({ id: "s3", displayNo: 3, name: "Approve", teamIds: doing, next: [{ targetId: "s4" }] }),
    step({ id: "s4", displayNo: 4, type: "end" }),
  ]);
}

describe("team similarity", () => {
  it("is 1 for teams on the same route and lower when one skips a step", () => {
    const p = approval(["north", "east"], ["south"]);
    expect(teamSimilarity(p, "north", "east")).toBe(1);
    // North: 4 steps, 3 arrows. South: 3 steps, 2 arrows. Shared: 3 steps, 1 arrow.
    expect(teamSimilarity(p, "north", "south")).toBeCloseTo(4 / 8);
  });

  it("counts who does a step", () => {
    const fin = party("Finance");
    const ops = party("Ops");
    const p = process([
      step({
        id: "s1",
        displayNo: 1,
        type: "end",
        ownerId: fin.id,
        coOwnerIds: [ops.id],
        ownerTeams: { [ops.id]: ["south"] },
      }),
    ]);
    // North: the step and Finance. South: the step, Finance and Ops.
    expect(teamSimilarity(p, "north", "south")).toBeCloseTo(2 / 3);
  });

  it("compares every pair and averages them", () => {
    const c = compareTeams(approval(["north", "east"], ["south"]), three);
    expect(c.pairs.map((p) => `${p.a}-${p.b}`)).toEqual([
      "north-south",
      "north-east",
      "south-east",
    ]);
    expect(c.average).toBeCloseTo((0.5 + 1 + 0.5) / 3);
    expect(compareTeams(approval(["north"], ["south"]), [north])).toEqual({
      average: 1,
      pairs: [],
    });
  });
});

describe("namesAlike", () => {
  it("ignores case, punctuation and small typing differences, but not numbers", () => {
    expect(namesAlike("Post journal", "post  journal.")).toBe(true);
    expect(namesAlike("Approve request", "Aprove request")).toBe(true);
    expect(namesAlike("Review 1", "Review 2")).toBe(false);
    expect(namesAlike("Approve", "Reject")).toBe(false);
    expect(namesAlike("", "")).toBe(false);
  });
});

describe("a step most teams do and one skips", () => {
  const p = approval(["north", "east"], ["south"]);

  it("is suggested for the team that skips it, and not for removal", () => {
    const found = suggestAlignments(p, three);
    expect(found.map((s) => s.action)).toEqual([
      { kind: "add-step", stepId: "s3", teamIds: ["south"], likeTeamId: "north" },
    ]);
    expect(found[0].title).toBe("Add step 3 to South");
    expect(found[0].gain).toBeCloseTo(1 - (0.5 + 1 + 0.5) / 3);
  });

  it("joins the team's route the way the reference team has it, dropping the shortcut", () => {
    const after = addStepToTeam(p, "s3", "south", "north", ids(three));
    expect(after.steps.find((s) => s.id === "s3")?.teamIds).toEqual([]);
    expect(after.steps.find((s) => s.id === "s2")?.next).toEqual([{ targetId: "s3" }]);
    expect(compareTeams(after, three).average).toBe(1);
    expect(suggestAlignments(after, three)).toEqual([]);
    expect(validateProcess(processForTeam(after, "south"), { parties: [] })).toEqual(
      validateProcess(processForTeam(after, "north"), { parties: [] }),
    );
  });

  it("gives the joining team the reference team's parties for the step", () => {
    const fin = party("Finance");
    const ops = party("Ops");
    const base = approval(["north", "east"], ["south"]);
    const scoped = {
      ...base,
      steps: base.steps.map((s) =>
        s.id === "s3"
          ? {
              ...s,
              ownerId: fin.id,
              coOwnerIds: [ops.id],
              ownerTeams: { [fin.id]: ["north"], [ops.id]: ["east"] },
            }
          : s,
      ),
    };
    const after = addStepToTeam(scoped, "s3", "south", "north", ids(three));
    const s3 = after.steps.find((s) => s.id === "s3");
    expect(s3?.ownerTeams).toEqual({ [fin.id]: ["north", "south"], [ops.id]: ["east"] });
  });

  it("leaves the process alone when the team already has the step", () => {
    expect(addStepToTeam(p, "s3", "east", "north", ids(three))).toBe(p);
  });
});

describe("a step half the teams do", () => {
  const p = approval(["north"], ["south"]);

  it("is offered both ways, since neither side is the majority", () => {
    const kinds = suggestAlignments(p, two).map((s) => s.action.kind);
    expect(kinds.sort()).toEqual(["add-step", "drop-step"]);
  });

  it("can be removed, leading its team straight on to the next step", () => {
    const after = dropStep(p, "s3", ids(two));
    expect(after.steps.map((s) => s.id)).toEqual(["s1", "s2", "s4"]);
    expect(after.steps.find((s) => s.id === "s2")?.next).toEqual([{ targetId: "s4" }]);
    expect(compareTeams(after, two).average).toBe(1);
    expect(validateProcess(after, { parties: [] }).some((f) => f.code === "broken-link")).toBe(
      false,
    );
  });

  it("is never suggested for removal when it is a start or an end", () => {
    const ends = process([
      step({
        id: "s1",
        displayNo: 1,
        type: "start",
        next: [
          { targetId: "e1", teamIds: ["north"] },
          { targetId: "e2", teamIds: ["south"] },
        ],
      }),
      step({ id: "e1", displayNo: 2, name: "Paid", type: "end", teamIds: ["north"] }),
      step({ id: "e2", displayNo: 3, name: "Archived", type: "end", teamIds: ["south"] }),
    ]);
    expect(suggestAlignments(ends, two).some((s) => s.action.kind === "drop-step")).toBe(false);
  });
});

describe("teams with their own copy of the same step", () => {
  const p = process([
    step({
      id: "s1",
      displayNo: 1,
      type: "start",
      next: [
        { targetId: "s2", teamIds: ["north"] },
        { targetId: "s3", teamIds: ["south"] },
      ],
    }),
    step({
      id: "s2",
      displayNo: 2,
      name: "Post journal",
      teamIds: ["north"],
      next: [{ targetId: "s4" }],
    }),
    step({
      id: "s3",
      displayNo: 3,
      name: "post  journal.",
      teamIds: ["south"],
      next: [{ targetId: "s4" }],
    }),
    step({ id: "s4", displayNo: 4, type: "end" }),
  ]);

  it("are offered a merge, and nothing else for those steps", () => {
    const found = suggestAlignments(p, two);
    expect(found.map((s) => s.action)).toEqual([{ kind: "merge", keepId: "s2", dropId: "s3" }]);
    expect(found[0].stepIds).toEqual(["s2", "s3"]);
  });

  it("end up on one shared step", () => {
    const [merge] = suggestAlignments(p, two);
    const after = applyAlignment(p, merge.action, ids(two));
    expect(after.steps.map((s) => s.id)).toEqual(["s1", "s2", "s4"]);
    expect(after.steps.find((s) => s.id === "s2")?.teamIds).toEqual([]);
    expect(compareTeams(after, two).average).toBe(1);
  });

  it("are not paired when the names differ in a number or the types differ", () => {
    const renamed = {
      ...p,
      steps: p.steps.map((s) =>
        s.id === "s2"
          ? { ...s, name: "Post journal 1" }
          : s.id === "s3"
            ? { ...s, name: "Post journal 2" }
            : s,
      ),
    };
    expect(suggestAlignments(renamed, two).some((s) => s.action.kind === "merge")).toBe(false);
  });
});

describe("a shared step done by different parties", () => {
  const fin = party("Finance");
  const ops = party("Ops");
  const p = process([
    step({
      id: "s1",
      displayNo: 1,
      name: "Raise invoice",
      type: "start",
      ownerId: fin.id,
      coOwnerIds: [ops.id],
      ownerTeams: { [ops.id]: ["south"] },
      next: [{ targetId: "s2" }],
    }),
    step({ id: "s2", displayNo: 2, type: "end", ownerId: fin.id }),
  ]);

  it("is suggested to follow the parties most teams use", () => {
    const found = suggestAlignments(p, three, [fin, ops]);
    expect(found.map((s) => s.action)).toEqual([
      { kind: "align-owner", stepId: "s1", teamIds: ["south"], partyIds: [fin.id] },
    ]);
    expect(found[0].title).toBe("Step 1: have Finance do it for South");
    expect(found[0].detail).toBe(
      '"Raise invoice" is done by Finance for North and East; Finance and Ops for South.',
    );
  });

  it("drops the odd party when applied", () => {
    const [s] = suggestAlignments(p, three, [fin, ops]);
    const after = applyAlignment(p, s.action, ids(three));
    const s1 = after.steps.find((x) => x.id === "s1");
    expect(s1?.coOwnerIds).toEqual([]);
    expect(s1?.ownerTeams).toBeUndefined();
    expect(suggestAlignments(after, three, [fin, ops])).toEqual([]);
  });
});

describe("suggestAlignments", () => {
  it("needs at least two teams", () => {
    expect(suggestAlignments(approval(["north"], ["south"]), [north])).toEqual([]);
    expect(suggestAlignments(approval(["north"], ["south"]), [])).toEqual([]);
  });

  it("lists only helpful edits, the most effective first, the same way every time", () => {
    const fin = party("Finance");
    const ops = party("Ops");
    const base = approval(["north", "east"], ["south"]);
    const p = {
      ...base,
      steps: base.steps.map((s) =>
        s.id === "s4"
          ? { ...s, ownerId: fin.id, coOwnerIds: [ops.id], ownerTeams: { [ops.id]: ["east"] } }
          : s,
      ),
    };
    const found = suggestAlignments(p, three, [fin, ops]);
    expect(found.map((s) => s.action.kind)).toEqual(["add-step", "align-owner"]);
    expect(found.every((s) => s.gain > 0)).toBe(true);
    expect(found[0].gain).toBeGreaterThan(found[1].gain);
    expect(suggestAlignments(p, three, [fin, ops])).toEqual(found);
  });
});
