import { zipSync } from "fflate";
import type { Workspace } from "../model/types";
import { buildLayoutGraph } from "../graph/build-graph";
import { requestLayout } from "../hooks/useLayout";
import { processToCsv } from "./csv";
import { datestamp, downloadBlob } from "./download";
import {
  planFiles,
  planMaps,
  zipName,
  type ExportOptions,
  type PlannedFile,
  type PlannedMap,
} from "./plan";
import { svgToPng } from "./png";
import { renderMapSvg } from "./render-map";
import { buildExportSvg, svgToBlob } from "./svg";
import { buildVsdxDocument, vsdxToBlob, type VsdxContext } from "./vsdx";

export interface ExportOutcome {
  maps: number;
  files: number;
  /** The .zip the files went into, when they were bundled. */
  zip: string | null;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Build and download a custom export. Every map is laid out afresh from the
 * workspace with the options' orientation, shapes and detail, so processes
 * other than the open one come out the same as they would on screen.
 */
export async function runExport(
  ws: Workspace,
  o: ExportOptions,
  theme: "light" | "dark",
  onProgress: (message: string) => void = () => {},
): Promise<ExportOutcome> {
  const date = datestamp();
  const maps = planMaps(ws, o);
  const files = planFiles(ws, o, maps, date);
  if (files.length === 0) throw new Error("There is nothing to export with these choices.");

  // Layout, once per map, shared by every format.
  const contexts: VsdxContext[] = [];
  for (const [i, m] of maps.entries()) {
    onProgress(`Laying out map ${i + 1} of ${maps.length}…`);
    const graph = buildLayoutGraph(
      m.process,
      ws.parties,
      o.shapeMode,
      o.orientation,
      o.annotations,
      m.teams,
    );
    const layout = await requestLayout(graph, o.orientation);
    contexts.push({
      process: m.process,
      parties: ws.parties,
      teams: m.teams,
      graph,
      layout,
      teamLine: m.teamLine,
      pageName: m.title,
    });
  }

  // The drawn picture, once per map, for the formats made from it.
  const svgs = new Map<number, string>();
  const svgOf = async (i: number): Promise<string> => {
    const cached = svgs.get(i);
    if (cached !== undefined) return cached;
    const m: PlannedMap = maps[i];
    const { graph, layout } = contexts[i];
    const svgEl = renderMapSvg({
      process: m.process,
      parties: ws.parties,
      teams: m.teams,
      graph,
      layout,
      mode: o.shapeMode,
      annotations: o.annotations,
    });
    const svg = await buildExportSvg({
      process: m.process,
      parties: ws.parties,
      layout,
      theme,
      svgEl,
      teamLine: m.teamLine,
      teams: m.teams,
    });
    svgs.set(i, svg);
    return svg;
  };

  const build = async (f: PlannedFile): Promise<Blob> => {
    const ctxs = f.maps.map((i) => contexts[i]);
    switch (f.format) {
      case "vsdx":
        return vsdxToBlob(buildVsdxDocument(ctxs, ctxs.length > 1 ? ws.meta.name : undefined));
      case "xlsx": {
        const { buildXlsxWorkbook, xlsxToBlob } = await import("./xlsx");
        return xlsxToBlob(buildXlsxWorkbook(ctxs));
      }
      case "pdf": {
        const pages: string[] = [];
        for (const i of f.maps) pages.push(await svgOf(i));
        const { svgsToPdf } = await import("./pdf");
        return svgsToPdf(pages);
      }
      case "svg":
        return svgToBlob(await svgOf(f.maps[0]));
      case "png":
        return svgToPng(await svgOf(f.maps[0]), 2);
      case "csv": {
        const m = maps[f.maps[0]];
        // The byte-order mark makes Excel read the file as UTF-8.
        return new Blob(["﻿", processToCsv(m.process, ws.parties, m.teams)], {
          type: "text/csv;charset=utf-8",
        });
      }
    }
  };

  const built: Array<{ name: string; blob: Blob }> = [];
  for (const [i, f] of files.entries()) {
    onProgress(`Writing file ${i + 1} of ${files.length}…`);
    built.push({ name: f.name, blob: await build(f) });
  }

  const zip = zipName(ws, o, files, date);
  if (zip) {
    const entries: Record<string, Uint8Array> = {};
    for (const b of built) entries[b.name] = new Uint8Array(await b.blob.arrayBuffer());
    downloadBlob(
      new Blob([zipSync(entries, { level: 6 }) as BlobPart], { type: "application/zip" }),
      zip,
    );
  } else {
    for (const [i, b] of built.entries()) {
      // A short gap, or browsers drop all but the first of a burst of downloads.
      if (i > 0) await pause(250);
      downloadBlob(b.blob, b.name);
    }
  }
  return { maps: maps.length, files: files.length, zip };
}
