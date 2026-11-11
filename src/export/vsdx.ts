import { strToU8, zipSync } from "fflate";
import type { Party, Process, Step, Team } from "../model/types";
import type {
  LayoutEdge,
  LayoutGraph,
  LayoutNode,
  LayoutResult,
  Point,
} from "../graph/layout-types";
import { UNASSIGNED_LANE } from "../graph/layout-types";
import { resolveColour, UNASSIGNED_COLOUR } from "../design/palette";
import { linkTeams, stepInTeam, teamNames } from "../model/team";
import { partyInitials } from "../model/party";

/**
 * Visio (.vsdx) export. A .vsdx file is an Open Packaging zip of XML parts;
 * this module writes the minimum set Visio needs: the document with one
 * stylesheet, one page, and the page's shapes and connections. Shapes carry
 * inline geometry rather than stencil masters, so nothing licensed ships with
 * the app. Connectors are dynamic connectors glued to their steps, so moving
 * a step in Visio keeps its arrows attached. Coordinates are inches with the
 * origin at the bottom-left, which is how Visio measures a page.
 */
export interface VsdxContext {
  process: Process;
  parties: readonly Party[];
  teams: readonly Team[];
  graph: LayoutGraph;
  layout: LayoutResult;
  /** Extra title-block line when one team's variant is shown. */
  teamLine?: string;
}

const NS = "http://schemas.microsoft.com/office/visio/2012/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
/** CSS pixels per inch: the map's px coordinates become inches at this scale. */
const PX = 96;
const MARGIN = 0.5;
const TITLE_H = 0.9;
const LEGEND_ROW = 0.26;
const LEGEND_GAP = 0.3;
const FONT = "Calibri";
const NEUTRAL_EDGE = "#9ca3af";
const TEXT = "#18181b";
const MUTED = "#71717a";
const BORDER = "#e4e4e7";
const SURFACE = "#ffffff";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const num = (v: number) => String(Math.round(v * 10000) / 10000);

function cell(n: string, v: string | number, f?: string, u?: string): string {
  return `<Cell N="${n}" V="${typeof v === "number" ? num(v) : esc(v)}"${f ? ` F="${esc(f)}"` : ""}${u ? ` U="${u}"` : ""}/>`;
}

/** Common transform cells for a 2-D shape whose pin is its centre. */
function xform(pinX: number, pinY: number, w: number, h: number): string {
  return (
    cell("PinX", pinX) +
    cell("PinY", pinY) +
    cell("Width", w) +
    cell("Height", h) +
    cell("LocPinX", w / 2, "Width*0.5") +
    cell("LocPinY", h / 2, "Height*0.5") +
    cell("Angle", 0) +
    cell("FlipX", 0) +
    cell("FlipY", 0) +
    cell("ResizeMode", 0)
  );
}

function character(size: number, colour: string, bold = false): string {
  return (
    `<Section N="Character"><Row IX="0">` +
    cell("Font", FONT) +
    cell("Color", colour) +
    cell("Style", bold ? 1 : 0) +
    cell("Size", size / 72, undefined, "PT") +
    `</Row></Section>`
  );
}

function paragraph(align: 0 | 1 | 2): string {
  return `<Section N="Paragraph"><Row IX="0">${cell("HorzAlign", align)}</Row></Section>`;
}

/** Relative-coordinate geometry: points in 0..1 of the shape's width and height. */
function relGeometry(points: Array<[number, number]>, close = true): string {
  const rows = points
    .map(
      ([x, y], i) =>
        `<Row T="${i === 0 ? "RelMoveTo" : "RelLineTo"}" IX="${i + 1}">${cell("X", x)}${cell("Y", y)}</Row>`,
    )
    .join("");
  const back = close
    ? `<Row T="RelLineTo" IX="${points.length + 1}">${cell("X", points[0][0])}${cell("Y", points[0][1])}</Row>`
    : "";
  return (
    `<Section N="Geometry" IX="0">` +
    cell("NoFill", 0) +
    cell("NoLine", 0) +
    cell("NoShow", 0) +
    cell("NoSnap", 0) +
    cell("NoQuickDrag", 0) +
    rows +
    back +
    `</Section>`
  );
}

