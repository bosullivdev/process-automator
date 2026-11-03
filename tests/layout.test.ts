import { describe, expect, it } from "vitest";
import ELK from "elkjs/lib/elk.bundled.js";
import { buildLayoutGraph } from "../src/graph/build-graph";
import { layoutGraph } from "../src/graph/layout";
import { UNASSIGNED_LANE } from "../src/graph/layout-types";
import { party, process, step } from "./fixtures";

const elk = new ELK();

function fixture() {
  const sales = party("Sales", 0);
  const ops = party("Ops", 1);
  const proc = process(
    [
      step({ id: "a", displayNo: 1, type: "start", ownerId: sales.id, next: [{ targetId: "b" }] }),
      step({ id: "b", displayNo: 2, ownerId: sales.id, next: [{ targetId: "c" }] }),
      step({
        id: "c",
        displayNo: 3,
        type: "decision",
        ownerId: ops.id,
        next: [
          { targetId: "d", label: "Approve", isDefault: true },
          { targetId: "e", label: "Reject" },
          { targetId: "b", label: "Rework" },
        ],
      }),
      step({
        id: "d",
        displayNo: 4,
        ownerId: ops.id,
        next: [{ targetId: "f" }, { targetId: "g" }],
      }),
      step({ id: "e", displayNo: 5, type: "end", ownerId: sales.id }),
      step({ id: "f", displayNo: 6, ownerId: null, next: [{ targetId: "h" }] }),
      step({ id: "g", displayNo: 7, ownerId: ops.id, next: [{ targetId: "h" }] }),
      step({ id: "h", displayNo: 8, type: "end", ownerId: ops.id }),
    ],
    { laneOrder: [sales.id, ops.id] },
  );
  return { proc, parties: [sales, ops], sales, ops };
}

describe("layout", () => {
  it("is deterministic across ten runs in each orientation", async () => {
    const { proc, parties } = fixture();
    for (const orientation of ["horizontal", "vertical"] as const) {
      for (const mode of ["simple", "bpmn"] as const) {
        const graph = buildLayoutGraph(proc, parties, mode);
        const first = JSON.stringify(await layoutGraph(graph, orientation, elk));
        for (let i = 0; i < 9; i++) {
          const again = JSON.stringify(await layoutGraph(graph, orientation, elk));
          expect(again).toBe(first);
        }
      }
    }
  });

  it("stacks lanes along the lane axis and pins starts to the first layer", async () => {
    const { proc, parties, sales, ops } = fixture();
    const graph = buildLayoutGraph(proc, parties, "simple");
    expect(graph.laneOrder).toEqual([sales.id, ops.id, UNASSIGNED_LANE]);
    const h = await layoutGraph(graph, "horizontal", elk);
    expect(h.lanes.map((l) => l.id)).toEqual([sales.id, ops.id, UNASSIGNED_LANE]);
    expect(h.lanes[0].y).toBeLessThan(h.lanes[1].y);
    expect(h.lanes[0].x).toBe(h.lanes[1].x);
    const start = h.nodes.find((n) => n.id === "a")!;
    expect(start.layer).toBe(0);
    expect(h.nodes.every((n) => n.layer >= start.layer)).toBe(true);
    const v = await layoutGraph(graph, "vertical", elk);
    expect(v.lanes[0].x).toBeLessThan(v.lanes[1].x);
    expect(v.lanes[0].y).toBe(v.lanes[1].y);
    const vStart = v.nodes.find((n) => n.id === "a")!;
    const vEnd = v.nodes.find((n) => n.id === "h")!;
    expect(vStart.y).toBeLessThan(vEnd.y);
  });

  it("places every node inside its lane and routes back-edges outside the band", async () => {
    const { proc, parties } = fixture();
    const graph = buildLayoutGraph(proc, parties, "simple");
    const r = await layoutGraph(graph, "horizontal", elk);
    const laneOf = new Map(graph.nodes.map((n) => [n.id, n.laneId]));
    for (const n of r.nodes) {
      const lane = r.lanes.find((l) => l.id === laneOf.get(n.id))!;
      expect(n.y).toBeGreaterThanOrEqual(lane.y);
      expect(n.y + n.height).toBeLessThanOrEqual(lane.y + lane.height);
    }
    const bandBottom = Math.max(...r.lanes.map((l) => l.y + l.height));
    const back = r.edges.find((e) => e.id === "c->b")!;
    expect(Math.max(...back.points.map((p) => p.y))).toBeGreaterThan(bandBottom);
    expect(r.height).toBeGreaterThan(bandBottom);
    // labels exist for decision outcomes
    expect(
      r.edges
        .filter((e) => e.labelAt)
        .map((e) => e.id)
        .sort(),
    ).toEqual(["c->b", "c->d", "c->e"]);
  });

  it("inserts parallel gateways in bpmn mode only", async () => {
    const { proc, parties } = fixture();
    const simple = buildLayoutGraph(proc, parties, "simple");
    const bpmn = buildLayoutGraph(proc, parties, "bpmn");
    expect(simple.nodes.some((n) => n.kind === "fork" || n.kind === "join")).toBe(false);
    expect(bpmn.nodes.filter((n) => n.kind === "fork").map((n) => n.stepId)).toEqual(["d"]);
    expect(bpmn.nodes.filter((n) => n.kind === "join").map((n) => n.stepId)).toEqual(["b", "h"]);
    expect(bpmn.edges.some((e) => e.from === "gw:fork:d" && e.to === "f")).toBe(true);
    expect(bpmn.edges.some((e) => e.from === "gw:join:h" && e.to === "h")).toBe(true);
  });

  it("drops self links and broken links from the graph", () => {
    const proc = process([
      step({
        id: "a",
        displayNo: 1,
        type: "start",
        next: [{ targetId: "a" }, { targetId: "zz" }, { targetId: "b" }],
      }),
      step({ id: "b", displayNo: 2, type: "end" }),
    ]);
    const g = buildLayoutGraph(proc, [], "simple");
    expect(g.edges.map((e) => e.id)).toEqual(["a->b"]);
    expect(g.laneOrder).toEqual([UNASSIGNED_LANE]);
  });

  it("handles an empty process", async () => {
    const r = await layoutGraph(buildLayoutGraph(process([]), [], "simple"), "horizontal", elk);
    expect(r.nodes).toEqual([]);
    expect(r.width).toBe(0);
  });
});

