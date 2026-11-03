import { useRef, useState } from "react";
import type { LayoutResult } from "../graph/layout-types";
import { getWorkspace, useStore } from "../store/workspace";
import { hasUnsavedChanges } from "../store/autosave";
import { isWorkspaceEmpty } from "../model/workspace";
import { exportWorkspaceJson, readWorkspaceFile } from "../export/json";
import { buildExportSvg, svgToBlob } from "../export/svg";
import { svgToPng } from "../export/png";
import { datestamp, downloadBlob, safeFilename } from "../export/download";
import { useResolvedTheme } from "../hooks/useTheme";
import { Popover } from "./ui/Popover";
import { toast } from "./ui/toast";
import type { Process } from "../model/types";

interface Props {
  process: Process;
  layout: LayoutResult | null;
}

export function ExportMenu({ process, layout }: Props) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const theme = useResolvedTheme();
  const parties = useStore((s) => s.parties);

  const run = async (kind: "json" | "svg" | "png" | "pdf") => {
    setOpen(false);
    setBusy(kind);
    try {
      const ws = getWorkspace();
      if (kind === "json") {
        exportWorkspaceJson(ws);
        return;
      }
      const svgEl = document.querySelector<SVGSVGElement>('[data-testid="map"] svg');
      if (!layout || !svgEl || layout.nodes.length === 0) {
        toast("Add some steps before exporting the map.");
        return;
      }
      const svg = await buildExportSvg({ process, parties, layout, theme, svgEl });
      const base = `${safeFilename(process.name)}-${datestamp()}`;
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
        </div>
      </Popover>
    </>
  );
}

export function ImportButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceWorkspace = useStore((s) => s.replaceWorkspace);
  const [pending, setPending] = useState<{ name: string; apply: () => void } | null>(null);

  const onFile = async (file: File) => {
    try {
      const ws = await readWorkspaceFile(file);
      const apply = () => {
        replaceWorkspace(ws);
        useStore.temporal.getState().clear();
        toast(`Imported "${ws.meta.name}".`);
      };
      const current = getWorkspace();
      if (!isWorkspaceEmpty(current) || hasUnsavedChanges())
        setPending({ name: ws.meta.name, apply });
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
          aria-label="Replace workspace"
        >
          <div className="menu flex w-96 flex-col gap-3 p-4">
            <p className="text-sm">
              Replace the current workspace with <strong>{pending.name}</strong>? The current
              workspace will be lost unless you export it first.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn" autoFocus onClick={() => setPending(null)}>
                Cancel
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
        className="btn h-6 px-2 text-xs"
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
