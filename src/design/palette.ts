/**
 * Twelve base hues, each with a light-mode variant (used with dark text) and a
 * dark-mode variant (used with light text). Hues are spread around the wheel
 * and alternate in lightness so neighbours stay distinguishable under
 * deuteranopia, protanopia and tritanopia. Every light variant passes WCAG AA
 * (4.5:1) against the dark text colour; every dark variant passes against the
 * light text colour. This is asserted in tests/palette.test.ts.
 */
export interface PaletteEntry {
  name: string;
  light: string;
  dark: string;
}

export const PALETTE: readonly PaletteEntry[] = [
  { name: "Blue", light: "#8fb8f2", dark: "#1e4fb3" },
  { name: "Orange", light: "#f5b273", dark: "#a8480c" },
  { name: "Green", light: "#8dd3a3", dark: "#1f6f3f" },
  { name: "Pink", light: "#f2a9cb", dark: "#a3225f" },
  { name: "Purple", light: "#bfaef2", dark: "#5b33b8" },
  { name: "Teal", light: "#7fd4d0", dark: "#0f6c66" },
  { name: "Yellow", light: "#e9d36a", dark: "#8a6200" },
  { name: "Coral", light: "#f4a79a", dark: "#a8322b" },
  { name: "Brown", light: "#d6b08a", dark: "#7a4a1c" },
  { name: "Lime", light: "#c4dc78", dark: "#4d6f0f" },
  { name: "Magenta", light: "#d9a8e8", dark: "#7c1f8c" },
  { name: "Sky", light: "#93d0ee", dark: "#0c6a8c" },
] as const;

export const PALETTE_SIZE = PALETTE.length;

export type PatternKind = "none" | "stripe" | "dot";

export interface ResolvedColour {
  /** Base colour for borders, dots and lane header band. */
  fill: string;
  /** Pattern overlaid on lane headers and node borders. */
  pattern: PatternKind;
  /** Text colour for the lane header. */
  text: string;
}

export const UNASSIGNED_COLOUR: Record<"light" | "dark", ResolvedColour> = {
  light: { fill: "#a1a1aa", pattern: "none", text: "#18181b" },
  dark: { fill: "#52525b", pattern: "none", text: "#f4f4f5" },
};

export const DARK_TEXT = "#18181b";
export const LIGHT_TEXT = "#f4f4f5";

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16,
  );
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((c) => clamp(c).toString(16).padStart(2, "0")).join("");
}

/** Mix a colour toward white (amount > 0) or black (amount < 0). */
export function tint(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const target = amount >= 0 ? 255 : 0;
  const a = Math.abs(amount);
  return rgbToHex([r + (target - r) * a, g + (target - g) * a, b + (target - b) * a]);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pick dark or light text for a given background to maximise contrast. */
export function textOn(background: string): string {
  return contrastRatio(background, DARK_TEXT) >= contrastRatio(background, LIGHT_TEXT)
    ? DARK_TEXT
    : LIGHT_TEXT;
}

/**
 * Map a colourIndex to a concrete colour and pattern.
 *   0..11   base hue
 *   12..23  same hue, lighter tint, diagonal hairline stripe
 *   24+     same hue, darker shade, dotted pattern
 * Never throws for large indices; the pattern simply repeats.
 */
export function resolveColour(
  colourIndex: number,
  mode: "light" | "dark",
  override?: string,
): ResolvedColour {
  if (override) {
    return { fill: override, pattern: "none", text: textOn(override) };
  }
  const idx = Math.max(0, Math.floor(colourIndex));
  const entry = PALETTE[idx % PALETTE_SIZE];
  const tier = Math.floor(idx / PALETTE_SIZE);
  const base = mode === "light" ? entry.light : entry.dark;
  if (tier === 0) {
    return { fill: base, pattern: "none", text: mode === "light" ? DARK_TEXT : LIGHT_TEXT };
  }
  if (tier === 1) {
    const fill = tint(base, mode === "light" ? 0.35 : 0.18);
    return { fill, pattern: "stripe", text: textOn(fill) };
  }
  const fill = tint(base, mode === "light" ? -0.18 : -0.3);
  return { fill, pattern: "dot", text: textOn(fill) };
}

/** Convert a hex colour to an rgba() string at the given alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