function ellipseGeometry(w: number, h: number): string {
  return (
    `<Section N="Geometry" IX="0">` +
    cell("NoFill", 0) +
    cell("NoLine", 0) +
    cell("NoShow", 0) +
    cell("NoSnap", 0) +
    cell("NoQuickDrag", 0) +
    `<Row T="Ellipse" IX="1">` +
    cell("X", w / 2, "Width*0.5") +
    cell("Y", h / 2, "Height*0.5") +
    cell("A", w, "Width*1") +
    cell("B", h / 2, "Height*0.5") +
    cell("C", w / 2, "Width*0.5") +
    cell("D", h, "Height*1") +
    `</Row></Section>`
  );
}

const RECT: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const DIAMOND: Array<[number, number]> = [
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
  [0, 0.5],
];

/** Shape Data rows shown in Visio's Shape Data window. */
function properties(rows: Array<[name: string, label: string, value: string]>): string {
  const body = rows
    .filter(([, , value]) => value !== "")
    .map(
      ([name, label, value]) =>
        `<Row N="${name}">${cell("Value", value, undefined, "STR")}${cell("Label", label)}${cell("Type", 0)}${cell("Invisible", 0)}</Row>`,
    )
    .join("");
  return body ? `<Section N="Property">${body}</Section>` : "";
}

/** Text block placed outside the shape (below it) for start, end and decision shapes. */
function textBelow(w: number, textW: number, textH: number): string {
  return (
    cell("TxtPinX", w / 2, "Width*0.5") +
    cell("TxtPinY", -textH / 2 - 0.04) +
    cell("TxtWidth", textW) +
    cell("TxtHeight", textH) +
    cell("TxtLocPinX", textW / 2, "TxtWidth*0.5") +
    cell("TxtLocPinY", textH / 2, "TxtHeight*0.5") +
    cell("TxtAngle", 0)
  );
}

interface Ctx {
  nextId: number;
  shapes: string[];
  connects: string[];
  pageW: number;
  pageH: number;
  contentTop: number;
}

/** Map a px point (y down, content origin) to page inches (y up). */
function toPage(c: Ctx, p: Point): Point {
  return { x: MARGIN + p.x / PX, y: c.pageH - (c.contentTop + p.y / PX) };
}

function addShape(c: Ctx, body: string, type = "Shape"): number {
  const id = c.nextId++;
  c.shapes.push(
    `<Shape ID="${id}" Type="${type}" LineStyle="0" FillStyle="0" TextStyle="0">${body}</Shape>`,
  );
  return id;
}

function laneShapes(c: Ctx, ctx: VsdxContext): void {
  const { layout, parties } = ctx;
  const partyById = new Map(parties.map((p) => [p.id, p]));
  for (const lane of layout.lanes) {
    const party = partyById.get(lane.id);
    const colour =
      lane.id === UNASSIGNED_LANE || !party
        ? UNASSIGNED_COLOUR.light
        : resolveColour(party.colourIndex, "light", party.colourOverride);
    const name = lane.id === UNASSIGNED_LANE ? "Unassigned" : (party?.name ?? "Unknown");
    // Lane body: tinted band.
    const tl = toPage(c, { x: lane.x, y: lane.y });
    const w = lane.width / PX;
    const h = lane.height / PX;
    addShape(
      c,
      xform(tl.x + w / 2, tl.y - h / 2, w, h) +
        cell("LineColor", BORDER) +
        cell("LineWeight", 1 / 96) +
        cell("FillForegnd", colour.fill) +
        cell("FillForegndTrans", 0.91) +
        relGeometry(RECT) +
        properties([["Lane", "Lane", name]]),
    );
    // Header band with the party name.
    const htl = toPage(c, { x: lane.header.x, y: lane.header.y });
    const hw = lane.header.width / PX;
    const hh = lane.header.height / PX;
    const rotated = hh > hw;
    const textW = rotated ? hh : hw;
    const textH = rotated ? hw : hh;
    addShape(
      c,
      xform(htl.x + hw / 2, htl.y - hh / 2, hw, hh) +
        cell("LineColor", colour.fill) +
        cell("LineWeight", 1 / 96) +
        cell("FillForegnd", colour.fill) +
        cell("TxtPinX", hw / 2, "Width*0.5") +
        cell("TxtPinY", hh / 2, "Height*0.5") +
        cell("TxtWidth", textW) +
        cell("TxtHeight", textH) +
        cell("TxtLocPinX", textW / 2, "TxtWidth*0.5") +
        cell("TxtLocPinY", textH / 2, "TxtHeight*0.5") +
        cell("TxtAngle", rotated ? Math.PI / 2 : 0) +
        character(9, colour.text, true) +
        paragraph(1) +
        relGeometry(RECT) +
        `<Text>${esc(lane.header.lines.join("\n") || name)}</Text>`,
    );
  }
}

