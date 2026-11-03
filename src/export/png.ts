/** Rasterise an SVG document string to a PNG blob at the given scale. */
export function svgToPng(svg: string, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const m = svg.match(/width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/);
    const w = m ? Number(m[1]) : 1200;
    const h = m ? Number(m[2]) : 800;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(w * scale);
      canvas.height = Math.ceil(h * scale);
      const g = canvas.getContext("2d");
      if (!g) return reject(new Error("Canvas is not available."));
      g.scale(scale, scale);
      g.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG encoding failed."))),
        "image/png",
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The map could not be rasterised."));
    };
    img.src = url;
  });
}
