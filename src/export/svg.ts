import type { Party, Process } from "../model/types";
import type { LayoutResult } from "../graph/layout-types";
import { UNASSIGNED_LANE } from "../graph/layout-types";
import { resolveColour, UNASSIGNED_COLOUR } from "../design/palette";
import { fontFaceCss, loadAllFonts } from "./fonts";

export interface ExportContext {
  process: Process;
  parties: Party[];
  layout: LayoutResult;
  theme: "light" | "dark";
  /** The live map <svg> element; its content group is cloned. */
  svgEl: SVGSVGElement;
}

const PAD = 32;
const TITLE_H = 64;
const LEGEND_ROW = 22;

/** Resolve CSS custom properties used in the map into literal values. */
function cssVars(theme: "light" | "dark"): Record<string, string> {
  const probe = document.createElement("div");
  probe.className = theme === "dark" ? "dark" : "";
  probe.style.display = "none";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const names = [
    "--bg",
    "--surface",
    "--surface-2",
    "--border",
    "--border-strong",
    "--text",
    "--text-muted",
    "--edge",
    "--unassigned",
    "--color-accent",
    "--color-warn",
    "--color-danger",
  ];
  const out: Record<string, string> = {};
  for (const n of names)
    out[n] =
      cs.getPropertyValue(n).trim() || document.documentElement.style.getPropertyValue(n) || "";
  probe.remove();
  // Fallbacks when the probe cannot see :root/.dark values (e.g. tests).
  const defaults: Record<string, string> =
    theme === "dark"
      ? {
          "--bg": "#121214",
          "--surface": "#1c1c1f",
          "--surface-2": "#232327",
          "--border": "#2e2e33",
          "--border-strong": "#3f3f46",
          "--text": "#f4f4f5",
          "--text-muted": "#a1a1aa",
          "--edge": "#71717a",
          "--unassigned": "#71717a",
        }
      : {
          "--bg": "#fafafa",
          "--surface": "#ffffff",
          "--surface-2": "#f4f4f5",
          "--border": "#e4e4e7",
          "--border-strong": "#d4d4d8",
          "--text": "#18181b",
          "--text-muted": "#71717a",
          "--edge": "#9ca3af",
          "--unassigned": "#9ca3af",
        };
  const accent: Record<string, string> = {
    "--color-accent": "#5b5fc7",
    "--color-warn": "#d97706",
    "--color-danger": "#dc2626",
  };
  for (const [k, v] of Object.entries({ ...defaults, ...accent })) if (!out[k]) out[k] = v;
  return out;
}

function replaceVars(s: string, vars: Record<string, string>): string {
  return s.replace(/var\((--[\w-]+)\)/g, (_, name: string) => vars[name] ?? "#000");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build a standalone SVG document string for the active process map. */
export async function buildExportSvg(ctx: ExportContext): Promise<string> {
  const { process, parties, layout, theme, svgEl } = ctx;
  const vars = cssVars(theme);
  const fonts = await loadAllFonts();

  // Clone content: defs + the transformed group, with the transform reset.
  const defs = svgEl.querySelector("defs")?.outerHTML ?? "";
  const group = svgEl.querySelector(":scope > g");
  const clone = group?.cloneNode(true) as SVGGElement | null;
  if (clone) {
    clone.removeAttribute("transform");
    clone.querySelectorAll("[tabindex]").forEach((el) => el.removeAttribute("tabindex"));
    clone.querySelectorAll("[class]").forEach((el) => el.removeAttribute("class"));
    clone.querySelectorAll("[style]").forEach((el) => el.removeAttribute("style"));
  }
  const content = clone?.outerHTML ?? "";

  const lanes = layout.lanes.map((l) => {
    const p = parties.find((x) => x.id === l.id);
    const c =
      l.id === UNASSIGNED_LANE
        ? UNASSIGNED_COLOUR[theme]
        : p
          ? resolveColour(p.colourIndex, theme, p.colourOverride)
          : UNASSIGNED_COLOUR[theme];
    return {
      name: l.id === UNASSIGNED_LANE ? "Unassigned" : (p?.name ?? "Unknown"),
      colour: c.fill,
    };
  });

  const width = Math.max(layout.width, 420) + PAD * 2;
  const legendH = lanes.length ? LEGEND_ROW * lanes.length + 16 : 0;
  const height = PAD + TITLE_H + layout.height + 16 + legendH + PAD;
  const meta = [
    process.owner && `Owner: ${process.owner}`,
    process.version && `Version: ${process.version}`,
    process.date && `Date: ${process.date}`,
  ]
    .filter(Boolean)
    .join("   ·   ");

  const legend = lanes
    .map(
      (l, i) =>
        `<g transform="translate(${PAD}, ${PAD + TITLE_H + layout.height + 24 + i * LEGEND_ROW})">` +
        `<rect x="0" y="0" width="14" height="14" rx="3" fill="${l.colour}"/>` +
        `<text x="22" y="7" dominant-baseline="central" font-size="12" fill="${vars["--text"]}">${esc(l.name)}</text></g>`,
    )
    .join("");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, system-ui, sans-serif">` +
    `<style>${fontFaceCss(fonts)}\ntext{font-family:Inter,system-ui,sans-serif}</style>` +
    `<rect width="100%" height="100%" fill="${vars["--bg"]}"/>` +
    `<g transform="translate(${PAD}, ${PAD})">` +
    `<text x="0" y="14" font-size="20" font-weight="600" fill="${vars["--text"]}">${esc(process.name)}</text>` +
    (meta
      ? `<text x="0" y="40" font-size="12" fill="${vars["--text-muted"]}">${esc(meta)}</text>`
      : "") +
    `</g>` +
    `<g transform="translate(${PAD}, ${PAD + TITLE_H})">${defs}${content}</g>` +
    (lanes.length
      ? `<text x="${PAD}" y="${PAD + TITLE_H + layout.height + 10}" font-size="11" font-weight="600" fill="${vars["--text-muted"]}">LANES</text>`
      : "") +
    legend +
    `</svg>`;
  return replaceVars(svg, vars);
}

export function svgToBlob(svg: string): Blob {
  return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
}
