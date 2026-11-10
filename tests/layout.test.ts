import { describe, expect, it } from "vitest";
import ELK from "elkjs/lib/elk.bundled.js";
import { buildLayoutGraph } from "../src/graph/build-graph";
import { layoutGraph } from "../src/graph/layout";
import { UNASSIGNED_LANE, type LayoutResult } from "../src/graph/layout-types";
import { party, process, step } from "./fixtures";

const elk = new ELK();

/** Shape centre and edges of a laid-out node in map coordinates (horizontal orientation). */
function shape(graph: ReturnType<typeof buildLayoutGraph>, r: LayoutResult, id: string) {
  const g = graph.nodes.find((n) => n.id === id)!;
  const n = r.nodes.find((p) => p.id === id)!;
  return {
    cx: n.x + g.cx,
    cy: n.y + g.cy,
    top: n.y + g.cy - g.shapeHeight / 2,
    bottom: n.y + g.cy + g.shapeHeight / 2,
    left: n.x + g.cx - g.shapeWidth / 2,
    right: n.x + g.cx + g.shapeWidth / 2,
  };
}

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

  it("places every node inside its lane and loops back-edges into the target's shape", async () => {
    const { proc, parties } = fixture();
    const graph = buildLayoutGraph(proc, parties, "simple");
    const r = await layoutGraph(graph, "horizontal", elk);
    const laneOf = new Map(graph.nodes.map((n) => [n.id, n.laneId]));
    for (const n of r.nodes) {
      const lane = r.lanes.find((l) => l.id === laneOf.get(n.id))!;
      expect(n.y).toBeGreaterThanOrEqual(lane.y);
      expect(n.y + n.height).toBeLessThanOrEqual(lane.y + lane.height);
    }
    // The "Rework" feedback loops back inside the band and enters b from above or below.
    const bandBottom = Math.max(...r.lanes.map((l) => l.y + l.height));
    const back = r.edges.find((e) => e.id === "c->b")!;
    expect(Math.max(...back.points.map((p) => p.y))).toBeLessThan(bandBottom);
    const b = shape(graph, r, "b");
    const last = back.points[back.points.length - 1];
    expect(last.x).toBeCloseTo(b.cx);
    expect([b.top, b.bottom].some((y) => Math.abs(y - last.y) < 0.01)).toBe(true);
    expect(r.height).toBeGreaterThanOrEqual(bandBottom);
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

  it("nests a fan-in from two lanes so the nearer arrow does not cross the farther one", async () => {
    const top = party("Department head", 0);
    const bottom = party("Executive board", 1);
    const third = party("Faculty finance", 2);
    // top: start -> delegate(a2); bottom: start -> delegate(b2); both -> populate (third lane)
    const proc = process(
      [
        step({
          id: "a1",
          displayNo: 1,
          type: "start",
          ownerId: top.id,
          next: [{ targetId: "a2" }],
        }),
        step({ id: "a2", displayNo: 2, ownerId: top.id, next: [{ targetId: "c" }] }),
        step({
          id: "b1",
          displayNo: 3,
          type: "start",
          ownerId: bottom.id,
          next: [{ targetId: "b2" }],
        }),
        step({ id: "b2", displayNo: 4, ownerId: bottom.id, next: [{ targetId: "c" }] }),
        step({ id: "c", displayNo: 5, ownerId: third.id, next: [{ targetId: "e" }] }),
        step({ id: "e", displayNo: 6, type: "end", ownerId: third.id }),
      ],
      { laneOrder: [top.id, bottom.id, third.id] },
    );
    for (const orientation of ["horizontal", "vertical"] as const) {
      const r = await layoutGraph(
        buildLayoutGraph(proc, [top, bottom, third], "simple"),
        orientation,
        elk,
      );
      const far = r.edges.find((e) => e.id === "a2->c")!;
      const near = r.edges.find((e) => e.id === "b2->c")!;
      expect(crossings(far.points, near.points), orientation).toBe(0);
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

describe("feedback loops", () => {
  /** start -> Review -> "Understood?" with "No" back to Review, all in one lane. */
  function loopFixture() {
    const fin = party("Finance", 0);
    const proc = process(
      [
        step({ id: "s", displayNo: 1, type: "start", ownerId: fin.id, next: [{ targetId: "r" }] }),
        step({
          id: "r",
          displayNo: 2,
          name: "Review central targets",
          ownerId: fin.id,
          next: [{ targetId: "q" }],
        }),
        step({
          id: "q",
          displayNo: 3,
          type: "decision",
          name: "Are the requirements understood?",
          ownerId: fin.id,
          next: [
            { targetId: "e", label: "Yes" },
            { targetId: "r", label: "No" },
          ],
        }),
        step({ id: "e", displayNo: 4, type: "end", ownerId: fin.id }),
      ],
      { laneOrder: [fin.id] },
    );
    return { proc, parties: [fin] };
  }

  it("leaves the decision's bottom, runs under the row and enters the previous step's bottom", async () => {
    const { proc, parties } = loopFixture();
    const graph = buildLayoutGraph(proc, parties, "simple");
    const r = await layoutGraph(graph, "horizontal", elk);
    const q = shape(graph, r, "q");
    const rv = shape(graph, r, "r");
    const no = r.edges.find((e) => e.id === "q->r")!;
    expect(no.points).toHaveLength(4);
    const [p0, p1, p2, p3] = no.points;
    expect(p0.x).toBeCloseTo(q.cx);
    expect(p0.y).toBeCloseTo(q.bottom);
    expect(p1.x).toBeCloseTo(q.cx);
    expect(p2.y).toBe(p1.y);
    expect(p1.y).toBeGreaterThan(q.bottom);
    expect(p3.x).toBeCloseTo(rv.cx);
    expect(p3.y).toBeCloseTo(rv.bottom);
    // Stays inside the lane; the band grows no extra rail below it.
    const lane = r.lanes[0];
    expect(p1.y).toBeLessThan(lane.y + lane.height);
    expect(r.height).toBeLessThanOrEqual(lane.y + lane.height + 8);
    // The "No" pill sits on the return run, just left of the corner under the diamond.
    expect(no.labelAt!.y).toBe(p1.y);
    expect(no.labelAt!.x).toBeLessThan(q.cx);
    expect(no.labelAt!.x).toBeGreaterThan(rv.cx);
    // The decision's name moves above the diamond, out of the loop's way.
    expect(r.nodes.find((n) => n.id === "q")!.labelSide).toBe("above");
    // The forward "Yes" still leaves the front of the diamond.
    const yes = r.edges.find((e) => e.id === "q->e")!;
    expect(yes.points[0].x).toBeCloseTo(q.right);
  });

  it("loops the same way in vertical orientation, along the lane axis", async () => {
    const { proc, parties } = loopFixture();
    const graph = buildLayoutGraph(proc, parties, "simple");
    const r = await layoutGraph(graph, "vertical", elk);
    const no = r.edges.find((e) => e.id === "q->r")!;
    expect(no.points).toHaveLength(4);
    const qn = r.nodes.find((n) => n.id === "q")!;
    const rn = r.nodes.find((n) => n.id === "r")!;
    const [p0, p1, , p3] = no.points;
    // Leaves the diamond's right side, runs back up beside the column, enters the task's right side.
    expect(p0.x).toBeGreaterThan(qn.x + qn.width / 2);
    expect(p1.x).toBeGreaterThan(p0.x);
    expect(p3.y).toBeLessThan(qn.y);
    expect(p3.x).toBeGreaterThan(rn.x + rn.width / 2);
    expect(r.nodes.find((n) => n.id === "q")!.labelSide).toBe("left");
  });

  /** True when some segment of the polyline passes through the rectangle's interior. */
  const passesThrough = (
    pts: { x: number; y: number }[],
    r: { x0: number; x1: number; y0: number; y1: number },
  ) =>
    pts.some((b, i) => {
      if (i === 0) return false;
      const a = pts[i - 1];
      return (
        Math.max(a.x, b.x) > r.x0 + 0.5 &&
        Math.min(a.x, b.x) < r.x1 - 0.5 &&
        Math.max(a.y, b.y) > r.y0 + 0.5 &&
        Math.min(a.y, b.y) < r.y1 - 0.5
      );
    });

  it("never runs a loop through a decision's name, and uses the front when both sides are taken", async () => {
    const fin = party("Finance", 0);
    const dept = party("Department head", 1);
    // issue -> q; q: Yes -> review, No -> develop; review -> q and develop -> q loop back.
    // "No" wants the diamond's bottom and the name must then move up, so
    // neither side is free for a loop: both come in at the front, sharing a
    // trunk, and "No" keeps its side exit.
    const proc = process(
      [
        step({
          id: "issue",
          displayNo: 1,
          type: "start",
          ownerId: fin.id,
          next: [{ targetId: "q" }],
        }),
        step({
          id: "q",
          displayNo: 2,
          type: "decision",
          name: "Are the requirements understood?",
          ownerId: dept.id,
          next: [
            { targetId: "review", label: "Yes" },
            { targetId: "develop", label: "No" },
          ],
        }),
        step({
          id: "review",
          displayNo: 3,
          ownerId: dept.id,
          next: [{ targetId: "q" }, { targetId: "e" }],
        }),
        step({ id: "develop", displayNo: 4, ownerId: dept.id, next: [{ targetId: "q" }] }),
        step({ id: "e", displayNo: 5, type: "end", ownerId: dept.id }),
      ],
      { laneOrder: [fin.id, dept.id] },
    );
    const graph = buildLayoutGraph(proc, [fin, dept], "simple");
    const r = await layoutGraph(graph, "horizontal", elk);
    const qn = r.nodes.find((n) => n.id === "q")!;
    const q = shape(graph, r, "q");
    const first = r.edges.find((e) => e.id === "review->q")!;
    const second = r.edges.find((e) => e.id === "develop->q")!;
    expect(r.nodes.find((n) => n.id === "review")!.layer).toBeGreaterThan(qn.layer);
    // Both loops: round through the channel before the diamond and in at its left point.
    const l1 = first.points[first.points.length - 1];
    expect(l1.x).toBeCloseTo(q.left);
    expect(l1.y).toBeCloseTo(q.cy);
    expect(qn.labelSide).toBe("above");
    const no = r.edges.find((e) => e.id === "q->develop")!;
    expect(no.points[0].y).toBeCloseTo(q.bottom);
    const l2 = second.points[second.points.length - 1];
    expect(l2.x).toBeCloseTo(q.left);
    expect(l2.y).toBeCloseTo(q.cy);
    expect(second.points.length).toBeGreaterThanOrEqual(5);
    // Neither loop passes through the name block above the diamond.
    const name = { x0: qn.x, x1: qn.x + qn.width, y0: qn.y, y1: q.top };
    expect(passesThrough(first.points, name)).toBe(false);
    expect(passesThrough(second.points, name)).toBe(false);
    // Both stay inside the band.
    const bandBottom = Math.max(...r.lanes.map((l) => l.y + l.height));
    for (const p of [...first.points, ...second.points]) expect(p.y).toBeLessThan(bandBottom);
  });

  it("loops through the channel into the front of a step several lanes away", async () => {
    const sales = party("Sales", 0);
    const ops = party("Ops", 1);
    const fin = party("Finance", 2);
    // b (Sales, layer 1) <- c (Finance, layer 4); Ops and Finance steps fill both
    // columns in every lane between, so no side entry is clear.
    const proc = process(
      [
        step({
          id: "a",
          displayNo: 1,
          type: "start",
          ownerId: sales.id,
          next: [{ targetId: "b" }, { targetId: "o1" }, { targetId: "f1" }],
        }),
        step({ id: "b", displayNo: 2, ownerId: sales.id, next: [{ targetId: "o2" }] }),
        step({ id: "o1", displayNo: 3, ownerId: ops.id, next: [{ targetId: "o2" }] }),
        step({ id: "o2", displayNo: 4, ownerId: ops.id, next: [{ targetId: "o3" }] }),
        step({
          id: "o3",
          displayNo: 5,
          ownerId: ops.id,
          next: [{ targetId: "c" }, { targetId: "s3" }, { targetId: "o4" }],
        }),
        step({ id: "s3", displayNo: 6, ownerId: sales.id, next: [{ targetId: "e" }] }),
        step({ id: "o4", displayNo: 12, ownerId: ops.id, next: [{ targetId: "e" }] }),
        step({ id: "f1", displayNo: 7, ownerId: fin.id, next: [{ targetId: "f2" }] }),
        step({ id: "f2", displayNo: 8, ownerId: fin.id, next: [{ targetId: "f3" }] }),
        step({ id: "f3", displayNo: 9, ownerId: fin.id, next: [{ targetId: "e" }] }),
        step({
          id: "c",
          displayNo: 10,
          type: "decision",
          ownerId: fin.id,
          next: [
            { targetId: "e", label: "Done" },
            { targetId: "b", label: "Again" },
          ],
        }),
        step({ id: "e", displayNo: 11, type: "end", ownerId: fin.id }),
      ],
      { laneOrder: [sales.id, ops.id, fin.id] },
    );
    const graph = buildLayoutGraph(proc, [sales, ops, fin], "simple");
    const r = await layoutGraph(graph, "horizontal", elk);
    const b = shape(graph, r, "b");
    const back = r.edges.find((e) => e.id === "c->b")!;
    const last = back.points[back.points.length - 1];
    expect(last.x).toBeCloseTo(b.left);
    expect(last.y).toBeCloseTo(b.cy);
    const bandBottom = Math.max(...r.lanes.map((l) => l.y + l.height));
    expect(Math.max(...back.points.map((p) => p.y))).toBeLessThan(bandBottom);
    // The vertical runs in the node-free gap before b's column, so it touches no step.
    for (const n of r.nodes) {
      if (n.id === "b" || n.id === "c") continue;
      const box = { x0: n.x, x1: n.x + n.width, y0: n.y, y1: n.y + n.height };
      expect(passesThrough(back.points, box), n.id).toBe(false);
    }
  });

  it("lets two loops from one step share its exit and stay inside the band", async () => {
    const fin = party("Finance", 0);
    // s, b and d all lead to c, which (with a technology pill below) loops back
    // to both b and d. Both loops leave c's bottom on one trunk and part on
    // their rails.
    const proc = process(
      [
        step({
          id: "s",
          displayNo: 1,
          type: "start",
          ownerId: fin.id,
          next: [{ targetId: "b" }, { targetId: "c" }],
        }),
        step({
          id: "b",
          displayNo: 2,
          ownerId: fin.id,
          next: [{ targetId: "d" }, { targetId: "c" }],
        }),
        step({ id: "d", displayNo: 3, ownerId: fin.id, next: [{ targetId: "c" }] }),
        step({
          id: "c",
          displayNo: 4,
          ownerId: fin.id,
          technology: "Axiom",
          next: [{ targetId: "b" }, { targetId: "d" }],
        }),
      ],
      { laneOrder: [fin.id] },
    );
    const graph = buildLayoutGraph(proc, [fin], "simple");
    const r = await layoutGraph(graph, "horizontal", elk);
    const bandBottom = Math.max(...r.lanes.map((l) => l.y + l.height));
    const toB = r.edges.find((e) => e.id === "c->b")!;
    const toD = r.edges.find((e) => e.id === "c->d")!;
    expect(Math.max(...toB.points.map((p) => p.y))).toBeLessThan(bandBottom);
    expect(Math.max(...toD.points.map((p) => p.y))).toBeLessThan(bandBottom);
    expect(toB.points[0]).toEqual(toD.points[0]);
    // b and d send their own arrows to c out of their bottoms, so the loops come
    // in over the top; c's pill stays below its exit-free side.
    const c = shape(graph, r, "c");
    expect(toB.points[0].y).toBeCloseTo(c.top);
    expect(r.nodes.find((n) => n.id === "c")!.labelSide).toBe("below");
    expect(r.height).toBeLessThanOrEqual(bandBottom + 8);
  });
});

describe("lane headers", () => {
  const LONG = "Financial planning and analysis business partnering team";

  function twoLanes(nameA: string, nameB: string) {
    const a = party(nameA, 0);
    const b = party(nameB, 1);
    const proc = process(
      [
        step({ id: "s", displayNo: 1, type: "start", ownerId: a.id, next: [{ targetId: "t" }] }),
        step({ id: "t", displayNo: 2, ownerId: b.id, next: [{ targetId: "e" }] }),
        step({ id: "e", displayNo: 3, type: "end", ownerId: a.id }),
      ],
      { laneOrder: [a.id, b.id] },
    );
    return { proc, parties: [a, b], a, b };
  }

  it("keeps a one-line band for short names", async () => {
    const { proc, parties } = twoLanes("Sales", "Ops");
    const graph = buildLayoutGraph(proc, parties, "simple");
    const r = await layoutGraph(graph, "horizontal", elk);
    expect(r.lanes.map((l) => l.header.lines)).toEqual([["Sales"], ["Ops"]]);
    expect(r.lanes.every((l) => l.header.width === 36)).toBe(true);
  });

  it("wraps a long name along the lane and thickens every band to fit", async () => {
    const { proc, parties, a, b } = twoLanes(LONG, "Ops");
    const graph = buildLayoutGraph(proc, parties, "simple");
    const r = await layoutGraph(graph, "horizontal", elk);
    const la = r.lanes.find((l) => l.id === a.id)!;
    const lb = r.lanes.find((l) => l.id === b.id)!;
    expect(la.header.lines.length).toBeGreaterThan(1);
    expect(la.header.lines.length).toBeLessThanOrEqual(3);
    expect(la.header.lines.join(" ")).toBe(LONG);
    expect(la.header.width).toBe(la.header.lines.length * 14 + 22);
    // Bands share one thickness so the columns line up across lanes.
    expect(lb.header.width).toBe(la.header.width);
    expect(lb.header.lines).toEqual(["Ops"]);
    // Every line fits inside its lane's extent.
    const widest = Math.max(...la.header.lines.map((s) => s.length));
    expect(widest * 12 * 0.62).toBeLessThanOrEqual(la.height - 24);
    // The first column still starts after the band.
    const firstX = Math.min(...r.nodes.map((n) => n.x));
    expect(firstX).toBeGreaterThan(la.header.width);
  });

  it("widens the lane when even three lines cannot hold the name, keeping nodes inside", async () => {
    const { proc, parties, a } = twoLanes(`${LONG} ${LONG} ${LONG}`, "Ops");
    const graph = buildLayoutGraph(proc, parties, "simple");
    const r = await layoutGraph(graph, "horizontal", elk);
    const la = r.lanes.find((l) => l.id === a.id)!;
    const plain = await layoutGraph(
      buildLayoutGraph(twoLanes("A", "B").proc, twoLanes("A", "B").parties, "simple"),
      "horizontal",
      elk,
    );
    expect(la.header.lines.length).toBe(3);
    expect(la.height).toBeGreaterThan(plain.lanes[0].height);
    for (const id of ["s", "e"]) {
      const n = r.nodes.find((p) => p.id === id)!;
      expect(n.y).toBeGreaterThanOrEqual(la.y);
      expect(n.y + n.height).toBeLessThanOrEqual(la.y + la.height);
    }
  });

  it("wraps across the lane width in vertical orientation", async () => {
    const { proc, parties, a } = twoLanes(LONG, "Ops");
    const graph = buildLayoutGraph(proc, parties, "simple");
    const r = await layoutGraph(graph, "vertical", elk);
    const la = r.lanes.find((l) => l.id === a.id)!;
    expect(la.header.lines.length).toBeGreaterThan(1);
    expect(la.header.height).toBe(la.header.lines.length * 14 + 22);
    expect(la.header.width).toBe(la.width);
  });
});
