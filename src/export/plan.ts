import type { Process, Team, ViewSettings, Workspace } from "../model/types";
import { processForTeam, processForTeams, withoutTeamScopes } from "../model/team";
import { safeFilename } from "./download";

/**
 * Custom export: the user picks formats, processes, teams and how the result
 * is packaged, and this module works out which maps are drawn and which files
 * they land in. Pure, so the dialog can show the outcome before anything is
 * built and so the rules are testable without a browser.
 */
export type ExportFormat = "vsdx" | "xlsx" | "pdf" | "svg" | "png" | "csv";

export interface FormatInfo {
  id: ExportFormat;
  label: string;
  ext: string;
  /** Whether one file of this format can hold several maps, and what each is called there. */
  holds: "pages" | "sheets" | null;
  hint: string;
}

export const FORMATS: readonly FormatInfo[] = [
  {
    id: "vsdx",
    label: "Visio (.vsdx)",
    ext: "vsdx",
    holds: "pages",
    hint: "Editable shapes with connectors glued to their steps",
  },
  {
    id: "xlsx",
    label: "Excel (.xlsx)",
    ext: "xlsx",
    holds: "sheets",
    hint: "Lanes as bands of cells, steps and arrows as shapes",
  },
  { id: "pdf", label: "PDF", ext: "pdf", holds: "pages", hint: "For printing and sharing" },
  { id: "svg", label: "SVG", ext: "svg", holds: null, hint: "Vector image, one map per file" },
  { id: "png", label: "PNG (2x)", ext: "png", holds: null, hint: "Image, one map per file" },
  {
    id: "csv",
    label: "Table (.csv)",
    ext: "csv",
    holds: null,
    hint: "The steps table rather than the map, one process per file",
  },
];

/**
 * - "all": each process whole, every team on it, as the map shows it with no team picked.
 * - "together": each process with just the ticked teams on one map.
 * - "each": a map per ticked team, each team's variant as a plain process.
 */
export type TeamMode = "all" | "together" | "each";

export interface ExportOptions {
  formats: ExportFormat[];
  processIds: string[];
  teamMode: TeamMode;
  teamIds: string[];
  /** "single": one file per format where the format can hold several maps. */
  packaging: "single" | "separate";
  /** When there is more than one file, download them as one .zip. */
  zip: boolean;
  orientation: ViewSettings["orientation"];
  shapeMode: ViewSettings["shapeMode"];
  annotations: ViewSettings["annotations"];
}

export interface PlannedMap {
  /** The process as drawn: the whole thing, or the chosen teams' view of it. */
  process: Process;
  /** Teams the map tells apart by arrow colour and labels; empty draws a plain process. */
  teams: Team[];
  /** Extra title-block line naming the teams, when the map is not the whole process. */
  teamLine?: string;
  /** Page or sheet name in a file that holds several maps. */
  title: string;
  /** Filename stem when the map gets a file of its own. */
  stem: string;
}

export interface PlannedFile {
  name: string;
  format: ExportFormat;
  /** Indexes into the planned maps, in page order. */
  maps: number[];
}

/** The teams the options pick, in registry order; every team when teams are not narrowed. */
function chosenTeams(ws: Workspace, o: ExportOptions): Team[] {
  if (o.teamMode === "all") return ws.teams;
  return ws.teams.filter((t) => o.teamIds.includes(t.id));
}

/** Filename part naming a narrowed set of teams, or "" for the whole process. */
function teamsPart(ws: Workspace, o: ExportOptions): string {
  const chosen = chosenTeams(ws, o);
  if (ws.teams.length === 0 || o.teamMode !== "together" || chosen.length === ws.teams.length)
    return "";
  return `-${safeFilename(chosen.map((t) => t.name).join("-"))}`;
}

/**
 * The maps to draw, in workspace order (and team order within a process).
 * Processes with no steps, or none for the chosen teams, are left out.
 */
export function planMaps(ws: Workspace, o: ExportOptions): PlannedMap[] {
  const processes = ws.processes.filter((p) => o.processIds.includes(p.id));
  const mode: TeamMode = ws.teams.length === 0 ? "all" : o.teamMode;
  const chosen = chosenTeams(ws, { ...o, teamMode: mode });
  const maps: PlannedMap[] = [];
  for (const master of processes) {
    const stem = safeFilename(master.name);
    if (mode === "all" || (mode === "together" && chosen.length === ws.teams.length)) {
      if (master.steps.length)
        maps.push({ process: master, teams: ws.teams, title: master.name, stem });
    } else if (mode === "together") {
      const process = processForTeams(
        master,
        chosen.map((t) => t.id),
      );
      if (process.steps.length === 0) continue;
      const names = chosen.map((t) => t.name);
      maps.push({
        process,
        // One team on its own has nothing to be told apart from.
        teams: chosen.length > 1 ? chosen : [],
        teamLine: chosen.length > 1 ? `Teams: ${names.join(", ")}` : `Team: ${names[0]} only`,
        title: master.name,
        stem: stem + teamsPart(ws, o),
      });
    } else {
      for (const team of chosen) {
        const process = withoutTeamScopes(processForTeam(master, team.id));
        if (process.steps.length === 0) continue;
        maps.push({
          process,
          teams: [],
          teamLine: `Team: ${team.name} only`,
          title: `${master.name} (${team.name})`,
          stem: `${stem}-${safeFilename(team.name)}`,
        });
      }
    }
  }
  return maps;
}

/** Give repeated filenames a number before the extension; names compare ignoring case. */
function uniqueNames(files: PlannedFile[]): PlannedFile[] {
  const taken = new Set<string>();
  return files.map((f) => {
    const dot = f.name.lastIndexOf(".");
    const base = f.name.slice(0, dot);
    const ext = f.name.slice(dot);
    let name = f.name;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base}-${n}${ext}`;
    taken.add(name.toLowerCase());
    return { ...f, name };
  });
}

/**
 * The files the maps land in. With "single" packaging a format that can hold
 * several maps gets one file with a page or sheet per map; every other case is
 * a file per map. `date` is the datestamp used in the names.
 */
export function planFiles(
  ws: Workspace,
  o: ExportOptions,
  maps: readonly PlannedMap[],
  date: string,
): PlannedFile[] {
  if (maps.length === 0) return [];
  const files: PlannedFile[] = [];
  for (const format of FORMATS) {
    if (!o.formats.includes(format.id)) continue;
    if (format.holds && o.packaging === "single") {
      const stem = maps.length === 1 ? maps[0].stem : safeFilename(ws.meta.name) + teamsPart(ws, o);
      files.push({
        name: `${stem}-${date}.${format.ext}`,
        format: format.id,
        maps: maps.map((_, i) => i),
      });
    } else {
      maps.forEach((m, i) =>
        files.push({ name: `${m.stem}-${date}.${format.ext}`, format: format.id, maps: [i] }),
      );
    }
  }
  return uniqueNames(files);
}

/** Name of the .zip the files are bundled into, or null when they download as they are. */
export function zipName(
  ws: Workspace,
  o: ExportOptions,
  files: readonly PlannedFile[],
  date: string,
): string | null {
  return o.zip && files.length > 1 ? `${safeFilename(ws.meta.name)}-export-${date}.zip` : null;
}
