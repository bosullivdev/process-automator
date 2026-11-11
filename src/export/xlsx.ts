import { strToU8, zipSync } from "fflate";
import type { Step } from "../model/types";
import type { LayoutNode, PositionedNode } from "../graph/layout-types";
import { UNASSIGNED_LANE } from "../graph/layout-types";
import { resolveColour, UNASSIGNED_COLOUR, type ResolvedColour } from "../design/palette";
import { partyInitials } from "../model/party";
import { edgeColour, esc, type VsdxContext } from "./vsdx";

/**
 * Excel (.xlsx) export, for people who want the map in a workbook. The lanes
 * are bands of cells: each lane's title is a cell in the party's colour and
 * the lane itself a run of tinted cells sized to the map. Steps, decisions,
 * arrows and labels are ordinary Excel shapes drawn over those cells at the
 * map's own positions.
 *
 * Arrows follow the map's routes exactly. They are freeform lines, not
 * connectors glued to the steps: Excel's glued connectors choose their own
 * route, which on a busy map runs through other steps.
 *
 * An .xlsx file is an Open Packaging zip of XML parts; this writes the few a
 * one-sheet workbook with a drawing needs.
 */
export type XlsxContext = VsdxContext;

const EMU = 9525; // English Metric Units per CSS pixel
const FONT = "Calibri";
const TEXT = "18181B";
const MUTED = "71717A";
const BORDER = "D4D4D8";
const SURFACE = "FFFFFF";
/** Rows above the map: process name, details line, a little air. */
const TITLE_ROWS = [30, 20, 10];
/** Excel's limits are 409.5 pt per row and 255 characters per column; stay well inside. */
const MAX_ROW_PX = 500;
const MAX_COL_PX = 1000;
/** Size of the plain cells that fill a lane along the flow. */
const CELL_W = 64;
const CELL_H = 20;
const NAME_GAP = 4;

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;

const hex = (colour: string) => colour.replace("#", "").toUpperCase().padEnd(6, "0").slice(0, 6);
const emu = (px: number) => Math.round(px * EMU);

/** A colour laid over white at the given strength: cells have no transparency. */
function tintOnWhite(colour: string, strength: number): string {
  const h = hex(colour);
  const mix = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16);
    return Math.round(255 + (v - 255) * strength)
      .toString(16)
      .padStart(2, "0");
  };
  return (mix(0) + mix(2) + mix(4)).toUpperCase();
}

/** Column letters for a 0-based index: 0 = A, 26 = AA. */
export function columnName(index: number): string {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

/** Split a span of pixels into equal whole-pixel parts no larger than max. */
function split(from: number, to: number, max: number): number[] {
  const a = Math.round(from);
  const b = Math.round(to);
  const n = Math.max(1, Math.ceil((b - a) / max));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(Math.round(a + ((b - a) * (i + 1)) / n) - Math.round(a + ((b - a) * i) / n));
  }
  return out;
}

/** Cell styles are collected as they are asked for; the index is the cell's `s`. */
class Styles {
  private fonts = [`<font><sz val="11"/><name val="${FONT}"/><family val="2"/></font>`];
  private fills = [
    `<fill><patternFill patternType="none"/></fill>`,
    `<fill><patternFill patternType="gray125"/></fill>`,
  ];
  private borders = [`<border><left/><right/><top/><bottom/><diagonal/></border>`];
  private xfs = [`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`];
  private seen = new Map<string, number>();

  private intern(list: string[], xml: string): number {
    const i = list.indexOf(xml);
    return i >= 0 ? i : list.push(xml) - 1;
  }

  font(size: number, colour: string, bold = false): number {
    return this.intern(
      this.fonts,
      `<font>${bold ? "<b/>" : ""}<sz val="${size}"/><color rgb="FF${colour}"/><name val="${FONT}"/><family val="2"/></font>`,
    );
  }

  fill(colour: string): number {
    return this.intern(
      this.fills,
      `<fill><patternFill patternType="solid"><fgColor rgb="FF${colour}"/><bgColor indexed="64"/></patternFill></fill>`,
    );
  }

  /** A thin line on one side of the cell, marking the end of a lane. */
  border(side: "bottom" | "right" | null): number {
    if (!side) return 0;
    const line = `<${side} style="thin"><color rgb="FF${BORDER}"/></${side}>`;
    return this.intern(
      this.borders,
      `<border><left/>${side === "right" ? line : "<right/>"}<top/>${side === "bottom" ? line : "<bottom/>"}<diagonal/></border>`,
    );
  }

