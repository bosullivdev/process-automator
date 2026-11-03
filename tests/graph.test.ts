import { describe, expect, it } from "vitest";
import { canReachEnd, findBackEdges, hasCycle, reachableFromStarts } from "../src/graph/analysis";
import { linearProcess, process, step } from "./fixtures";

describe("graph analysis", () => {
  it("reachability from starts", () => {
    const p = linearProcess();
    expect([...reachableFromStarts(p)].sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("unreachable steps are excluded", () => {
    const p = linearProcess();
    p.steps.push(step({ id: "x", displayNo: 7, next: [{ targetId: "b" }] }));
    expect(reachableFromStarts(p).has("x")).toBe(false);
  });

  it("reachability to ends", () => {
    const p = linearProcess();
    p.steps.push(step({ id: "x", displayNo: 7 }));
    const r = canReachEnd(p);
    expect(r.has("a")).toBe(true);
    expect(r.has("x")).toBe(false);
  });

  it("ignores links to missing targets", () => {
    const p = process([
      step({ id: "a", displayNo: 1, type: "start", next: [{ targetId: "ghost" }] }),
    ]);
    expect(reachableFromStarts(p)).toEqual(new Set(["a"]));
    expect(findBackEdges(p)).toEqual([]);
  });

  it("detects cycles and reports the back edge deterministically", () => {
    const p = process([
      step({ id: "a", displayNo: 1, type: "start", next: [{ targetId: "b" }] }),
      step({ id: "b", displayNo: 2, next: [{ targetId: "c" }] }),
      step({ id: "c", displayNo: 3, next: [{ targetId: "b" }, { targetId: "d" }] }),
      step({ id: "d", displayNo: 4, type: "end" }),
    ]);
    expect(hasCycle(p)).toBe(true);
    expect(findBackEdges(p)).toEqual([{ from: "c", to: "b" }]);
    expect(hasCycle(linearProcess())).toBe(false);
  });

  it("detects a dead cycle with no start", () => {
    const p = process([
      step({ id: "a", displayNo: 1, next: [{ targetId: "b" }] }),
      step({ id: "b", displayNo: 2, next: [{ targetId: "a" }] }),
    ]);
    expect(hasCycle(p)).toBe(true);
    expect(findBackEdges(p)).toEqual([{ from: "b", to: "a" }]);
  });
});
