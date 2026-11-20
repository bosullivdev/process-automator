import { describe, expect, it } from "vitest";
import ELK from "elkjs/lib/elk.bundled.js";
import { planFiles, planMaps, zipName, type ExportOptions } from "../src/export/plan";
import { buildVsdxDocumentParts, pageNames } from "../src/export/vsdx";
import { buildLayoutGraph } from "../src/graph/build-graph";
import { layoutGraph } from "../src/graph/layout";
import { processForTeam, processForTeams, withoutTeamScopes } from "../src/model/team";
import type { Team, Workspace } from "../src/model/types";
import { party, process, step, workspace } from "./fixtures";

const sales = party("Sales", 0);
const legal = party("Legal", 1);
const north: Team = { id: "north", name: "North", colourIndex: 0 };
const south: Team = { id: "south", name: "South", colourIndex: 1 };
const east: Team = { id: "east", name: "East", colourIndex: 2 };

/**
 * start(1) -> review(2) -> end(5) for everyone; North and South also check (3)
 * between review and end; East alone escalates (4). Legal reviews for East only.
 */
function orders() {
  return process(
    [
      step({
        id: "o1",
        displayNo: 1,
        type: "start",
        ownerId: sales.id,
        next: [{ targetId: "o2" }],
      }),
      step({
        id: "o2",
        displayNo: 2,
        name: "Review",
        ownerId: sales.id,
        coOwnerIds: [legal.id],
        ownerTeams: { [legal.id]: ["east"] },
        next: [
          { targetId: "o5", teamIds: ["east"] },
          { targetId: "o3", teamIds: ["north", "south"] },
          { targetId: "o4", teamIds: ["east"] },
        ],
      }),
      step({
        id: "o3",
        displayNo: 3,
        name: "Check",
        ownerId: sales.id,
        teamIds: ["north", "south"],
        next: [{ targetId: "o5" }],
      }),
      step({
        id: "o4",
        displayNo: 4,
        name: "Escalate",
        ownerId: legal.id,
        teamIds: ["east"],
        next: [{ targetId: "o5" }],
      }),
      step({ id: "o5", displayNo: 5, type: "end", ownerId: sales.id }),
    ],
    { name: "Orders", laneOrder: [sales.id, legal.id] },
  );
}

function ws(): Workspace {
  const ledger = process(
    [
      step({
        id: "l1",
        displayNo: 1,
        type: "start",
        ownerId: legal.id,
        next: [{ targetId: "l2" }],
      }),
      step({ id: "l2", displayNo: 2, type: "end", ownerId: legal.id, teamIds: [] }),
    ],
    { name: "Close ledger", laneOrder: [legal.id] },
  );
  const eastOnly = process(
    [step({ id: "e1", displayNo: 1, type: "start", ownerId: legal.id, teamIds: ["east"] })],
    { name: "East audit" },
  );
  const empty = process([], { name: "Empty" });
  const w = workspace([sales, legal], [orders(), ledger, eastOnly, empty]);
  return { ...w, meta: { ...w.meta, name: "Finance ops" }, teams: [north, south, east] };
}

function options(w: Workspace, patch: Partial<ExportOptions> = {}): ExportOptions {
  return {
    formats: ["vsdx"],
    processIds: w.processes.map((p) => p.id),
    teamMode: "all",
    teamIds: w.teams.map((t) => t.id),
    packaging: "single",
    zip: true,
    orientation: "horizontal",
    shapeMode: "simple",
    annotations: "full",
    ...patch,
  };
}

