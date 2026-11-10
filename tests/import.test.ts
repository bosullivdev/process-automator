import { describe, expect, it } from "vitest";
import { mergeWorkspace } from "../src/model/import";
import { validateProcess } from "../src/model/validate";
import { party, process, step, workspace } from "./fixtures";
import type { Team } from "../src/model/types";

const sales = party("Sales", 0);
const legal = party("Legal", 1);
const north: Team = { id: "north", name: "North", colourIndex: 0 };

function current() {
  const ws = workspace(
    [sales, legal],
    [
      process(
        [
          step({
            id: "a",
            displayNo: 1,
            type: "start",
            ownerId: sales.id,
            next: [{ targetId: "b" }],
          }),
          step({ id: "b", displayNo: 2, type: "end", ownerId: legal.id }),
        ],
        { name: "Onboarding", laneOrder: [sales.id, legal.id] },
      ),
    ],
  );
  return { ...ws, teams: [north] };
}

/** A file from another browser: its own IDs, "sales" spelt differently, a new party and team. */
function incoming() {
  const s2 = party(" SALES ", 3);
  const ops = party("Ops", 0, { colourOverride: "#123456" });
  const south: Team = { id: "south", name: "South", colourIndex: 0 };
  const n2: Team = { id: "n2", name: "north", colourIndex: 1 };
  const ws = workspace(
    [s2, ops],
    [
      process(
        [
          step({
            id: "x",
            displayNo: 1,
            type: "start",
            ownerId: s2.id,
            coOwnerIds: [ops.id],
            ownerTeams: { [ops.id]: [south.id] },
            next: [{ targetId: "y", teamIds: [n2.id] }, { targetId: "z" }],
          }),
          step({
            id: "y",
            displayNo: 2,
            ownerId: ops.id,
            contributorIds: [s2.id],
            teamIds: [n2.id],
            next: [{ targetId: "z" }],
          }),
          step({ id: "z", displayNo: 3, type: "end", ownerId: null }),
        ],
        { name: "Onboarding", laneOrder: [s2.id, ops.id] },
      ),
      process([step({ id: "q", displayNo: 1, type: "start", ownerId: ops.id, next: [] })], {
        name: "Offboarding",
        laneOrder: [ops.id],
      }),
    ],
  );
  return { ...ws, teams: [south, n2] };
}

describe("mergeWorkspace", () => {
  it("adds the file's processes and keeps the current ones", () => {
    const cur = current();
    const out = mergeWorkspace(cur, incoming());
    expect(out.processes.map((p) => p.name)).toEqual([
      "Onboarding",
      "Onboarding (imported)",
      "Offboarding",
    ]);
    expect(out.activeProcessId).toBe(out.processes[1].id);
    expect(out.processes[0]).toBe(cur.processes[0]);
  });

  it("matches parties and teams by name and creates the rest with free colours", () => {
    const out = mergeWorkspace(current(), incoming());
    expect(out.parties.map((p) => p.name)).toEqual(["Sales", "Legal", "Ops"]);
    const ops = out.parties[2];
    expect(ops.colourIndex).toBe(2);
    expect(ops.colourOverride).toBe("#123456");
    expect(out.teams.map((t) => t.name)).toEqual(["North", "South"]);
    expect(out.teams[1].colourIndex).toBe(1);

    const added = out.processes[1];
    const [x, y, z] = added.steps;
    expect(x.ownerId).toBe(sales.id);
    expect(x.coOwnerIds).toEqual([ops.id]);
    expect(x.ownerTeams).toEqual({ [ops.id]: [out.teams[1].id] });
    expect(x.next).toEqual([{ targetId: y.id, teamIds: [north.id] }, { targetId: z.id }]);
    expect(y.contributorIds).toEqual([sales.id]);
    expect(y.teamIds).toEqual([north.id]);
    expect(z.ownerId).toBeNull();
    expect(added.laneOrder).toEqual([sales.id, ops.id]);
  });

  it("gives every added process and step a fresh ID so the same file can be added twice", () => {
    const once = mergeWorkspace(current(), incoming());
    const twice = mergeWorkspace({ ...current(), ...once }, incoming());
    const ids = twice.processes.flatMap((p) => [p.id, ...p.steps.map((s) => s.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(twice.processes.map((p) => p.name)).toEqual([
      "Onboarding",
      "Onboarding (imported)",
      "Offboarding",
      "Onboarding (imported)",
      "Offboarding (imported)",
    ]);
    expect(twice.parties).toHaveLength(3);
    expect(twice.teams).toHaveLength(2);
  });

  it("produces a workspace that validates clean", () => {
    const out = mergeWorkspace(current(), incoming());
    const ws = { ...current(), ...out };
    const flags = ws.processes
      .flatMap((p) => validateProcess(p, ws))
      .filter((f) => f.severity === "error");
    expect(flags).toEqual([]);
  });
});
