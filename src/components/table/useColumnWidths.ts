import { useCallback, useEffect, useState } from "react";

export type ColumnKey =
  | "no"
  | "name"
  | "owner"
  | "type"
  | "next"
  | "technology"
  | "contributors"
  | "teams"
  | "notes"
  | "actions";

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  width: number;
  min: number;
  /** Fixed columns have no resize handle. */
  fixed?: boolean;
}

/** Table columns in order with their default and minimum widths, in pixels. */
export const COLUMNS: readonly ColumnDef[] = [
  { key: "no", label: "No", width: 56, min: 44, fixed: true },
  { key: "name", label: "Name", width: 260, min: 120 },
  { key: "owner", label: "Owner", width: 160, min: 100 },
  { key: "type", label: "Type", width: 168, min: 120 },
  { key: "next", label: "Next", width: 240, min: 120 },
  { key: "technology", label: "Technology", width: 140, min: 80 },
  { key: "contributors", label: "Contributors", width: 160, min: 100 },
  { key: "teams", label: "Teams", width: 140, min: 90 },
  { key: "notes", label: "Notes", width: 200, min: 100 },
  { key: "actions", label: "", width: 36, min: 36, fixed: true },
];

export type ColumnWidths = Record<ColumnKey, number>;

const STORAGE_KEY = "process-mapper:column-widths";

function defaults(): ColumnWidths {
  return Object.fromEntries(COLUMNS.map((c) => [c.key, c.width])) as ColumnWidths;
}

function load(): ColumnWidths {
  const out = defaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return out;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      for (const c of COLUMNS) {
        const v = (parsed as Record<string, unknown>)[c.key];
        if (typeof v === "number" && Number.isFinite(v)) out[c.key] = Math.max(c.min, v);
      }
    }
  } catch {
    // Storage may be unavailable; defaults are fine.
  }
  return out;
}

export function clampWidth(key: ColumnKey, width: number): number {
  const def = COLUMNS.find((c) => c.key === key)!;
  return Math.max(def.min, Math.round(width));
}

/**
 * Column widths for the step table, remembered in this browser. Widths are a
 * per-device preference, so they live in localStorage rather than in the
 * workspace file.
 */
export function useColumnWidths(): {
  widths: ColumnWidths;
  setWidth: (key: ColumnKey, width: number) => void;
  resetWidth: (key: ColumnKey) => void;
} {
  const [widths, setWidths] = useState<ColumnWidths>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
    } catch {
      // Ignore: the widths still apply for this session.
    }
  }, [widths]);

  const setWidth = useCallback((key: ColumnKey, width: number) => {
    setWidths((w) => {
      const next = clampWidth(key, width);
      return w[key] === next ? w : { ...w, [key]: next };
    });
  }, []);
  const resetWidth = useCallback((key: ColumnKey) => {
    const def = COLUMNS.find((c) => c.key === key)!;
    setWidths((w) => (w[key] === def.width ? w : { ...w, [key]: def.width }));
  }, []);

  return { widths, setWidth, resetWidth };
}