describe("processForTeams", () => {
  it("keeps what any chosen team does and narrows team tags to the chosen teams", () => {
    const p = processForTeams(orders(), ["north", "south"]);
    expect(p.steps.map((s) => s.id)).toEqual(["o1", "o2", "o3", "o5"]);
    const review = p.steps.find((s) => s.id === "o2")!;
    // East's direct route and escalation are gone; the shared route needs no tag any more.
    expect(review.next).toEqual([{ targetId: "o3" }]);
    // Legal reviews for East only, so it is not on this map.
    expect(review.coOwnerIds).toEqual([]);
    expect(review.ownerTeams).toBeUndefined();
    // A step both chosen teams do reads as "every team".
    expect(p.steps.find((s) => s.id === "o3")!.teamIds).toEqual([]);
  });

  it("keeps the tags that still tell the chosen teams apart", () => {
    const p = processForTeams(orders(), ["north", "east"]);
    expect(p.steps.map((s) => s.id)).toEqual(["o1", "o2", "o3", "o4", "o5"]);
    const review = p.steps.find((s) => s.id === "o2")!;
    expect(review.next).toEqual([
      { targetId: "o5", teamIds: ["east"] },
      { targetId: "o3", teamIds: ["north"] },
      { targetId: "o4", teamIds: ["east"] },
    ]);
    expect(review.coOwnerIds).toEqual([legal.id]);
    expect(review.ownerTeams).toEqual({ [legal.id]: ["east"] });
    expect(p.steps.find((s) => s.id === "o3")!.teamIds).toEqual(["north"]);
    expect(p.steps.find((s) => s.id === "o4")!.teamIds).toEqual(["east"]);
  });

  it("with one team is that team's variant as a plain process", () => {
    const p = orders();
    for (const id of ["north", "east"])
      expect(processForTeams(p, [id])).toEqual(withoutTeamScopes(processForTeam(p, id)));
  });

  it("is empty when no chosen team does anything", () => {
    expect(processForTeams(orders(), []).steps).toEqual([]);
  });
});

describe("planMaps", () => {
  it("draws each ticked process whole, skipping ones with no steps", () => {
    const w = ws();
    const maps = planMaps(w, options(w));
    expect(maps.map((m) => m.title)).toEqual(["Orders", "Close ledger", "East audit"]);
    expect(maps[0].process).toBe(w.processes[0]);
    expect(maps[0].teams).toEqual(w.teams);
    expect(maps[0].teamLine).toBeUndefined();
    expect(planMaps(w, options(w, { processIds: [w.processes[1].id] }))).toHaveLength(1);
  });

  it("puts the ticked teams together on one map per process", () => {
    const w = ws();
    const maps = planMaps(w, options(w, { teamMode: "together", teamIds: ["south", "north"] }));
    // East audit has nothing for North or South.
    expect(maps.map((m) => m.title)).toEqual(["Orders", "Close ledger"]);
    // Registry order, whatever order they were ticked in.
    expect(maps[0].teams.map((t) => t.name)).toEqual(["North", "South"]);
    expect(maps[0].teamLine).toBe("Teams: North, South");
    expect(maps[0].stem).toBe("Orders-North-South");
    expect(maps[0].process.steps.map((s) => s.id)).toEqual(["o1", "o2", "o3", "o5"]);
  });

  it("treats every team ticked as the whole process, and one team as a plain process", () => {
    const w = ws();
    const all = planMaps(w, options(w, { teamMode: "together" }));
    expect(all[0].process).toBe(w.processes[0]);
    expect(all[0].stem).toBe("Orders");
    const one = planMaps(w, options(w, { teamMode: "together", teamIds: ["east"] }));
    expect(one.map((m) => m.title)).toEqual(["Orders", "Close ledger", "East audit"]);
    expect(one[0].teams).toEqual([]);
    expect(one[0].teamLine).toBe("Team: East only");
  });

  it("draws a map for each ticked team", () => {
    const w = ws();
    const maps = planMaps(w, options(w, { teamMode: "each", teamIds: ["north", "east"] }));
    expect(maps.map((m) => m.title)).toEqual([
      "Orders (North)",
      "Orders (East)",
      "Close ledger (North)",
      "Close ledger (East)",
      "East audit (East)",
    ]);
    expect(maps.every((m) => m.teams.length === 0)).toBe(true);
    expect(maps[1].stem).toBe("Orders-East");
    expect(maps[1].process.steps.map((s) => s.id)).toEqual(["o1", "o2", "o4", "o5"]);
  });

  it("ignores team choices in a workspace without teams, and yields nothing with no team ticked", () => {
    const w = ws();
    expect(planMaps(w, options(w, { teamMode: "each", teamIds: [] }))).toEqual([]);
    const plain = { ...w, teams: [] };
    expect(planMaps(plain, options(plain, { teamMode: "each", teamIds: [] }))).toHaveLength(3);
  });
});