function stepText(step: Step | undefined, ln: LayoutNode): string {
  if (!step) return ln.kind === "fork" ? "+" : ln.kind === "join" ? "+" : "";
  const lines = [step.name.trim() || "Untitled"];
  if (ln.text.tech) lines.push(ln.text.tech);
  if (ln.text.control) lines.push(ln.text.control);
  return lines.join("\n");
}

function nodeShapes(c: Ctx, ctx: VsdxContext, shapeIdByNode: Map<string, number>): void {
  const { graph, layout, process, parties, teams } = ctx;
  const stepById = new Map(process.steps.map((s) => [s.id, s]));
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const laneColour = (laneId: string) => {
    const p = partyById.get(laneId);
    return p ? resolveColour(p.colourIndex, "light", p.colourOverride) : UNASSIGNED_COLOUR.light;
  };
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const pos of layout.nodes) {
    const ln = byId.get(pos.id);
    if (!ln) continue;
    const step = ln.kind === "fork" || ln.kind === "join" ? undefined : stepById.get(ln.stepId);
    const sw = ln.shapeWidth / PX;
    const sh = ln.shapeHeight / PX;
    const centre = toPage(c, { x: pos.x + ln.cx, y: pos.y + ln.cy });
    const colour = laneColour(ln.laneId);
    const outside = ln.kind !== "task";
    const lineWeight = ln.kind === "end" ? 4 / 96 : 2 / 96;

    let geometry: string;
    switch (ln.kind) {
      case "start":
      case "end":
        geometry = ellipseGeometry(sw, sh);
        break;
      case "decision":
      case "fork":
      case "join":
        geometry = relGeometry(DIAMOND);
        break;
      default:
        geometry = relGeometry(RECT);
    }
    // A co-owned step is drawn once per lane; each copy names its own lane's party.
    const laneParty = partyById.get(ln.laneId);
    const owner = !step ? "" : (laneParty?.name ?? (step.ownerId ? "Unknown party" : ""));
    const text = stepText(step, ln);
    const labelW = Math.max(ln.text.labelWidth / PX, 1.2);
    const labelH = Math.max((ln.text.nameLines.length * 14) / PX + 0.1, 0.25);
    const body =
      xform(centre.x, centre.y, sw, sh) +
      cell("LineColor", colour.fill) +
      cell("LineWeight", lineWeight) +
      cell("FillForegnd", SURFACE) +
      (ln.kind === "task" ? cell("Rounding", 8 / 96) : "") +
      (outside && step ? textBelow(sw, labelW, labelH) : "") +
      character(outside ? 8 : 9, TEXT) +
      paragraph(1) +
      geometry +
      (step
        ? properties([
            ["StepNo", "Step", String(step.displayNo)],
            ["StepType", "Type", step.type],
            ["Owner", "Owner", owner],
            [
              "Contributors",
              "Contributors",
              step.contributorIds
                .map((id) => partyById.get(id)?.name ?? "Unknown party")
                .join(", "),
            ],
            ["Teams", "Teams", teamNames(step.teamIds, teams).join(", ") || "All teams"],
            ["Technology", "Technology", step.technology],
            ["Notes", "Notes", step.notes],
            ["Control", "Control", step.hasControl ? "Yes" : ""],
            [
              "ControlRef",
              "Control reference",
              step.hasControl ? (step.controlRef ?? "").trim() : "",
            ],
          ])
        : "") +
      (text ? `<Text>${esc(text)}</Text>` : "");
    shapeIdByNode.set(pos.id, addShape(c, body));
  }
}

