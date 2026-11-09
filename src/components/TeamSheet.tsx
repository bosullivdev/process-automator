import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Team } from "../model/types";
import { teamUsage } from "../model/team";
import { useStore } from "../store/workspace";
import { TeamGlyph } from "./table/TeamsCombobox";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Side sheet for the team registry: add, rename, delete (blocked while referenced). */
export function TeamSheet({ open, onClose }: Props) {
  const teams = useStore((s) => s.teams);
  const processes = useStore((s) => s.processes);
  const addTeam = useStore((s) => s.addTeam);
  const renameTeam = useStore((s) => s.renameTeam);
  const deleteTeam = useStore((s) => s.deleteTeam);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const sorted = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams]);

  if (!open) return null;

  const row = (t: Team) => {
    const usage = teamUsage(t.id, processes);
    const referenced = usage.length > 0;
    return (
      <li
        key={t.id}
        className="flex flex-col gap-1 rounded-lg border p-2"
        style={{ borderColor: "var(--border)" }}
        data-team-id={t.id}
      >
        <div className="flex items-center gap-2">
          <TeamGlyph size={12} />
          <input
            className="cell-input h-7 flex-1 rounded px-1 font-medium"
            aria-label={`Rename ${t.name}`}
            defaultValue={t.name}
            key={t.name}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== t.name) renameTeam(t.id, v);
              else e.target.value = t.name;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                (e.target as HTMLInputElement).value = t.name;
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span className="flex-1 truncate">
            {referenced
              ? usage
                  .map(
                    (u) =>
                      `${u.processName} (${u.steps} step${u.steps === 1 ? "" : "s"}${
                        u.links ? `, ${u.links} link${u.links === 1 ? "" : "s"}` : ""
                      })`,
                  )
                  .join(", ")
              : "Not used: every step applies to it"}
          </span>
          <button
            className="btn h-6 px-2 text-xs"
            aria-label={`Delete ${t.name}`}
            onClick={() =>
              referenced ? setDeleting(deleting === t.id ? null : t.id) : deleteTeam(t.id)
            }
          >
            Delete
          </button>
        </div>
        {deleting === t.id && referenced && (
          <div
            className="rounded-md p-2 text-xs"
            style={{ background: "var(--color-warn-soft)", color: "#78350f" }}
          >
            <strong>{t.name}</strong> is used in {usage.map((u) => u.processName).join(", ")}.
            Remove it from those steps and links first; a step with no teams applies to every team.
          </div>
        )}
      </li>
    );
  };

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Teams"
    >
      <div className="flex-1" style={{ background: "rgba(0,0,0,0.25)" }} onClick={onClose} />
      <div
        className="flex h-full w-[380px] max-w-full flex-col border-l shadow-xl"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div
          className="flex h-12 items-center gap-2 border-b px-3"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="font-semibold">Teams</span>
          <span className="text-xs text-[var(--text-muted)]">{teams.length}</span>
          <div className="flex-1" />
          <button className="btn btn-ghost btn-icon" aria-label="Close" onClick={onClose} autoFocus>
            ×
          </button>
        </div>
        <form
          className="flex gap-2 border-b p-3"
          style={{ borderColor: "var(--border)" }}
          onSubmit={(e) => {
            e.preventDefault();
            const v = newName.trim();
            if (!v) return;
            addTeam(v);
            setNewName("");
          }}
        >
          <input
            className="input"
            placeholder="New team name"
            aria-label="New team name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="btn btn-primary" type="submit">
            Add
          </button>
        </form>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <p className="mb-3 text-xs text-[var(--text-muted)]">
            Teams are variants of a process, not lanes. A step or link with no teams applies to
            every team; tag it to make it specific. Use the header's Team menu to highlight or
            isolate one team's variant.
          </p>
          {teams.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">
              No teams yet. Add one here or type a name in the table's Teams column.
            </p>
          )}
          {sorted.length > 0 && <ul className="flex flex-col gap-2">{sorted.map(row)}</ul>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
