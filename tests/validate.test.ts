import { describe, expect, it } from "vitest";
import { flagsByStep, validateProcess, worstSeverity, type FlagCode } from "../src/model/validate";
import { linearProcess, party, process, step } from "./fixtures";

const noParties = { parties: [] };

function codes(flags: ReturnType<typeof validateProcess>, stepId?: string): FlagCode[] {
  return flags.filter((f) => (stepId ? f.stepId === stepId : true)).map((f) => f.code);
}

describe("validateProcess errors", () => {
  it("a well-formed process owned by a known party has no flags", () => {
    const p = party("Ops");
    expect(validateProcess(linearProcess(p.id), { parties: [p] })).toEqual([]);
  });

  it("broken-link with the dangling target id", () => {
    const p = process([
      step({ id: "a", displayNo: 1, type: "start", next: [{ targetId: "gone" }] }),
      step({ id: "z", displayNo: 2, type: "end" }),
    ]);
    const f = validateProcess(p, noParties).find((x) => x.code === "broken-link");
    expect(f).toMatchObject({ severity: "error", stepId: "a", targetId: "gone" });
  });

  it("self-link", () => {
    const p = process([step({ id: "a", displayNo: 1, type: "task", next: [{ targetId: "a" }] })]);
    expect(codes(validateProcess(p, noParties), "a")).toContain("self-link");
  });

  it("start-has-incoming", () => {
    const p = process([
      step({ id: "a", displayNo: 1, type: "start", next: [{ targetId: "b" }] }),
      step({ id: "b", displayNo: 2, next: [{ targetId: "a" }] }),
    ]);
    expect(codes(validateProcess(p, noParties), "a")).toContain("start-has-incoming");
  });

  it("end-has-next", () => {
    const p = process([
      step({ id: "a", displayNo: 1, type: "start", next: [{ targetId: "b" }] }),
      step({ id: "b", displayNo: 2, type: "end", next: [{ targetId: "a" }] }),
    ]);
    expect(codes(validateProcess(p, noParties), "b")).toContain("end-has-next");
  });

  it("decision label errors", () => {
    const p = process([
      step({ id: "a", displayNo: 1, type: "start", next: [{ targetId: "d" }] }),
      step({
        id: "d",
        displayNo: 2,
        type: "decision",
        next: [
          { targetId: "x", label: "Yes", isDefault: true },
          { targetId: "y", label: " yes ", isDefault: true },
          { targetId: "z" },
        ],
      }),
      step({ id: "x", displayNo: 3, type: "end" }),
      step({ id: "y", displayNo: 4, type: "end" }),
      step({ id: "z", displayNo: 5, type: "end" }),
    ]);
    const c = codes(validateProcess(p, noParties), "d");
    expect(c).toContain("decision-missing-label");
    expect(c).toContain("decision-duplicate-label");
    expect(c).toContain("decision-multiple-default");
  });

  it("unknown-party for owner and contributor", () => {
    const p = process([
      step({
        id: "a",
        displayNo: 1,
        type: "start",
        ownerId: "nobody",
        contributorIds: ["ghost"],
        next: [{ targetId: "b" }],
      }),
      step({ id: "b", displayNo: 2, type: "end" }),
    ]);
    const flags = validateProcess(p, noParties).filter((f) => f.code === "unknown-party");
    expect(flags.map((f) => f.partyId)).toEqual(["nobody", "ghost"]);
  });
});

