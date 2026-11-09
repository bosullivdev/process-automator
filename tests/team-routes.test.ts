import { describe, expect, it } from "vitest";
import {
  applyScopedNext,
  copyTeamRoute,
  forkStepForTeam,
  linkTeams,
  normaliseScope,
  processForTeam,
  removeStepFromTeam,
  scopeWith,
  scopeWithout,
} from "../src/model/team";
import { validateProcess } from "../src/model/validate";
import { process, step } from "./fixtures";
import type { Team } from "../src/model/types";

const A: Team = { id: "a", name: "Team A", colourIndex: 0 };
const B: Team = { id: "b", name: "Team B", colourIndex: 1 };
const C: Team = { id: "c", name: "Team C", colourIndex: 2 };
const teams = [A, B, C];
const all = teams.map((t) => t.id);

/** Team A's finished process, untagged: start -> review -> approve -> end. */
function masterA() {
  return process([
    step({ id: "s", displayNo: 1, type: "start", next: [{ targetId: "r" }] }),
    step({ id: "r", displayNo: 2, name: "Review", next: [{ targetId: "p" }] }),
    step({ id: "p", displayNo: 3, name: "Approve", next: [{ targetId: "e" }] }),
    step({ id: "e", displayNo: 4, type: "end" }),
  ]);
}

describe("scope arithmetic", () => {
  it("normalises a scope naming every team to all-teams", () => {
    expect(normaliseScope(["a", "b", "c"], all)).toEqual([]);
    expect(normaliseScope(["b", "a"], all)).toEqual(["b", "a"]);
  });
  it("adds and removes teams, spelling out all-teams minus one", () => {
    expect(scopeWith([], "b", all)).toEqual([]);
    expect(scopeWith(["a"], "b", all)).toEqual(["a", "b"]);
    expect(scopeWith(["a", "b"], "c", all)).toEqual([]);
    expect(scopeWithout([], "b", all)).toEqual(["a", "c"]);
    expect(scopeWithout(["a", "b"], "b", all)).toEqual(["a"]);
    expect(scopeWithout(["b"], "b", all)).toBeNull();
    expect(scopeWithout(undefined, "b", ["b"])).toBeNull();
  });
});

describe("copyTeamRoute", () => {
  it("is a no-op on an untagged process, since every team already has the route", () => {
    const m = masterA();
    expect(copyTeamRoute(m, "a", "b", all)).toEqual(m);
  });

  it("gives the target every tagged step and link the source uses", () => {
    const m = masterA();
    m.steps[2].teamIds = ["a"];
    m.steps[1].next = [
      { targetId: "p", teamIds: ["a"] },
      { targetId: "e", teamIds: ["c"] },
    ];
    const out = copyTeamRoute(m, "a", "b", all);
    expect(out.steps[2].teamIds).toEqual(["a", "b"]);
    expect(out.steps[1].next).toEqual([
      { targetId: "p", teamIds: ["a", "b"] },
      { targetId: "e", teamIds: ["c"] },
    ]);
    // Team B's view now matches Team A's.
    expect(processForTeam(out, "b")).toEqual({ ...processForTeam(out, "a") });
  });
});

describe("applyScopedNext", () => {
  const inRoute = new Set(["s", "r", "p", "e"]);

  it("dropping a shared link removes only this team from it", () => {
    const r = masterA().steps[1];
    expect(applyScopedNext(r, [], "b", all, inRoute)).toEqual([
      { targetId: "p", teamIds: ["a", "c"] },
    ]);
  });

  it("dropping a link the team had alone deletes it", () => {
    const r = { ...masterA().steps[1], next: [{ targetId: "p", teamIds: ["b"] }] };
    expect(applyScopedNext(r, [], "b", all, inRoute)).toEqual([]);
  });

  it("adding a new link scopes it to this team; adding one another team has shares it", () => {
    const r = { ...masterA().steps[1], next: [{ targetId: "p", teamIds: ["a"] }] };
    const out = applyScopedNext(r, [{ targetId: "p" }, { targetId: "e" }], "b", all, inRoute);
    expect(out).toEqual([
      { targetId: "p", teamIds: ["a", "b"] },
      { targetId: "e", teamIds: ["b"] },
    ]);
  });

  it("keeps labels and defaults, ignores self-links and links outside the route", () => {
    const d = step({
      id: "d",
      displayNo: 9,
      type: "decision",
      next: [
        { targetId: "p", label: "Yes", isDefault: true },
        { targetId: "x", label: "Later", teamIds: ["b"] },
      ],
    });
    const out = applyScopedNext(
      d,
      [
        { targetId: "p", label: "Approved", isDefault: false },
        { targetId: "d", label: "Loop" },
      ],
      "b",
      all,
      inRoute,
    );
    expect(out).toEqual([
      { targetId: "p", label: "Approved" },
      { targetId: "x", label: "Later", teamIds: ["b"] },
    ]);
  });
});

