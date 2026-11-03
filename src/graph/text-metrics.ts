/**
 * Text measurement for node sizing. Uses a canvas with the UI font when one is
 * available (browser), otherwise a per-character estimate, so sizes are
 * deterministic for a given text in a given environment.
 */
export const UI_FONT = '"Inter Variable", Inter, system-ui, sans-serif';

let ctx: CanvasRenderingContext2D | null | undefined;

function context(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  try {
    ctx =
      typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  } catch {
    ctx = null;
  }
  return ctx;
}

export function measureText(text: string, fontSize: number, weight = 400): number {
  const c = context();
  if (c) {
    c.font = `${weight} ${fontSize}px ${UI_FONT}`;
    return c.measureText(text).width;
  }
  return text.length * fontSize * 0.58;
}

/**
 * Greedy word wrap to a pixel width. Words longer than the width are split by
 * character. At most maxLines lines; the last line is ellipsised if text remains.
 */
export function wrapToWidth(
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number,
  weight = 400,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const fits = (s: string) => measureText(s, fontSize, weight) <= maxWidth;
  const lines: string[] = [];
  let cur = "";
  const pushWord = (w: string) => {
    if (!cur) {
      cur = w;
    } else if (fits(`${cur} ${w}`)) {
      cur += ` ${w}`;
    } else {
      lines.push(cur);
      cur = w;
    }
    // Break a single word that is wider than the line.
    while (!fits(cur) && cur.length > 1) {
      let cut = cur.length - 1;
      while (cut > 1 && !fits(cur.slice(0, cut))) cut--;
      lines.push(cur.slice(0, cut));
      cur = cur.slice(cut);
    }
  };
  for (const w of words) pushWord(w);
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && !fits(`${last}…`)) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

export function linesWidth(lines: string[], fontSize: number, weight = 400): number {
  return lines.reduce((m, l) => Math.max(m, measureText(l, fontSize, weight)), 0);
}
