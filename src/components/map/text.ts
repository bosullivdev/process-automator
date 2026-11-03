/** Greedy word wrap by character budget; returns at most maxLines lines, last line ellipsised. */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (
    lines.length > maxLines ||
    (lines.length === maxLines && words.join(" ").length > lines.join(" ").length)
  ) {
    lines.length = maxLines;
    const last = lines[maxLines - 1];
    lines[maxLines - 1] =
      last.length > maxChars - 1 ? last.slice(0, maxChars - 1) + "…" : last + "…";
  }
  return lines.map((l) => (l.length > maxChars ? l.slice(0, maxChars - 1) + "…" : l));
}

export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.58 + 4;
}