describe("decision side exits", () => {
  it("sends the nearest turning outcome out of the shape's side and moves the name away", async () => {
    const sales = party("Sales", 0);
    const ops = party("Ops", 1);
    const proc = process(
      [
        step({
          id: "a",
          displayNo: 1,
          type: "start",
          ownerId: sales.id,
          next: [{ targetId: "d" }],
        }),
        step({
          id: "d",
          displayNo: 2,
          type: "decision",
          ownerId: sales.id,
          next: [
            { targetId: "x", label: "No" },
            { targetId: "y", label: "Yes" },
          ],
        }),
        step({ id: "x", displayNo: 3, type: "end", ownerId: sales.id }),
        step({ id: "y", displayNo: 4, type: "end", ownerId: ops.id }),
      ],
      { laneOrder: [sales.id, ops.id] },
    );
    const graph = buildLayoutGraph(proc, [sales, ops], "simple", "horizontal");
    const r = await layoutGraph(graph, "horizontal", elk);
    const d = r.nodes.find((n) => n.id === "d")!;
    const dn = graph.nodes.find((n) => n.id === "d")!;
    const shapeBottom = d.y + dn.cy + dn.shapeHeight / 2;
    const shapeRight = d.x + dn.cx + dn.shapeWidth / 2;
    const no = r.edges.find((e) => e.id === "d->x")!;
    const yes = r.edges.find((e) => e.id === "d->y")!;
    expect(no.points[0].x).toBeCloseTo(shapeRight);
    expect(yes.points[0].y).toBeCloseTo(shapeBottom);
    expect(yes.points[0].x).toBeCloseTo(d.x + dn.cx);
    expect(d.labelSide).toBe("above");
    expect(r.nodes.find((n) => n.id === "x")!.labelSide).toBe("below");
    // The pill for the side exit sits beyond the shape on its own line.
    expect(yes.labelAt!.x).toBeCloseTo(d.x + dn.cx);
    expect(yes.labelAt!.y).toBeGreaterThan(shapeBottom);
  });
});

describe("same-row alignment", () => {
  it("draws straight arrows between mixed shapes in one row", async () => {
    const ops = party("Ops", 0);
    const proc = process(
      [
        step({
          id: "s",
          displayNo: 1,
          type: "start",
          ownerId: ops.id,
          name: "Request received from a department",
          next: [{ targetId: "t" }],
        }),
        step({
          id: "t",
          displayNo: 2,
          ownerId: ops.id,
          name: "Submit the request within the finance system",
          next: [{ targetId: "d" }],
        }),
        step({
          id: "d",
          displayNo: 3,
          type: "decision",
          ownerId: ops.id,
          name: "Is the requisition charged to a research grant?",
          next: [
            { targetId: "e", label: "No" },
            { targetId: "f", label: "Yes" },
          ],
        }),
        step({ id: "e", displayNo: 4, type: "end", ownerId: ops.id, name: "Closed" }),
        step({
          id: "f",
          displayNo: 5,
          type: "end",
          ownerId: ops.id,
          name: "Referred to the research office",
        }),
      ],
      { laneOrder: [ops.id] },
    );
    for (const orientation of ["horizontal", "vertical"] as const) {
      const graph = buildLayoutGraph(proc, [ops], "simple", orientation);
      const r = await layoutGraph(graph, orientation, elk);
      for (const id of ["s->t", "t->d", "d->e"]) {
        const e = r.edges.find((x) => x.id === id)!;
        expect(e.points, `${orientation} ${id}`).toHaveLength(2);
      }
    }
  });
});
