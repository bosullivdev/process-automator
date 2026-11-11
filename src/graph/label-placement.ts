import type { Point } from "./layout-types";

/*
 * Where each outcome label goes. A label has to say, at a glance, which arrow
 * it names, so it sits on a stretch of its arrow that belongs to that arrow
 * alone: never on the trunk it shares with the decision's other outcomes,
 * never across another arrow, never over a step, a name or another label.
 * Among the places that satisfy this, the one nearest the decision wins.
 *
 * Every label always gets a place. When nothing is clean, the least bad spot
 * is used: crossing a line is better than hiding a name, which is better than
 * covering a step or another label.
 *
 * Arrows that leave one node with the same label are a single outcome going
 * to several places. They are labelled once, on the line they share: each
 * later arrow whose route passes through the first one's label takes that
 * same spot, so the map shows one pill instead of a pile of identical ones.
 */

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LabelRoute {
  id: string;
  /** Node the arrow leaves; arrows with the same source are sibling outcomes. */
  sourceId: string;
  /**
   * The arrow's label, if any. Arrows leaving one node with the same label are
   * one outcome drawn to several places (a step shared by several lanes).
   */
  text?: string;
  points: Point[];
}

export interface LabelSpec extends LabelRoute {
  text: string;
  width: number;
  height: number;
  /** Extra room to the right of the pill (the "default" tag). */
  tail: number;
}

export interface LabelObstacles {
  /** Step shapes. */
  shapes: Rect[];
  /** Names and annotations drawn outside shapes. */
  names: Rect[];
}

const STEP = 6; // distance between candidate positions along a segment
const LEAD = 6; // clearance from the source shape
const CORNER = 4; // clearance from a bend
const ARROWHEAD = 12; // clearance from the arrow's tip

const COST_BLOCKED = 5000; // over a step, another label, or off the canvas
const COST_NAME = 400;
const COST_SIBLING_LINE = 250; // on or across another outcome of the same decision
const COST_OTHER_LINE = 150;
const COST_CRAMPED = 40; // on a segment too short to hold the pill

const overlaps = (a: Rect, b: Rect, pad = 0) =>
  a.x0 - pad < b.x1 && b.x0 < a.x1 + pad && a.y0 - pad < b.y1 && b.y0 < a.y1 + pad;

function routeTouches(route: LabelRoute, r: Rect, pad: number): boolean {
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1];
    const b = route.points[i];
    const seg: Rect = {
      x0: Math.min(a.x, b.x),
      y0: Math.min(a.y, b.y),
      x1: Math.max(a.x, b.x),
      y1: Math.max(a.y, b.y),
    };
    // Closed comparison: a zero-thickness segment still touches.
    if (
      seg.x0 <= r.x1 + pad &&
      seg.x1 >= r.x0 - pad &&
      seg.y0 <= r.y1 + pad &&
      seg.y1 >= r.y0 - pad
    ) {
      return true;
    }
  }
  return false;
}

function onRoute(route: LabelRoute, p: Point): boolean {
  return routeTouches(route, { x0: p.x, y0: p.y, x1: p.x, y1: p.y }, 0.01);
}

/**
 * Centre point of each label, keyed by edge id. Labels are placed in the
 * order given. Two labels may share a point only when they are the same
 * outcome (same source, same text).
 */
export function placeLabels(
  labels: readonly LabelSpec[],
  routes: readonly LabelRoute[],
  obstacles: LabelObstacles,
): Map<string, Point> {
  const placed = new Map<string, Point>();
  const taken: Rect[] = [];

  // Within one outcome, the arrow that runs straight on longest goes first:
  // its first stretch is the shared line with the most room for the pill, so
  // the arrows that turn off it sooner can share the label.
  const firstRun = (l: LabelSpec) =>
    l.points.length < 2
      ? 0
      : Math.hypot(l.points[1].x - l.points[0].x, l.points[1].y - l.points[0].y);
  const groupOf = (l: LabelSpec) => `${l.sourceId}\u0000${l.text}`;
  const groupOrder = new Map<string, number>();
  labels.forEach((l, i) => {
    if (!groupOrder.has(groupOf(l))) groupOrder.set(groupOf(l), i);
  });
  const ordered = labels
    .map((label, i) => ({ label, i }))
    .sort(
      (a, b) =>
        groupOrder.get(groupOf(a.label))! - groupOrder.get(groupOf(b.label))! ||
        firstRun(b.label) - firstRun(a.label) ||
        a.i - b.i,
    )
    .map(({ label }) => label);

  for (const label of ordered) {
    const pts = label.points;
    if (pts.length < 2) continue;
    const rectAt = (c: Point): Rect => ({
      x0: c.x - label.width / 2,
      y0: c.y - label.height / 2,
      x1: c.x + label.width / 2 + label.tail,
      y1: c.y + label.height / 2,
    });
    const sameOutcome = (r: LabelRoute) => r.sourceId === label.sourceId && r.text === label.text;
    // The same outcome already labelled on a line this arrow runs along.
    const shared = labels
      .filter((l) => l.id !== label.id && sameOutcome(l) && placed.has(l.id))
      .map((l) => placed.get(l.id)!)
      .find((at) => onRoute(label, at));
    if (shared) {
      placed.set(label.id, shared);
      continue;
    }
    // Lines of the same outcome are not rivals: the label may sit on them.
    const others = routes.filter((r) => r.id !== label.id && !sameOutcome(r));
    const cost = (c: Point): number => {
      const r = rectAt(c);
      let total = 0;
      if (r.x0 < 0 || r.y0 < 0) total += COST_BLOCKED;
      if (obstacles.shapes.some((s) => overlaps(r, s, 2))) total += COST_BLOCKED;
      if (taken.some((t) => overlaps(r, t, 3))) total += COST_BLOCKED;
      if (obstacles.names.some((n) => overlaps(r, n, 1))) total += COST_NAME;
      for (const o of others) {
        if (routeTouches(o, r, 2)) {
          total += o.sourceId === label.sourceId ? COST_SIBLING_LINE : COST_OTHER_LINE;
        }
      }
      return total;
    };

    let best: { at: Point; cost: number } | null = null;
    let travelled = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.01) continue;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      const alongX = Math.abs(ux) > Math.abs(uy);
      // Extent of the pill behind and ahead of its centre along this segment.
      const behind = alongX ? label.width / 2 + (ux < 0 ? label.tail : 0) : label.height / 2;
      const ahead = alongX ? label.width / 2 + (ux > 0 ? label.tail : 0) : label.height / 2;
      const lo = behind + (i === 1 ? LEAD : CORNER);
      const hi = len - ahead - (i === pts.length - 1 ? ARROWHEAD : CORNER);
      const stops: Array<{ t: number; extra: number }> = [];
      if (hi >= lo) {
        for (let t = lo; t < hi; t += STEP) stops.push({ t, extra: 0 });
        stops.push({ t: hi, extra: 0 });
      } else {
        stops.push({ t: len / 2, extra: COST_CRAMPED });
      }
      for (const { t, extra } of stops) {
        const at = { x: a.x + ux * t, y: a.y + uy * t };
        const total = travelled + t + extra + cost(at);
        if (!best || total < best.cost - 1e-6) best = { at, cost: total };
      }
      travelled += len;
    }
    if (!best) continue;
    placed.set(label.id, best.at);
    taken.push(rectAt(best.at));
  }
  return placed;
}
