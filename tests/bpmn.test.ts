import { describe, expect, it } from "vitest";
import { buildLayoutGraph, terminateDashedEdges } from "../src/graph/build-graph";
import { process, step } from "./fixtures";

/**
 * start -> fork task "a" -> { "b" -> terminate end "t",  "c" -> "d" -> end "e" }
 * Branch c is still running when t terminates, so c's downstream edges are dashed.
 */
function forkWithTerminate() {
  return process([
    step({ id: "s", displayNo: 1, type: "start", next: [{ targetId: "a" }] }),
    step({ id: "a", displayNo: 2, next: [{ targetId: "b" }, { targetId: "c" }] }),
    step({ id: "b", displayNo: 3, next: [{ targetId: "t" }] }),
    step({ id: "t", displayNo: 4, type: "end", endKind: "terminate" }),
    step({ id: "c", displayNo: 5, next: [{ targetId: "d" }] }),
    step({ id: "d", displayNo: 6, next: [{ targetId: "e" }] }),
    step({ id: "e", displayNo: 7, type: "end" }),
  ]);
}

describe("bpmn terminate handling", () => {
  it("dashes the branch that is cut short by a terminate end", () => {
    const dashed = terminateDashedEdges(forkWithTerminate());
    expect([...dashed].sort()).toEqual(["a->c", "c->d", "d->e"]);
  });

  it("marks those edges dashed in the bpmn graph but not in simple mode", () => {
    const p = forkWithTerminate();
    const bpmn = buildLayoutGraph(p, [], "bpmn");
    const dashedIds = bpmn.edges
      .filter((e) => e.dashed)
      .map((e) => e.id)
      .sort();
    expect(dashedIds).toEqual(["a->c", "c->d", "d->e"]);
    expect(bpmn.edges.find((e) => e.id === "a->b")?.dashed).toBeUndefined();
    // the fork gateway carries the branch edges
    expect(
      bpmn.edges
        .filter((e) => e.from === "gw:fork:a")
        .map((e) => e.to)
        .sort(),
    ).toEqual(["b", "c"]);
    const simple = buildLayoutGraph(p, [], "simple");
    expect(simple.edges.some((e) => e.dashed)).toBe(false);
  });

  it("does nothing without a terminate end or when every branch terminates", () => {
    const p = forkWithTerminate();
    p.steps.find((s) => s.id === "t")!.endKind = "normal";
    expect(terminateDashedEdges(p).size).toBe(0);
    const both = forkWithTerminate();
    both.steps.find((s) => s.id === "e")!.endKind = "terminate";
    expect(terminateDashedEdges(both).size).toBe(0);
  });
});