  xf(font: number, fill: number, border: number, alignment = ""): number {
    const key = `${font}|${fill}|${border}|${alignment}`;
    const known = this.seen.get(key);
    if (known !== undefined) return known;
    const xml =
      `<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"` +
      `${font ? ' applyFont="1"' : ""}${fill ? ' applyFill="1"' : ""}${border ? ' applyBorder="1"' : ""}` +
      (alignment ? ` applyAlignment="1">${alignment}</xf>` : "/>");
    const index = this.xfs.push(xml) - 1;
    this.seen.set(key, index);
    return index;
  }

  xml(): string {
    return (
      `${XML}<styleSheet xmlns="${NS_MAIN}">` +
      `<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join("")}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join("")}</borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`
    );
  }
}

interface Sheet {
  xml: string;
  /** Sheet pixel position of the map's (0, 0). */
  originX: number;
  originY: number;
  width: number;
  height: number;
}

function laneColourOf(ctx: XlsxContext, laneId: string): ResolvedColour {
  const party = ctx.parties.find((p) => p.id === laneId);
  return laneId === UNASSIGNED_LANE || !party
    ? UNASSIGNED_COLOUR.light
    : resolveColour(party.colourIndex, "light", party.colourOverride);
}

function laneNameOf(ctx: XlsxContext, laneId: string): string {
  if (laneId === UNASSIGNED_LANE) return "Unassigned";
  return ctx.parties.find((p) => p.id === laneId)?.name ?? "Unknown";
}

/**
 * The worksheet: title rows, then the lanes as cells. With left-to-right flow
 * each lane is a band of rows whose first cell is its title; with
 * top-to-bottom flow each lane is a band of columns under its title. The
 * titles are frozen so they stay in view while scrolling.
 */