/** Colour of an arrow: neutral when every team uses it, else the first team's colour. */
export function edgeColour(ctx: VsdxContext, e: LayoutEdge): { colour: string; teams: string[] } {
  const { teams, process } = ctx;
  if (teams.length === 0) return { colour: NEUTRAL_EDGE, teams: [] };
  const stepById = new Map(process.steps.map((s) => [s.id, s]));
  const src = stepById.get(e.sourceStepId);
  if (!src) return { colour: NEUTRAL_EDGE, teams: [] };
  let used: Team[];
  if (e.sourceStepId === e.targetStepId) used = teams.filter((t) => stepInTeam(src, t.id));
  else {
    const tgt = stepById.get(e.targetStepId);
    const link = src.next.find((l) => l.targetId === e.targetStepId);
    if (!tgt || !link) return { colour: NEUTRAL_EDGE, teams: [] };
    used = linkTeams(src, link, tgt, teams);
  }
  if (used.length === 0 || used.length === teams.length) return { colour: NEUTRAL_EDGE, teams: [] };
  return {
    colour: resolveColour(used[0].colourIndex, "light").fill,
    teams: used.map((t) => t.name),
  };
}

function connectorShapes(c: Ctx, ctx: VsdxContext, shapeIdByNode: Map<string, number>): void {
  const { graph, layout } = ctx;
  const edgeById = new Map(graph.edges.map((e) => [e.id, e]));
  for (const route of layout.edges) {
    const e = edgeById.get(route.id);
    const from = shapeIdByNode.get(e?.from ?? "");
    const to = shapeIdByNode.get(e?.to ?? "");
    if (!e || from === undefined || to === undefined || route.points.length < 2) continue;
    const pts = route.points.map((p) => toPage(c, p));
    const begin = pts[0];
    const end = pts[pts.length - 1];
    const dx = end.x - begin.x;
    const dy = end.y - begin.y;
    const width = Math.hypot(dx, dy) || 0.01;
    const angle = Math.atan2(dy, dx);
    const height = 0.25;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Route points in the connector's own frame: x along begin->end, y across.
    const local = pts.map((p) => {
      const ox = p.x - begin.x;
      const oy = p.y - begin.y;
      return { x: ox * cos + oy * sin, y: -ox * sin + oy * cos + height / 2 };
    });
    const rows = local
      .map(
        (p, i) =>
          `<Row T="${i === 0 ? "MoveTo" : "LineTo"}" IX="${i + 1}">${cell("X", p.x)}${cell("Y", p.y)}</Row>`,
      )
      .join("");
    const { colour, teams } = edgeColour(ctx, e);
    const id = c.nextId++;
    const label = e.label ?? "";
    // The label's text block is pinned where the map draws the pill, in the
    // connector's own frame, and turned back upright. Without this Visio puts
    // the text at the middle of the straight line from begin to end, which on
    // a bent arrow is off the line altogether.
    let textBlock = "";
    if (label && route.labelAt) {
      const at = toPage(c, route.labelAt);
      const ox = at.x - begin.x;
      const oy = at.y - begin.y;
      const tw = (label.length * 8 * 0.58 + 14) / PX;
      const th = 16 / PX;
      textBlock =
        cell("TxtPinX", ox * cos + oy * sin) +
        cell("TxtPinY", -ox * sin + oy * cos + height / 2) +
        cell("TxtWidth", tw) +
        cell("TxtHeight", th) +
        cell("TxtLocPinX", tw / 2, "TxtWidth*0.5") +
        cell("TxtLocPinY", th / 2, "TxtHeight*0.5") +
        cell("TxtAngle", -angle, "-Angle");
    }
    c.shapes.push(
      `<Shape ID="${id}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">` +
        cell("PinX", (begin.x + end.x) / 2, "(BeginX+EndX)/2") +
        cell("PinY", (begin.y + end.y) / 2, "(BeginY+EndY)/2") +
        cell("Width", width, "SQRT((EndX-BeginX)^2+(EndY-BeginY)^2)") +
        cell("Height", height) +
        cell("LocPinX", width / 2, "Width*0.5") +
        cell("LocPinY", height / 2, "Height*0.5") +
        cell("Angle", angle, "ATAN2(EndY-BeginY,EndX-BeginX)") +
        cell("FlipX", 0) +
        cell("FlipY", 0) +
        cell("ResizeMode", 0) +
        cell("BeginX", begin.x, "_WALKGLUE(BegTrigger,EndTrigger,WalkPreference)") +
        cell("BeginY", begin.y, "_WALKGLUE(BegTrigger,EndTrigger,WalkPreference)") +
        cell("EndX", end.x, "_WALKGLUE(EndTrigger,BegTrigger,WalkPreference)") +
        cell("EndY", end.y, "_WALKGLUE(EndTrigger,BegTrigger,WalkPreference)") +
        cell("BegTrigger", 2, `_XFTRIGGER(Sheet.${from}!EventXFMod)`) +
        cell("EndTrigger", 2, `_XFTRIGGER(Sheet.${to}!EventXFMod)`) +
        cell("ObjType", 2) +
        cell("ShapeRouteStyle", 1) +
        cell("ConLineRouteExt", 1) +
        cell("LineColor", colour) +
        cell("LineWeight", (e.dashed ? 1.5 : 1.5) / 96) +
        cell("LinePattern", e.dashed ? 2 : 1) +
        cell("BeginArrow", 0) +
        cell("EndArrow", 4) +
        cell("EndArrowSize", 1) +
        cell("TextBkgnd", label ? "#ffffff" : "0") +
        textBlock +
        character(8, TEXT) +
        paragraph(1) +
        `<Section N="Geometry" IX="0">` +
        cell("NoFill", 1) +
        cell("NoLine", 0) +
        cell("NoShow", 0) +
        cell("NoSnap", 0) +
        cell("NoQuickDrag", 0) +
        rows +
        `</Section>` +
        properties([
          ["Teams", "Teams", teams.join(", ")],
          ["Default", "Default outcome", e.isDefault ? "Yes" : ""],
        ]) +
        (label ? `<Text>${esc(label)}</Text>` : "") +
        `</Shape>`,
    );
    c.connects.push(
      `<Connect FromSheet="${id}" FromCell="BeginX" FromPart="9" ToSheet="${from}" ToCell="PinX" ToPart="3"/>` +
        `<Connect FromSheet="${id}" FromCell="EndX" FromPart="12" ToSheet="${to}" ToCell="PinX" ToPart="3"/>`,
    );
  }
}

