import { describe, expect, it } from "vitest";
import ELK from "elkjs/lib/elk.bundled.js";
import { buildLayoutGraph } from "../src/graph/build-graph";
import { placeLabels, type LabelSpec, type Rect } from "../src/graph/label-placement";
import { layoutGraph } from "../src/graph/layout";
import { party, process, step } from "./fixtures";

const elk = new ELK();
const none = { shapes: [], names: [] };
const spec = (id: string, points: Array<[number, number]>, width = 30): LabelSpec => ({
  id,
  sourceId: "d",
  points: points.map(([x, y]) => ({ x, y })),
  width,
  height: 18,
  tail: 0,
});
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe("placeLabels", () => {
  it("puts a label near the decision on a lone arrow", () => {
    const yes = spec("yes", [
      [100, 50],
      [300, 50],
    ]);
    const at = placeLabels([yes], [yes], none).get("yes")!;
    expect(at.y).toBe(50);
    expect(at.x).toBe(100 + 6 + 15);
  });

  it("keeps a label off the trunk shared with a sibling outcome", () => {
    const yes = spec("yes", [
      [100, 50],
      [300, 50],
    ]);
    const no = spec("no", [
      [100, 50],
      [160, 50],
      [160, 200],
      [300, 200],
    ]);
    const placed = placeLabels([yes, no], [yes, no], none);
    // "Yes" sits past the point where "No" turns off; "No" sits on its own vertical.
    expect(placed.get("yes")!.x - 15).toBeGreaterThan(160);
    expect(placed.get("yes")!.y).toBe(50);
    expect(placed.get("no")!.x).toBe(160);
    expect(placed.get("no")!.y - 9).toBeGreaterThan(50);
  });

  it("moves along the arrow past a step and past an arrow that crosses it", () => {
    const yes = spec("yes", [
      [100, 50],
      [400, 50],
    ]);
    const crossing = {
      id: "x",
      sourceId: "other",
      points: [
        { x: 130, y: 0 },
        { x: 130, y: 100 },
      ],
    };
    const shapes = [{ x0: 150, y0: 40, x1: 200, y1: 60 }];
    const at = placeLabels([yes], [yes, crossing], { shapes, names: [] }).get("yes")!;
    expect(at.x - 15).toBeGreaterThanOrEqual(200);
  });

  it("never stacks two labels on each other", () => {
    const a = spec("a", [
      [100, 50],
      [100, 200],
    ]);
    const b = {
      ...spec("b", [
        [104, 50],
        [104, 200],
      ]),
      sourceId: "e",
    };
    const placed = placeLabels([a, b], [a, b], none);
    expect(Math.abs(placed.get("a")!.y - placed.get("b")!.y)).toBeGreaterThanOrEqual(18);
  });

  it("still places a label on an arrow too short to hold it", () => {
    const tiny = spec("tiny", [
      [100, 50],
      [110, 50],
    ]);
    expect(placeLabels([tiny], [tiny], none).get("tiny")).toEqual({ x: 105, y: 50 });
  });
});

describe("outcome labels in a layout", () => {
  it("keeps every label on its own arrow, clear of steps and other labels", async () => {
    const a = party("Sales", 0);
    const b = party("Operations", 1);
    const proc = process(
      [
        step({ id: "s", displayNo: 1, type: "start", ownerId: a.id, next: [{ targetId: "d" }] }),
        step({
          id: "d",
          displayNo: 2,
          type: "decision",
          ownerId: a.id,
          next: [
            { targetId: "t1", label: "In stock", isDefault: true },
            { targetId: "t2", label: "Partly available" },
            { targetId: "t3", label: "Out of stock" },
            { targetId: "e2", label: "Discontinued" },
          ],
        }),
        step({ id: "t1", displayNo: 3, ownerId: a.id, next: [{ targetId: "e1" }] }),
        step({ id: "t2", displayNo: 4, ownerId: a.id, next: [{ targetId: "e1" }] }),
        step({ id: "t3", displayNo: 5, ownerId: b.id, next: [{ targetId: "e1" }] }),
        step({ id: "e1", displayNo: 6, type: "end", ownerId: b.id }),
        step({ id: "e2", displayNo: 7, type: "end", ownerId: b.id }),
      ],
      { laneOrder: [a.id, b.id] },
    );
    for (const orientation of ["horizontal", "vertical"] as const) {
      const graph = buildLayoutGraph(proc, [a, b], "simple", orientation);
      const r = await layoutGraph(graph, orientation, elk);
      const pills = new Map<string, Rect>();
      for (const e of r.edges) {
        const ge = graph.edges.find((x) => x.id === e.id)!;
        if (!ge.label) continue;
        const at = e.labelAt!;
        const w = ge.label.length * 5.8 + 14;
        const pill = { x0: at.x - w / 2, y0: at.y - 9, x1: at.x + w / 2, y1: at.y + 9 };
        pills.set(e.id, pill);
        // On its own arrow.
        const onRoute = e.points.some((p, i) => {
          if (i === 0) return false;
          const q = e.points[i - 1];
          return (
            at.x >= Math.min(p.x, q.x) - 0.01 &&
            at.x <= Math.max(p.x, q.x) + 0.01 &&
            at.y >= Math.min(p.y, q.y) - 0.01 &&
            at.y <= Math.max(p.y, q.y) + 0.01
          );
        });
        expect(onRoute, `${orientation} ${ge.label} on its arrow`).toBe(true);
        // Inside the canvas and clear of every step.
        expect(pill.x0).toBeGreaterThanOrEqual(0);
        expect(pill.y0).toBeGreaterThanOrEqual(0);
        expect(pill.x1).toBeLessThanOrEqual(r.width);
        expect(pill.y1).toBeLessThanOrEqual(r.height);
        for (const n of r.nodes) {
          const g = graph.nodes.find((x) => x.id === n.id)!;
          const shape = {
            x0: n.x + g.cx - g.shapeWidth / 2,
            y0: n.y + g.cy - g.shapeHeight / 2,
            x1: n.x + g.cx + g.shapeWidth / 2,
            y1: n.y + g.cy + g.shapeHeight / 2,
          };
          expect(overlaps(pill, shape), `${orientation} ${ge.label} over ${n.id}`).toBe(false);
        }
        // Not on a line that belongs to another outcome of the same decision.
        for (const o of r.edges) {
          const og = graph.edges.find((x) => x.id === o.id)!;
          if (o.id === e.id || og.from !== ge.from) continue;
          const touches = o.points.some((p, i) => {
            if (i === 0) return false;
            const q = o.points[i - 1];
            return (
              Math.min(p.x, q.x) <= pill.x1 &&
              Math.max(p.x, q.x) >= pill.x0 &&
              Math.min(p.y, q.y) <= pill.y1 &&
              Math.max(p.y, q.y) >= pill.y0
            );
          });
          expect(touches, `${orientation} ${ge.label} on sibling ${og.label}`).toBe(false);
        }
      }
      const list = [...pills.values()];
      list.forEach((p, i) => list.slice(i + 1).forEach((q) => expect(overlaps(p, q)).toBe(false)));
    }
  });
});
