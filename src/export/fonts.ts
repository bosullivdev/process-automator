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
}

export const EXPORT_FONTS: ExportFont[] = [
  { family: "Inter", weight: 400, file: "/fonts/Inter-Regular.ttf", style: "normal" },
  { family: "Inter", weight: 600, file: "/fonts/Inter-SemiBold.ttf", style: "bold" },
  {
    family: "JetBrains Mono",
    weight: 400,
    file: "/fonts/JetBrainsMono-Regular.ttf",
    style: "normal",
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
