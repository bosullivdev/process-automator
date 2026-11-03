import { describe, expect, it } from "vitest";
import { measureText, wrapToWidth } from "../src/graph/text-metrics";
import { buildLayoutGraph } from "../src/graph/build-graph";
import { process, step } from "./fixtures";

describe("text metrics (estimate fallback)", () => {
  it("measures proportionally to length", () => {
    expect(measureText("ab", 12)).toBeCloseTo(2 * 12 * 0.58);
  });

  it("wraps by words and keeps all text when under the line cap", () => {
    const lines = wrapToWidth("Provides research-specific guidance to the team", 144, 12, 8);
    expect(lines.join(" ")).toBe("Provides research-specific guidance to the team");
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measureText(l, 12)).toBeLessThanOrEqual(144);
  });

  it("splits a single over-long word and ellipsises past the cap", () => {
    const lines = wrapToWidth("Supercalifragilisticexpialidocious", 60, 12, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    expect(wrapToWidth("", 100, 12, 2)).toEqual([]);
  });
});

describe("content-sized nodes", () => {
  it("tasks grow in height with longer names and keep their width", () => {
    const short = process([step({ id: "a", displayNo: 1, name: "Ship" })]);
    const long = process([
      step({
        id: "a",
        displayNo: 1,
        name: "Reconcile the supplier invoice against the purchase order and goods receipt",
      }),
    ]);
    const a = buildLayoutGraph(short, [], "simple", "horizontal").nodes[0];
    const b = buildLayoutGraph(long, [], "simple", "horizontal").nodes[0];
    expect(a.width).toBe(b.width);
    expect(b.height).toBeGreaterThan(a.height);
    expect(b.text.nameLines.join(" ")).toContain("goods receipt");
  });

  it("outside labels extend the box below in horizontal mode and to the right in vertical mode", () => {
    const p = process([
      step({
        id: "d",
        displayNo: 1,
        type: "decision",
        name: "Is the request research and development?",
      }),
    ]);
    const h = buildLayoutGraph(p, [], "simple", "horizontal").nodes[0];
    const v = buildLayoutGraph(p, [], "simple", "vertical").nodes[0];
    expect(h.text.outside).toBe(true);
    expect(h.height).toBeGreaterThan(h.shapeHeight);
    expect(h.width).toBe(h.shapeWidth);
    expect(h.cx).toBe(h.shapeWidth / 2);
    expect(v.width).toBeGreaterThan(v.shapeWidth);
    expect(v.height).toBe(v.shapeHeight);
    expect(v.cy).toBe(v.shapeHeight / 2);
  });
});

describe("annotations", () => {
  it("minimal hides technology and contributor rows and shrinks the task", () => {
    const p = process([
      step({ id: "a", displayNo: 1, name: "Pack", technology: "WMS", contributorIds: ["x"] }),
    ]);
    const full = buildLayoutGraph(p, [], "simple", "horizontal", "full").nodes[0];
    const minimal = buildLayoutGraph(p, [], "simple", "horizontal", "minimal").nodes[0];
    expect(full.text.tech).toBe("WMS");
    expect(minimal.text.tech).toBeUndefined();
    expect(minimal.height).toBeLessThan(full.height);
  });
});
