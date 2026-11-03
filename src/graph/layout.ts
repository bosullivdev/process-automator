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
  type Seg = { edgeId: string; gap: number; key: number; which: "a" | "b" };
  const segs: Seg[] = [];
  const edgeInfo = graph.edges
    .map((e) => {
      const s = nodes.get(e.from);
      const t = nodes.get(e.to);
      if (!s || !t) return null;
      const forward = t.layer > s.layer;
      const direct = forward && t.layer === s.layer + 1;
      const gapA = forward ? s.layer : s.layer; // channel after source
      const gapB = forward ? t.layer - 1 : t.layer - 1; // channel before target
      return { e, s, t, forward, direct, gapA, gapB };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  let backIndex = 0;
  const backRail = new Map<string, number>();
  for (const info of edgeInfo) {
    const { e, s, t, direct, forward } = info;
    const sc = (s.l0 + s.l1) / 2;
    const tc = (t.l0 + t.l1) / 2;
    if (direct && Math.abs(sc - tc) < 0.5) continue; // straight line, no channel needed
    segs.push({ edgeId: e.id, gap: info.gapA, key: sc * 1000 + tc, which: "a" });
    if (!direct) segs.push({ edgeId: e.id, gap: info.gapB, key: tc * 1000 + sc, which: "b" });
    if (!forward) backRail.set(e.id, backIndex++);
  }
  // Assign channel positions: spread segments in each gap by their key.
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

  // Label spreading: edges leaving the same source, in order.
  const labelIndex = new Map<string, number>();
  const perSource = new Map<string, number>();
  for (const info of edgeInfo) {
    if (!info.e.label) continue;
    const i = perSource.get(info.e.from) ?? 0;
    labelIndex.set(info.e.id, i);
    perSource.set(info.e.from, i + 1);
  }

  const edges: RoutedEdge[] = [];
  for (const info of edgeInfo) {
    const { e, s, t, direct, forward } = info;
    const sc = (s.l0 + s.l1) / 2;
    const tc = (t.l0 + t.l1) / 2;
    const pts: Point[] = [];
    const fa = channelF.get(`${e.id}:a`);
    const fb = channelF.get(`${e.id}:b`);
    if (forward && direct && fa === undefined) {
      pts.push(toXY(s.f1, sc), toXY(t.f0, tc));
    } else if (forward && direct) {
      pts.push(toXY(s.f1, sc), toXY(fa!, sc), toXY(fa!, tc), toXY(t.f0, tc));
    } else if (forward) {
      const gutter = s.rowGutter;
      pts.push(
        toXY(s.f1, sc),
        toXY(fa!, sc),
        toXY(fa!, gutter),
        toXY(fb!, gutter),
        toXY(fb!, tc),
        toXY(t.f0, tc),
      );
    } else {
      const rail = bandEnd + BACK_STEP + (backRail.get(e.id) ?? 0) * BACK_STEP;
      pts.push(
        toXY(s.f1, sc),
        toXY(fa!, sc),
        toXY(fa!, rail),
        toXY(fb!, rail),
        toXY(fb!, tc),
        toXY(t.f0, tc),
      );
    }
    const routed: RoutedEdge = { id: e.id, points: dedupe(pts) };
    if (e.label) {
      routed.labelAt = labelPoint(routed.points, labelIndex.get(e.id) ?? 0);
    }
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

/**
 * Labels sit on the edge's own channel segment (the second segment, which is
 * unique per edge) so several outcomes leaving one decision never overlap. A
 * straight edge has no channel, so its label sits a little way along it.
 */
function labelPoint(pts: Point[], index: number): Point {
  if (pts.length >= 3) {
    const a = pts[1];
    const b = pts[2];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const d = Math.min(len / 2, 18 + index * 6);
    const t = len === 0 ? 0 : d / len;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  return pointAlong(pts, 16 + index * 22);
}

function pointAlong(pts: Point[], dist: number): Point {
  let remaining = dist;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= len) {
      const t = len === 0 ? 0 : remaining / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= len;
  }
  return pts[pts.length - 1] ?? { x: 0, y: 0 };
}
