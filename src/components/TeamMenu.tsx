import { useState } from "react";
import { useStore } from "../store/workspace";
import { Popover } from "./ui/Popover";
import { PartySwatch } from "./ui/PartySwatch";

interface Props {
  onManage: () => void;
}

/**
 * Header control for team variants: pick the team to look at, choose between
 * fading the rest of the process and showing the team's variant alone, and
 * open the team registry.
 */
export function TeamMenu({ onManage }: Props) {
  const teams = useStore((s) => s.teams);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);

  const current = teams.find((t) => t.id === view.highlightTeamId) ?? null;
  const label = current
    ? `${current.name}${view.teamFocus === "isolate" ? " only" : ""}`
    : "All teams";

  return (
    <>
      <button
        ref={setAnchor}
        className={`btn ${current ? "btn-active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Team view"
        title="Highlight or isolate one team's variant of the process"
        onClick={() => setOpen((o) => !o)}
        data-testid="team-menu"
      >
        {current && <PartySwatch party={current} size={8} />}
        Team: {label}
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={240}>
        <div role="menu" className="flex flex-col">
          <button
            role="menuitemradio"
            aria-checked={!current}
            className="menu-item"
            data-active={!current}
            onClick={() => {
              setView({ highlightTeamId: null });
              setOpen(false);
            }}
          >
            All teams
          </button>
          {teams.map((t) => (
            <button
              key={t.id}
              role="menuitemradio"
              aria-checked={current?.id === t.id}
              className="menu-item"
              data-active={current?.id === t.id}
              onClick={() => {
                setView({ highlightTeamId: t.id });
                setOpen(false);
              }}
            >
              <PartySwatch party={t} size={10} />
              <span className="truncate">{t.name}</span>
            </button>
          ))}
          {teams.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-[var(--text-muted)]">
              No teams yet. Tag steps in the Teams column to create some.
            </div>
          )}
          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          <div
            className="flex gap-1 px-2 py-1"
            role="group"
            aria-label="How to show the chosen team"
          >
            <button
              className={`btn h-7 flex-1 text-xs ${view.teamFocus === "highlight" ? "btn-active" : ""}`}
              aria-pressed={view.teamFocus === "highlight"}
              title="Fade steps and links the team does not use"
              onClick={() => setView({ teamFocus: "highlight" })}
            >
              Highlight
            </button>
            <button
              className={`btn h-7 flex-1 text-xs ${view.teamFocus === "isolate" ? "btn-active" : ""}`}
              aria-pressed={view.teamFocus === "isolate"}
              title="Show only the team's own steps and links"
              onClick={() => setView({ teamFocus: "isolate" })}
            >
              Only this team
            </button>
          </div>
          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          <button
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            Manage teams…
          </button>
        </div>
      </Popover>
    </>
  );
}
