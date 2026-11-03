import type { ELK, ElkNode } from "elkjs/lib/elk-api";
import type {
  LaneBox,
  LayoutGraph,
  LayoutResult,
  Orientation,
  Point,
  PositionedNode,
  RoutedEdge,
} from "./layout-types";

/*
 * Layout works in (f, l) space: f runs along the flow, l across the lanes.
 * ELK layered provides layer assignment and crossing-minimised order; lanes
 * are applied in a deterministic post-pass; edges are routed orthogonally
 * through node-free channels (between layers) and gutters (between rows), and
 * back-edges go around the outside of the lane band.
 */

const HEADER = 36; // lane header strip along the flow-axis start
const MARGIN_F = 48; // space between header and first column (also a channel for back-edges into layer 0)
const GAP_F = 64; // gap between layer columns
const GAP_L = 28; // gap between rows inside a lane
const LANE_PAD = 26; // lane padding on the lane axis
const BACK_STEP = 16; // spacing between stacked back-edge rails below the band
const END_MARGIN_F = 48; // space after the last column (channel for back-edges out of the last layer)

interface FLNode {
  id: string;
  layer: number;
  order: number; // ELK order within layer
  laneId: string;
  fExtent: number;
  lExtent: number;
  // assigned later
  f0: number;
  f1: number;
  l0: number;
  l1: number;
  row: number;
  rowBottom: number; // l of the bottom of this node's row slot
  rowGutter: number; // node-free l just below the row
  rowGutterUp: number; // node-free l just above the row
}

export const ELK_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.randomSeed": "1",
  "elk.separateConnectedComponents": "false",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.cycleBreaking.strategy": "GREEDY_MODEL_ORDER",
  "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.thoroughness": "7",
  "elk.spacing.nodeNode": "20",
  "elk.layered.spacing.nodeNodeBetweenLayers": "40",
};

function extents(width: number, height: number, orientation: Orientation): [number, number] {
  return orientation === "horizontal" ? [width, height] : [height, width];
}

