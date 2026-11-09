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

/** Orthogonal polyline segments of two edges that cross each other. */
function crossings(a: { x: number; y: number }[], b: { x: number; y: number }[]): number {
  const segs = (pts: { x: number; y: number }[]) =>
    pts.slice(1).map((p, i) => ({ p: pts[i], q: p }));
  let n = 0;
  for (const s of segs(a)) {
    for (const t of segs(b)) {
      const sV = Math.abs(s.p.x - s.q.x) < 0.01;
      const tV = Math.abs(t.p.x - t.q.x) < 0.01;
      if (sV === tV) continue;
      const v = sV ? s : t;
      const h = sV ? t : s;
      const x = v.p.x;
      const y = h.p.y;
      const within = (c: number, lo: number, hi: number) =>
        c > Math.min(lo, hi) + 0.01 && c < Math.max(lo, hi) - 0.01;
      if (within(x, h.p.x, h.q.x) && within(y, v.p.y, v.q.y)) n++;
    }
  }
  return n;
}

describe("decision side exits", () => {
  it("does not cross outcomes that fan out to stacked steps in another lane", async () => {
    // "Mayo or ham?" in the lower lane, Eat and Bin stacked in the upper lane:
    // the arrow to the farther step takes the side exit and the nearer one
    // turns in the channel, so neither crosses the other.
    const me = party("Me", 0);
    const kitchen = party("Kitchen", 1);
    const proc = process(
      [
        step({
          id: "buy",
          displayNo: 1,
          type: "start",
          ownerId: me.id,
          next: [{ targetId: "make" }],
        }),
        step({ id: "make", displayNo: 2, ownerId: kitchen.id, next: [{ targetId: "which" }] }),
        step({
          id: "which",
          displayNo: 3,
          type: "decision",
          ownerId: kitchen.id,
          next: [
            { targetId: "bin", label: "Mayo" },
            { targetId: "eat", label: "Ham" },
          ],
        }),
        step({ id: "eat", displayNo: 4, type: "end", ownerId: me.id }),
        step({ id: "bin", displayNo: 5, type: "end", ownerId: me.id }),
      ],
      { laneOrder: [me.id, kitchen.id] },
    );
    for (const orientation of ["horizontal", "vertical"] as const) {
      const graph = buildLayoutGraph(proc, [me, kitchen], "simple", orientation);
      const r = await layoutGraph(graph, orientation, elk);
      const mayo = r.edges.find((e) => e.id === "which->bin")!;
      const ham = r.edges.find((e) => e.id === "which->eat")!;
      expect(crossings(mayo.points, ham.points), orientation).toBe(0);
    }
  });

  it("nests channel verticals so a fan-out downwards does not cross itself", async () => {
    const ops = party("Ops", 0);
    const proc = process(
      [
        step({ id: "s", displayNo: 1, type: "start", ownerId: ops.id, next: [{ targetId: "t" }] }),
        step({
          id: "t",
          displayNo: 2,
          ownerId: ops.id,
          next: [{ targetId: "a" }, { targetId: "b" }, { targetId: "c" }],
        }),
        step({ id: "a", displayNo: 3, type: "end", ownerId: ops.id }),
        step({ id: "b", displayNo: 4, type: "end", ownerId: ops.id }),
        step({ id: "c", displayNo: 5, type: "end", ownerId: ops.id }),
      ],
      { laneOrder: [ops.id] },
    );
    const graph = buildLayoutGraph(proc, [ops], "simple", "horizontal");
    const r = await layoutGraph(graph, "horizontal", elk);
    const out = ["t->a", "t->b", "t->c"].map((id) => r.edges.find((e) => e.id === id)!);
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++)
        expect(crossings(out[i].points, out[j].points), `${out[i].id} x ${out[j].id}`).toBe(0);
  });

  it("sends the farthest turning outcome out of the shape's side and moves the name away", async () => {
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
