import type { Point } from "../../graph/layout-types";

function normal(a: Point, b: Point): Point {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
}

/**
 * Shift a polyline sideways by `d`. Routes are axis-aligned, so at a corner
 * the sum of the two segment normals gives the mitre point; along a straight
 * run the two normals agree and one is used.
 */
export function offsetPolyline(pts: Point[], d: number): Point[] {
  if (d === 0 || pts.length < 2) return pts;
  return pts.map((p, i) => {
    const n1 = i > 0 ? normal(pts[i - 1], p) : null;
    const n2 = i < pts.length - 1 ? normal(p, pts[i + 1]) : null;
    let n: Point;
    if (n1 && n2) {
      const parallel = n1.x * n2.x + n1.y * n2.y > 0.99;
      n = parallel ? n1 : { x: n1.x + n2.x, y: n1.y + n2.y };
    } else n = (n1 ?? n2)!;
    return { x: p.x + n.x * d, y: p.y + n.y * d };
  });
}
