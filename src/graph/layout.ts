import type { ELK, ElkNode } from "elkjs/lib/elk-api";
import type {
  LabelSide,
  LaneBox,
  LayoutGraph,
  LayoutResult,
  Orientation,
  Point,
  PositionedNode,
  RoutedEdge,
} from "./layout-types";
import { measureText, wrapToWidth } from "./text-metrics";

/*
 * Layout works in (f, l) space: f runs along the flow, l across the lanes.
 * ELK layered provides layer assignment and crossing-minimised order; lanes
 * are applied in a deterministic post-pass; edges are routed orthogonally
 * through node-free channels (between layers) and gutters (between rows).
 * Back-edges loop under (or over) the row when the way is clear, leaving the
 * source's bottom and entering the target's bottom; otherwise they go around
 * the outside of the lane band.
 */

/*
 * Lane header band. The party name runs along the lane, wrapped to the lane's
 * extent in up to HEADER_MAX_LINES lines; the band is as thick (along the flow
 * axis) as the most lines any lane needs. A name that would still not fit
 * widens its lane instead, so a name never bleeds into the lanes beside it.
 */
const HEADER_FONT = 12;
const HEADER_WEIGHT = 600;
const HEADER_LINE_H = 14;
const HEADER_PAD_F = 11; // band padding either side of the lines (one line = 36)
const HEADER_PAD_L = 12; // padding at both ends of the lane
const HEADER_MAX_LINES = 3;
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
  /** Shape attachment points relative to the box: edges leave/enter the shape, not the box. */
  aF0: number;
  aF1: number;
  aL: number;
  /** Half of the shape's extent along the lane axis (for top/bottom exits). */
  aLHalf: number;
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
    const horizontal = orientation === "horizontal";
    const aF0 = horizontal ? n.cx - n.shapeWidth / 2 : n.cy - n.shapeHeight / 2;
    const aF1 = horizontal ? n.cx + n.shapeWidth / 2 : n.cy + n.shapeHeight / 2;
    const aL = horizontal ? n.cy : n.cx;
    const aLHalf = (horizontal ? n.shapeHeight : n.shapeWidth) / 2;
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
      aF0,
      aF1,
      aL,
      aLHalf,
      row: 0,
      rowBottom: 0,
      rowGutter: 0,
      rowGutterUp: 0,
    });
  }
  const layerCount = xs.length;

  /**
   * Wrap a lane's name along a lane of the given extent. When it needs more
   * than HEADER_MAX_LINES lines, the extent grows until it fits.
   */
  const headerLines = (name: string, extent: number): { lines: string[]; extent: number } => {
    const full = Math.ceil(measureText(name, HEADER_FONT, HEADER_WEIGHT));
    let avail = extent - HEADER_PAD_L * 2;
    let lines = wrapToWidth(name, avail, HEADER_FONT, Infinity, HEADER_WEIGHT);
    while (lines.length > HEADER_MAX_LINES && avail < full) {
      avail = Math.min(full, avail + 16);
      lines = wrapToWidth(name, avail, HEADER_FONT, Infinity, HEADER_WEIGHT);
    }
    return { lines, extent: Math.max(extent, avail + HEADER_PAD_L * 2) };
  };

  // ---- 2. Lanes: rows per (lane, layer) in ELK order.
  const lanes: Array<{
    id: string;
    l0: number;
    l1: number;
    rowH: number;
    rows: number;
    lines: string[];
  }> = [];
  let l = 0;
  for (const laneId of graph.laneOrder) {
    const laneNodes = [...nodes.values()].filter((n) => n.laneId === laneId);
    if (laneNodes.length === 0) continue;
    // Rows align on shape centres, not box centres, so an arrow between two
    // nodes in the same row is straight even when one carries a name outside
    // its shape. The row is as tall as the largest extent above and below that line.
    const above = Math.max(...laneNodes.map((n) => n.aL));
    const below = Math.max(...laneNodes.map((n) => n.lExtent - n.aL));
    const rowH = above + below;
    let rows = 1;
    for (let k = 0; k < layerCount; k++) {
      const inCell = laneNodes
        .filter((n) => n.layer === k)
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      rows = Math.max(rows, inCell.length);
      inCell.forEach((n, i) => (n.row = i));
    }
    const l0 = l;
    const natural = LANE_PAD * 2 + rows * rowH + (rows - 1) * GAP_L;
    const { lines, extent: height } = headerLines(graph.laneNames?.[laneId] ?? "", natural);
    const l1 = l0 + height;
    // A lane widened for its name keeps its rows centred.
    const inset = (height - natural) / 2;
    for (const n of laneNodes) {
      const slotTop = l0 + inset + LANE_PAD + n.row * (rowH + GAP_L);
      n.l0 = slotTop + above - n.aL;
      n.l1 = n.l0 + n.lExtent;
      n.rowBottom = slotTop + rowH;
      n.rowGutter = n.row === rows - 1 ? l1 - inset - LANE_PAD / 2 : n.rowBottom + GAP_L / 2;
      n.rowGutterUp = n.row === 0 ? l0 + inset + LANE_PAD / 2 : slotTop - GAP_L / 2;
    }
    lanes.push({ id: laneId, l0, l1, rowH, rows, lines });
    l = l1;
  }
  const bandEnd = l;

  // Header band thickness: enough for the most lines any lane needs, one line at least.
  const HEADER =
    Math.max(1, ...lanes.map((ln) => ln.lines.length)) * HEADER_LINE_H + HEADER_PAD_F * 2;
  const colStart = (k: number) => HEADER + MARGIN_F + k * (NODE_F + GAP_F);
  for (const n of nodes.values()) {
    n.f0 = colStart(n.layer) + (NODE_F - n.fExtent) / 2;
    n.f1 = n.f0 + n.fExtent;
  }
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

  /** True when a run along the lane axis at flow-coordinate f between l0 and l1 touches no node (other than skip). */
  const clearColumn = (f: number, l0: number, l1: number, skip: Set<string>): boolean => {
    const lo = Math.min(l0, l1);
    const hi = Math.max(l0, l1);
    for (const n of nodes.values()) {
      if (skip.has(n.id)) continue;
      if (f < n.f0 - COLLIDE_MARGIN || f > n.f1 + COLLIDE_MARGIN) continue;
      if (n.l1 + COLLIDE_MARGIN <= lo || n.l0 - COLLIDE_MARGIN >= hi) continue;
      return false;
    }
    return true;
  };

  type PlanKind = "straight" | "targetLine" | "sourceLine" | "gutter" | "loop" | "back";
  type Exit = "front" | "down" | "up";
  interface EdgePlan {
    e: (typeof graph.edges)[number];
    s: FLNode;
    t: FLNode;
    sc: number;
    tc: number;
    kind: PlanKind;
    rail: number; // gutter or back rail l-coordinate (gutter/loop/back only)
    needA: boolean; // channel after the source
    needB: boolean; // channel before the target
    exit: Exit; // which side of the source shape the edge leaves from
    entry: Exit; // which side of the target shape the edge enters (loop only)
  }

  /**
   * Space a node's box reserves beyond its shape on one side of the lane axis
   * (its name, when drawn outside the shape). An edge may not cross it.
   */
  const boxBeyond = (n: FLNode, side: "up" | "down") =>
    side === "down" ? n.l1 - (n.l0 + n.aL + n.aLHalf) : n.aL - n.aLHalf;
  const symmetricOf = (id: string) => graph.nodes.find((n) => n.id === id)?.text.symmetric ?? false;
  /** A side can carry an edge when nothing is drawn there, or the name can move to the other side. */
  const sideFree = (n: FLNode, side: "up" | "down") => boxBeyond(n, side) <= 6 || symmetricOf(n.id);

  /*
   * Forward edges prefer, in order: a straight line; a run along the target's
   * row (one bend pair in the channel after the source); a run along the
   * source's row (bend pair in the channel before the target); a gutter route
   * through the nearest node-free gutter. Each run is checked against every
   * node, so edges never pass through a step.
   *
   * Back-edges (feedback) prefer a loop: out of the source's bottom or top,
   * along the nearest node-free gutter back to the target's column, and into
   * the target's bottom or top, so a "No" reads as repeating the earlier step.
   * The loop must not touch any node or any name drawn outside a shape. When
   * no gutter gives a clear loop, the edge goes around the outside of the band.
   */
  let backIndex = 0;
  const plans: EdgePlan[] = [];
  for (const e of graph.edges) {
    const s = nodes.get(e.from);
    const t = nodes.get(e.to);
    if (!s || !t) continue;
    const sc = s.l0 + s.aL;
    const tc = t.l0 + t.aL;
    const sf1 = s.f0 + s.aF1;
    const tf0 = t.f0 + t.aF0;
    const skip = new Set([s.id, t.id]);
    const plan: EdgePlan = {
      e,
      s,
      t,
      sc,
      tc,
      kind: "back",
      rail: 0,
      needA: true,
      needB: true,
      exit: "front",
      entry: "front",
    };
    if (t.layer > s.layer) {
      const colEndS = colStart(s.layer) + NODE_F;
      const colStartT = colStart(t.layer);
      if (Math.abs(sc - tc) < 0.5 && clearRun(sf1, tf0, sc, skip)) {
        plan.kind = "straight";
        plan.needA = false;
        plan.needB = false;
      } else if (clearRun(colEndS, tf0, tc, skip)) {
        plan.kind = "targetLine";
        plan.needB = false;
      } else if (clearRun(sf1, colStartT, sc, skip)) {
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
      const sfc = s.f0 + (s.aF0 + s.aF1) / 2;
      const tfc = t.f0 + (t.aF0 + t.aF1) / 2;
      const rails = [...new Set([s.rowGutter, t.rowGutter, s.rowGutterUp, t.rowGutterUp])]
        .map((rail) => ({ rail, travel: Math.abs(sc - rail) + Math.abs(rail - tc) }))
        // Nearest loop first; below the row before above it when equal.
        .sort((a, b) => a.travel - b.travel || (a.rail > sc ? -1 : 1));
      for (const { rail } of rails) {
        const exit: Exit = rail > sc ? "down" : "up";
        const entry: Exit = rail > tc ? "down" : "up";
        if (Math.abs(rail - sc) <= s.aLHalf + 4 || Math.abs(rail - tc) <= t.aLHalf + 4) continue;
        if (!sideFree(s, exit) || !sideFree(t, entry)) continue;
        const sEdge = sc + (exit === "down" ? s.aLHalf : -s.aLHalf);
        const tEdge = tc + (entry === "down" ? t.aLHalf : -t.aLHalf);
        if (!clearColumn(sfc, sEdge, rail, new Set([s.id]))) continue;
        if (!clearColumn(tfc, tEdge, rail, new Set([t.id]))) continue;
        if (!clearRun(sfc, tfc, rail, skip)) continue;
        plan.kind = "loop";
        plan.rail = rail;
        plan.exit = exit;
        plan.entry = entry;
        plan.needA = false;
        plan.needB = false;
        break;
      }
      if (plan.kind === "back") {
        plan.rail = bandEnd + BACK_STEP + backIndex * BACK_STEP;
        backIndex++;
      }
    }
    plans.push(plan);
  }

  /*
   * Side exits. A node with several outgoing edges sends the one that travels
   * farthest across the lanes out of the top or bottom of its shape instead of
   * its front, so outcomes are told apart by where they leave. The farthest
   * edge takes the innermost vertical so that it never crosses the horizontal
   * runs of the nearer edges, which turn in the channel beyond it. Only one
   * side exit per node; its name then moves to the other side (labelSide).
   */
  const labelSide = new Map<string, LabelSide>();
  const defaultSide: LabelSide = orientation === "horizontal" ? "below" : "right";
  const flippedSide: LabelSide = orientation === "horizontal" ? "above" : "left";
  const bySourceAll = new Map<string, EdgePlan[]>();
  for (const p of plans) bySourceAll.set(p.e.from, [...(bySourceAll.get(p.e.from) ?? []), p]);
  for (const [sourceId, group] of bySourceAll) {
    const s = nodes.get(sourceId)!;
    labelSide.set(sourceId, defaultSide);
    const loop = group.find((p) => p.kind === "loop");
    if (loop) {
      // The loop already uses one side of the shape; the name moves to the other.
      if (symmetricOf(sourceId)) {
        labelSide.set(sourceId, loop.exit === "down" ? flippedSide : defaultSide);
      }
      continue;
    }
    if (group.length < 2) continue;
    const sfc = s.f0 + (s.aF0 + s.aF1) / 2;
    const candidates = group
      .filter((p) => p.kind === "targetLine" || p.kind === "gutter" || p.kind === "back")
      .map((p) => {
        const goal = p.kind === "targetLine" ? p.tc : p.rail;
        return { p, goal, dist: Math.abs(goal - p.sc) };
      })
      .filter(({ goal, p }) => Math.abs(goal - p.sc) > s.aLHalf + 4)
      .sort((a, b) => b.dist - a.dist || a.p.e.id.localeCompare(b.p.e.id));
    for (const { p, goal } of candidates) {
      const down = goal > p.sc;
      const edgeL = p.sc + (down ? s.aLHalf : -s.aLHalf);
      const skip = new Set([s.id, p.t.id]);
      if (!clearColumn(sfc, edgeL, goal, skip)) continue;
      if (p.kind === "targetLine" && !clearRun(sfc, p.t.f0 + p.t.aF0, p.tc, skip)) continue;
      p.exit = down ? "down" : "up";
      p.needA = false;
      // The name moves to the side the edge does not use (only when the box reserved it).
      const symmetric = graph.nodes.find((n) => n.id === sourceId)?.text.symmetric;
      if (symmetric) labelSide.set(sourceId, down ? flippedSide : defaultSide);
      break;
    }
  }

  /*
   * Channel positions. Each gap holds the verticals of edges leaving the layer
   * before it ("a", vertical then horizontal on to the target) and of edges
   * arriving in the layer after it ("b", horizontal then vertical). Verticals
   * nest by how far they travel across the lanes: an "a" vertical that spans
   * more rows sits nearer the source column, a "b" vertical that spans more
   * rows sits nearer the target column, so a long vertical never cuts across
   * the horizontal run of a shorter edge turning off inside its span.
   */
  type Seg = { edgeId: string; gap: number; span: number; which: "a" | "b" };
  const segs: Seg[] = [];
  for (const p of plans) {
    if (p.needA) {
      const span = Math.abs((p.kind === "gutter" ? p.rail : p.tc) - p.sc);
      segs.push({ edgeId: p.e.id, gap: p.s.layer, span, which: "a" });
    }
    if (p.needB) {
      const span = Math.abs(p.tc - (p.kind === "gutter" ? p.rail : p.sc));
      segs.push({ edgeId: p.e.id, gap: p.t.layer - 1, span, which: "b" });
    }
  }
  const channelF = new Map<string, number>();
  const byGap = new Map<number, Seg[]>();
  for (const sg of segs) byGap.set(sg.gap, [...(byGap.get(sg.gap) ?? []), sg]);
  for (const [g, list] of byGap) {
    list.sort((a, b) => {
      if (a.which !== b.which) return a.which === "a" ? -1 : 1;
      const bySpan = a.which === "a" ? b.span - a.span : a.span - b.span;
      return bySpan || a.edgeId.localeCompare(b.edgeId);
    });
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
    const horizontal = group.filter(
      (p) => p.exit === "front" && (p.kind === "straight" || p.kind === "sourceLine"),
    );
    const loops = group.filter((p) => p.kind === "loop");
    const side = group.filter((p) => p.exit !== "front" && p.kind !== "loop");
    const vertical = group.filter(
      (p) => !horizontal.includes(p) && !side.includes(p) && !loops.includes(p),
    );
    let along = 8;
    for (const p of horizontal) {
      const w = labelWidth(p.e.label!);
      labelFL.set(p.e.id, { f: p.s.f0 + p.s.aF1 + along + w / 2, l: p.sc });
      along += w + 8;
    }
    for (const p of side) {
      const w = labelWidth(p.e.label!);
      const sfc = p.s.f0 + (p.s.aF0 + p.s.aF1) / 2;
      const ext = orientation === "horizontal" ? LABEL_H : w;
      const off = p.s.aLHalf + 8 + ext / 2;
      labelFL.set(p.e.id, { f: sfc, l: p.sc + (p.exit === "down" ? off : -off) });
    }
    // A loop's pill sits on the return run just past the corner under the
    // source, so the outcome is read beside the decision it leaves.
    for (const p of loops) {
      const w = labelWidth(p.e.label!);
      const sfc = p.s.f0 + (p.s.aF0 + p.s.aF1) / 2;
      const tfc = p.t.f0 + (p.t.aF0 + p.t.aF1) / 2;
      const extAlongF = orientation === "horizontal" ? w : LABEL_H;
      const run = Math.abs(tfc - sfc);
      const back = Math.sign(tfc - sfc) || -1;
      const off = run < extAlongF + 24 ? run / 2 : extAlongF / 2 + 12;
      labelFL.set(p.e.id, { f: sfc + back * off, l: p.rail });
    }
    // Channel-side pills stack away from the source line. The step is the pill's
    // extent along the lane axis: its height when lanes stack vertically, its
    // width when lanes sit side by side (vertical flow).
    const extentAlongL = (w: number) => (orientation === "horizontal" ? LABEL_H : w);
    const stacks = { up: 0, down: 0 };
    for (const p of vertical) {
      const w = labelWidth(p.e.label!);
      const fa = channelF.get(`${p.e.id}:a`) ?? p.s.f0 + p.s.aF1 + 12;
      const goal = p.kind === "targetLine" ? p.tc : p.rail;
      const dir = goal >= p.sc ? "down" : "up";
      const ext = extentAlongL(w);
      const want = 16 + stacks[dir] + ext / 2;
      stacks[dir] += ext + 6;
      const span = Math.abs(goal - p.sc);
      const h = Math.min(want, Math.max(span / 2, 10));
      labelFL.set(p.e.id, { f: fa, l: p.sc + (dir === "down" ? h : -h) });
    }
  }

  const edges: RoutedEdge[] = [];
  for (const p of plans) {
    const { e, s, t, sc, tc } = p;
    const sf1 = s.f0 + s.aF1;
    const tf0 = t.f0 + t.aF0;
    const fa = channelF.get(`${e.id}:a`) ?? sf1;
    const fb = channelF.get(`${e.id}:b`) ?? tf0;
    const pts: Point[] = [];
    if (p.exit !== "front") {
      const sfc = s.f0 + (s.aF0 + s.aF1) / 2;
      const edgeL = sc + (p.exit === "down" ? s.aLHalf : -s.aLHalf);
      if (p.kind === "loop") {
        const tfc = t.f0 + (t.aF0 + t.aF1) / 2;
        const tEdge = tc + (p.entry === "down" ? t.aLHalf : -t.aLHalf);
        pts.push(toXY(sfc, edgeL), toXY(sfc, p.rail), toXY(tfc, p.rail), toXY(tfc, tEdge));
      } else if (p.kind === "targetLine") {
        pts.push(toXY(sfc, edgeL), toXY(sfc, tc), toXY(tf0, tc));
      } else {
        pts.push(
          toXY(sfc, edgeL),
          toXY(sfc, p.rail),
          toXY(fb, p.rail),
          toXY(fb, tc),
          toXY(tf0, tc),
        );
      }
      const routed: RoutedEdge = { id: e.id, points: dedupe(pts) };
      const lab = labelFL.get(e.id);
      if (lab) routed.labelAt = toXY(lab.f, lab.l);
      edges.push(routed);
      continue;
    }
    switch (p.kind) {
      case "straight":
        pts.push(toXY(sf1, sc), toXY(tf0, tc));
        break;
      case "targetLine":
        pts.push(toXY(sf1, sc), toXY(fa, sc), toXY(fa, tc), toXY(tf0, tc));
        break;
      case "sourceLine":
        pts.push(toXY(sf1, sc), toXY(fb, sc), toXY(fb, tc), toXY(tf0, tc));
        break;
      default:
        pts.push(
          toXY(sf1, sc),
          toXY(fa, sc),
          toXY(fa, p.rail),
          toXY(fb, p.rail),
          toXY(fb, tc),
          toXY(tf0, tc),
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
      header: { x: hp.x, y: hp.y, width: hs.x, height: hs.y, lines: ln.lines },
    };
  });

  const positioned: PositionedNode[] = graph.nodes.map((n) => {
    const fl = nodes.get(n.id)!;
    const p = toXY(fl.f0, fl.l0);
    return {
      id: n.id,
      x: p.x,
      y: p.y,
      width: n.width,
      height: n.height,
      layer: fl.layer,
      labelSide: labelSide.get(n.id) ?? defaultSide,
    };
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
