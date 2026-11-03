import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  DARK_TEXT,
  LIGHT_TEXT,
  PALETTE,
  resolveColour,
  tint,
  withAlpha,
} from "../src/design/palette";

describe("palette", () => {
  it("has twelve hues", () => {
    expect(PALETTE).toHaveLength(12);
  });

  it("light-mode variants pass WCAG AA with dark text", () => {
    for (const p of PALETTE) {
      expect(contrastRatio(p.light, DARK_TEXT), p.name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("dark-mode variants pass WCAG AA with light text", () => {
    for (const p of PALETTE) {
      expect(contrastRatio(p.dark, LIGHT_TEXT), p.name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("all hues are distinct", () => {
    expect(new Set(PALETTE.map((p) => p.light)).size).toBe(12);
    expect(new Set(PALETTE.map((p) => p.dark)).size).toBe(12);
  });

  it("tier 0 has no pattern, tier 1 stripes, tier 2+ dots, and never throws", () => {
    expect(resolveColour(0, "light").pattern).toBe("none");
    expect(resolveColour(11, "light").pattern).toBe("none");
    expect(resolveColour(12, "light").pattern).toBe("stripe");
    expect(resolveColour(23, "dark").pattern).toBe("stripe");
    expect(resolveColour(24, "light").pattern).toBe("dot");
    expect(resolveColour(999, "dark").pattern).toBe("dot");
  });

  it("tier 1 is lighter and tier 2 darker than base in light mode", () => {
    const base = resolveColour(3, "light").fill;
    expect(resolveColour(15, "light").fill).toBe(tint(base, 0.35));
    expect(resolveColour(27, "light").fill).toBe(tint(base, -0.18));
  });

  it("override replaces colour in both modes and chooses readable text", () => {
    expect(resolveColour(0, "light", "#000000")).toEqual({
      fill: "#000000",
      pattern: "none",
      text: LIGHT_TEXT,
    });
    expect(resolveColour(0, "dark", "#ffffff").text).toBe(DARK_TEXT);
  });

  it("withAlpha produces rgba", () => {
    expect(withAlpha("#ff0000", 0.1)).toBe("rgba(255, 0, 0, 0.1)");
  });
});
