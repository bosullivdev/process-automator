import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { DOMParser } from "@xmldom/xmldom";
import { buildVsdx, buildVsdxParts, esc } from "../src/export/vsdx";
import { buildLayoutGraph } from "../src/graph/build-graph";
import { layoutGraph } from "../src/graph/layout";
import { party, process, step } from "./fixtures";
import type { Team } from "../src/model/types";
import ELK from "elkjs/lib/elk.bundled.js";

const sales = party("Sales", 0);
const legal = party("Legal", 1);
const north: Team = { id: "north", name: "North", colourIndex: 0 };
const south: Team = { id: "south", name: "South", colourIndex: 1 };
const teams = [north, south];

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
        notes: 'Check "limits"',
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
          { targetId: "s2", label: "No", teamIds: ["north"] },
        ],
      }),
      step({ id: "s4", displayNo: 4, type: "end", ownerId: legal.id }),
    ],
    { name: "Contract review", owner: "Ops", laneOrder: [sales.id, legal.id] },
  );
}

async function build() {
  const proc = fixture();
  const graph = buildLayoutGraph(proc, [sales, legal], "simple", "horizontal", "full", teams);
  const layout = await layoutGraph(graph, "horizontal", new ELK());
  return { proc, graph, layout };
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

describe("vsdx export", () => {
  it("escapes text for XML", () => {
    expect(esc('a < b & "c"')).toBe("a &lt; b &amp; &quot;c&quot;");
  });

  it("writes every package part as well-formed XML", async () => {
    const { proc, graph, layout } = await build();
    const parts = buildVsdxParts(
      {
        process: proc,
        parties: [sales, legal],
        teams,
        graph,
        layout,
        teamLine: "Team: North only",
      },
      "2026-11-09T12:00:00Z",
    );
    expect(Object.keys(parts).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/app.xml",
      "docProps/core.xml",
      "visio/_rels/document.xml.rels",
      "visio/document.xml",
      "visio/pages/_rels/pages.xml.rels",
      "visio/pages/page1.xml",
      "visio/pages/pages.xml",
    ]);
    for (const [path, xml] of Object.entries(parts)) {
      const { errors } = parse(xml);
      expect(errors, path).toEqual([]);
    }
  });

  it("draws lanes, steps, glued connectors, shape data and the legend", async () => {
    const { proc, graph, layout } = await build();
    const parts = buildVsdxParts({ process: proc, parties: [sales, legal], teams, graph, layout });
    const page = parts["visio/pages/page1.xml"];
    const { doc } = parse(page);
    const shapes = Array.from(doc.getElementsByTagName("Shape"));
    const connects = Array.from(doc.getElementsByTagName("Connect"));
    // 4 steps, 4 links -> 4 connectors with begin and end glue.
    expect(connects).toHaveLength(8);
    const connectorIds = new Set(connects.map((c) => c.getAttribute("FromSheet")));
    expect(connectorIds.size).toBe(4);
    const ids = shapes.map((s) => s.getAttribute("ID"));
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of connects) {
      expect(ids).toContain(c.getAttribute("ToSheet"));
      expect(c.getAttribute("ToPart")).toBe("3");
    }
    // Connectors are dynamic and glued by formula to their step shapes.
    const connectorXml = shapes
      .filter((s) => connectorIds.has(s.getAttribute("ID")))
      .map((s) => s.toString());
    for (const x of connectorXml) {
      expect(x).toContain('N="ObjType" V="2"');
      expect(x).toContain("_WALKGLUE(BegTrigger,EndTrigger,WalkPreference)");
      expect(x).toMatch(/_XFTRIGGER\(Sheet\.\d+!EventXFMod\)/);
      expect(x).toContain('N="EndArrow" V="4"');
    }
    // Labels, step text and escaped characters.
    expect(page).toContain("<Text>Yes</Text>");
    expect(page).toContain("<Text>No</Text>");
    expect(page).toContain("Review &lt;contract&gt; &amp; sign\nDocuSign");
    expect(page).toContain('N="Value" V="Check &quot;limits&quot;" U="STR"');
    expect(page).toContain('<Row N="Owner"><Cell N="Value" V="Sales" U="STR"/>');
    expect(page).toContain('<Row N="Teams"><Cell N="Value" V="All teams" U="STR"/>');
    // Lane bands and headers, title block, legends.
    expect(page).toContain('<Row N="Lane"><Cell N="Value" V="Sales" U="STR"/>');
    expect(page).toContain("<Text>Legal</Text>");
    expect(page).toContain("<Text>Contract review</Text>");
    expect(page).toContain("<Text>Owner: Ops</Text>");
    expect(page).toContain("<Text>PARTIES</Text>");
    expect(page).toContain("<Text>TEAMS (arrow colours)</Text>");
    expect(page).toContain("<Text>North</Text>");
    // The North-only "No" link takes North's colour; shared links stay neutral.
    const noConnector = connectorXml.find((x) => x.includes("<Text>No</Text>"))!;
    expect(noConnector).toContain('<Row N="Teams"><Cell N="Value" V="North" U="STR"/>');
    expect(noConnector).not.toContain('N="LineColor" V="#9ca3af"');
    const yesConnector = connectorXml.find((x) => x.includes("<Text>Yes</Text>"))!;
    expect(yesConnector).toContain('N="LineColor" V="#9ca3af"');
  });

  it("keeps every shape on the page and the page sized to the map", async () => {
    const { proc, graph, layout } = await build();
    const parts = buildVsdxParts({ process: proc, parties: [sales, legal], teams, graph, layout });
    const pages = parts["visio/pages/pages.xml"];
    const w = Number(/N="PageWidth" V="([\d.]+)"/.exec(pages)![1]);
    const h = Number(/N="PageHeight" V="([\d.]+)"/.exec(pages)![1]);
    expect(w).toBeGreaterThan(layout.width / 96);
    expect(h).toBeGreaterThan(layout.height / 96);
    const { doc } = parse(parts["visio/pages/page1.xml"]);
    for (const shape of Array.from(doc.getElementsByTagName("Shape"))) {
      const v = (n: string) =>
        Number(
          Array.from(shape.getElementsByTagName("Cell"))
            .find((c) => c.getAttribute("N") === n)!
            .getAttribute("V"),
        );
      expect(v("PinX")).toBeGreaterThanOrEqual(0);
      expect(v("PinX")).toBeLessThanOrEqual(w);
      expect(v("PinY")).toBeGreaterThanOrEqual(0);
      expect(v("PinY")).toBeLessThanOrEqual(h);
    }
  });

  it("zips into a package whose parts match", async () => {
    const { proc, graph, layout } = await build();
    const ctx = { process: proc, parties: [sales, legal], teams, graph, layout };
    const bytes = buildVsdx(ctx);
    expect(bytes[0]).toBe(0x50); // "PK"
    expect(bytes[1]).toBe(0x4b);
    const files = unzipSync(bytes);
    const parts = buildVsdxParts(ctx);
    expect(Object.keys(files).sort()).toEqual(Object.keys(parts).sort());
    expect(strFromU8(files["visio/pages/page1.xml"])).toBe(parts["visio/pages/page1.xml"]);
  });
});