function buildSheet(ctx: XlsxContext, styles: Styles): Sheet {
  const { layout, process } = ctx;
  const horizontal = layout.orientation === "horizontal";
  const titleH = TITLE_ROWS.reduce((a, b) => a + b, 0);

  type Band = { laneId: string | null; size: number; first: boolean; last: boolean };
  /** Bands across the lanes (rows when horizontal, columns when vertical). */
  const across: Band[] = [];
  let at = 0;
  for (const lane of layout.lanes) {
    const start = horizontal ? lane.y : lane.x;
    const end = start + (horizontal ? lane.height : lane.width);
    const parts = split(start, end, horizontal ? MAX_ROW_PX : MAX_COL_PX);
    parts.forEach((size, i) =>
      across.push({ laneId: lane.id, size, first: i === 0, last: i === parts.length - 1 }),
    );
    at = end;
  }
  // Room beyond the last lane, where arrows that go round the outside run.
  const acrossTotal = horizontal ? layout.height : layout.width;
  if (acrossTotal > at + 1) {
    for (const size of split(at, acrossTotal, horizontal ? MAX_ROW_PX : MAX_COL_PX)) {
      across.push({ laneId: null, size, first: false, last: false });
    }
  }
  /** Cells along the flow: the title band, then plain cells to the end of the map. */
  const header = layout.lanes[0]?.header;
  const headerSize = Math.round(horizontal ? (header?.width ?? 36) : (header?.height ?? 36));
  const alongTotal = Math.round(horizontal ? layout.width : layout.height);
  const cell = horizontal ? CELL_W : CELL_H;
  const along: number[] = [headerSize];
  for (let used = headerSize; used < alongTotal;) {
    const size = Math.min(cell, alongTotal - used);
    along.push(size);
    used += size;
  }

  const colPx = horizontal ? along : across.map((b) => b.size);
  const mapRowPx = horizontal ? across.map((b) => b.size) : along;
  const rowPx = [...TITLE_ROWS, ...mapRowPx];
  const firstMapRow = TITLE_ROWS.length; // 0-based

  const titleStyle = styles.xf(styles.font(16, TEXT, true), 0, 0);
  const metaStyle = styles.xf(styles.font(9, MUTED), 0, 0);
  const laneStyles = new Map<string, { title: number; body: number; bodyEnd: number }>();
  for (const lane of layout.lanes) {
    const c = laneColourOf(ctx, lane.id);
    const tint = styles.fill(tintOnWhite(c.fill, 0.12));
    laneStyles.set(lane.id, {
      title: styles.xf(
        styles.font(9, hex(c.text), true),
        styles.fill(hex(c.fill)),
        0,
        `<alignment horizontal="center" vertical="center" wrapText="1"${horizontal ? ' textRotation="90"' : ""}/>`,
      ),
      body: styles.xf(0, tint, 0),
      bodyEnd: styles.xf(0, tint, styles.border(horizontal ? "bottom" : "right")),
    });
  }

  const text = (ref: string, style: number, value: string) =>
    `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
  const blank = (ref: string, style: number) => `<c r="${ref}" s="${style}"/>`;

  const meta = [
    process.owner && `Owner: ${process.owner}`,
    process.version && `Version: ${process.version}`,
    process.date && `Date: ${process.date}`,
    ctx.teamLine,
  ]
    .filter(Boolean)
    .join("   ·   ");

  const rows: string[] = [];
  const merges: string[] = [];
  const rowXml = (r: number, cells: string) =>
    `<row r="${r + 1}" ht="${rowPx[r] * 0.75}" customHeight="1">${cells}</row>`;
  rows.push(rowXml(0, text("A1", titleStyle, process.name)));
  rows.push(rowXml(1, meta ? text("A2", metaStyle, meta) : ""));
  rows.push(rowXml(2, ""));

  for (let r = 0; r < mapRowPx.length; r++) {
    const sheetRow = firstMapRow + r;
    let cells = "";
    for (let col = 0; col < colPx.length; col++) {
      const band = horizontal ? across[r] : across[col];
      const st = band.laneId ? laneStyles.get(band.laneId)! : null;
      if (!st || !band.laneId) continue;
      const ref = `${columnName(col)}${sheetRow + 1}`;
      const isTitle = horizontal ? col === 0 : r === 0;
      if (isTitle) {
        cells += band.first
          ? text(ref, st.title, laneNameOf(ctx, band.laneId))
          : blank(ref, st.title);
      } else {
        cells += blank(ref, band.last ? st.bodyEnd : st.body);
      }
    }
    rows.push(rowXml(sheetRow, cells));
  }
  // A lane split over several rows or columns has one merged title cell.
  for (let i = 0; i < across.length; i++) {
    if (!across[i].laneId || !across[i].first || across[i].last) continue;
    let j = i;
    while (!across[j].last) j++;
    merges.push(
      horizontal
        ? `A${firstMapRow + i + 1}:A${firstMapRow + j + 1}`
        : `${columnName(i)}${firstMapRow + 1}:${columnName(j)}${firstMapRow + 1}`,
    );
  }

  // Team key under the map: arrows only some teams use are drawn in that team's colour.
  let nextRow = rowPx.length;
  if (ctx.teams.length) {
    const keyStyle = styles.xf(styles.font(9, MUTED, true), 0, 0);
    const nameStyle = styles.xf(styles.font(9, TEXT), 0, 0);
    nextRow += 1;
    rows.push(
      `<row r="${nextRow + 1}">${text(`A${nextRow + 1}`, keyStyle, "TEAMS (arrow colours)")}</row>`,
    );
    for (const team of ctx.teams) {
      nextRow += 1;
      // A colour chip and the name in one cell, so the key reads the same
      // whatever the width of the first column.
      const chip = hex(resolveColour(team.colourIndex, "light").fill);
      rows.push(
        `<row r="${nextRow + 1}"><c r="A${nextRow + 1}" s="${nameStyle}" t="inlineStr"><is>` +
          `<r><rPr><sz val="11"/><color rgb="FF${chip}"/><rFont val="${FONT}"/></rPr><t xml:space="preserve">\u25A0 </t></r>` +
          `<r><rPr><sz val="9"/><color rgb="FF${TEXT}"/><rFont val="${FONT}"/></rPr><t xml:space="preserve">${esc(team.name)}</t></r>` +
          `</is></c></row>`,
      );
    }
  }

  // Stored column width is in characters of the default font: 7 px each.
  const cols = colPx
    .map(
      (px, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${Math.floor((px / 7) * 256) / 256}" customWidth="1"/>`,
    )
    .join("");
  const frozenCols = horizontal ? 1 : 0;
  const frozenRows = horizontal ? firstMapRow : firstMapRow + 1;
  const topLeft = `${columnName(frozenCols)}${frozenRows + 1}`;
  const pane =
    `<pane${frozenCols ? ` xSplit="${frozenCols}"` : ""} ySplit="${frozenRows}" topLeftCell="${topLeft}" ` +
    `activePane="${frozenCols ? "bottomRight" : "bottomLeft"}" state="frozen"/>`;

  const xml =
    `${XML}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}">` +
    `<dimension ref="A1:${columnName(colPx.length - 1)}${nextRow + 1}"/>` +
    `<sheetViews><sheetView showGridLines="0" tabSelected="1" workbookViewId="0">${pane}</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${rows.join("")}</sheetData>` +
    (merges.length
      ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
      : "") +
    `<pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
    `<pageSetup orientation="landscape" fitToHeight="0"/>` +
    `<drawing r:id="rId1"/>` +
    `</worksheet>`;
  return {
    xml,
    originX: 0,
    originY: titleH,
    width: colPx.reduce((a, b) => a + b, 0),
    height: rowPx.reduce((a, b) => a + b, 0),
  };
}

interface TextOptions {
  size: number; // points
  colour?: string;
  bold?: boolean;
  italic?: boolean;
  /** Inset on every side, px. */
  inset?: number;
  anchor?: "ctr" | "t" | "b";
}

function textBody(lines: string[], o: TextOptions): string {
  const inset = emu(o.inset ?? 0);
  const run = (line: string) =>
    `<a:p><a:pPr algn="ctr"/>` +
    (line
      ? `<a:r><a:rPr lang="en-GB" sz="${Math.round(o.size * 100)}" b="${o.bold ? 1 : 0}" i="${o.italic ? 1 : 0}">` +
        `<a:solidFill><a:srgbClr val="${o.colour ?? TEXT}"/></a:solidFill><a:latin typeface="${FONT}"/><a:cs typeface="${FONT}"/></a:rPr>` +
        `<a:t>${esc(line)}</a:t></a:r>`
      : "") +
    `</a:p>`;
  return (
    `<xdr:txBody><a:bodyPr vertOverflow="overflow" horzOverflow="overflow" wrap="square" ` +
    `lIns="${inset}" tIns="${inset}" rIns="${inset}" bIns="${inset}" anchor="${o.anchor ?? "ctr"}" rtlCol="0"/>` +
    `<a:lstStyle/>${(lines.length ? lines : [""]).map(run).join("")}</xdr:txBody>`
  );
}

const solid = (colour: string) => `<a:solidFill><a:srgbClr val="${colour}"/></a:solidFill>`;

/** Shapes are collected in drawing order: later ones sit on top. */
class Drawing {
  private anchors: string[] = [];
  private nextId = 2;

  constructor(
    private originX: number,
    private originY: number,
  ) {}

  /** One shape at a map position (px), as an absolutely placed drawing object. */
  add(
    name: string,
    x: number,
    y: number,
    w: number,
    h: number,
    geometry: string,
    fill: string,
    line: string,
    text = "",
    flip = "",
  ): void {
    const id = this.nextId++;
    const ox = emu(this.originX + x);
    const oy = emu(this.originY + y);
    const cx = Math.max(0, emu(w));
    const cy = Math.max(0, emu(h));
    this.anchors.push(
      `<xdr:absoluteAnchor><xdr:pos x="${ox}" y="${oy}"/><xdr:ext cx="${cx}" cy="${cy}"/>` +
        `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${esc(name)}"/><xdr:cNvSpPr/></xdr:nvSpPr>` +
        `<xdr:spPr><a:xfrm${flip}><a:off x="${ox}" y="${oy}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
        `${geometry}${fill}${line}</xdr:spPr>${text}</xdr:sp><xdr:clientData/></xdr:absoluteAnchor>`,
    );
  }

  get count(): number {
    return this.anchors.length;
  }

  xml(): string {
    return `${XML}<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}">${this.anchors.join("")}</xdr:wsDr>`;
  }
}

