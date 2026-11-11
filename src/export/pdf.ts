import { jsPDF } from "jspdf";
import "svg2pdf.js";
import { loadAllFonts } from "./fonts";

/** Render an SVG document string to a single-page PDF sized to the drawing. */
export async function svgToPdf(svg: string): Promise<Blob> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, "image/svg+xml");
  const el = doc.documentElement as unknown as SVGSVGElement;
  const w = Number(el.getAttribute("width")) || 1200;
  const h = Number(el.getAttribute("height")) || 800;
  // svg2pdf does not read @font-face; strip it and register TTFs with jsPDF instead.
  el.querySelectorAll("style").forEach((s) => s.remove());

  const pdf = new jsPDF({
    orientation: w >= h ? "landscape" : "portrait",
    unit: "px",
    format: [w, h],
    hotfixes: ["px_scaling"],
  });
  const fonts = await loadAllFonts();
  // jsPDF embeds every face it is given, used or not, so only the faces the
  // drawing's text actually asks for are registered.
  const wanted = usedFaces(el);
  for (const f of fonts) {
    const file = f.file.split("/").pop()!;
    const faces = f.pdfFaces.filter((face) =>
      wanted.has(faceKey(f.family, face.weight, face.style)),
    );
    if (faces.length === 0) continue;
    pdf.addFileToVFS(file, f.base64);
    for (const face of faces) pdf.addFont(file, f.family, face.style, face.weight);
  }
  if (fonts.length) pdf.setFont("Inter", "normal");
  await pdf.svg(el, { x: 0, y: 0, width: w, height: h });
  return pdf.output("blob");
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
