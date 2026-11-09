import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Team } from "../model/types";
import { teamUsage } from "../model/team";
import { useStore } from "../store/workspace";
import { PartySwatch } from "./ui/PartySwatch";
import { toast } from "./ui/toast";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Side sheet for the team registry: add a team (optionally starting from
 * another team's route in the active process), rename, copy a route, delete
 * (blocked while referenced).
 */
export function TeamSheet({ open, onClose }: Props) {
  const teams = useStore((s) => s.teams);
  const processes = useStore((s) => s.processes);
  const activeProcessId = useStore((s) => s.view.activeProcessId);
  const addTeam = useStore((s) => s.addTeam);
  const renameTeam = useStore((s) => s.renameTeam);
  const deleteTeam = useStore((s) => s.deleteTeam);
  const copyTeamRoute = useStore((s) => s.copyTeamRoute);
  const [newName, setNewName] = useState("");
  const [startFrom, setStartFrom] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copying, setCopying] = useState<string | null>(null);

  const sorted = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams]);
  const activeProcess = processes.find((p) => p.id === activeProcessId);

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
          <PartySwatch party={t} size={12} />
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
              : "Follows every untagged step"}
          </span>
          {teams.length > 1 && activeProcess && (
            <button
              className="btn h-6 px-2 text-xs"
              aria-label={`Copy a route to ${t.name}`}
              onClick={() => setCopying(copying === t.id ? null : t.id)}
            >
              Copy route…
            </button>
          )}
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
        {copying === t.id && activeProcess && (
          <div className="flex items-center gap-2 text-xs">
            <span className="shrink-0">In {activeProcess.name}, follow</span>
            <select
              className="input h-7 flex-1 text-xs"
              aria-label={`Copy route to ${t.name} from`}
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                copyTeamRoute(activeProcess.id, e.target.value, t.id);
                const from = teams.find((x) => x.id === e.target.value);
                toast(
                  `${t.name} now follows ${from?.name ?? "that team"}'s route in ${activeProcess.name}.`,
                );
                setCopying(null);
              }}
            >
              <option value="">Choose a team…</option>
              {teams
                .filter((o) => o.id !== t.id)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          </div>
        )}
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
        className="flex h-full w-[400px] max-w-full flex-col border-l shadow-xl"
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
          className="flex flex-col gap-2 border-b p-3"
          style={{ borderColor: "var(--border)" }}
          onSubmit={(e) => {
            e.preventDefault();
            const v = newName.trim();
            if (!v) return;
            const from =
              startFrom && activeProcess
                ? { teamId: startFrom, processId: activeProcess.id }
                : undefined;
            addTeam(v, from);
            setNewName("");
            setStartFrom("");
          }}
        >
          <div className="flex gap-2">
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
          </div>
          {teams.length > 0 && activeProcess && (
            <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span className="shrink-0">Start from</span>
              <select
                className="input h-7 flex-1 text-xs"
                aria-label="Start the new team from"
                value={startFrom}
                onChange={(e) => setStartFrom(e.target.value)}
              >
                <option value="">Every untagged step</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}&apos;s route in {activeProcess.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </form>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <p className="mb-3 text-xs text-[var(--text-muted)]">
            Build one team&apos;s process in full, then add the next team starting from it and edit
            that team&apos;s route with the header&apos;s Team menu set to &quot;only this
            team&quot;. Team colours appear on arrows the teams do not share. Teams are not lanes.
          </p>
          {teams.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">
              No teams yet. Add one here or type a name in the table&apos;s Teams column.
            </p>
          )}
          {sorted.length > 0 && <ul className="flex flex-col gap-2">{sorted.map(row)}</ul>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