const preset = (name: string, adjust = "") =>
  `<a:prstGeom prst="${name}"><a:avLst>${adjust}</a:avLst></a:prstGeom>`;
const outline = (px: number, colour: string, extra = "") =>
  `<a:ln w="${emu(px)}">${solid(colour)}${extra}</a:ln>`;
const NO_LINE = `<a:ln><a:noFill/></a:ln>`;
const NO_FILL = `<a:noFill/>`;

/** Arrows, exactly along the map's routes. */
function addEdges(d: Drawing, ctx: XlsxContext): void {
  const edgeById = new Map(ctx.graph.edges.map((e) => [e.id, e]));
  for (const route of ctx.layout.edges) {
    const e = edgeById.get(route.id);
    const pts = route.points;
    if (!e || pts.length < 2) continue;
    const { colour } = edgeColour(ctx, e);
    const x0 = Math.min(...pts.map((p) => p.x));
    const y0 = Math.min(...pts.map((p) => p.y));
    const w = Math.max(...pts.map((p) => p.x)) - x0;
    const h = Math.max(...pts.map((p) => p.y)) - y0;
    const line = outline(
      1.5,
      hex(colour),
      `${e.dashed ? '<a:prstDash val="dash"/>' : ""}<a:round/><a:tailEnd type="triangle" w="med" len="med"/>`,
    );
    const name = `Arrow ${e.label ? `"${e.label}" ` : ""}${e.id}`.slice(0, 120);
    if (pts.length === 2) {
      // A straight run is a plain line; the flips point it the right way.
      const flip =
        (pts[1].x < pts[0].x ? ' flipH="1"' : "") + (pts[1].y < pts[0].y ? ' flipV="1"' : "");
      d.add(name, x0, y0, w, h, preset("line"), "", line, "", flip);
      continue;
    }
    const path = pts
      .map((p, i) => {
        const pt = `<a:pt x="${emu(p.x - x0)}" y="${emu(p.y - y0)}"/>`;
        return i === 0 ? `<a:moveTo>${pt}</a:moveTo>` : `<a:lnTo>${pt}</a:lnTo>`;
      })
      .join("");
    const geometry =
      `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/>` +
      `<a:pathLst><a:path w="${emu(w)}" h="${emu(h)}" fill="none">${path}</a:path></a:pathLst></a:custGeom>`;
    d.add(name, x0, y0, w, h, geometry, NO_FILL, line);
  }
}