describe("validateProcess warnings", () => {
  it("incomplete for a non-end step with no next", () => {
    const p = process([
      step({ id: "a", displayNo: 1, type: "start", next: [{ targetId: "b" }] }),
      step({ id: "b", displayNo: 2 }),
    ]);
    expect(codes(validateProcess(p, noParties), "b")).toContain("incomplete");
    expect(codes(validateProcess(p, noParties), "a")).not.toContain("incomplete");
  });

  it("decision-too-few and decision-many", () => {
    const few = process([
      step({ id: "a", displayNo: 1, type: "start", next: [{ targetId: "d" }] }),
      step({ id: "d", displayNo: 2, type: "decision", next: [{ targetId: "e", label: "x" }] }),
      step({ id: "e", displayNo: 3, type: "end" }),
    ]);
    expect(codes(validateProcess(few, noParties), "d")).toContain("decision-too-few");
    const ends = Array.from({ length: 6 }, (_, i) =>
      step({ id: `e${i}`, displayNo: 3 + i, type: "end" }),
    );
    const many = process([
      step({ id: "a", displayNo: 1, type: "start", next: [{ targetId: "d" }] }),
      step({
        id: "d",
        displayNo: 2,
        type: "decision",
        next: ends.map((e, i) => ({ targetId: e.id, label: `L${i}` })),
      }),
      ...ends,
    ]);
    expect(codes(validateProcess(many, noParties), "d")).toContain("decision-many");
  });

  it("no-start and no-end at process level", () => {
    const p = process([step({ id: "a", displayNo: 1, next: [{ targetId: "a" }] })]);
    const flags = validateProcess(p, noParties).filter((f) => !f.stepId);
    expect(flags.map((f) => f.code).sort()).toEqual(["no-end", "no-start"]);
    expect(validateProcess(process([]), noParties)).toEqual([]);
  });

  it("unreachable and orphan", () => {
    const p = linearProcess();
    p.steps.push(step({ id: "x", displayNo: 7, next: [{ targetId: "b" }] }));
    const c = codes(validateProcess(p, noParties), "x");
    expect(c).toContain("unreachable");
    expect(c).toContain("orphan");
  });

  it("dead-end covers a dead cycle", () => {
    const p = process([
      step({ id: "a", displayNo: 1, type: "start", next: [{ targetId: "b" }, { targetId: "z" }] }),
      step({ id: "b", displayNo: 2, next: [{ targetId: "c" }] }),
      step({ id: "c", displayNo: 3, next: [{ targetId: "b" }] }),
      step({ id: "z", displayNo: 4, type: "end" }),
    ]);
    const flags = validateProcess(p, noParties);
    expect(codes(flags, "b")).toContain("dead-end");
    expect(codes(flags, "c")).toContain("dead-end");
    expect(codes(flags, "a")).not.toContain("dead-end");
  });

  it("a live cycle produces no flags", () => {
    const p = party("Ops");
    const proc = process(
      [
        step({ id: "a", displayNo: 1, type: "start", ownerId: p.id, next: [{ targetId: "b" }] }),
        step({ id: "b", displayNo: 2, ownerId: p.id, next: [{ targetId: "c" }] }),
        step({
          id: "c",
          displayNo: 3,
          type: "decision",
          ownerId: p.id,
          next: [
            { targetId: "b", label: "Retry" },
            { targetId: "z", label: "Done" },
          ],
        }),
        step({ id: "z", displayNo: 4, type: "end", ownerId: p.id }),
      ],
      { laneOrder: [p.id] },
    );
    expect(validateProcess(proc, { parties: [p] })).toEqual([]);
  });

  it("unassigned-owner", () => {
    const p = process([
      step({ id: "a", displayNo: 1, type: "start", next: [{ targetId: "b" }] }),
      step({ id: "b", displayNo: 2, type: "end" }),
    ]);
    expect(codes(validateProcess(p, noParties), "a")).toContain("unassigned-owner");
  });
});

describe("helpers", () => {
  it("flagsByStep groups and worstSeverity ranks", () => {
    const p = process([step({ id: "a", displayNo: 1, type: "start", next: [{ targetId: "a" }] })]);
    const m = flagsByStep(validateProcess(p, noParties));
    expect(worstSeverity(m.get("a"))).toBe("error");
    expect(worstSeverity(undefined)).toBeNull();
    expect(worstSeverity([])).toBeNull();
  });
});