describe("removeStepFromTeam", () => {
  it("reconnects the team's arrows around the step and leaves other teams alone", () => {
    const out = removeStepFromTeam(masterA(), "p", "b", all);
    const byId = new Map(out.steps.map((s) => [s.id, s]));
    expect(byId.get("p")!.teamIds).toEqual(["a", "c"]);
    expect(byId.get("r")!.next).toEqual([
      { targetId: "p", teamIds: ["a", "c"] },
      { targetId: "e", teamIds: ["b"] },
    ]);
    expect(byId.get("p")!.next).toEqual([{ targetId: "e", teamIds: ["a", "c"] }]);
    // A still goes through Approve, B skips it, and both validate.
    expect(processForTeam(out, "a").steps.map((s) => s.id)).toEqual(["s", "r", "p", "e"]);
    expect(processForTeam(out, "b").steps.map((s) => s.id)).toEqual(["s", "r", "e"]);
    for (const id of all) {
      const flags = validateProcess(processForTeam(out, id), { parties: [], teams });
      expect(flags.filter((f) => f.severity === "error")).toEqual([]);
    }
  });

  it("copies a decision's outcome label onto the bypass", () => {
    const m = process([
      step({ id: "s", displayNo: 1, type: "start", next: [{ targetId: "d" }] }),
      step({
        id: "d",
        displayNo: 2,
        type: "decision",
        next: [
          { targetId: "p", label: "Yes", isDefault: true },
          { targetId: "e", label: "No" },
        ],
      }),
      step({ id: "p", displayNo: 3, next: [{ targetId: "e" }] }),
      step({ id: "e", displayNo: 4, type: "end" }),
    ]);
    const out = removeStepFromTeam(m, "p", "b", all);
    const d = out.steps.find((s) => s.id === "d")!;
    expect(d.next).toEqual([
      { targetId: "p", label: "Yes", isDefault: true, teamIds: ["a", "c"] },
      { targetId: "e", label: "No" },
    ]);
    // Team B's "Yes" would have duplicated "No" to the same target, so the existing link is shared instead.
    expect(processForTeam(out, "b").steps.find((s) => s.id === "d")!.next).toEqual([
      { targetId: "e", label: "No" },
    ]);
  });

  it("does nothing when the step belongs to this team alone or is not in its route", () => {
    const m = masterA();
    m.steps[2].teamIds = ["b"];
    expect(removeStepFromTeam(m, "p", "b", all)).toBe(m);
    expect(removeStepFromTeam(m, "p", "a", all)).toBe(m);
  });
});

describe("forkStepForTeam", () => {
  it("gives the team its own copy with the team's links moved over", () => {
    const { process: out, copyId } = forkStepForTeam(masterA(), "p", "b", all);
    expect(copyId).not.toBeNull();
    const byId = new Map(out.steps.map((s) => [s.id, s]));
    const copy = byId.get(copyId!)!;
    expect(out.steps.map((s) => s.id)).toEqual(["s", "r", "p", copyId, "e"]);
    expect(copy).toMatchObject({ name: "Approve", displayNo: 5, teamIds: ["b"] });
    expect(copy.next).toEqual([{ targetId: "e", teamIds: ["b"] }]);
    expect(byId.get("p")!.teamIds).toEqual(["a", "c"]);
    expect(byId.get("p")!.next).toEqual([{ targetId: "e", teamIds: ["a", "c"] }]);
    expect(byId.get("r")!.next).toEqual([
      { targetId: "p", teamIds: ["a", "c"] },
      { targetId: copyId, teamIds: ["b"] },
    ]);
    expect(processForTeam(out, "b").steps.map((s) => s.id)).toEqual(["s", "r", copyId, "e"]);
    expect(processForTeam(out, "a").steps.map((s) => s.id)).toEqual(["s", "r", "p", "e"]);
  });

  it("returns no copy for a step the team already owns alone", () => {
    const m = masterA();
    m.steps[2].teamIds = ["b"];
    expect(forkStepForTeam(m, "p", "b", all)).toEqual({ process: m, copyId: null });
  });
});

describe("linkTeams", () => {
  it("lists the teams that travel a link", () => {
    expect(linkTeams({ teamIds: [] }, {}, { teamIds: [] }, teams)).toEqual(teams);
    expect(linkTeams({ teamIds: [] }, { teamIds: ["b"] }, { teamIds: [] }, teams)).toEqual([B]);
    expect(linkTeams({ teamIds: ["a", "b"] }, {}, { teamIds: ["b", "c"] }, teams)).toEqual([B]);
  });
});
