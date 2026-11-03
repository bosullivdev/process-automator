import { useCallback, useEffect } from "react";
import { SplitPane } from "./components/SplitPane";
import { NARROW_QUERY, useMediaQuery } from "./hooks/useMediaQuery";
import { useApplyTheme } from "./hooks/useTheme";
import { redo, undo, useStore } from "./store/workspace";
import { startAutosave } from "./store/autosave";
import { useState } from "react";

export default function App() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const saveStatus = useStore((s) => s.saveStatus);
  const hydrated = useStore((s) => s.hydrated);
  const [tab, setTab] = useState<"table" | "map">("table");
  const narrow = useMediaQuery(NARROW_QUERY);
  useApplyTheme(view.theme);

  useEffect(() => {
    let stop: (() => void) | undefined;
    void startAutosave().then((s) => (stop = s));
    return () => stop?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onRatio = useCallback((splitRatio: number) => setView({ splitRatio }), [setView]);
  const cycleTheme = () =>
    setView({
      theme: view.theme === "system" ? "light" : view.theme === "light" ? "dark" : "system",
    });

  const table = <div className="h-full p-4 text-sm text-[var(--text-muted)]">Table</div>;
  const map = <div className="h-full p-4 text-sm text-[var(--text-muted)]">Map</div>;

  if (!hydrated) return null;

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex h-12 shrink-0 items-center gap-2 border-b px-3"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <span className="font-semibold">Process Mapper</span>
        <div className="flex-1" />
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
    </div>
  );
}
