import { describe, expect, it } from "vitest";
import { mergeCandidates, mergeSteps, setOwnersForTeam } from "../src/model/owner-teams";
import { effectiveTeams, ownersForTeam, processForTeam } from "../src/model/team";
import { buildLayoutGraph, laneNodeId } from "../src/graph/build-graph";
import { migrate } from "../src/model/schema";
import { party, process, step, workspace } from "./fixtures";
import type { Team } from "../src/model/types";

const deputy = party("Deputy Head", 0);
const bp = party("Finance BP", 1);
const ma = party("MA Team", 2);
const parties = [deputy, bp, ma];
const central: Team = { id: "central", name: "Central", colourIndex: 0 };
const estates: Team = { id: "estates", name: "Estates", colourIndex: 1 };
const teams = [central, estates];
const all = teams.map((t) => t.id);

/** start -> review (Deputy + BP, every team) -> end, one shared route. */
function shared() {
  return process(
    [
      step({ id: "s", displayNo: 1, type: "start", ownerId: deputy.id, next: [{ targetId: "r" }] }),
      step({
        id: "r",
        displayNo: 2,
        name: "Review central targets",
        ownerId: deputy.id,
        coOwnerIds: [bp.id],
        next: [{ targetId: "e" }],
      }),
      step({ id: "e", displayNo: 3, type: "end", ownerId: deputy.id }),
    ],
    { laneOrder: [deputy.id, bp.id] },
  );
}

describe("setOwnersForTeam", () => {
  it("drops a party for one team only and keeps the step shared", () => {
    const out = setOwnersForTeam(shared(), "r", [bp.id], estates.id, all);
    const r = out.steps[1];
    expect(r).toMatchObject({ ownerId: deputy.id, coOwnerIds: [bp.id], teamIds: [] });
    expect(r.ownerTeams).toEqual({ [deputy.id]: [central.id] });
    expect(ownersForTeam(r, estates.id)).toEqual({ ownerId: bp.id, coOwnerIds: [] });
    expect(ownersForTeam(r, central.id)).toEqual({ ownerId: deputy.id, coOwnerIds: [bp.id] });
    expect(out.steps).toHaveLength(3);
  });

  it("adds a party for one team only, and removes it again when no team is left", () => {
    const added = setOwnersForTeam(shared(), "r", [deputy.id, bp.id, ma.id], estates.id, all);
    expect(added.steps[1].coOwnerIds).toEqual([bp.id, ma.id]);
    expect(added.steps[1].ownerTeams).toEqual({ [ma.id]: [estates.id] });
    expect(added.laneOrder).toEqual([deputy.id, bp.id, ma.id]);
    const removed = setOwnersForTeam(added, "r", [deputy.id, bp.id], estates.id, all);
    expect(removed.steps[1].coOwnerIds).toEqual([bp.id]);
    expect(removed.steps[1].ownerTeams).toBeUndefined();
  });

  it("promotes a co-owner when the owner leaves every team", () => {
    const one = setOwnersForTeam(shared(), "r", [bp.id], estates.id, all);
    const two = setOwnersForTeam(one, "r", [bp.id], central.id, all);
    expect(two.steps[1]).toMatchObject({ ownerId: bp.id, coOwnerIds: [] });
    expect(two.steps[1].ownerTeams).toBeUndefined();
  });

  it("shows a team that no party covers as unassigned", () => {
    const out = setOwnersForTeam(shared(), "r", [], estates.id, all);
    expect(ownersForTeam(out.steps[1], estates.id)).toEqual({ ownerId: null, coOwnerIds: [] });
    expect(processForTeam(out, estates.id).steps[1].ownerId).toBeNull();
  });
});

describe("lane copies per team", () => {
  it("narrows each lane copy to the party's teams and draws only them in a team's view", () => {
    const proc = setOwnersForTeam(shared(), "r", [bp.id], estates.id, all);
    const r = proc.steps[1];
    expect(effectiveTeams(r, deputy.id, all)).toEqual([central.id]);
    expect(effectiveTeams(r, bp.id, all)).toEqual([]);
    const g = buildLayoutGraph(proc, parties, "simple", "horizontal", "full", teams);
    expect(g.nodes.find((n) => n.id === "r")!.teamIds).toEqual([central.id]);
    expect(g.nodes.find((n) => n.id === laneNodeId("r", bp.id))!.teamIds).toEqual([]);
    const estatesOnly = buildLayoutGraph(
      processForTeam(proc, estates.id),
      parties,
      "simple",
      "horizontal",
      "full",
      teams,
    );
    expect(estatesOnly.nodes.filter((n) => n.stepId === "r").map((n) => n.laneId)).toEqual([bp.id]);
  });
});

