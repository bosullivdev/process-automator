import { describe, expect, it } from "vitest";
import {
  deleteParty,
  isPartyReferenced,
  levenshtein,
  matchParty,
  mergeParties,
  nextColourIndex,
  partyUsage,
  renameParty,
} from "../src/model/party";
import { party, process, step, workspace } from "./fixtures";

describe("levenshtein", () => {
  it("computes edit distance", () => {
    expect(levenshtein("", "")).toBe(0);
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("sales", "sale")).toBe(1);
  });
});

describe("matchParty", () => {
  const parties = [party("Sales Team"), party("Finance"), party("IT")];

  it("exact match is case-insensitive and trimmed", () => {
    const m = matchParty("  sales team ", parties);
    expect(m.kind).toBe("exact");
    if (m.kind === "exact") expect(m.party.name).toBe("Sales Team");
  });

  it("near match on small edit distance", () => {
    const m = matchParty("Finanse", parties);
    expect(m.kind).toBe("near");
    if (m.kind === "near") expect(m.party.name).toBe("Finance");
  });

  it("near match on prefix either way", () => {
    expect(matchParty("Sales", parties).kind).toBe("near");
    expect(matchParty("Sales Team Europe", parties).kind).toBe("near");
  });

  it("new when nothing is close", () => {
    expect(matchParty("Marketing", parties).kind).toBe("new");
    expect(matchParty("", parties).kind).toBe("new");
  });
});

describe("colour index allocation", () => {
  it("takes the lowest free index", () => {
    expect(nextColourIndex([])).toBe(0);
    expect(nextColourIndex([party("a", 0), party("b", 1)])).toBe(2);
    expect(nextColourIndex([party("a", 0), party("b", 2)])).toBe(1);
  });

  it("goes beyond the palette instead of blocking", () => {
    const many = Array.from({ length: 12 }, (_, i) => party(`p${i}`, i));
    expect(nextColourIndex(many)).toBe(12);
  });

  it("releases an index on merge", () => {
    const a = party("A", 0);
    const b = party("B", 1);
    const ws = workspace([a, b], [process([])]);
    const merged = mergeParties(ws, a.id, b.id);
    expect(nextColourIndex(merged.parties)).toBe(1);
  });
});

describe("mergeParties", () => {
  it("rewrites owners, contributors and lane order across all processes", () => {
    const a = party("A", 0);
    const b = party("B", 1);
    const p1 = process(
      [
        step({ id: "s1", displayNo: 1, ownerId: b.id, contributorIds: [a.id, b.id] }),
        step({ id: "s2", displayNo: 2, ownerId: a.id, contributorIds: [b.id] }),
      ],
      { laneOrder: [b.id, a.id] },
    );
    const p2 = process([step({ id: "s3", displayNo: 1, ownerId: b.id })], { laneOrder: [b.id] });
    const ws = workspace([a, b], [p1, p2]);
    const out = mergeParties(ws, a.id, b.id);
    expect(out.parties.map((p) => p.id)).toEqual([a.id]);
    expect(out.processes[0].steps[0].ownerId).toBe(a.id);
    expect(out.processes[0].steps[0].contributorIds).toEqual([a.id]);
    expect(out.processes[0].steps[1].contributorIds).toEqual([a.id]);
    expect(out.processes[0].laneOrder).toEqual([a.id]);
    expect(out.processes[1].steps[0].ownerId).toBe(a.id);
    expect(out.processes[1].laneOrder).toEqual([a.id]);
  });

  it("is a no-op for unknown or identical ids", () => {
    const a = party("A", 0);
    const ws = workspace([a], [process([])]);
    expect(mergeParties(ws, a.id, a.id)).toBe(ws);
    expect(mergeParties(ws, a.id, "nope")).toBe(ws);
  });
});

describe("rename / delete / usage", () => {
  it("rename is workspace-wide and keeps colour", () => {
    const a = party("A", 4);
    const out = renameParty(workspace([a], []), a.id, "  Alpha ");
    expect(out.parties[0]).toEqual({ ...a, name: "Alpha" });
  });

  it("reports usage per process", () => {
    const a = party("A");
    const p = process([step({ id: "s", displayNo: 1, ownerId: a.id, contributorIds: [a.id] })], {
      name: "Onboarding",
      laneOrder: [a.id],
    });
    const usage = partyUsage(a.id, [p]);
    expect(usage).toEqual([
      {
        processId: p.id,
        processName: "Onboarding",
        asOwner: 1,
        asContributor: 1,
        inLaneOrder: true,
      },
    ]);
    expect(isPartyReferenced(a.id, [p])).toBe(true);
  });

  it("delete is blocked while referenced and allowed otherwise", () => {
    const a = party("A");
    const referenced = workspace([a], [process([step({ id: "s", displayNo: 1, ownerId: a.id })])]);
    expect(deleteParty(referenced, a.id)).toBe(referenced);
    const unreferenced = workspace([a], [process([], { laneOrder: [a.id] })]);
    const out = deleteParty(unreferenced, a.id);
    expect(out.parties).toEqual([]);
    expect(out.processes[0].laneOrder).toEqual([]);
  });
});
