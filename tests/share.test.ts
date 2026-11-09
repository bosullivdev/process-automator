import { describe, expect, it } from "vitest";
import { assignOwners, splitOwnerQuery } from "../src/model/share";
import { validateProcess } from "../src/model/validate";
import { party, process, step } from "./fixtures";

describe("splitOwnerQuery", () => {
  it("returns a single trimmed name when there is no separator", () => {
    expect(splitOwnerQuery("  Sales ")).toEqual(["Sales"]);
    expect(splitOwnerQuery("   ")).toEqual([]);
  });

  it("splits on comma, semicolon and plus, dropping blanks and duplicates", () => {
    expect(splitOwnerQuery("Sales, Legal")).toEqual(["Sales", "Legal"]);
    expect(splitOwnerQuery("Sales + Legal; Finance")).toEqual(["Sales", "Legal", "Finance"]);
    expect(splitOwnerQuery("Sales,, sales ,")).toEqual(["Sales"]);
  });

  it("keeps slash and ampersand inside a single team name", () => {
    expect(splitOwnerQuery("R&D")).toEqual(["R&D"]);
    expect(splitOwnerQuery("Sales/Marketing")).toEqual(["Sales/Marketing"]);
  });
});

describe("assignOwners", () => {
  const sales = party("Sales", 0);
  const legal = party("Legal", 1);
  const finance = party("Finance", 2);
  const parties = [sales, legal, finance];

  function fixture() {
    // start(1) -> shared(2) -> end(3); decision(4) -> shared(2) with label "Yes"
    return process(
      [
        step({
          id: "s1",
          displayNo: 1,
          type: "start",
          ownerId: sales.id,
          next: [{ targetId: "s2" }],
        }),
        step({
          id: "s2",
          displayNo: 2,
          name: "Review contract",
          ownerId: sales.id,
          technology: "DocuSign",
          notes: "joint",
          contributorIds: [legal.id, finance.id],
          next: [{ targetId: "s3" }],
        }),
        step({ id: "s3", displayNo: 3, type: "end", ownerId: sales.id }),
        step({
          id: "s4",
          displayNo: 4,
          type: "decision",
          ownerId: sales.id,
          next: [
            { targetId: "s2", label: "Yes", isDefault: true },
            { targetId: "s3", label: "No" },
          ],
        }),
      ],
      { laneOrder: [sales.id] },
    );
  }

  it("returns the process unchanged for an unknown step or no parties", () => {
    const proc = fixture();
    expect(assignOwners(proc, "nope", [legal.id], parties).process).toBe(proc);
    expect(assignOwners(proc, "s2", [], parties).process).toBe(proc);
  });

  it("with one party just sets the owner", () => {
    const { process: out, copyIds } = assignOwners(fixture(), "s2", [legal.id], parties);
    expect(copyIds).toEqual([]);
    expect(out.steps).toHaveLength(4);
    expect(out.steps[1].ownerId).toBe(legal.id);
    expect(out.steps[1].contributorIds).toEqual([finance.id]);
    expect(out.laneOrder).toEqual([sales.id, legal.id]);
  });

  it("copies the step into each extra party's lane with the same fields and links", () => {
    const { process: out, copyIds } = assignOwners(fixture(), "s2", [sales.id, legal.id], parties);
    expect(copyIds).toHaveLength(1);
    const copy = out.steps.find((s) => s.id === copyIds[0])!;
    const original = out.steps.find((s) => s.id === "s2")!;

    expect(out.steps.map((s) => s.id)).toEqual(["s1", "s2", copy.id, "s3", "s4"]);
    expect(copy.displayNo).toBe(5);
    expect(copy.ownerId).toBe(legal.id);
    expect(copy).toMatchObject({ name: "Review contract", technology: "DocuSign", notes: "joint" });
    expect(copy.next).toEqual([{ targetId: "s3" }]);
    expect(copy.next).not.toBe(original.next);
    expect(original.ownerId).toBe(sales.id);
    expect(original.displayNo).toBe(2);
  });

  it("forks every predecessor to the copy, labelling decision outcomes by team", () => {
    const { process: out, copyIds } = assignOwners(fixture(), "s2", [sales.id, legal.id], parties);
    const start = out.steps.find((s) => s.id === "s1")!;
    const decision = out.steps.find((s) => s.id === "s4")!;
    expect(start.next).toEqual([{ targetId: "s2" }, { targetId: copyIds[0] }]);
    expect(decision.next).toEqual([
      { targetId: "s2", label: "Yes", isDefault: true },
      { targetId: "s3", label: "No" },
      { targetId: copyIds[0], label: "Yes (Legal)" },
    ]);
    const flags = validateProcess(out, { parties });
    expect(flags.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("drops the group's teams from contributors on every step in the group", () => {
    const { process: out, copyIds } = assignOwners(fixture(), "s2", [sales.id, legal.id], parties);
    expect(out.steps.find((s) => s.id === "s2")!.contributorIds).toEqual([finance.id]);
    expect(out.steps.find((s) => s.id === copyIds[0])!.contributorIds).toEqual([finance.id]);
  });

  it("handles several extra parties, duplicates and lane order", () => {
    const { process: out, copyIds } = assignOwners(
      fixture(),
      "s2",
      [sales.id, legal.id, finance.id, legal.id],
      parties,
    );
    expect(copyIds).toHaveLength(2);
    expect(out.steps.map((s) => s.displayNo)).toEqual([1, 2, 5, 6, 3, 4]);
    expect(out.steps.filter((s) => s.name === "Review contract").map((s) => s.ownerId)).toEqual([
      sales.id,
      legal.id,
      finance.id,
    ]);
    expect(out.laneOrder).toEqual([sales.id, legal.id, finance.id]);
    expect(out.steps.find((s) => s.id === "s1")!.next.map((l) => l.targetId)).toEqual([
      "s2",
      ...copyIds,
    ]);
  });

  it("copies a step inside a cycle without linking a copy to itself", () => {
    const proc = process(
      [
        step({ id: "a", displayNo: 1, type: "start", next: [{ targetId: "b" }] }),
        step({ id: "b", displayNo: 2, ownerId: sales.id, next: [{ targetId: "c" }] }),
        step({ id: "c", displayNo: 3, ownerId: sales.id, next: [{ targetId: "b" }] }),
      ],
      { laneOrder: [sales.id] },
    );
    const { process: out, copyIds } = assignOwners(proc, "b", [sales.id, legal.id], parties);
    const copy = out.steps.find((s) => s.id === copyIds[0])!;
    expect(copy.next).toEqual([{ targetId: "c" }]);
    expect(out.steps.find((s) => s.id === "c")!.next).toEqual([
      { targetId: "b" },
      { targetId: copy.id },
    ]);
    const flags = validateProcess(out, { parties });
    expect(flags.some((f) => f.code === "self-link")).toBe(false);
  });
});