describe("mergeSteps", () => {
  /** Central's review (Deputy + BP) and Estates' own copy (BP + MA) with their own neighbours. */
  function forked() {
    return process(
      [
        step({
          id: "s",
          displayNo: 1,
          type: "start",
          ownerId: deputy.id,
          next: [
            { targetId: "r", teamIds: [central.id] },
            { targetId: "r2", teamIds: [estates.id] },
          ],
        }),
        step({
          id: "r",
          displayNo: 2,
          name: "Review central targets",
          ownerId: deputy.id,
          coOwnerIds: [bp.id],
          teamIds: [central.id],
          technology: "",
          next: [{ targetId: "q", teamIds: [central.id] }],
        }),
        step({
          id: "q",
          displayNo: 3,
          type: "decision",
          name: "Understood?",
          ownerId: deputy.id,
          teamIds: [central.id],
          next: [
            { targetId: "r", label: "No", teamIds: [central.id] },
            { targetId: "e", label: "Yes", teamIds: [central.id] },
          ],
        }),
        step({ id: "e", displayNo: 4, type: "end", ownerId: deputy.id }),
        step({
          id: "r2",
          displayNo: 5,
          name: "Review central targets",
          ownerId: bp.id,
          coOwnerIds: [ma.id],
          teamIds: [estates.id],
          technology: "Axiom",
          next: [{ targetId: "q2", teamIds: [estates.id] }],
        }),
        step({
          id: "q2",
          displayNo: 6,
          type: "decision",
          name: "Understood?",
          ownerId: bp.id,
          teamIds: [estates.id],
          next: [
            { targetId: "r2", label: "No", teamIds: [estates.id] },
            { targetId: "e", label: "Yes", teamIds: [estates.id] },
          ],
        }),
      ],
      { laneOrder: [deputy.id, bp.id, ma.id] },
    );
  }

  it("offers the other team's copy as a merge candidate", () => {
    expect(mergeCandidates(forked(), "r").map((s) => s.id)).toEqual(["r2"]);
    expect(mergeCandidates(forked(), "q").map((s) => s.id)).toEqual(["q2"]);
    expect(mergeCandidates(forked(), "e")).toEqual([]);
  });

  it("folds a copy back into one shared step with per-team owners and links", () => {
    const once = mergeSteps(forked(), "r", "r2", all);
    expect(once.steps.map((s) => s.id)).toEqual(["s", "r", "q", "e", "q2"]);
    const r = once.steps[1];
    expect(r).toMatchObject({
      ownerId: deputy.id,
      coOwnerIds: [bp.id, ma.id],
      teamIds: [],
      technology: "Axiom",
      displayNo: 2,
    });
    expect(r.ownerTeams).toEqual({ [deputy.id]: [central.id], [ma.id]: [estates.id] });
    // Out: the kept link stays Central's, the copy's link joins it scoped to Estates.
    expect(r.next).toEqual([
      { targetId: "q", teamIds: [central.id] },
      { targetId: "q2", teamIds: [estates.id] },
    ]);
    // In: the start's two links become one shared link.
    expect(once.steps[0].next).toEqual([{ targetId: "r" }]);
    // q2's "No" now points at the merged step.
    expect(once.steps[4].next[0]).toEqual({ targetId: "r", label: "No", teamIds: [estates.id] });

    // Merging the decisions too leaves one route with two owners per team.
    const twice = mergeSteps(once, "q", "q2", all);
    expect(twice.steps.map((s) => s.id)).toEqual(["s", "r", "q", "e"]);
    expect(twice.steps[1].next).toEqual([{ targetId: "q" }]);
    const q = twice.steps[2];
    expect(q).toMatchObject({ ownerId: deputy.id, coOwnerIds: [bp.id], teamIds: [] });
    expect(q.ownerTeams).toEqual({ [deputy.id]: [central.id], [bp.id]: [estates.id] });
    expect(q.next).toEqual([
      { targetId: "r", label: "No" },
      { targetId: "e", label: "Yes" },
    ]);
    // Each team's view is the same route with its own owners.
    expect(processForTeam(twice, central.id).steps.map((s) => s.ownerId)).toEqual([
      deputy.id,
      deputy.id,
      deputy.id,
      deputy.id,
    ]);
    expect(processForTeam(twice, estates.id).steps.map((s) => s.ownerId)).toEqual([
      deputy.id,
      bp.id,
      bp.id,
      deputy.id,
    ]);
  });

  it("round-trips owner scopes through the schema and loads older files without them", () => {
    const proc = setOwnersForTeam(shared(), "r", [bp.id], estates.id, all);
    const ws = { ...workspace(parties, [proc]), teams };
    const out = migrate(JSON.parse(JSON.stringify(ws)));
    expect(out.processes[0].steps[1].ownerTeams).toEqual({ [deputy.id]: [central.id] });
    const legacy = JSON.parse(JSON.stringify(ws)) as { processes: Array<{ steps: object[] }> };
    for (const s of legacy.processes[0].steps) delete (s as { ownerTeams?: unknown }).ownerTeams;
    expect(migrate(legacy).processes[0].steps[1].ownerTeams).toBeUndefined();
  });
});
