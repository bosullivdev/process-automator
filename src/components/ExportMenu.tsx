import { useRef, useState } from "react";
import type { LayoutGraph, LayoutResult } from "../graph/layout-types";
import { getWorkspace, useStore } from "../store/workspace";
import { hasUnsavedChanges } from "../store/autosave";
import { isWorkspaceEmpty } from "../model/workspace";
import { exportWorkspaceJson, readWorkspaceFile } from "../export/json";
import { exportProcessCsv } from "../export/csv";
import { buildExportSvg, svgToBlob } from "../export/svg";
import { svgToPng } from "../export/png";
import { buildVsdx, vsdxToBlob } from "../export/vsdx";
import { datestamp, downloadBlob, safeFilename } from "../export/download";
import { useResolvedTheme } from "../hooks/useTheme";
import { Popover } from "./ui/Popover";
import { toast } from "./ui/toast";
import type { Process } from "../model/types";
import type { TeamFocus } from "../model/team";

interface Props {
  /** The process as shown: the whole thing, or one team's variant when isolated. */
  process: Process;
  layout: LayoutResult | null;
  graph: LayoutGraph;
  focus: TeamFocus | null;
}

export function ExportMenu({ process, layout, graph, focus }: Props) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const theme = useResolvedTheme();
  const parties = useStore((s) => s.parties);
  const teams = useStore((s) => s.teams);
  const team = focus ? teams.find((t) => t.id === focus.teamId) : undefined;
  const teamLine = team
    ? `Team: ${team.name}${focus?.mode === "isolate" ? " only" : " (highlighted)"}`
    : undefined;
  /** Filename stem: process name, plus the team when one is focused. */
  const stem = `${safeFilename(process.name)}${team ? `-${safeFilename(team.name)}` : ""}`;

  const run = async (kind: "json" | "csv" | "svg" | "png" | "pdf" | "vsdx" | "xlsx") => {
    setOpen(false);
    setBusy(kind);
    try {
      const ws = getWorkspace();
      if (kind === "json") {
        exportWorkspaceJson(ws);
        return;
      }
      if (kind === "csv") {
        exportProcessCsv(process, parties, teams, stem);
        return;
      }
      const svgEl = document.querySelector<SVGSVGElement>('[data-testid="map"] svg');
      if (!layout || !svgEl || layout.nodes.length === 0) {
        toast("Add some steps before exporting the map.");
        return;
      }
      if (kind === "vsdx") {
        const bytes = buildVsdx({ process, parties, teams, graph, layout, teamLine });
        downloadBlob(vsdxToBlob(bytes), `${stem}-${datestamp()}.vsdx`);
        return;
      }
      if (kind === "xlsx") {
        const { buildXlsx, xlsxToBlob } = await import("../export/xlsx");
        const bytes = buildXlsx({ process, parties, teams, graph, layout, teamLine });
        downloadBlob(xlsxToBlob(bytes), `${stem}-${datestamp()}.xlsx`);
        return;
      }
      const svg = await buildExportSvg({
        process,
        parties,
        layout,
        theme,
        svgEl,
        teamLine,
        teams,
      });
      const base = `${stem}-${datestamp()}`;
      if (kind === "svg") downloadBlob(svgToBlob(svg), `${base}.svg`);
      else if (kind === "png") downloadBlob(await svgToPng(svg, 2), `${base}.png`);
      else {
        const { svgToPdf } = await import("../export/pdf");
        downloadBlob(await svgToPdf(svg), `${base}.pdf`);
      }
    } catch (err) {
      toast(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button
        ref={setAnchor}
        className="btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        disabled={!!busy}
      >
        {busy ? `Exporting ${busy}…` : "Export"}
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={220}>
        <div role="menu" className="flex flex-col">
          <button role="menuitem" className="menu-item" onClick={() => run("json")}>
            Workspace JSON
          </button>
          <button role="menuitem" className="menu-item" onClick={() => run("csv")}>
            Table as CSV
          </button>
          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          <button role="menuitem" className="menu-item" onClick={() => run("svg")}>
            Map as SVG
          </button>
          <button role="menuitem" className="menu-item" onClick={() => run("png")}>
            Map as PNG (2x)
          </button>
          <button role="menuitem" className="menu-item" onClick={() => run("pdf")}>
            Map as PDF
          </button>
          <button
            role="menuitem"
            className="menu-item"
            title="Visio drawing with editable shapes and connectors glued to their steps"
            onClick={() => run("vsdx")}
          >
            Map as Visio (.vsdx)
          </button>
          <button
            role="menuitem"
            className="menu-item"
            title="Excel workbook: lanes as bands of cells, steps and arrows as shapes"
            onClick={() => run("xlsx")}
          >
            Map as Excel (.xlsx)
          </button>
        </div>
      </Popover>
    </>
  );
}

export function ImportButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceWorkspace = useStore((s) => s.replaceWorkspace);
  const addWorkspace = useStore((s) => s.addWorkspace);
  const [pending, setPending] = useState<{
    name: string;
    processes: number;
    apply: () => void;
    add: () => void;
  } | null>(null);

  const onFile = async (file: File) => {
    try {
      const ws = await readWorkspaceFile(file);
      const apply = () => {
        replaceWorkspace(ws);
        useStore.temporal.getState().clear();
        toast(`Imported "${ws.meta.name}".`);
      };
      const add = () => {
        addWorkspace(ws);
        const n = ws.processes.length;
        toast(`Added ${n} ${n === 1 ? "process" : "processes"} from "${ws.meta.name}".`);
      };
      const current = getWorkspace();
      if (!isWorkspaceEmpty(current) || hasUnsavedChanges())
        setPending({ name: ws.meta.name, processes: ws.processes.length, apply, add });
      else apply();
    } catch (err) {
      toast(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-label="Import workspace file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onFile(f);
        }}
      />
      <button className="btn" onClick={() => inputRef.current?.click()}>
        Import
      </button>
      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.3)" }}
          role="alertdialog"
          aria-label="Import workspace"
        >
          <div className="menu flex w-[26rem] flex-col gap-3 p-4">
            <p className="text-sm">
              Import <strong>{pending.name}</strong>: add its{" "}
              {pending.processes === 1 ? "process" : `${pending.processes} processes`} to this
              workspace, or replace the workspace with it? Replacing loses the current workspace
              unless you export it first.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn" autoFocus onClick={() => setPending(null)}>
                Cancel
              </button>
              <button
                className="btn"
                title="Keep the current processes and add the file's processes beside them. Parties and teams with the same name are shared."
                onClick={() => {
                  pending.add();
                  setPending(null);
                }}
              >
                Add to workspace
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  pending.apply();
                  setPending(null);
                }}
              >
                Replace
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const NOTICE_KEY = "process-mapper:storage-notice-dismissed";

export function StorageNotice() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(NOTICE_KEY) === "1");
  if (dismissed) return null;
  return (
    <div
      className="flex items-center gap-3 border-b px-3 py-1.5 text-xs"
      style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
      role="note"
    >
      <span>
        Your work is saved in this browser only. Browser storage can be cleared, so use{" "}
        <strong>Export → Workspace JSON</strong> to keep a real copy.
      </span>
      <button
        className="btn h-6 shrink-0 px-2 text-xs whitespace-nowrap"
        onClick={() => {
          localStorage.setItem(NOTICE_KEY, "1");
          setDismissed(true);
        }}
      >
        Got it
      </button>
    </div>
  );
}