export async function layoutGraph(
  graph: LayoutGraph,
  orientation: Orientation,
  elk: ELK,
): Promise<LayoutResult> {
  const toXY = (f: number, l: number): Point =>
    orientation === "horizontal" ? { x: f, y: l } : { x: l, y: f };

  if (graph.nodes.length === 0) {
    return { width: 0, height: 0, orientation, lanes: [], nodes: [], edges: [] };
  }

  // ---- 1. ELK: layers and order. Uniform flow extent so x identifies the layer.
  const NODE_F = Math.max(...graph.nodes.map((n) => extents(n.width, n.height, orientation)[0]));
  const elkGraph: ElkNode = {
    id: "root",
    layoutOptions: ELK_OPTIONS,
    children: graph.nodes.map((n) => ({
      id: n.id,
      width: NODE_F,
      height: extents(n.width, n.height, orientation)[1],
      layoutOptions: n.pinFirst ? { "elk.layered.layering.layerConstraint": "FIRST" } : undefined,
    })),
    edges: graph.edges.map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
  };
  const laid = await elk.layout(elkGraph);
  const xs = Array.from(new Set((laid.children ?? []).map((c) => Math.round(c.x ?? 0)))).sort(
    (a, b) => a - b,
  );
  const layerOfX = new Map(xs.map((x, i) => [x, i]));
  const nodes = new Map<string, FLNode>();
  for (const c of laid.children ?? []) {
    const n = graph.nodes.find((g) => g.id === c.id)!;
    const [fExtent, lExtent] = extents(n.width, n.height, orientation);
    nodes.set(n.id, {
      id: n.id,
      layer: layerOfX.get(Math.round(c.x ?? 0)) ?? 0,
      order: c.y ?? 0,
      laneId: n.laneId,
      fExtent,
      lExtent,
      f0: 0,
      f1: 0,
      l0: 0,
      l1: 0,
      row: 0,
      rowBottom: 0,
      rowGutter: 0,
      rowGutterUp: 0,
    });
  }
  const layerCount = xs.length;
  const colStart = (k: number) => HEADER + MARGIN_F + k * (NODE_F + GAP_F);

  // ---- 2. Lanes: rows per (lane, layer) in ELK order.
  const lanes: Array<{ id: string; l0: number; l1: number; rowH: number; rows: number }> = [];
  let l = 0;
  for (const laneId of graph.laneOrder) {
    const laneNodes = [...nodes.values()].filter((n) => n.laneId === laneId);
    if (laneNodes.length === 0) continue;
    const rowH = Math.max(...laneNodes.map((n) => n.lExtent));
    let rows = 1;
    for (let k = 0; k < layerCount; k++) {
      const inCell = laneNodes
        .filter((n) => n.layer === k)
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      rows = Math.max(rows, inCell.length);
      inCell.forEach((n, i) => (n.row = i));
    }
    const l0 = l;
    const height = LANE_PAD * 2 + rows * rowH + (rows - 1) * GAP_L;
    const l1 = l0 + height;
    for (const n of laneNodes) {
      const slotTop = l0 + LANE_PAD + n.row * (rowH + GAP_L);
      n.l0 = slotTop + (rowH - n.lExtent) / 2;
      n.l1 = n.l0 + n.lExtent;
      n.rowBottom = slotTop + rowH;
      n.rowGutter = n.row === rows - 1 ? l1 - LANE_PAD / 2 : n.rowBottom + GAP_L / 2;
      n.rowGutterUp = n.row === 0 ? l0 + LANE_PAD / 2 : slotTop - GAP_L / 2;
      n.f0 = colStart(n.layer) + (NODE_F - n.fExtent) / 2;
      n.f1 = n.f0 + n.fExtent;
    }
    lanes.push({ id: laneId, l0, l1, rowH, rows });
    l = l1;
  }
  const bandEnd = l;
  const fEnd = colStart(layerCount - 1) + NODE_F + END_MARGIN_F;

  // ---- 3. Edges. Channels: gap index g spans [colStart(g)+NODE_F, colStart(g+1)];
  // g = -1 is the margin before layer 0, g = layerCount-1 is the margin after the last layer.
  const gapRange = (g: number): [number, number] => {
    if (g < 0) return [HEADER + 6, HEADER + MARGIN_F - 6];
    const start = colStart(g) + NODE_F;
    if (g >= layerCount - 1) return [start + 6, start + END_MARGIN_F - 6];
    return [start, start + GAP_F];
  };
  const COLLIDE_MARGIN = 8;
  /** True when a horizontal run at lane-coordinate l between f0 and f1 touches no node (other than skip). */
  const clearRun = (f0: number, f1: number, l: number, skip: Set<string>): boolean => {
    const lo = Math.min(f0, f1);
    const hi = Math.max(f0, f1);
    for (const n of nodes.values()) {
      if (skip.has(n.id)) continue;
      if (n.f1 + COLLIDE_MARGIN <= lo || n.f0 - COLLIDE_MARGIN >= hi) continue;
      if (l < n.l0 - COLLIDE_MARGIN || l > n.l1 + COLLIDE_MARGIN) continue;
      return false;
    }
    return true;
  };

  type PlanKind = "straight" | "targetLine" | "sourceLine" | "gutter" | "back";
  interface EdgePlan {
    e: (typeof graph.edges)[number];
    s: FLNode;
    t: FLNode;
    sc: number;
    tc: number;
    kind: PlanKind;
    rail: number; // gutter or back rail l-coordinate (gutter/back only)
    needA: boolean; // channel after the source
    needB: boolean; // channel before the target
  }

  /*
   * Forward edges prefer, in order: a straight line; a run along the target's
   * row (one bend pair in the channel after the source); a run along the
   * source's row (bend pair in the channel before the target); a gutter route
   * through the nearest node-free gutter. Each run is checked against every
   * node, so edges never pass through a step. Back-edges go around the
   * outside of the lane band.
   */
  let backIndex = 0;
  const plans: EdgePlan[] = [];
  for (const e of graph.edges) {
    const s = nodes.get(e.from);
    const t = nodes.get(e.to);
    if (!s || !t) continue;
    const sc = (s.l0 + s.l1) / 2;
    const tc = (t.l0 + t.l1) / 2;
    const skip = new Set([s.id, t.id]);
    const plan: EdgePlan = { e, s, t, sc, tc, kind: "back", rail: 0, needA: true, needB: true };
    if (t.layer > s.layer) {
      const colEndS = colStart(s.layer) + NODE_F;
      const colStartT = colStart(t.layer);
      if (Math.abs(sc - tc) < 0.5 && clearRun(s.f1, t.f0, sc, skip)) {
        plan.kind = "straight";
        plan.needA = false;
        plan.needB = false;
      } else if (clearRun(colEndS, t.f0, tc, skip)) {
        plan.kind = "targetLine";
        plan.needB = false;
      } else if (clearRun(s.f1, colStartT, sc, skip)) {
        plan.kind = "sourceLine";
        plan.needA = false;
      } else {
        plan.kind = "gutter";
        const rails = [s.rowGutter, s.rowGutterUp, t.rowGutter, t.rowGutterUp];
        plan.rail = rails.reduce((best, r) =>
          Math.abs(sc - r) + Math.abs(r - tc) < Math.abs(sc - best) + Math.abs(best - tc)
            ? r
            : best,
        );
      }
    } else {
      plan.rail = bandEnd + BACK_STEP + backIndex * BACK_STEP;
      backIndex++;
    }
    plans.push(plan);
  }

  // Assign channel positions: spread the segments in each gap by their row order.
  type Seg = { edgeId: string; gap: number; key: number; which: "a" | "b" };
  const segs: Seg[] = [];
  for (const p of plans) {
    if (p.needA) segs.push({ edgeId: p.e.id, gap: p.s.layer, key: p.sc * 1000 + p.tc, which: "a" });
    if (p.needB)
      segs.push({ edgeId: p.e.id, gap: p.t.layer - 1, key: p.tc * 1000 + p.sc, which: "b" });
  }
  const channelF = new Map<string, number>();
  const byGap = new Map<number, Seg[]>();
  for (const sg of segs) byGap.set(sg.gap, [...(byGap.get(sg.gap) ?? []), sg]);
  for (const [g, list] of byGap) {
    list.sort((a, b) => a.key - b.key || a.edgeId.localeCompare(b.edgeId));
    const [g0, g1] = gapRange(g);
    list.forEach((sg, i) => {
      channelF.set(`${sg.edgeId}:${sg.which}`, g0 + ((g1 - g0) * (i + 1)) / (list.length + 1));
    });
  }

  // Labels. Edges whose first segment is long carry the pill on it, stacked
  // along the segment; edges that turn into a channel carry the pill on their
  // own vertical segment, stacked by height so pills from one source never
  // overlap. Pills beside a horizontal run sit just above the line.
  const LABEL_H = 18;
  const labelWidth = (text: string) => text.length * 10 * 0.58 + 14;
  const labelled = plans.filter((p) => p.e.label);
  const bySource = new Map<string, EdgePlan[]>();
  for (const p of labelled) bySource.set(p.e.from, [...(bySource.get(p.e.from) ?? []), p]);
  const labelFL = new Map<string, { f: number; l: number }>();
  for (const group of bySource.values()) {
    const horizontal = group.filter((p) => p.kind === "straight" || p.kind === "sourceLine");
    const vertical = group.filter((p) => !horizontal.includes(p));
    let along = 6;
    for (const p of horizontal) {
      const w = labelWidth(p.e.label!);
      labelFL.set(p.e.id, { f: p.s.f1 + along + w / 2, l: p.sc - LABEL_H / 2 - 3 });
      along += w + 8;
    }
    // Channel-side pills stack away from the source line. The step is the pill's
    // extent along the lane axis: its height when lanes stack vertically, its
    // width when lanes sit side by side (vertical flow).
    const extentAlongL = (w: number) => (orientation === "horizontal" ? LABEL_H : w);
    const stacks = { up: horizontal.length ? LABEL_H + 6 : 0, down: 0 };
    for (const p of vertical) {
      const w = labelWidth(p.e.label!);
      const fa = channelF.get(`${p.e.id}:a`) ?? p.s.f1 + 12;
      const goal = p.kind === "targetLine" ? p.tc : p.rail;
      const dir = goal >= p.sc ? "down" : "up";
      const ext = extentAlongL(w);
      const want = 6 + stacks[dir] + ext / 2;
      stacks[dir] += ext + 6;
      const span = Math.abs(goal - p.sc);
      const h = Math.min(want, Math.max(span / 2, 10));
      labelFL.set(p.e.id, { f: fa, l: p.sc + (dir === "down" ? h : -h) });
    }
  }

  const edges: RoutedEdge[] = [];
  for (const p of plans) {
    const { e, s, t, sc, tc } = p;
    const fa = channelF.get(`${e.id}:a`) ?? s.f1;
    const fb = channelF.get(`${e.id}:b`) ?? t.f0;
    const pts: Point[] = [];
    switch (p.kind) {
      case "straight":
        pts.push(toXY(s.f1, sc), toXY(t.f0, tc));
        break;
      case "targetLine":
        pts.push(toXY(s.f1, sc), toXY(fa, sc), toXY(fa, tc), toXY(t.f0, tc));
        break;
      case "sourceLine":
        pts.push(toXY(s.f1, sc), toXY(fb, sc), toXY(fb, tc), toXY(t.f0, tc));
        break;
      default:
        pts.push(
          toXY(s.f1, sc),
          toXY(fa, sc),
          toXY(fa, p.rail),
          toXY(fb, p.rail),
          toXY(fb, tc),
          toXY(t.f0, tc),
        );
    }
    const routed: RoutedEdge = { id: e.id, points: dedupe(pts) };
    const lab = labelFL.get(e.id);
    if (lab) routed.labelAt = toXY(lab.f, lab.l);
    edges.push(routed);
  }

  const backRails = backIndex;
  const lEnd = bandEnd + (backRails > 0 ? BACK_STEP * (backRails + 1) : 0) + 8;

  const laneBoxes: LaneBox[] = lanes.map((ln) => {
    const p = toXY(0, ln.l0);
    const size = toXY(fEnd, ln.l1 - ln.l0);
    const hp = toXY(0, ln.l0);
    const hs = toXY(HEADER, ln.l1 - ln.l0);
    return {
      id: ln.id,
      x: p.x,
      y: p.y,
      width: size.x,
      height: size.y,
      header: { x: hp.x, y: hp.y, width: hs.x, height: hs.y },
    };
  });

  const positioned: PositionedNode[] = graph.nodes.map((n) => {
    const fl = nodes.get(n.id)!;
    const p = toXY(fl.f0, fl.l0);
    return { id: n.id, x: p.x, y: p.y, width: n.width, height: n.height, layer: fl.layer };
  });

  const total = toXY(fEnd, lEnd);
  return {
    width: total.x,
    height: total.y,
    orientation,
    lanes: laneBoxes,
    nodes: positioned,
    edges,
  };
}

function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.01 || Math.abs(last.y - p.y) > 0.01) out.push(p);
  }
  // Remove collinear middle points.
  const res: Point[] = [];
  for (let i = 0; i < out.length; i++) {
    const a = res[res.length - 1];
    const b = out[i];
    const c = out[i + 1];
    if (a && c && ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y))) continue;
    res.push(b);
  }
  return res;
}