/** Rectangle of the name-and-annotations block drawn outside a shape, on the side the layout chose. */
function blockRect(pos: PositionedNode, ln: LayoutNode) {
  const cx = pos.x + ln.cx;
  const cy = pos.y + ln.cy;
  const w = Math.max(ln.text.labelWidth, 40);
  const h = ln.text.labelHeight;
  switch (pos.labelSide) {
    case "above":
      return { x: cx - w / 2, y: cy - ln.shapeHeight / 2 - NAME_GAP - h, w, h };
    case "right":
      return { x: cx + ln.shapeWidth / 2 + NAME_GAP, y: cy - h / 2, w, h };
    case "left":
      return { x: cx - ln.shapeWidth / 2 - NAME_GAP - w, y: cy - h / 2, w, h };
    default:
      return { x: cx - w / 2, y: cy + ln.shapeHeight / 2 + NAME_GAP, w, h };
  }
}

/** Steps and decisions, each an editable shape, plus the text the map draws beside them. */
function addNodes(d: Drawing, ctx: XlsxContext): void {
  const stepById = new Map(ctx.process.steps.map((s) => [s.id, s]));
  const byId = new Map(ctx.graph.nodes.map((n) => [n.id, n]));
  for (const pos of ctx.layout.nodes) {
    const ln = byId.get(pos.id);
    if (!ln) continue;
    const gateway = ln.kind === "fork" || ln.kind === "join";
    const step: Step | undefined = gateway ? undefined : stepById.get(ln.stepId);
    const colour = hex(laneColourOf(ctx, ln.laneId).fill);
    const x = pos.x + ln.cx - ln.shapeWidth / 2;
    const y = pos.y + ln.cy - ln.shapeHeight / 2;
    const name = step ? step.name.trim() || "Untitled" : "";
    const label = step ? `Step ${step.displayNo}: ${name}`.slice(0, 120) : "Parallel gateway";
    if (ln.kind === "task") {
      d.add(
        label,
        x,
        y,
        ln.shapeWidth,
        ln.shapeHeight,
        // Corner radius of 8 px, as a share of the shorter side.
        preset(
          "roundRect",
          `<a:gd name="adj" fmla="val ${Math.round((8 / Math.min(ln.shapeWidth, ln.shapeHeight)) * 100000)}"/>`,
        ),
        solid(SURFACE),
        outline(2, colour),
        textBody([name], { size: 9, inset: 6 }),
      );
    } else {
      const shape = ln.kind === "start" || ln.kind === "end" ? "ellipse" : "diamond";
      d.add(
        label,
        x,
        y,
        ln.shapeWidth,
        ln.shapeHeight,
        preset(shape),
        solid(SURFACE),
        outline(ln.kind === "end" ? 4 : 2, colour),
        gateway ? textBody(["+"], { size: 14, bold: true }) : "",
      );
    }
    if (!step || ln.text.labelHeight <= 0) continue;
    // Beside the shape: the name (when it is not inside), then the annotations.
    const lines: string[] = [];
    if (ln.text.outside) lines.push(name);
    if (ln.text.tech) lines.push(ln.text.tech);
    if (ln.text.badges > 0) {
      const initials = step.contributorIds
        .slice(0, ln.text.badges)
        .map((id) => ctx.parties.find((p) => p.id === id))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => partyInitials(p.name));
      if (initials.length) lines.push(`With: ${initials.join(", ")}`);
    }
    if (ln.text.teams) lines.push(ln.text.teams);
    if (ln.text.control) lines.push(ln.text.control);
    if (lines.length === 0) continue;
    const r = blockRect(pos, ln);
    d.add(
      `Notes for step ${step.displayNo}`,
      r.x,
      r.y,
      r.w,
      r.h,
      preset("rect"),
      NO_FILL,
      NO_LINE,
      textBody(lines, { size: 8, colour: TEXT, anchor: pos.labelSide === "above" ? "b" : "t" }),
    );
  }
}