function textShape(
  c: Ctx,
  x: number,
  yTop: number,
  w: number,
  h: number,
  text: string,
  size: number,
  colour: string,
  bold = false,
): void {
  addShape(
    c,
    xform(x + w / 2, yTop - h / 2, w, h) +
      cell("LineColor", BORDER) +
      cell("LineWeight", 0) +
      cell("LinePattern", 0) +
      cell("FillPattern", 0) +
      cell("VerticalAlign", 0) +
      cell("LeftMargin", 0) +
      character(size, colour, bold) +
      paragraph(0) +
      relGeometry(RECT) +
      `<Text>${esc(text)}</Text>`,
  );
}

function legendRows(ctx: VsdxContext): {
  parties: Array<{ name: string; colour: string; text: string; initials: string }>;
  teams: Array<{ name: string; colour: string }>;
} {
  const { layout, process, parties, teams } = ctx;
  const referenced: string[] = [];
  for (const l of layout.lanes) if (l.id !== UNASSIGNED_LANE) referenced.push(l.id);
  for (const st of process.steps) {
    for (const cId of st.contributorIds) {
      if (!referenced.includes(cId) && parties.some((p) => p.id === cId)) referenced.push(cId);
    }
  }
  const partyRows = referenced.map((id) => {
    const p = parties.find((x) => x.id === id);
    const col = p
      ? resolveColour(p.colourIndex, "light", p.colourOverride)
      : UNASSIGNED_COLOUR.light;
    const name = p?.name ?? "Unknown";
    return { name, colour: col.fill, text: col.text, initials: partyInitials(name) };
  });
  if (layout.lanes.some((l) => l.id === UNASSIGNED_LANE)) {
    const col = UNASSIGNED_COLOUR.light;
    partyRows.push({ name: "Unassigned", colour: col.fill, text: col.text, initials: "" });
  }
  const scoped = process.steps.some(
    (s) => s.teamIds.length > 0 || s.next.some((l) => l.teamIds && l.teamIds.length > 0),
  );
  const teamRows = scoped
    ? teams.map((t) => ({ name: t.name, colour: resolveColour(t.colourIndex, "light").fill }))
    : [];
  return { parties: partyRows, teams: teamRows };
}

