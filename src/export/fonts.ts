/**
 * Export-time fonts. The app itself uses the woff2 builds from fontsource;
 * exports embed TTFs (which jsPDF needs) fetched lazily from /fonts.
 */
export interface ExportFont {
  family: string;
  weight: number;
  file: string;
  /** jsPDF font style name */
  style: "normal" | "bold";
  /**
   * Every weight and style the map asks for that this file stands in for in a
   * PDF. jsPDF looks a font up by exact weight and style and silently falls
   * back to Times when there is no entry, so each one used must be listed.
   */
  pdfFaces: Array<{ weight: number; style: "normal" | "italic" }>;
}

export const EXPORT_FONTS: ExportFont[] = [
  {
    family: "Inter",
    weight: 400,
    file: "/fonts/Inter-Regular.ttf",
    style: "normal",
    // Medium (step names) and italic (the "default" tag) have no file of
    // their own; regular is the nearest.
    pdfFaces: [100, 200, 300, 400, 500].flatMap((weight) => [
      { weight, style: "normal" as const },
      { weight, style: "italic" as const },
    ]),
  },
  {
    family: "Inter",
    weight: 600,
    file: "/fonts/Inter-SemiBold.ttf",
    style: "bold",
    pdfFaces: [600, 700, 800, 900].flatMap((weight) => [
      { weight, style: "normal" as const },
      { weight, style: "italic" as const },
    ]),
  },
  {
    family: "JetBrains Mono",
    weight: 400,
    file: "/fonts/JetBrainsMono-Regular.ttf",
    style: "normal",
    pdfFaces: [100, 200, 300, 400, 500, 600, 700, 800, 900].flatMap((weight) => [
      { weight, style: "normal" as const },
      { weight, style: "italic" as const },
    ]),
  },
];

const cache = new Map<string, Promise<string | null>>();

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Base64 of a font file, or null if it cannot be fetched. */
export function loadFontBase64(file: string): Promise<string | null> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const url = `${base}${file}`;
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer().then(toBase64) : null))
        .catch(() => null),
    );
  }
  return cache.get(url)!;
}

export async function loadAllFonts(): Promise<Array<ExportFont & { base64: string }>> {
  const out: Array<ExportFont & { base64: string }> = [];
  for (const f of EXPORT_FONTS) {
    const base64 = await loadFontBase64(f.file);
    if (base64) out.push({ ...f, base64 });
  }
  return out;
}

export function fontFaceCss(fonts: Array<ExportFont & { base64: string }>): string {
  return fonts
    .map(
      (f) =>
        `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:normal;src:url(data:font/ttf;base64,${f.base64}) format("truetype");}`,
    )
    .join("\n");
}
