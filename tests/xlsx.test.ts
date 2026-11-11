import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";
import ELK from "elkjs/lib/elk.bundled.js";
import { buildXlsx, buildXlsxParts, columnName, sheetName } from "../src/export/xlsx";
import { buildLayoutGraph } from "../src/graph/build-graph";
import { layoutGraph } from "../src/graph/layout";
import type { Orientation } from "../src/graph/layout-types";
import type { Team } from "../src/model/types";
import { party, process, step } from "./fixtures";

const sales = party("Sales & <Ops>", 0);
const legal = party("Legal", 1);
const north: Team = { id: "north", name: "North", colourIndex: 0 };
const EMU = 9525;
const TITLE_H = 60;

function fixture() {
  return process(
    [
      step({
        id: "s1",
        displayNo: 1,
        type: "start",
        ownerId: sales.id,
        next: [{ targetId: "s2" }],
      }),
      step({
        id: "s2",
        displayNo: 2,
        name: "Review <contract> & sign",
        ownerId: sales.id,
        technology: "DocuSign",
        hasControl: true,
        controlRef: "FIN-012",
        contributorIds: [legal.id],
        next: [{ targetId: "s3" }],
      }),
      step({
        id: "s3",
        displayNo: 3,
        type: "decision",
        name: "Approved?",
        ownerId: legal.id,
        next: [
          { targetId: "s4", label: "Yes", isDefault: true },
          { targetId: "s2", label: "No" },
        ],
      }),
      step({ id: "s4", displayNo: 4, type: "end", name: "Filed", ownerId: legal.id }),
    ],
    { name: "Contract: review/sign?", owner: "Ops", laneOrder: [sales.id, legal.id] },
  );
}

async function build(orientation: Orientation = "horizontal") {
  const proc = fixture();
  const parties = [sales, legal];
  const graph = buildLayoutGraph(proc, parties, "simple", orientation);
  const layout = await layoutGraph(graph, orientation, new ELK());
  const ctx = { process: proc, parties, teams: [north], graph, layout };
  return { ...ctx, parts: buildXlsxParts(ctx) };
}

function parse(xml: string) {
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level, msg) => {
      errors.push(`${level}: ${msg}`);
    },
  }).parseFromString(xml, "application/xml");
  return { doc, errors };
}

const all = (root: XmlDocument | XmlElement, name: string): XmlElement[] =>
  Array.from(root.getElementsByTagName(name));

