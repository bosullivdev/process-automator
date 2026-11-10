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
  // Cycles are broken before ELK sees the graph (see backEdges); this only
  // applies if something slips through.
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
  // Cycles are broken here, not by ELK: a depth-first walk from the starts in
  // step order follows the natural flow, and an edge that closes a cycle is
  // the feedback ("No" back to an earlier step). ELK's own greedy breaker
  // would sometimes reverse the forward edge instead, drawing a decision
  // before the step it checks. Only true cycles are reversed, so a later
  // step linking forward to an earlier-numbered one stays a forward arrow.
  const reversed = backEdges(graph);
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
    edges: graph.edges.map((e) =>
      reversed.has(e.id)
        ? { id: e.id, sources: [e.to], targets: [e.from] }
        : { id: e.id, sources: [e.from], targets: [e.to] },
    ),
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

  // ---- 2. Lanes. Rows: a chain of steps that stays in one lane keeps one
  // row, so its arrows run straight along the lane instead of stepping
  // between rows wherever another step shares a layer with one of its
  // members. Chains are followed along forward same-lane links where each
  // step has one such successor and the successor one such predecessor.
  // Rows are then dealt out per lane in ELK order: each chain takes the first
  // row whose layers it does not share with a chain already there.
  const chainOut = new Map<string, Set<string>>();
  const chainIn = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (reversed.has(e.id)) continue;
    const s = nodes.get(e.from);
    const t = nodes.get(e.to);
    if (!s || !t || s.laneId !== t.laneId || t.layer <= s.layer) continue;
    chainOut.set(s.id, (chainOut.get(s.id) ?? new Set()).add(t.id));
    chainIn.set(t.id, (chainIn.get(t.id) ?? new Set()).add(s.id));
  }
  const chainNext = (id: string): string | undefined => {
    const out = chainOut.get(id);
    if (!out || out.size !== 1) return undefined;
    const [next] = out;
    return chainIn.get(next)?.size === 1 ? next : undefined;
  };
  const runOf = new Map<string, FLNode[]>();
  for (const n of nodes.values()) {
    if (runOf.has(n.id)) continue;
    // Walk back to the head of the chain, then forward along it.
    let head = n;
    const seen = new Set([head.id]);
    for (;;) {
      const prev = [...(chainIn.get(head.id) ?? [])];
      if (prev.length !== 1 || chainNext(prev[0]) !== head.id || seen.has(prev[0])) break;
      head = nodes.get(prev[0])!;
      seen.add(head.id);
    }
    const run: FLNode[] = [];
    for (let cur: FLNode | undefined = head; cur && !runOf.has(cur.id);) {
      run.push(cur);
      runOf.set(cur.id, run);
      const next = chainNext(cur.id);
      cur = next ? nodes.get(next) : undefined;
    }
  }
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
    const runs = [...new Set(laneNodes.map((n) => runOf.get(n.id)!))]
      .map((run) => ({
        run,
        order: run.reduce((sum, n) => sum + n.order, 0) / run.length,
        first: Math.min(...run.map((n) => n.layer)),
      }))
      .sort(
        (a, b) => a.order - b.order || a.first - b.first || a.run[0].id.localeCompare(b.run[0].id),
      );
    const tracks: Array<Set<number>> = [];
    for (const { run } of runs) {
      let row = tracks.findIndex((taken) => run.every((n) => !taken.has(n.layer)));
      if (row < 0) row = tracks.push(new Set()) - 1;
      for (const n of run) {
        n.row = row;
        tracks[row].add(n.layer);
      }
    }
    const rows = Math.max(1, tracks.length);
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
    /** A target-row run whose source-row run is also clear, so either may be used. */
    flexible?: boolean;
  }

  /**
   * Space a node's box reserves beyond its shape on one side of the lane axis
   * (its name, when drawn outside the shape). An edge may not cross it.
   */
  const boxBeyond = (n: FLNode, side: "up" | "down") =>
    side === "down" ? n.l1 - (n.l0 + n.aL + n.aLHalf) : n.aL - n.aLHalf;
  const symmetricOf = (id: string) => graph.nodes.find((n) => n.id === id)?.text.symmetric ?? false;
  const fc = (n: FLNode) => n.f0 + (n.aF0 + n.aF1) / 2;

  /*
   * Each node's two sides along the lane axis ("down" is the default name
   * side) can carry at most one edge each, and never an edge through the
   * name. A node whose box reserved room on both sides (symmetric) may move
   * its name across to free a side. Sides are claimed in order of importance:
   * feedback loops first, then the farthest outcome of a fan-out, then
   * back-edges heading for the outside rail.
   */
  type Side = "up" | "down";
  const other = (side: Side): Side => (side === "down" ? "up" : "down");
  const sideState = new Map<
    string,
    { name: Side | null; used: Set<Side>; loopExit: Side | null }
  >();
  for (const n of nodes.values()) {
    sideState.set(n.id, {
      name: boxBeyond(n, "down") > 6 ? "down" : null,
      used: new Set(),
      loopExit: null,
    });
  }
  /** Loops leaving one node share its exit side: they run up the same trunk and part on their rails. */
  const canClaim = (n: FLNode, side: Side, loopExit = false): boolean => {
    const st = sideState.get(n.id)!;
    if (st.used.has(side)) return loopExit && st.loopExit === side;
    if (st.name === side) return symmetricOf(n.id) && !st.used.has(other(side));
    return true;
  };
  const claim = (n: FLNode, side: Side, loopExit = false): void => {
    const st = sideState.get(n.id)!;
    if (st.name === side) st.name = other(side);
    st.used.add(side);
    if (loopExit) st.loopExit = side;
  };

  /*
   * Forward edges prefer, in order: a straight line; a run along the target's
   * row (one bend pair in the channel after the source); a run along the
   * source's row (bend pair in the channel before the target); a gutter route
   * through the nearest node-free gutter. Each run is checked against every
   * node, so edges never pass through a step.
   *
   * Back-edges are planned afterwards, once every forward plan is known.
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
        plan.flexible = clearRun(sf1, colStartT, sc, skip);
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
    }
    plans.push(plan);
  }

  /*
   * Feedback loops. A back-edge prefers a loop: out of the source's bottom or
   * top, along the nearest node-free gutter back towards the target, and in
   * through the target's bottom or top, so a "No" reads as repeating the
   * earlier step. When neither of the target's sides is free (its name is on
   * one and another arrow uses the other), the loop instead turns in the
   * channel before the target and enters its front, where arrows normally
   * arrive. A loop never touches a node or a name. When no rail gives a clear
   * loop, the edge goes around the outside of the band.
   */
  /*
   * Where each arrow will roughly run (channel verticals at the middle of
   * their gap), so a route can be scored by the crossings it would add.
   */
  type FL = { f: number; l: number };
  const gapMid = (g: number) => {
    const [g0, g1] = gapRange(g);
    return (g0 + g1) / 2;
  };
  const roughPath = (p: EdgePlan, kind = p.kind): FL[] => {
    const sf1 = p.s.f0 + p.s.aF1;
    const tf0 = p.t.f0 + p.t.aF0;
    // Verticals of edges leaving a layer sit before those of edges arriving.
    const fa = gapMid(p.s.layer) - 6;
    const fb = gapMid(p.t.layer - 1) + 6;
    const a = { f: sf1, l: p.sc };
    const z = { f: tf0, l: p.tc };
    switch (kind) {
      case "straight":
        return [a, z];
      case "targetLine":
        return [a, { f: fa, l: p.sc }, { f: fa, l: p.tc }, z];
      case "sourceLine":
        return [a, { f: fb, l: p.sc }, { f: fb, l: p.tc }, z];
      default:
        return [
          a,
          { f: fa, l: p.sc },
          { f: fa, l: p.rail },
          { f: fb, l: p.rail },
          { f: fb, l: p.tc },
          z,
        ];
    }
  };
  const segsCross = (a1: FL, a2: FL, b1: FL, b2: FL): boolean => {
    const aAlongL = Math.abs(a1.f - a2.f) < 0.01;
    const bAlongL = Math.abs(b1.f - b2.f) < 0.01;
    if (aAlongL === bAlongL) return false;
    const [v1, v2, h1, h2] = aAlongL ? [a1, a2, b1, b2] : [b1, b2, a1, a2];
    return (
      v1.f > Math.min(h1.f, h2.f) + 0.5 &&
      v1.f < Math.max(h1.f, h2.f) - 0.5 &&
      h1.l > Math.min(v1.l, v2.l) + 0.5 &&
      h1.l < Math.max(v1.l, v2.l) - 0.5
    );
  };
  const roughPaths = new Map<EdgePlan, FL[]>();
  for (const p of plans) if (p.kind !== "back") roughPaths.set(p, roughPath(p));
  const pathCrossings = (pts: FL[], self?: EdgePlan): number => {
    let n = 0;
    for (const [p, other] of roughPaths) {
      if (p === self) continue;
      for (let i = 1; i < pts.length; i++) {
        for (let j = 1; j < other.length; j++) {
          if (segsCross(pts[i - 1], pts[i], other[j - 1], other[j])) n++;
        }
      }
    }
    return n;
  };

  // An arrow that could turn in either channel takes the one that crosses
  // fewer of the other arrows: a run along the target row when equal, so a
  // fan-out still parts right after its source.
  for (const p of plans) {
    if (!p.flexible) continue;
    const viaTarget = pathCrossings(roughPaths.get(p)!, p);
    const viaSource = roughPath(p, "sourceLine");
    if (pathCrossings(viaSource, p) < viaTarget) {
      p.kind = "sourceLine";
      p.needA = false;
      p.needB = true;
      roughPaths.set(p, viaSource);
    }
  }

  // The side each fan-out would like for its farthest outcome (see "Side
  // exits" below). A loop avoids taking that side from either end, so the
  // outcome keeps its side exit instead of turning in the channel across the
  // loop's return run.
  const wantedSide = new Map<string, Side>();
  {
    const bySource = new Map<string, EdgePlan[]>();
    for (const p of plans) bySource.set(p.e.from, [...(bySource.get(p.e.from) ?? []), p]);
    for (const [id, group] of bySource) {
      if (group.length < 2) continue;
      const n = nodes.get(id)!;
      const far = group
        .filter((p) => p.kind === "targetLine" || p.kind === "gutter")
        .map((p) => ({ p, goal: p.kind === "targetLine" ? p.tc : p.rail }))
        .filter(({ goal, p }) => Math.abs(goal - p.sc) > n.aLHalf + 4)
        .sort(
          (a, b) =>
            Math.abs(b.goal - b.p.sc) - Math.abs(a.goal - a.p.sc) ||
            a.p.e.id.localeCompare(b.p.e.id),
        )[0];
      if (far) wantedSide.set(id, far.goal > far.p.sc ? "down" : "up");
    }
  }

  /** Would claiming this side leave the node's wanted side unusable (taken, or now holding the name)? */
  const blocksWanted = (n: FLNode, side: Side): boolean => {
    const wanted = wantedSide.get(n.id);
    if (!wanted) return false;
    if (wanted === side) return true;
    const st = sideState.get(n.id)!;
    const nameAfter = st.name === side ? other(side) : st.name;
    return nameAfter === wanted;
  };
  /** Rails used by loops already leaving a node, so a later loop can share the trunk. */
  const loopRails = new Map<string, number[]>();

  for (const plan of plans) {
    if (plan.kind !== "back") continue;
    const { s, t, sc, tc } = plan;
    const sfc = fc(s);
    const tfc = fc(t);
    const skip = new Set([s.id, t.id]);
    const rails = [
      ...new Set([
        s.rowGutter,
        t.rowGutter,
        s.rowGutterUp,
        t.rowGutterUp,
        ...(loopRails.get(s.id) ?? []),
      ]),
    ]
      .map((rail) => ({ rail, travel: Math.abs(sc - rail) + Math.abs(rail - tc) }))
      // Nearest loop first; below the row before above it when about equal, so
      // a feedback loop reads as a return under the step wherever it can.
      .sort((a, b) => {
        const below = (r: number) => (r > sc ? 0 : 1);
        return Math.abs(a.travel - b.travel) <= 16
          ? below(a.rail) - below(b.rail) || a.travel - b.travel
          : a.travel - b.travel;
      })
      .map(({ rail }) => rail);
    // Side entries that take no wanted side first, then front entries, then
    // the rest; within a rank, nearest rail first.
    const ranked = [false, true]
      .flatMap((front) => rails.map((rail, i) => ({ rail, front, i })))
      .map((a) => {
        const exit: Side = a.rail > sc ? "down" : "up";
        const entry: Side = a.rail > tc ? "down" : "up";
        const conflict = blocksWanted(s, exit) || (!a.front && blocksWanted(t, entry));
        return { ...a, rank: (conflict ? 2 : 0) + (a.front ? 1 : 0) };
      });
    // Candidates that take nobody's wanted side first; among those, fewest
    // added crossings, then a side entry before a front one, then the nearest rail.
    type Candidate = (typeof ranked)[number] & {
      exit: Side;
      entry: Exit;
      pts: FL[];
      crossings: number;
    };
    const candidates: Candidate[] = [];
    for (const a of ranked) {
      const { rail, front } = a;
      const exit: Side = rail > sc ? "down" : "up";
      if (Math.abs(rail - sc) <= s.aLHalf + 4 || !canClaim(s, exit, true)) continue;
      const sEdge = sc + (exit === "down" ? s.aLHalf : -s.aLHalf);
      if (!clearColumn(sfc, sEdge, rail, new Set([s.id]))) continue;
      let pts: FL[];
      let entry: Exit;
      if (front) {
        const fb = gapMid(t.layer - 1) + 6;
        if (!clearRun(sfc, fb, rail, skip)) continue;
        if (!clearColumn(fb, rail, tc, skip)) continue;
        if (!clearRun(fb, t.f0 + t.aF0, tc, skip)) continue;
        entry = "front";
        pts = [
          { f: sfc, l: sEdge },
          { f: sfc, l: rail },
          { f: fb, l: rail },
          { f: fb, l: tc },
          { f: t.f0 + t.aF0, l: tc },
        ];
      } else {
        entry = rail > tc ? "down" : "up";
        if (Math.abs(rail - tc) <= t.aLHalf + 4 || !canClaim(t, entry)) continue;
        const tEdge = tc + (entry === "down" ? t.aLHalf : -t.aLHalf);
        if (!clearColumn(tfc, tEdge, rail, new Set([t.id]))) continue;
        if (!clearRun(sfc, tfc, rail, skip)) continue;
        pts = [
          { f: sfc, l: sEdge },
          { f: sfc, l: rail },
          { f: tfc, l: rail },
          { f: tfc, l: tEdge },
        ];
      }
      candidates.push({ ...a, exit, entry, pts, crossings: pathCrossings(pts) });
    }
    candidates.sort(
      (a, b) =>
        (a.rank >= 2 ? 1 : 0) - (b.rank >= 2 ? 1 : 0) ||
        a.crossings - b.crossings ||
        (a.rank % 2) - (b.rank % 2) ||
        a.i - b.i,
    );
    const best = candidates[0];
    if (best) {
      claim(s, best.exit, true);
      if (best.entry !== "front") claim(t, best.entry);
      plan.kind = "loop";
      plan.rail = best.rail;
      plan.exit = best.exit;
      plan.entry = best.entry;
      plan.needA = false;
      plan.needB = best.entry === "front";
      roughPaths.set(plan, best.pts);
      loopRails.set(s.id, [...(loopRails.get(s.id) ?? []), best.rail]);
    }
    if (plan.kind === "back") {
      plan.rail = bandEnd + BACK_STEP + backIndex * BACK_STEP;
      backIndex++;
    }
  }

  /*
   * Side exits. A node with several outgoing edges sends the one that travels
   * farthest across the lanes out of the top or bottom of its shape instead of
   * its front, so outcomes are told apart by where they leave. The farthest
   * edge takes the innermost vertical so that it never crosses the horizontal
   * runs of the nearer edges, which turn in the channel beyond it. Only one
   * side exit per node, and a loop leaving the node already counts as it.
   */
  const bySourceAll = new Map<string, EdgePlan[]>();
  for (const p of plans) bySourceAll.set(p.e.from, [...(bySourceAll.get(p.e.from) ?? []), p]);
  for (const [sourceId, group] of bySourceAll) {
    const s = nodes.get(sourceId)!;
    if (group.length < 2 || group.some((p) => p.kind === "loop")) continue;
    const sfc = fc(s);
    const candidates = group
      .filter((p) => p.kind === "targetLine" || p.kind === "gutter" || p.kind === "back")
      .map((p) => {
        const goal = p.kind === "targetLine" ? p.tc : p.rail;
        return { p, goal, dist: Math.abs(goal - p.sc) };
      })
      .filter(({ goal, p }) => Math.abs(goal - p.sc) > s.aLHalf + 4)
      .sort((a, b) => b.dist - a.dist || a.p.e.id.localeCompare(b.p.e.id));
    for (const { p, goal } of candidates) {
      const side: Side = goal > p.sc ? "down" : "up";
      if (!canClaim(s, side)) continue;
      const edgeL = p.sc + (side === "down" ? s.aLHalf : -s.aLHalf);
      const skip = new Set([s.id, p.t.id]);
      if (!clearColumn(sfc, edgeL, goal, skip)) continue;
      if (p.kind === "targetLine" && !clearRun(sfc, p.t.f0 + p.t.aF0, p.tc, skip)) continue;
      claim(s, side);
      p.exit = side;
      p.needA = false;
      break;
    }
  }

  // The name sits on whichever side the edges left it.
  const defaultSide: LabelSide = orientation === "horizontal" ? "below" : "right";
  const flippedSide: LabelSide = orientation === "horizontal" ? "above" : "left";
  const labelSide = new Map<string, LabelSide>();
  for (const [id, st] of sideState) labelSide.set(id, st.name === "up" ? flippedSide : defaultSide);

  /*
   * Channel positions. Each gap holds the verticals of edges leaving the layer
   * before it ("a", vertical then horizontal on to the target) and of edges
   * arriving in the layer after it ("b", horizontal then vertical). Every such
   * vertical is the middle of a Z: a horizontal arrives from the source side
   * at row "inL", the vertical runs to row "outL", and a horizontal leaves
   * towards the target side. Two Zs in one gap cross when the outer one's
   * arriving run passes through the inner one's span, or the inner one's
   * leaving run passes through the outer one's span; verticals are ordered
   * to avoid that. Equal rows merge rather than cross. Ties fall back to
   * span: an "a" vertical that spans more rows sits nearer the source column,
   * a "b" vertical that spans more rows nearer the target column.
   */
  type Seg = {
    edgeId: string;
    gap: number;
    span: number;
    which: "a" | "b";
    inL: number;
    outL: number;
  };
  const segs: Seg[] = [];
  for (const p of plans) {
    if (p.needA) {
      const outL = p.kind === "gutter" ? p.rail : p.tc;
      segs.push({
        edgeId: p.e.id,
        gap: p.s.layer,
        span: Math.abs(outL - p.sc),
        which: "a",
        inL: p.sc,
        outL,
      });
    }
    if (p.needB) {
      const inL = p.kind === "gutter" || p.kind === "loop" ? p.rail : p.sc;
      segs.push({
        edgeId: p.e.id,
        gap: p.t.layer - 1,
        span: Math.abs(p.tc - inL),
        which: "b",
        inL,
        outL: p.tc,
      });
    }
  }
  const within = (l: number, a: number, b: number) =>
    l > Math.min(a, b) + 0.5 && l < Math.max(a, b) - 0.5;
  /** Crossings when `inner` sits nearer the source column than `outer`. */
  const crossings = (inner: Seg, outer: Seg) =>
    (within(outer.inL, inner.inL, inner.outL) ? 1 : 0) +
    (within(inner.outL, outer.inL, outer.outL) ? 1 : 0);
  const LABEL_H = 18;
  const labelWidth = (text: string) => text.length * 10 * 0.58 + 14;
  const channelF = new Map<string, number>();
  const byGap = new Map<number, Seg[]>();
  for (const sg of segs) byGap.set(sg.gap, [...(byGap.get(sg.gap) ?? []), sg]);
  for (const [g, list] of byGap) {
    list.sort((a, b) => {
      if (a.which !== b.which) return a.which === "a" ? -1 : 1;
      const byCross = crossings(a, b) - crossings(b, a);
      if (byCross) return byCross;
      const bySpan = a.which === "a" ? b.span - a.span : a.span - b.span;
      return bySpan || a.edgeId.localeCompare(b.edgeId);
    });
    const [g0, g1] = gapRange(g);
    // A pill on a straight run out of the layer before sits at the start of
    // this gap; the verticals move along so none passes through it.
    const pill = Math.max(
      0,
      ...plans
        .filter(
          (p) =>
            p.e.label &&
            p.exit === "front" &&
            (p.kind === "straight" || p.kind === "sourceLine") &&
            p.s.layer === g,
        )
        .map((p) => (orientation === "horizontal" ? labelWidth(p.e.label!) : LABEL_H) + 16),
    );
    const reserve = Math.min(pill, Math.max(0, g1 - g0 - 12 * (list.length + 1)));
    list.forEach((sg, i) => {
      channelF.set(
        `${sg.edgeId}:${sg.which}`,
        g0 + reserve + ((g1 - g0 - reserve) * (i + 1)) / (list.length + 1),
      );
    });
  }

  // Labels. Edges whose first segment is long carry the pill on it, stacked
  // along the segment; edges that turn into a channel carry the pill on their
  // own vertical segment, stacked by height so pills from one source never
  // overlap. Pills beside a horizontal run sit just above the line.
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
    const alongRail = new Map<number, number>();
    for (const p of loops) {
      const w = labelWidth(p.e.label!);
      const sfc = p.s.f0 + (p.s.aF0 + p.s.aF1) / 2;
      const tfc = p.t.f0 + (p.t.aF0 + p.t.aF1) / 2;
      const extAlongF = orientation === "horizontal" ? w : LABEL_H;
      const run = Math.abs(tfc - sfc);
      const back = Math.sign(tfc - sfc) || -1;
      const taken = alongRail.get(p.rail) ?? 0;
      const off = run < extAlongF + 24 ? run / 2 : taken + extAlongF / 2 + 12;
      alongRail.set(p.rail, taken + extAlongF + 6);
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
      if (p.kind === "loop" && p.entry === "front") {
        pts.push(
          toXY(sfc, edgeL),
          toXY(sfc, p.rail),
          toXY(fb, p.rail),
          toXY(fb, tc),
          toXY(tf0, tc),
        );
      } else if (p.kind === "loop") {
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

/**
 * Ids of the edges that close a cycle. The walk is depth-first over steps
 * (not nodes) from the starts, then any step not yet reached, in graph order;
 * a link that reaches a step still on the walk's stack is feedback. Deciding
 * per step link means every lane copy of a co-owned step treats the same link
 * as its feedback, and gateway edges inside a step are never reversed.
 */
export function backEdges(graph: LayoutGraph): Set<string> {
  const out = new Map<string, string[]>();
  const stepOrder: string[] = [];
  const seenStep = new Set<string>();
  for (const n of graph.nodes) {
    if (seenStep.has(n.stepId)) continue;
    seenStep.add(n.stepId);
    if (n.pinFirst) stepOrder.unshift(n.stepId);
    else stepOrder.push(n.stepId);
  }
  for (const e of graph.edges) {
    if (e.sourceStepId === e.targetStepId) continue;
    const list = out.get(e.sourceStepId) ?? [];
    if (!list.includes(e.targetStepId)) list.push(e.targetStepId);
    out.set(e.sourceStepId, list);
  }
  const state = new Map<string, "open" | "done">();
  const backLinks = new Set<string>();
  const visit = (id: string) => {
    state.set(id, "open");
    for (const to of out.get(id) ?? []) {
      const st = state.get(to);
      if (st === "open") backLinks.add(`${id}->${to}`);
      else if (!st) visit(to);
    }
    state.set(id, "done");
  };
  for (const id of stepOrder) if (!state.has(id)) visit(id);
  const back = new Set<string>();
  for (const e of graph.edges) {
    if (backLinks.has(`${e.sourceStepId}->${e.targetStepId}`)) back.add(e.id);
  }
  return back;
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
