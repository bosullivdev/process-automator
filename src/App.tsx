import { useState } from "react";
import { SplitPane } from "./components/SplitPane";
import { NARROW_QUERY, useMediaQuery } from "./hooks/useMediaQuery";
import { useApplyTheme, type ThemeSetting } from "./hooks/useTheme";

export default function App() {
  const [theme, setTheme] = useState<ThemeSetting>("system");
  const [ratio, setRatio] = useState(0.5);
  const [tab, setTab] = useState<"table" | "map">("table");
  const narrow = useMediaQuery(NARROW_QUERY);
  useApplyTheme(theme);

  const cycleTheme = () =>
    setTheme((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system"));

  const table = <div className="h-full p-4 text-sm text-[var(--text-muted)]">Table</div>;
  const map = <div className="h-full p-4 text-sm text-[var(--text-muted)]">Map</div>;

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex h-12 shrink-0 items-center gap-2 border-b px-3"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <span className="font-semibold">Process Mapper</span>
        <div className="flex-1" />
        <button className="btn" onClick={cycleTheme} aria-label="Theme">
          Theme: {theme}
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
          <SplitPane ratio={ratio} onRatioChange={setRatio} left={table} right={map} />
        </div>
      )}
    </div>
  );
}