describe("xlsx export", () => {
  it("names columns and sheets the way Excel requires", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    expect(sheetName("Contract: review/sign?")).toBe("Contract  review sign");
    expect(sheetName("A very long process name that goes past the limit")).toHaveLength(31);
    expect(sheetName("[]")).toBe("Process map");
  });

  it("writes every package part as well-formed XML, with each part declared and linked", async () => {
    const { parts } = await build();
    expect(Object.keys(parts).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/drawings/drawing1.xml",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/_rels/sheet1.xml.rels",
      "xl/worksheets/sheet1.xml",
    ]);
    for (const [path, xml] of Object.entries(parts)) {
      expect(parse(xml).errors, path).toEqual([]);
    }
    for (const part of ["workbook", "worksheets/sheet1", "styles", "drawings/drawing1"]) {
      expect(parts["[Content_Types].xml"]).toContain(`PartName="/xl/${part}.xml"`);
    }
    expect(parts["xl/worksheets/sheet1.xml"]).toContain('<drawing r:id="rId1"/>');
    expect(parts["xl/worksheets/_rels/sheet1.xml.rels"]).toContain("../drawings/drawing1.xml");
    expect(parts["xl/workbook.xml"]).toContain('name="Contract  review sign"');
  });

  it("lays the lanes out as bands of rows with a frozen, coloured title cell each", async () => {
    const { parts, layout } = await build();
    const { doc } = parse(parts["xl/worksheets/sheet1.xml"]);
    const rows = all(doc, "row");
    const cellText = (ref: string) =>
      all(doc, "c").find((c) => c.getAttribute("r") === ref)?.textContent ?? "";
    expect(cellText("A1")).toBe("Contract: review/sign?");
    expect(cellText("A2")).toBe("Owner: Ops");
    // One row per lane, as tall as the lane on the map (points = px * 0.75).
    expect(cellText("A4")).toBe("Sales & <Ops>");
    expect(cellText("A5")).toBe("Legal");
    layout.lanes.forEach((lane, i) => {
      expect(Number(rows[3 + i].getAttribute("ht"))).toBeCloseTo(lane.height * 0.75, 0);
    });
    // Title and body cells carry different styles; every body cell in a lane is filled.
    const lane1 = all(rows[3], "c");
    expect(lane1.length).toBeGreaterThan(3);
    expect(lane1[0].getAttribute("s")).not.toBe(lane1[1].getAttribute("s"));
    expect(new Set(lane1.slice(1).map((c) => c.getAttribute("s"))).size).toBe(1);
    // The columns add up to the map's width, so shapes line up with the cells.
    const widthPx = all(doc, "col").reduce(
      (sum, c) => sum + Number(c.getAttribute("width")) * 7,
      0,
    );
    expect(widthPx).toBeGreaterThan(layout.width - 8);
    expect(widthPx).toBeLessThan(layout.width + 8);
    // Lane titles stay put while scrolling.
    const pane = all(doc, "pane")[0];
    expect(pane.getAttribute("xSplit")).toBe("1");
    expect(pane.getAttribute("ySplit")).toBe("3");
    expect(pane.getAttribute("state")).toBe("frozen");
    expect(parts["xl/worksheets/sheet1.xml"]).toContain("TEAMS (arrow colours)");
    // Party colours reach the stylesheet: a solid title fill and a paler lane tint.
    expect(parts["xl/styles.xml"]).toContain('fgColor rgb="FF8FB8F2"');
    expect(parts["xl/styles.xml"]).toContain('textRotation="90"');
  });

  it("turns the lanes into columns under their titles for top-to-bottom flow", async () => {
    const { parts, layout } = await build("vertical");
    const { doc } = parse(parts["xl/worksheets/sheet1.xml"]);
    const cellText = (ref: string) =>
      all(doc, "c").find((c) => c.getAttribute("r") === ref)?.textContent ?? "";
    expect(cellText("A4")).toBe("Sales & <Ops>");
    expect(cellText("B4")).toBe("Legal");
    const cols = all(doc, "col");
    // One column per lane, plus room beyond the last lane for arrows that go round the outside.
    expect(cols.length).toBeGreaterThanOrEqual(layout.lanes.length);
    layout.lanes.forEach((lane, i) => {
      expect(Number(cols[i].getAttribute("width")) * 7).toBeCloseTo(lane.width, -1);
    });
    const pane = all(doc, "pane")[0];
    expect(pane.getAttribute("xSplit")).toBeNull();
    expect(pane.getAttribute("ySplit")).toBe("4");
    expect(parts["xl/styles.xml"]).not.toContain("textRotation");
  });

  it("draws each step as a shape at its map position and each arrow along its exact route", async () => {
    const { parts, graph, layout } = await build();
    const { doc } = parse(parts["xl/drawings/drawing1.xml"]);
    const shapes = all(doc, "xdr:sp");
    const named = (prefix: string) =>
      shapes.filter((s) => all(s, "xdr:cNvPr")[0].getAttribute("name")!.startsWith(prefix));
    const ids = shapes.map((s) => all(s, "xdr:cNvPr")[0].getAttribute("id"));
    expect(new Set(ids).size).toBe(ids.length);

    // Steps: one shape each, the right kind, where the map has it.
    const steps = named("Step ");
    expect(steps).toHaveLength(4);
    const kinds = steps.map((s) => all(s, "a:prstGeom")[0].getAttribute("prst"));
    expect(kinds).toEqual(["ellipse", "roundRect", "diamond", "ellipse"]);
    const task = steps[1];
    expect(task.textContent).toBe("Review <contract> & sign");
    const pos = layout.nodes.find((n) => n.id === "s2")!;
    const ln = graph.nodes.find((n) => n.id === "s2")!;
    const off = all(task, "a:off")[0];
    const ext = all(task, "a:ext")[0];
    expect(Number(off.getAttribute("x")) / EMU).toBeCloseTo(pos.x + ln.cx - ln.shapeWidth / 2, 0);
    expect(Number(off.getAttribute("y")) / EMU).toBeCloseTo(
      TITLE_H + pos.y + ln.cy - ln.shapeHeight / 2,
      0,
    );
    expect(Number(ext.getAttribute("cx")) / EMU).toBeCloseTo(ln.shapeWidth, 0);

    // What the map writes beside a step comes along as text.
    const notes = named("Notes for step 2")[0];
    expect(all(notes, "a:t").map((t) => t.textContent)).toEqual([
      "DocuSign",
      "With: LE",
      "Control · FIN-012",
    ]);
    expect(named("Notes for step 3")[0].textContent).toBe("Approved?");

    // Arrows: one per link, with an arrowhead, through every point of the map's route.
    const arrows = named("Arrow ");
    expect(arrows).toHaveLength(graph.edges.length);
    for (const route of layout.edges) {
      const arrow = arrows.find((a) =>
        all(a, "xdr:cNvPr")[0].getAttribute("name")!.endsWith(route.id),
      )!;
      expect(all(arrow, "a:tailEnd")).toHaveLength(1);
      const x0 = Math.min(...route.points.map((p) => p.x));
      const y0 = Math.min(...route.points.map((p) => p.y));
      const at = all(arrow, "a:off")[0];
      expect(Number(at.getAttribute("x")) / EMU).toBeCloseTo(x0, 0);
      expect(Number(at.getAttribute("y")) / EMU).toBeCloseTo(TITLE_H + y0, 0);
      if (route.points.length === 2) {
        expect(all(arrow, "a:prstGeom")[0].getAttribute("prst")).toBe("line");
      } else {
        const pts = all(arrow, "a:pt");
        expect(pts).toHaveLength(route.points.length);
        pts.forEach((pt, i) => {
          expect(Number(pt.getAttribute("x")) / EMU).toBeCloseTo(route.points[i].x - x0, 0);
          expect(Number(pt.getAttribute("y")) / EMU).toBeCloseTo(route.points[i].y - y0, 0);
        });
      }
    }

    // Outcome labels sit where the map puts them; the default outcome says so.
    const labels = named("Label ");
    expect(labels.map((l) => l.textContent).sort()).toEqual(["No", "Yes (default)"]);
    const no = layout.edges.find((e) => e.id === "s3->s2")!;
    const noAt = all(
      labels.find((l) => l.textContent === "No")!,
      "a:off",
    )[0];
    expect(Number(noAt.getAttribute("y")) / EMU).toBeCloseTo(TITLE_H + no.labelAt!.y - 9, 0);

    // Steps are drawn after arrows, and labels last, so nothing is hidden.
    const order = shapes.map((s) => all(s, "xdr:cNvPr")[0].getAttribute("name")!.split(" ")[0]);
    expect(order.lastIndexOf("Arrow")).toBeLessThan(order.indexOf("Step"));
    expect(order.lastIndexOf("Step")).toBeLessThan(order.indexOf("Label"));
  });

  it("zips into a package whose parts match", async () => {
    const { parts, ...ctx } = await build();
    const unzipped = unzipSync(buildXlsx(ctx));
    expect(Object.keys(unzipped).sort()).toEqual(Object.keys(parts).sort());
    expect(strFromU8(unzipped["xl/workbook.xml"])).toBe(parts["xl/workbook.xml"]);
  });
});
