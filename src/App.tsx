import { useCallback, useEffect, useMemo, useState } from "react";
import { SplitPane } from "./components/SplitPane";
import { StepTable } from "./components/table/StepTable";
import { ValidationPanel } from "./components/ValidationPanel";
import { MapView } from "./components/map/MapView";
import { PartySheet } from "./components/PartySheet";
import { TeamSheet } from "./components/TeamSheet";
import { TeamMenu } from "./components/TeamMenu";
import { ProcessSwitcher } from "./components/ProcessSwitcher";
import { ExportMenu, ImportButton, StorageNotice } from "./components/ExportMenu";
import { Toaster } from "./components/ui/Toaster";
import { buildLayoutGraph } from "./graph/build-graph";
import type { BoxWidth } from "./model/types";
import { NARROW_QUERY, useMediaQuery } from "./hooks/useMediaQuery";
import { useApplyTheme } from "./hooks/useTheme";
import { useLayout } from "./hooks/useLayout";
import { flagsByStep, validateProcess } from "./model/validate";
import { processForTeam, teamView, type TeamFocus } from "./model/team";
import { startAutosave } from "./store/autosave";
import { redo, selectActiveProcess, undo, useStore } from "./store/workspace";

export default function App() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const saveStatus = useStore((s) => s.saveStatus);
  const hydrated = useStore((s) => s.hydrated);
  const parties = useStore((s) => s.parties);
  const teams = useStore((s) => s.teams);
  const process = useStore(selectActiveProcess);
  const selectedStepId = useStore((s) => s.selectedStepId);
  const selectStep = useStore((s) => s.selectStep);
  const removeLink = useStore((s) => s.removeLink);
  const setLaneOrder = useStore((s) => s.setLaneOrder);
  const [tab, setTab] = useState<"table" | "map">("table");
  const [partiesOpen, setPartiesOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
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

  // The team being looked at, if any. "highlight" fades the rest of the master
  // process; "isolate" shows the team's variant alone. Either way the table,
  // map, validation and exports all follow it.
  const focus = useMemo<TeamFocus | null>(() => {
    const teamId = view.highlightTeamId;
    if (!process || !teamId || !teams.some((t) => t.id === teamId)) return null;
    return { teamId, mode: view.teamFocus, view: teamView(process, teamId) };
  }, [process, teams, view.highlightTeamId, view.teamFocus]);
  const focusTeam = focus ? teams.find((t) => t.id === focus.teamId) : undefined;
  /** The process as one team runs it, when a team is focused. */
  const variant = useMemo(
    () => (process && focus ? processForTeam(process, focus.teamId) : process),
    [process, focus],
  );
  /** What the map and exports show: the variant alone when isolating, else the master. */
  const shown = focus?.mode === "isolate" ? variant : process;

  const flags = useMemo(
    () => (variant ? validateProcess(variant, { parties, teams }) : []),
    [variant, parties, teams],
  );
  const flagMap = useMemo(() => flagsByStep(flags), [flags]);
  // Node sizes come from measured text, so rebuild the graph once the UI font has loaded.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) setFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const graph = useMemo(
    () =>
      shown
        ? buildLayoutGraph(
            shown,
            parties,
            view.shapeMode,
            view.orientation,
            view.annotations,
            teams,
            view.boxWidth,
          )
        : { laneOrder: [], nodes: [], edges: [] },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      shown,
      parties,
      teams,
      view.shapeMode,
      view.orientation,
      view.annotations,
      view.boxWidth,
      fontsReady,
    ],
  );
  const { layout, updating } = useLayout(graph, view.orientation);

  const onRatio = useCallback((splitRatio: number) => setView({ splitRatio }), [setView]);
  const cycleTheme = () =>
    setView({
      theme: view.theme === "system" ? "light" : view.theme === "light" ? "dark" : "system",
    });

  if (!hydrated || !process || !shown) return null;

  const table = (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <StepTable process={process} flags={flagMap} focus={focus} />
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
        teamName={focusTeam?.name}
      />
    </div>
  );
  const map = (
    <MapView
      process={shown}
      parties={parties}
      teams={teams}
      focus={focus}
      graph={graph}
      layout={layout}
      updating={updating}
      mode={view.shapeMode}
      annotations={view.annotations}
      selectedStepId={selectedStepId}
      flags={flagMap}
      onSelect={selectStep}
      onReorderLanes={(laneOrder) => setLaneOrder(process.id, laneOrder)}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <header
        className="relative flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <span className="font-semibold whitespace-nowrap">Process Mapper</span>
        <ProcessSwitcher />
        <TeamMenu onManage={() => setTeamsOpen(true)} />
        <div className="flex-1" />
        <button className="btn" aria-label="Parties" onClick={() => setPartiesOpen(true)}>
          Parties
          <span className="text-xs text-[var(--text-muted)]">{parties.length}</span>
        </button>
        <ImportButton />
        <ExportMenu process={shown} layout={layout} graph={graph} focus={focus} />
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
        <button
          className="btn"
          aria-label="Toggle annotations"
          title="Show or hide technology and contributors on the map"
          onClick={() => setView({ annotations: view.annotations === "full" ? "minimal" : "full" })}
        >
          {view.annotations === "full" ? "Details" : "Minimal"}
        </button>
        <select
          className="input h-8 w-32"
          aria-label="Box width"
          title="How wide step boxes are drawn; long names wrap to fewer lines in a wider box"
          value={view.boxWidth}
          onChange={(e) => setView({ boxWidth: e.target.value as BoxWidth })}
        >
          <option value="narrow">Narrow boxes</option>
          <option value="normal">Normal boxes</option>
          <option value="wide">Wide boxes</option>
          <option value="extra">Extra wide</option>
        </select>
        <span
          className="flex items-center gap-1 text-xs text-[var(--text-muted)]"
          data-testid="save-status"
          aria-live="polite"
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: saveStatus === "saved" ? "var(--color-ok)" : "var(--color-warn)" }}
          />
          {saveStatus === "saved"
            ? "Saved"
            : saveStatus === "saving"
              ? "Saving…"
              : "Unsaved changes"}
        </span>
        <button className="btn" onClick={cycleTheme} aria-label="Theme">
          Theme: {view.theme}
        </button>
      </header>
      <StorageNotice />
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
      <PartySheet open={partiesOpen} onClose={() => setPartiesOpen(false)} />
      <TeamSheet open={teamsOpen} onClose={() => setTeamsOpen(false)} />
      <Toaster />
    </div>
  );
}