/** The page XML plus its size in inches. */
export function buildVsdxPage(ctx: VsdxContext): { xml: string; width: number; height: number } {
  const { process, layout } = ctx;
  const legend = legendRows(ctx);
  const legendH =
    (legend.parties.length ? LEGEND_GAP + LEGEND_ROW * legend.parties.length : 0) +
    (legend.teams.length ? LEGEND_GAP + LEGEND_ROW * legend.teams.length : 0);
  const contentW = Math.max(layout.width / PX, 4);
  const contentH = layout.height / PX;
  const pageW = contentW + MARGIN * 2;
  const pageH = MARGIN + TITLE_H + contentH + legendH + MARGIN;
  const c: Ctx = {
    nextId: 1,
    shapes: [],
    connects: [],
    pageW,
    pageH,
    contentTop: MARGIN + TITLE_H,
  };

  // Title block.
  const meta = [
    process.owner && `Owner: ${process.owner}`,
    process.version && `Version: ${process.version}`,
    process.date && `Date: ${process.date}`,
    ctx.teamLine,
  ]
    .filter(Boolean)
    .join("   ·   ");
  textShape(c, MARGIN, pageH - MARGIN, contentW, 0.4, process.name, 16, TEXT, true);
  if (meta) textShape(c, MARGIN, pageH - MARGIN - 0.42, contentW, 0.3, meta, 9, MUTED);

  laneShapes(c, ctx);
  // Connectors reference node shape ids, so nodes are built first; Visio draws
  // in document order, so the node XML is moved after the connectors to sit on top.
  const shapeIdByNode = new Map<string, number>();
  const beforeNodes = c.shapes.length;
  nodeShapes(c, ctx, shapeIdByNode);
  const nodeXml = c.shapes.splice(beforeNodes);
  connectorShapes(c, ctx, shapeIdByNode);
  c.shapes.push(...nodeXml);

  // Legend under the map.
  let y = pageH - (MARGIN + TITLE_H + contentH) - LEGEND_GAP + 0.05;
  if (legend.parties.length) {
    textShape(c, MARGIN, y + 0.22, 3, 0.2, "PARTIES", 7, MUTED, true);
    for (const row of legend.parties) {
      y -= LEGEND_ROW;
      addShape(
        c,
        xform(MARGIN + 0.1, y + LEGEND_ROW / 2, 0.18, 0.18) +
          cell("LineColor", row.colour) +
          cell("LineWeight", 0) +
          cell("LinePattern", 0) +
          cell("FillForegnd", row.colour) +
          character(5, row.text, true) +
          paragraph(1) +
          ellipseGeometry(0.18, 0.18) +
          (row.initials ? `<Text>${esc(row.initials)}</Text>` : ""),
      );
      textShape(c, MARGIN + 0.26, y + LEGEND_ROW - 0.03, contentW - 0.3, 0.2, row.name, 9, TEXT);
    }
    y -= LEGEND_GAP;
  }
  if (legend.teams.length) {
    textShape(c, MARGIN, y + 0.22, 3, 0.2, "TEAMS (arrow colours)", 7, MUTED, true);
    for (const row of legend.teams) {
      y -= LEGEND_ROW;
      addShape(
        c,
        xform(MARGIN + 0.1, y + LEGEND_ROW / 2, 0.2, 0.03) +
          cell("LineColor", row.colour) +
          cell("LineWeight", 2.5 / 96) +
          relGeometry(
            [
              [0, 0.5],
              [1, 0.5],
            ],
            false,
          ),
      );
      textShape(c, MARGIN + 0.26, y + LEGEND_ROW - 0.03, contentW - 0.3, 0.2, row.name, 9, TEXT);
    }
  }

  const xml =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<PageContents xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve">` +
    `<Shapes>${c.shapes.join("")}</Shapes>` +
    (c.connects.length ? `<Connects>${c.connects.join("")}</Connects>` : "") +
    `</PageContents>`;
  return { xml, width: pageW, height: pageH };
}