/** Outcome labels: a small pill where the map draws it. */
function addLabels(d: Drawing, ctx: XlsxContext): void {
  const edgeById = new Map(ctx.graph.edges.map((e) => [e.id, e]));
  const drawn = new Set<string>();
  for (const route of ctx.layout.edges) {
    const e = edgeById.get(route.id);
    if (!e?.label || !route.labelAt) continue;
    const text = e.isDefault ? `${e.label} (default)` : e.label;
    // One outcome that goes to several places shares a single label on the map.
    const key = `${text}@${route.labelAt.x},${route.labelAt.y}`;
    if (drawn.has(key)) continue;
    drawn.add(key);
    const w = text.length * 5.8 + 14;
    d.add(
      `Label ${text}`.slice(0, 120),
      route.labelAt.x - w / 2,
      route.labelAt.y - 9,
      w,
      18,
      preset("roundRect", `<a:gd name="adj" fmla="val 50000"/>`),
      solid(SURFACE),
      outline(1, "A1A1AA"),
      textBody([text], { size: 7.5 }),
    );
  }
}

const CONTENT_TYPES =
  `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
  `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` +
  `</Types>`;

const rels = (items: Array<[id: string, type: string, target: string]>) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  items
    .map(
      ([id, type, target]) =>
        `<Relationship Id="${id}" Type="${NS_R}/${type}" Target="${target}"/>`,
    )
    .join("") +
  `</Relationships>`;

/** Sheet names may not contain []:*?/\ and are at most 31 characters. */
export function sheetName(name: string): string {
  const clean = name
    .replace(/[[\]:*?/\\]/g, " ")
    .replace(/^'+|'+$/g, "")
    .trim()
    .slice(0, 31)
    .trim();
  return clean || "Process map";
}

/** Every part of the workbook as XML text, keyed by its path in the zip. */
export function buildXlsxParts(ctx: XlsxContext): Record<string, string> {
  const styles = new Styles();
  const sheet = buildSheet(ctx, styles);
  const drawing = new Drawing(sheet.originX, sheet.originY);
  // Drawn in this order so steps sit on top of arrows and labels on top of both.
  addEdges(drawing, ctx);
  addNodes(drawing, ctx);
  addLabels(drawing, ctx);
  return {
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": rels([["rId1", "officeDocument", "xl/workbook.xml"]]),
    "xl/workbook.xml":
      `${XML}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}">` +
      `<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="15000"/></bookViews>` +
      `<sheets><sheet name="${esc(sheetName(ctx.process.name))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": rels([
      ["rId1", "worksheet", "worksheets/sheet1.xml"],
      ["rId2", "styles", "styles.xml"],
    ]),
    "xl/styles.xml": styles.xml(),
    "xl/worksheets/sheet1.xml": sheet.xml,
    "xl/worksheets/_rels/sheet1.xml.rels": rels([["rId1", "drawing", "../drawings/drawing1.xml"]]),
    "xl/drawings/drawing1.xml": drawing.xml(),
  };
}

/** Zip the parts into an .xlsx file. */
export function buildXlsx(ctx: XlsxContext): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const [path, xml] of Object.entries(buildXlsxParts(ctx))) files[path] = strToU8(xml);
  return zipSync(files, { level: 6 });
}

export function xlsxToBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