describe("planFiles", () => {
  const date = "2026-11-20";

  it("puts every map in one file for formats that hold several, and a file per map for the rest", () => {
    const w = ws();
    const o = options(w, { formats: ["png", "vsdx", "pdf"] });
    const maps = planMaps(w, o);
    const files = planFiles(w, o, maps, date);
    expect(files.map((f) => f.name)).toEqual([
      "Finance-ops-2026-11-20.vsdx",
      "Finance-ops-2026-11-20.pdf",
      "Orders-2026-11-20.png",
      "Close-ledger-2026-11-20.png",
      "East-audit-2026-11-20.png",
    ]);
    expect(files[0].maps).toEqual([0, 1, 2]);
    expect(zipName(w, o, files, date)).toBe("Finance-ops-export-2026-11-20.zip");
    expect(zipName(w, { ...o, zip: false }, files, date)).toBeNull();
  });

  it("names a single file after its teams, and is not zipped when it is the only file", () => {
    const w = ws();
    const o = options(w, { teamMode: "together", teamIds: ["north", "south"] });
    const files = planFiles(w, o, planMaps(w, o), date);
    expect(files.map((f) => f.name)).toEqual(["Finance-ops-North-South-2026-11-20.vsdx"]);
    expect(zipName(w, o, files, date)).toBeNull();
  });

  it("names a one-map file after the map", () => {
    const w = ws();
    const o = options(w, { processIds: [w.processes[0].id], formats: ["xlsx"] });
    expect(planFiles(w, o, planMaps(w, o), date).map((f) => f.name)).toEqual([
      "Orders-2026-11-20.xlsx",
    ]);
  });

  it("writes a file per map when asked, with repeated names numbered", () => {
    const w = ws();
    w.processes[1].name = "orders";
    const o = options(w, { packaging: "separate", formats: ["vsdx"] });
    expect(planFiles(w, o, planMaps(w, o), date).map((f) => f.name)).toEqual([
      "Orders-2026-11-20.vsdx",
      "orders-2026-11-20-2.vsdx",
      "East-audit-2026-11-20.vsdx",
    ]);
  });

  it("plans nothing without maps or formats", () => {
    const w = ws();
    expect(planFiles(w, options(w), [], date)).toEqual([]);
    const o = options(w, { formats: [] });
    expect(planFiles(w, o, planMaps(w, o), date)).toEqual([]);
  });
});

describe("multi-page vsdx", () => {
  it("numbers repeated page names and keeps them to 31 characters", () => {
    expect(pageNames(["Orders", "orders", "A very long process name that goes on", ""])).toEqual([
      "Orders",
      "orders (2)",
      "A very long process name that g",
      "Process map",
    ]);
  });

  it("writes a page per map, each wired into the package", async () => {
    const w = ws();
    const o = options(w, { teamMode: "each", teamIds: ["north", "east"] });
    const maps = planMaps(w, o).slice(0, 3);
    const elk = new ELK();
    const ctxs = [];
    for (const m of maps) {
      const graph = buildLayoutGraph(m.process, w.parties, "simple", "horizontal", "full", m.teams);
      const layout = await layoutGraph(graph, "horizontal", elk);
      ctxs.push({
        process: m.process,
        parties: w.parties,
        teams: m.teams,
        graph,
        layout,
        teamLine: m.teamLine,
        pageName: m.title,
      });
    }
    const parts = buildVsdxDocumentParts(ctxs, "Finance ops", "2026-11-20T12:00:00Z");
    for (const n of [1, 2, 3]) {
      expect(parts[`visio/pages/page${n}.xml`]).toBeDefined();
      expect(parts["[Content_Types].xml"]).toContain(`/visio/pages/page${n}.xml`);
      expect(parts["visio/pages/_rels/pages.xml.rels"]).toContain(
        `Id="rId${n}" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page${n}.xml"`,
      );
    }
    expect(parts["visio/pages/page4.xml"]).toBeUndefined();
    const pages = parts["visio/pages/pages.xml"];
    expect(pages).toContain('<Page ID="0" NameU="Orders (North)"');
    expect(pages).toContain('<Page ID="1" NameU="Orders (East)"');
    expect(pages).toContain('<Page ID="2" NameU="Close ledger (North)"');
    expect(pages.match(/<Rel r:id="rId\d+"\/>/g)).toEqual([
      '<Rel r:id="rId1"/>',
      '<Rel r:id="rId2"/>',
      '<Rel r:id="rId3"/>',
    ]);
    // Each page is its team's variant: Escalate is East's step only.
    expect(parts["visio/pages/page1.xml"]).not.toContain("Escalate");
    expect(parts["visio/pages/page2.xml"]).toContain("Escalate");
    expect(parts["visio/pages/page2.xml"]).toContain("Team: East only");
    expect(parts["docProps/core.xml"]).toContain("<dc:title>Finance ops</dc:title>");
  });
});
