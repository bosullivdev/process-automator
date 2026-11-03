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
  for (const f of fonts) {
    const file = f.file.split("/").pop()!;
    pdf.addFileToVFS(file, f.base64);
    pdf.addFont(file, f.family, f.style);
  }
  if (fonts.length) pdf.setFont("Inter", "normal");
  await pdf.svg(el, { x: 0, y: 0, width: w, height: h });
  return pdf.output("blob");
}
