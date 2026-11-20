import { jsPDF } from "jspdf";
import "svg2pdf.js";
import { loadAllFonts } from "./fonts";

interface PdfPage {
  el: SVGSVGElement;
  w: number;
  h: number;
}

function parsePage(svg: string): PdfPage {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const el = doc.documentElement as unknown as SVGSVGElement;
  const w = Number(el.getAttribute("width")) || 1200;
  const h = Number(el.getAttribute("height")) || 800;
  // svg2pdf does not read @font-face; strip it and register TTFs with jsPDF instead.
  el.querySelectorAll("style").forEach((s) => s.remove());
  return { el, w, h };
}

const orientationOf = (p: PdfPage) => (p.w >= p.h ? "landscape" : "portrait");

/** Render SVG document strings to one PDF, a page per drawing, each page sized to its drawing. */
export async function svgsToPdf(svgs: readonly string[]): Promise<Blob> {
  if (svgs.length === 0) throw new Error("There is no process map to export.");
  const pages = svgs.map(parsePage);
  const pdf = new jsPDF({
    orientation: orientationOf(pages[0]),
    unit: "px",
    format: [pages[0].w, pages[0].h],
    hotfixes: ["px_scaling"],
  });
  const fonts = await loadAllFonts();
  // jsPDF embeds every face it is given, used or not, so only the faces the
  // drawings' text actually asks for are registered.
  const wanted = new Set<string>();
  for (const p of pages) for (const face of usedFaces(p.el)) wanted.add(face);
  for (const f of fonts) {
    const file = f.file.split("/").pop()!;
    const faces = f.pdfFaces.filter((face) =>
      wanted.has(faceKey(f.family, face.weight, face.style)),
    );
    if (faces.length === 0) continue;
    pdf.addFileToVFS(file, f.base64);
    for (const face of faces) pdf.addFont(file, f.family, face.style, face.weight);
  }
  for (const [i, p] of pages.entries()) {
    if (i > 0) pdf.addPage([p.w, p.h], orientationOf(p));
    if (fonts.length) pdf.setFont("Inter", "normal");
    await pdf.svg(p.el, { x: 0, y: 0, width: p.w, height: p.h });
  }
  return pdf.output("blob");
}

/** Render an SVG document string to a single-page PDF sized to the drawing. */
export function svgToPdf(svg: string): Promise<Blob> {
  return svgsToPdf([svg]);
}

const faceKey = (family: string, weight: number, style: string) => `${family}|${weight}|${style}`;

/**
 * The font faces (family, weight, style) the drawing's text uses, reading each
 * attribute from the text element or the nearest ancestor that sets it. The
 * default face is always included.
 */
export function usedFaces(root: Element): Set<string> {
  const faces = new Set([faceKey("Inter", 400, "normal")]);
  const inherited = (el: Element, name: string): string => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const v = e.getAttribute(name);
      if (v) return v;
    }
    return "";
  };
  root.querySelectorAll("text, tspan").forEach((t) => {
    const mono = inherited(t, "data-font") === "mono" || /mono/i.test(inherited(t, "font-family"));
    const w = inherited(t, "font-weight");
    const weight = w === "bold" ? 700 : w === "normal" || !w ? 400 : Number(w) || 400;
    const style = inherited(t, "font-style") === "italic" ? "italic" : "normal";
    faces.add(faceKey(mono ? "JetBrains Mono" : "Inter", weight, style));
  });
  return faces;
}
