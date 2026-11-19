import { useMemo } from "react";
import { createPortal } from "react-dom";
import type { Process } from "../model/types";
import { compareTeams, suggestAlignments, type Suggestion } from "../model/align";
import { undo, useStore } from "../store/workspace";
import { PartySwatch } from "./ui/PartySwatch";
import { toast } from "./ui/toast";

interface Props {
  open: boolean;
  /** The master process, with every team's variant in it. */
  process: Process;
  onClose: () => void;
}

const percent = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Side panel comparing the teams' variants of the active process: how alike
 * each pair of teams is, and edits that would bring them closer together.
 * It sits beside the table and map without covering them, so a suggestion's
 * step can be looked at before it is applied. Everything shown is worked out
 * from the process; applying a suggestion is an ordinary undoable edit.
 */
export function CompareTeamsPanel({ open, process, onClose }: Props) {
  const teams = useStore((s) => s.teams);
  const parties = useStore((s) => s.parties);
  const selectStep = useStore((s) => s.selectStep);
  const selectedStepId = useStore((s) => s.selectedStepId);
  const applyAlignment = useStore((s) => s.applyAlignment);

  const comparison = useMemo(
    () => (open ? compareTeams(process, teams) : null),
    [open, process, teams],
  );
  const suggestions = useMemo(
    () => (open ? suggestAlignments(process, teams, parties) : []),
    [open, process, teams, parties],
  );

  if (!open || !comparison) return null;

  const team = (id: string) => teams.find((t) => t.id === id);
  const show = (s: Suggestion) => {
    const id = s.stepIds[0];
    selectStep(id);
    document
      .querySelector<HTMLElement>(`tr[data-step-id="${id}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };
  const apply = (s: Suggestion) => {
    applyAlignment(process.id, s.action);
    toast(`Done: ${s.title}.`, { label: "Undo", onClick: undo });
  };

  return createPortal(
    <aside
      className="fixed top-0 right-0 z-30 flex h-full w-[380px] max-w-full flex-col border-l shadow-xl"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      aria-label="Compare teams"
      data-testid="compare-teams"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className="flex h-12 shrink-0 items-center gap-2 border-b px-3"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="font-semibold">Compare teams</span>
        <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-muted)]">
          {process.name}
        </span>
        <button className="btn btn-ghost btn-icon" aria-label="Close" onClick={onClose} autoFocus>
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {teams.length < 2 ? (
          <p className="text-sm text-[var(--text-muted)]">
            There is nothing to compare yet. Set up at least two teams (Team menu → Manage teams)
            and give each its own route through this process.
          </p>
        ) : (
          <>
            <p className="text-sm" data-testid="team-similarity">
              The teams&apos; routes through this process are{" "}
              <strong>{percent(comparison.average)}</strong> alike, counting the steps, owners and
              arrows they share.
            </p>
            {comparison.pairs.length > 1 && (
              <ul className="mt-2 flex flex-col gap-1 text-xs">
                {[...comparison.pairs]
                  .sort((a, b) => a.similarity - b.similarity)
                  .map((p) => {
                    const a = team(p.a);
                    const b = team(p.b);
                    if (!a || !b) return null;
                    return (
                      <li key={`${p.a}:${p.b}`} className="flex items-center gap-1.5">
                        <PartySwatch party={a} size={8} />
                        <span className="truncate">{a.name}</span>
                        <span className="text-[var(--text-muted)]">and</span>
                        <PartySwatch party={b} size={8} />
                        <span className="min-w-0 flex-1 truncate">{b.name}</span>
                        <span className="font-tabular font-mono">{percent(p.similarity)}</span>
                      </li>
                    );
                  })}
              </ul>
            )}
            <h2 className="mt-4 mb-2 text-xs font-medium text-[var(--text-muted)]">
              {suggestions.length
                ? `${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"}, most effective first`
                : "No suggestions"}
            </h2>
            {suggestions.length === 0 && (
              <p className="text-sm text-[var(--text-muted)]">
                {comparison.average > 0.999
                  ? "Every team follows the same route."
                  : "The remaining differences are in how the teams' steps are connected, which is not something this can suggest a fix for."}
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {suggestions.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-col gap-1.5 rounded-lg border p-2"
                  style={{
                    borderColor: s.stepIds.includes(selectedStepId ?? "")
                      ? "var(--color-accent)"
                      : "var(--border)",
                  }}
                  data-suggestion={s.action.kind}
                >
                  <div className="flex items-start gap-2">
                    <span className="flex-1 text-sm font-medium">{s.title}</span>
                    <span
                      className="font-tabular shrink-0 font-mono text-xs text-[var(--text-muted)]"
                      title="How much more alike the teams become"
                    >
                      {s.gain < 0.005 ? "+<1%" : `+${percent(s.gain)}`}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">{s.detail}</p>
                  <div className="flex justify-end gap-1.5">
                    <button
                      className="btn h-7 px-2 text-xs"
                      title="Select the step in the table and on the map"
                      onClick={() => show(s)}
                    >
                      Show step
                    </button>
                    <button className="btn btn-primary h-7 px-2 text-xs" onClick={() => apply(s)}>
                      Apply
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-[var(--text-muted)]">
              Suggestions follow what most teams do; they cannot tell which way is better. Every
              change can be undone.
            </p>
          </>
        )}
      </div>
    </aside>,
    document.body,
  );
}