function documentXml(): string {
  const noStyle =
    `<StyleSheet ID="0" NameU="No Style" IsCustomNameU="1" Name="No Style" IsCustomName="1">` +
    cell("EnableLineProps", 1) +
    cell("EnableFillProps", 1) +
    cell("EnableTextProps", 1) +
    cell("HideForApply", 0) +
    cell("LineWeight", 0.01041666666666667) +
    cell("LineColor", "#000000") +
    cell("LinePattern", 1) +
    cell("Rounding", 0) +
    cell("EndArrowSize", 2) +
    cell("BeginArrow", 0) +
    cell("EndArrow", 0) +
    cell("LineCap", 0) +
    cell("BeginArrowSize", 2) +
    cell("LineColorTrans", 0) +
    cell("FillForegnd", "#ffffff") +
    cell("FillBkgnd", "#000000") +
    cell("FillPattern", 1) +
    cell("ShdwForegnd", "#000000") +
    cell("ShdwPattern", 0) +
    cell("FillForegndTrans", 0) +
    cell("FillBkgndTrans", 0) +
    cell("ShdwForegndTrans", 0) +
    cell("ShapeShdwType", 0) +
    cell("ShapeShdwOffsetX", 0) +
    cell("ShapeShdwOffsetY", 0) +
    cell("ShapeShdwObliqueAngle", 0) +
    cell("ShapeShdwScaleFactor", 1) +
    cell("ShapeShdwBlur", 0) +
    cell("ShapeShdwShow", 0) +
    cell("LeftMargin", 0.05555555555555555) +
    cell("RightMargin", 0.05555555555555555) +
    cell("TopMargin", 0.05555555555555555) +
    cell("BottomMargin", 0.05555555555555555) +
    cell("VerticalAlign", 1) +
    cell("TextBkgnd", 0) +
    cell("DefaultTabStop", 0.5) +
    cell("TextDirection", 0) +
    cell("TextBkgndTrans", 0) +
    `<Section N="Character"><Row IX="0">` +
    cell("Font", FONT) +
    cell("Color", "#000000") +
    cell("Style", 0) +
    cell("Case", 0) +
    cell("Pos", 0) +
    cell("FontScale", 1) +
    cell("Size", 0.1666666666666667) +
    cell("DblUnderline", 0) +
    cell("Overline", 0) +
    cell("Strikethru", 0) +
    cell("DoubleStrikethrough", 0) +
    cell("Letterspace", 0) +
    cell("ColorTrans", 0) +
    cell("AsianFont", 0) +
    cell("ComplexScriptFont", 0) +
    cell("LocalizeFont", 0) +
    cell("ComplexScriptSize", -1) +
    cell("LangID", "en-GB") +
    `</Row></Section>` +
    `<Section N="Paragraph"><Row IX="0">` +
    cell("IndFirst", 0) +
    cell("IndLeft", 0) +
    cell("IndRight", 0) +
    cell("SpLine", -1.2) +
    cell("SpBefore", 0) +
    cell("SpAfter", 0) +
    cell("HorzAlign", 1) +
    cell("Bullet", 0) +
    cell("BulletStr", "") +
    cell("BulletFont", 0) +
    cell("LocalizeBulletFont", 0) +
    cell("BulletFontSize", -1) +
    cell("TextPosAfterBullet", 0) +
    cell("Flags", 0) +
    `</Row></Section>` +
    `<Section N="Tabs"><Row IX="0"/></Section>` +
    `</StyleSheet>`;
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<VisioDocument xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve">` +
    `<DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="0">` +
    `<GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings><SnapExtensions>34</SnapExtensions>` +
    `</DocumentSettings>` +
    `<StyleSheets>${noStyle}</StyleSheets>` +
    `</VisioDocument>`
  );
}

