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
    // The box is as wide as the wider of the shape and its label; the shape stays centred.
    expect(h.width).toBeGreaterThanOrEqual(h.shapeWidth);
    expect(h.cx).toBe(h.width / 2);
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

describe("annotations on outside-label nodes", () => {
  it("reserves room under a decision's name for its technology pill and badges", () => {
    const plain = process([step({ id: "d", displayNo: 1, type: "decision", name: "Approved?" })]);
    const rich = process([
      step({
        id: "d",
        displayNo: 1,
        type: "decision",
        name: "Approved?",
        technology: "ServiceNow",
        contributorIds: ["a", "b", "c"],
      }),
    ]);
    const a = buildLayoutGraph(plain, [], "simple", "horizontal").nodes[0];
    const b = buildLayoutGraph(rich, [], "simple", "horizontal").nodes[0];
    expect(b.text.tech).toBe("ServiceNow");
    expect(b.text.badges).toBe(3);
    expect(b.text.labelHeight).toBeGreaterThan(a.text.labelHeight);
    expect(b.height).toBeGreaterThan(a.height);
    expect(b.text.labelWidth).toBeGreaterThanOrEqual(b.text.techWidth);
    const minimal = buildLayoutGraph(rich, [], "simple", "horizontal", "minimal").nodes[0];
    expect(minimal.text.badges).toBe(0);
    expect(minimal.height).toBe(a.height);
  });
});

describe("task annotations outside the box", () => {
  it("keeps the task box to its name and reserves the pill and badges below it", () => {
    const plain = process([step({ id: "t", displayNo: 1, name: "Pack order" })]);
    const rich = process([
      step({
        id: "t",
        displayNo: 1,
        name: "Pack order",
        technology: "WMS",
        contributorIds: ["a", "b"],
      }),
    ]);
    const a = buildLayoutGraph(plain, [], "simple", "horizontal").nodes[0];
    const b = buildLayoutGraph(rich, [], "simple", "horizontal").nodes[0];
    expect(b.shapeHeight).toBe(a.shapeHeight);
    expect(b.text.outside).toBe(false);
    expect(b.text.labelHeight).toBeGreaterThan(0);
    expect(b.height).toBe(b.shapeHeight + 4 + b.text.labelHeight);
    expect(b.cy).toBe(b.shapeHeight / 2);
    const v = buildLayoutGraph(rich, [], "simple", "vertical").nodes[0];
    expect(v.height).toBe(v.shapeHeight);
    expect(v.width).toBeGreaterThan(v.shapeWidth);
  });
});

describe("box width setting", () => {
  const long = process([
    step({ id: "a", displayNo: 1, name: "Review central targets and saving requirements" }),
    step({
      id: "d",
      displayNo: 2,
      type: "decision",
      name: "Are the central targets and saving requirements understood by everyone?",
    }),
  ]);

  it("widens task boxes so long names wrap to fewer lines", () => {
    const normal = buildLayoutGraph(long, [], "simple", "horizontal").nodes;
    const wide = buildLayoutGraph(long, [], "simple", "horizontal", "full", [], "wide").nodes;
    const extra = buildLayoutGraph(long, [], "simple", "horizontal", "full", [], "extra").nodes;
    expect(wide[0].shapeWidth).toBeGreaterThan(normal[0].shapeWidth);
    expect(extra[0].shapeWidth).toBeGreaterThan(wide[0].shapeWidth);
    expect(extra[0].text.nameLines.length).toBeLessThan(normal[0].text.nameLines.length);
    expect(extra[0].text.nameLines.join(" ")).toBe(normal[0].text.nameLines.join(" "));
  });

  it("widens the names beside decisions with it, without changing the shape", () => {
    const normal = buildLayoutGraph(long, [], "simple", "horizontal").nodes[1];
    const extra = buildLayoutGraph(long, [], "simple", "horizontal", "full", [], "extra").nodes[1];
    expect(extra.shapeWidth).toBe(normal.shapeWidth);
    expect(extra.text.nameLines.length).toBeLessThan(normal.text.nameLines.length);
    expect(extra.text.labelWidth).toBeGreaterThan(normal.text.labelWidth);
  });

  it("narrow boxes wrap to more lines", () => {
    const normal = buildLayoutGraph(long, [], "simple", "horizontal").nodes[0];
    const narrow = buildLayoutGraph(long, [], "simple", "horizontal", "full", [], "narrow")
      .nodes[0];
    expect(narrow.shapeWidth).toBeLessThan(normal.shapeWidth);
    expect(narrow.text.nameLines.length).toBeGreaterThanOrEqual(normal.text.nameLines.length);
  });
});
