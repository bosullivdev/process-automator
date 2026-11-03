import { useCallback, useEffect, useMemo, useState } from "react";
import { SplitPane } from "./components/SplitPane";
import { StepTable } from "./components/table/StepTable";
import { ValidationPanel } from "./components/ValidationPanel";
import { MapView } from "./components/map/MapView";
import { Toaster } from "./components/ui/Toaster";
import { buildLayoutGraph } from "./graph/build-graph";
import { NARROW_QUERY, useMediaQuery } from "./hooks/useMediaQuery";
import { useApplyTheme } from "./hooks/useTheme";
import { useLayout } from "./hooks/useLayout";
import { flagsByStep, validateProcess } from "./model/validate";
import { startAutosave } from "./store/autosave";
import { redo, selectActiveProcess, undo, useStore } from "./store/workspace";

export default function App() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const saveStatus = useStore((s) => s.saveStatus);
  const hydrated = useStore((s) => s.hydrated);
  const parties = useStore((s) => s.parties);
  const process = useStore(selectActiveProcess);
  const selectedStepId = useStore((s) => s.selectedStepId);
  const selectStep = useStore((s) => s.selectStep);
  const removeLink = useStore((s) => s.removeLink);
  const setLaneOrder = useStore((s) => s.setLaneOrder);
  const [tab, setTab] = useState<"table" | "map">("table");
  const narrow = useMediaQuery(NARROW_QUERY);
  useApplyTheme();

  useEffect(() => {
    let stop: (() => void) | undefined;
    void startAutosave().then((s) => (stop = s));
    return () => stop?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const flags = useMemo(
    () => (process ? validateProcess(process, { parties }) : []),
    [process, parties],
  );
  const flagMap = useMemo(() => flagsByStep(flags), [flags]);
  const graph = useMemo(
    () =>
      process
        ? buildLayoutGraph(process, parties, view.shapeMode)
        : { laneOrder: [], nodes: [], edges: [] },
    [process, parties, view.shapeMode],
  );
  const { layout, updating } = useLayout(graph, view.orientation);

  const onRatio = useCallback((splitRatio: number) => setView({ splitRatio }), [setView]);
  const cycleTheme = () =>
    setView({
      theme: view.theme === "system" ? "light" : view.theme === "light" ? "dark" : "system",
    });

  if (!hydrated || !process) return null;

  const table = (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <StepTable process={process} flags={flagMap} />
      </div>
      <ValidationPanel
        flags={flags}
        onSelectStep={(id) => {
          selectStep(id);
          const row = document.querySelector<HTMLElement>(`[data-step-id="${id}"]`);
          row?.scrollIntoView({ block: "nearest" });
          row?.querySelector<HTMLInputElement>("input")?.focus();
        }}
        onRemoveLink={(stepId, targetId) => removeLink(process.id, stepId, targetId)}
      />
    </div>
  );
  const map = (
    <MapView
      process={process}
      parties={parties}
      graph={graph}
      layout={layout}
      updating={updating}
      mode={view.shapeMode}
      selectedStepId={selectedStepId}
      flags={flagMap}
      onSelect={selectStep}
      onReorderLanes={(laneOrder) => setLaneOrder(process.id, laneOrder)}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex h-12 shrink-0 items-center gap-2 border-b px-3"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <span className="font-semibold">Process Mapper</span>
        <div className="flex-1" />
        <button
          className="btn"
          aria-label="Toggle orientation"
          title="Orientation"
          onClick={() =>
            setView({ orientation: view.orientation === "horizontal" ? "vertical" : "horizontal" })
          }
        >
          {view.orientation === "horizontal" ? "Horizontal" : "Vertical"}
        </button>
        <button
          className="btn"
          aria-label="Toggle shape mode"
          title="Shape mode"
          onClick={() => setView({ shapeMode: view.shapeMode === "simple" ? "bpmn" : "simple" })}
        >
          {view.shapeMode === "simple" ? "Simple" : "BPMN"}
        </button>
        <span className="text-xs text-[var(--text-muted)]">{saveStatus}</span>
        <button className="btn" onClick={cycleTheme} aria-label="Theme">
          Theme: {view.theme}
        </button>
      </header>
      {narrow ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className="flex shrink-0 gap-1 border-b p-1"
            style={{ borderColor: "var(--border)" }}
          >
            <button
              className={`btn ${tab === "table" ? "btn-active" : ""}`}
              onClick={() => setTab("table")}
            >
              Table
            </button>
            <button
              className={`btn ${tab === "map" ? "btn-active" : ""}`}
              onClick={() => setTab("map")}
            >
              Map
            </button>
          </div>
          <div className="min-h-0 flex-1">{tab === "table" ? table : map}</div>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <SplitPane ratio={view.splitRatio} onRatioChange={onRatio} left={table} right={map} />
        </div>
      )}
      <Toaster />
    </div>
  );
}