function pagesXml(name: string, width: number, height: number): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<Pages xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve">` +
    `<Page ID="0" NameU="${esc(name)}" Name="${esc(name)}" ViewScale="1" ViewCenterX="${num(width / 2)}" ViewCenterY="${num(height / 2)}">` +
    `<PageSheet LineStyle="0" FillStyle="0" TextStyle="0">` +
    cell("PageWidth", width) +
    cell("PageHeight", height) +
    cell("ShdwOffsetX", 0.125) +
    cell("ShdwOffsetY", -0.125) +
    cell("PageScale", 1, undefined, "IN") +
    cell("DrawingScale", 1, undefined, "IN") +
    cell("DrawingSizeType", 3) +
    cell("DrawingScaleType", 0) +
    cell("InhibitSnap", 0) +
    cell("PageLockReplace", 0) +
    cell("PageLockDuplicate", 0) +
    cell("UIVisibility", 0) +
    cell("ShdwType", 0) +
    cell("ShdwObliqueAngle", 0) +
    cell("ShdwScaleFactor", 1) +
    cell("DrawingResizeType", 2) +
    cell("PageShapeSplit", 1) +
    cell("PrintPageOrientation", width > height ? 2 : 1) +
    `</PageSheet>` +
    `<Rel r:id="rId1"/>` +
    `</Page></Pages>`
  );
}

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>` +
  `<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>` +
  `<Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>` +
  `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
  `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
  `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
  `</Relationships>`;

const DOCUMENT_RELS =
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>` +
  `</Relationships>`;

const PAGES_RELS =
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/>` +
  `</Relationships>`;

function coreXml(title: string, now: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${esc(title)}</dc:title><dc:creator>Process Mapper</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
    `</cp:coreProperties>`
  );
}

const APP_XML =
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
  `<Application>Microsoft Visio</Application><AppVersion>16.0000</AppVersion>` +
  `</Properties>`;

/** All package parts by path, so tests can inspect them without unzipping. */
export function buildVsdxParts(
  ctx: VsdxContext,
  now = new Date().toISOString(),
): Record<string, string> {
  const page = buildVsdxPage(ctx);
  return {
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "docProps/core.xml": coreXml(ctx.process.name, now),
    "docProps/app.xml": APP_XML,
    "visio/document.xml": documentXml(),
    "visio/_rels/document.xml.rels": DOCUMENT_RELS,
    "visio/pages/pages.xml": pagesXml("Page-1", page.width, page.height),
    "visio/pages/_rels/pages.xml.rels": PAGES_RELS,
    "visio/pages/page1.xml": page.xml,
  };
}

/** Zip the parts into a .vsdx file. */
export function buildVsdx(ctx: VsdxContext): Uint8Array {
  const parts = buildVsdxParts(ctx);
  const files: Record<string, Uint8Array> = {};
  for (const [path, xml] of Object.entries(parts)) files[path] = strToU8(xml);
  return zipSync(files, { level: 6 });
}

export function vsdxToBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], { type: "application/vnd.ms-visio.drawing" });
}
