import { describe, expect, it } from "vitest";
import { assignOwners, splitOwnerQuery, stepParties } from "../src/model/share";
import { party, process, step } from "./fixtures";

describe("splitOwnerQuery", () => {
  it("returns a single trimmed name when there is no separator", () => {
    expect(splitOwnerQuery("  Sales ")).toEqual(["Sales"]);
    expect(splitOwnerQuery("   ")).toEqual([]);
  });

  it("splits on comma, semicolon and plus, dropping blanks and duplicates", () => {
    expect(splitOwnerQuery("Sales, Legal; Finance + sales,,")).toEqual([
      "Sales",
      "Legal",
      "Finance",
    ]);
  });

  it("keeps slash and ampersand inside a single team name", () => {
    expect(splitOwnerQuery("R&D / Labs")).toEqual(["R&D / Labs"]);
  });
});

describe("assignOwners", () => {
  const sales = party("Sales", 0);
  const legal = party("Legal", 1);
  const finance = party("Finance", 2);

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
    const p = fixture();
    expect(assignOwners(p, "nope", [legal.id])).toBe(p);
    expect(assignOwners(p, "s2", [])).toBe(p);
  });

  it("with one party just sets the owner and clears co-owners", () => {
    const p = fixture();
    const once = assignOwners(p, "s2", [sales.id, legal.id]);
    const back = assignOwners(once, "s2", [legal.id]);
    expect(back.steps).toHaveLength(4);
    expect(back.steps[1]).toMatchObject({ ownerId: legal.id, coOwnerIds: [] });
  });

  it("keeps one row and records the extra parties as co-owners", () => {
    const out = assignOwners(fixture(), "s2", [sales.id, legal.id]);
    expect(out.steps).toHaveLength(4);
    const s2 = out.steps[1];
    expect(s2).toMatchObject({
      id: "s2",
      displayNo: 2,
      name: "Review contract",
      ownerId: sales.id,
      coOwnerIds: [legal.id],
      technology: "DocuSign",
      notes: "joint",
      next: [{ targetId: "s3" }],
    });
    // Links into the step are untouched: the map fans them out per lane.
    expect(out.steps[0].next).toEqual([{ targetId: "s2" }]);
    expect(out.steps[3].next).toEqual([
      { targetId: "s2", label: "Yes", isDefault: true },
      { targetId: "s3", label: "No" },
    ]);
  });

  it("drops the group's parties from the step's contributors", () => {
    const out = assignOwners(fixture(), "s2", [sales.id, legal.id]);
    expect(out.steps[1].contributorIds).toEqual([finance.id]);
  });

  it("handles several extra parties, duplicates and lane order", () => {
    const out = assignOwners(fixture(), "s2", [sales.id, legal.id, finance.id, legal.id]);
    expect(out.steps[1].coOwnerIds).toEqual([legal.id, finance.id]);
    expect(out.steps[1].contributorIds).toEqual([]);
    expect(out.laneOrder).toEqual([sales.id, legal.id, finance.id]);
  });

  it("can change the owner while keeping the rest as co-owners", () => {
    const out = assignOwners(fixture(), "s2", [legal.id, sales.id]);
    expect(out.steps[1]).toMatchObject({ ownerId: legal.id, coOwnerIds: [sales.id] });
    expect(out.laneOrder).toEqual([sales.id, legal.id]);
  });
});

describe("stepParties", () => {
  it("lists the owner first then distinct co-owners", () => {
    expect(stepParties({ ownerId: "a", coOwnerIds: ["b", "a", "c", "b"] })).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(stepParties({ ownerId: null, coOwnerIds: [] })).toEqual([null]);
  });
});
