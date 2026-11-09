import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NextLink, Process, Step } from "../../model/types";
import type { Flag } from "../../model/validate";
import { worstSeverity } from "../../model/validate";
import { stepVariant, undo, useStore, type StepVariant } from "../../store/workspace";
import { OwnerCombobox } from "./OwnerCombobox";
import { ContributorsCombobox } from "./ContributorsCombobox";
import { TeamsCombobox } from "./TeamsCombobox";
import { linkInTeam, scopeWithout, type TeamFocus } from "../../model/team";
import { Popover } from "../ui/Popover";
import { NextPicker } from "./NextPicker";
import { Tooltip } from "../ui/Tooltip";
import { toast } from "../ui/toast";
import { readingOrder } from "../../graph/reading-order";
import { COLUMNS, useColumnWidths, type ColumnKey } from "./useColumnWidths";

interface Props {
  process: Process;
  flags: Map<string, Flag[]>;
  focus: TeamFocus | null;
}

export function StepTable({ process, flags, focus }: Props) {
  const parties = useStore((s) => s.parties);
  const teams = useStore((s) => s.teams);
  const setStepTeams = useStore((s) => s.setStepTeams);
  const addTeam = useStore((s) => s.addTeam);
  const setStepNextForTeam = useStore((s) => s.setStepNextForTeam);
  const removeStepFromTeam = useStore((s) => s.removeStepFromTeam);
  const forkStepForTeam = useStore((s) => s.forkStepForTeam);
  // In "only this team" mode every edit to links and rows affects that team's route alone.
  const isolate = focus?.mode === "isolate" ? focus : null;
  const isolateTeam = isolate ? teams.find((t) => t.id === isolate.teamId) : undefined;
  const allTeamIds = useMemo(() => teams.map((t) => t.id), [teams]);
  const routeSteps = useMemo(
    () => (isolate ? process.steps.filter((s) => isolate.view.stepIds.has(s.id)) : process.steps),
    [isolate, process.steps],
  );
  /** The links of a step as the isolated team sees them. */
  const visibleNext = (step: Step): NextLink[] =>
    isolate
      ? step.next.filter(
          (l) => linkInTeam(l, isolate.teamId) && isolate.view.stepIds.has(l.targetId),
        )
      : step.next;
  const changeNext = (step: Step, next: NextLink[]) =>
    isolate
      ? setStepNextForTeam(process.id, step.id, next, isolate.teamId)
      : setStepNext(process.id, step.id, next);
  /** Whether other teams also use this step, so the isolated team can leave it rather than delete it. */
  const sharedWithOthers = (step: Step) =>
    !!isolate && scopeWithout(step.teamIds, isolate.teamId, allTeamIds) !== null;
  const selectedStepId = useStore((s) => s.selectedStepId);
  const selectStep = useStore((s) => s.selectStep);
  const addStep = useStore((s) => s.addStep);
  const updateStep = useStore((s) => s.updateStep);
  const setStepVariant = useStore((s) => s.setStepVariant);
  const setStepOwner = useStore((s) => s.setStepOwner);
  const assignOwners = useStore((s) => s.assignOwners);
  const setStepNext = useStore((s) => s.setStepNext);
  const deleteStep = useStore((s) => s.deleteStep);
  const duplicateStep = useStore((s) => s.duplicateStep);
  const restoreStep = useStore((s) => s.restoreStep);
  const reorderSteps = useStore((s) => s.reorderSteps);
  const addParty = useStore((s) => s.addParty);

  const nameRefs = useRef(new Map<string, HTMLInputElement>());
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const pendingFocus = useRef<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const { widths, setWidth, resetWidth } = useColumnWidths();
  // The Notes column stretches so the table fills the pane when the others are narrow.
  const [paneWidth, setPaneWidth] = useState(0);
  useEffect(() => {
    const el = tableRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setPaneWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fixedTotal = COLUMNS.reduce((sum, c) => sum + (c.key === "notes" ? 0 : widths[c.key]), 0);
  const notesWidth = Math.max(widths.notes, paneWidth - fixedTotal);
  const colWidth = (key: ColumnKey) => (key === "notes" ? notesWidth : widths[key]);
  const tableWidth = fixedTotal + notesWidth;

  useEffect(() => {
    if (!pendingFocus.current) return;
    const el = nameRefs.current.get(pendingFocus.current);
    if (el) {
      el.focus();
      pendingFocus.current = null;
    }
  });

  // When the selection comes from the map, scroll the row into view.
  useEffect(() => {
    if (!selectedStepId) return;
    const row = rowRefs.current.get(selectedStepId);
    if (row && !row.contains(document.activeElement)) {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [selectedStepId]);

  const addAfter = useCallback(
    (afterStepId?: string, partial?: Partial<Step>) => {
      // A row added while one team's variant is shown alone belongs to that team.
      const scoped =
        focus?.mode === "isolate" && !partial?.teamIds
          ? { ...partial, teamIds: [focus.teamId] }
          : partial;
      const id = addStep(process.id, { afterStepId, partial: scoped });
      pendingFocus.current = id;
      selectStep(id);
      return id;
    },
    [addStep, focus, process.id, selectStep],
  );

  const remove = useCallback(
    (step: Step) => {
      const index = process.steps.findIndex((s) => s.id === step.id);
      deleteStep(process.id, step.id);
      toast(`Deleted step ${step.displayNo}${step.name ? ` "${step.name}"` : ""}`, {
        label: "Undo",
        onClick: () => restoreStep(process.id, step, index),
      });
    },
    [deleteStep, process.id, process.steps, restoreStep],
  );

  /** Take the step off the isolated team's route; other teams keep it. */
  const leaveTeam = (step: Step) => {
    if (!isolate || !isolateTeam) return;
    removeStepFromTeam(process.id, step.id, isolate.teamId);
    toast(
      `Step ${step.displayNo} is no longer on ${isolateTeam.name}'s route. Other teams keep it.`,
      { label: "Undo", onClick: () => undo() },
    );
  };

  /** Give the isolated team its own copy of a shared step. */
  const forkForTeam = (step: Step) => {
    if (!isolate || !isolateTeam) return;
    const id = forkStepForTeam(process.id, step.id, isolate.teamId);
    if (!id) return;
    pendingFocus.current = id;
    selectStep(id);
    toast(`Step ${step.displayNo} is now ${isolateTeam.name}'s own copy; edit it freely.`, {
      label: "Undo",
      onClick: () => undo(),
    });
  };

  /** Delete, or in an isolated view with other teams on the step, just leave the route. */
  const removeOrLeave = (step: Step) => (sharedWithOthers(step) ? leaveTeam(step) : remove(step));

  const onRowKeyDown = (e: React.KeyboardEvent, step: Step) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      const id = duplicateStep(process.id, step.id);
      if (id) {
        pendingFocus.current = id;
        selectStep(id);
      }
    }
  };

  const onTextKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, step: Step) => {
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      addAfter(step.id, { ownerId: step.ownerId });
    }
  };

  const onNoKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, step: Step) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeOrLeave(step);
    }
  };

  const brokenByStep = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const [stepId, list] of flags) {
      const set = new Set<string>();
      for (const f of list) if (f.code === "broken-link" && f.targetId) set.add(f.targetId);
      if (set.size) m.set(stepId, set);
    }
    return m;
  }, [flags]);
  const emptySet = useMemo(() => new Set<string>(), []);

  const createParty = useCallback((name: string) => addParty(name), [addParty]);
  const createTeam = useCallback((name: string) => addTeam(name), [addTeam]);

  const assign = useCallback(
    (step: Step, partyIds: string[]) => {
      const copyIds = assignOwners(process.id, step.id, partyIds);
      if (copyIds.length === 0) return;
      const proc = useStore.getState().processes.find((p) => p.id === process.id);
      const names = useStore.getState().parties;
      const where = copyIds
        .map((id) => proc?.steps.find((s) => s.id === id))
        .filter((s): s is Step => !!s)
        .map((s) => `${names.find((p) => p.id === s.ownerId)?.name ?? "?"} (step ${s.displayNo})`)
        .join(", ");
      toast(`Copied step ${step.displayNo} to ${where}, with the same links.`, {
        label: "Undo",
        onClick: () => undo(),
      });
    },
    [assignOwners, process.id],
  );

  return (
    <div ref={tableRef} className="h-full overflow-auto" data-testid="step-table">
      <table
        className="table-fixed border-separate border-spacing-0 text-sm"
        style={{ width: tableWidth }}
      >
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.key} style={{ width: colWidth(c.key) }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-10" style={{ background: "var(--surface)" }}>
          <tr className="text-left text-xs font-medium text-[var(--text-muted)]">
            {COLUMNS.map((c) => (
              <Th
                key={c.key}
                label={c.label}
                width={colWidth(c.key)}
                onResize={c.fixed ? undefined : (w) => setWidth(c.key, w)}
                onReset={c.fixed ? undefined : () => resetWidth(c.key)}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {process.steps.map((step) => {
            const inTeam = !focus || focus.view.stepIds.has(step.id);
            if (focus?.mode === "isolate" && !inTeam) return null;
            const stepFlags = flags.get(step.id);
            const sev = worstSeverity(stepFlags);
            const selected = step.id === selectedStepId;
            return (
              <tr
                key={step.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(step.id, el);
                  else rowRefs.current.delete(step.id);
                }}
                data-step-id={step.id}
                data-selected={selected}
                data-in-team={focus ? inTeam : undefined}
                className={inTeam ? "group" : "group opacity-40"}
                style={{ background: selected ? "var(--selection)" : undefined }}
                onFocus={() => {
                  if (selectedStepId !== step.id) selectStep(step.id);
                }}
                onClick={() => {
                  if (selectedStepId !== step.id) selectStep(step.id);
                }}
                onKeyDown={(e) => onRowKeyDown(e, step)}
              >
                <Td>
                  <Tooltip
                    content={
                      stepFlags && stepFlags.length ? (
                        <ul className="flex flex-col gap-0.5">
                          {stepFlags.map((f, i) => (
                            <li key={i}>{f.message}</li>
                          ))}
                        </ul>
                      ) : null
                    }
                    className="flex h-full w-full"
                  >
                    <button
                      type="button"
                      aria-label={`Step ${step.displayNo}${sev ? `, has ${sev}s` : ""}. Press Delete to remove.`}
                      className="flex h-full w-full items-center gap-1 px-2 font-mono font-tabular text-xs text-[var(--text-muted)]"
                      onKeyDown={(e) => onNoKeyDown(e, step)}
                    >
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background:
                            sev === "error"
                              ? "var(--color-danger)"
                              : sev === "warning"
                                ? "var(--color-warn)"
                                : "transparent",
                        }}
                      />
                      {step.displayNo}
                    </button>
                  </Tooltip>
                </Td>
                <Td>
                  <input
                    ref={(el) => {
                      if (el) nameRefs.current.set(step.id, el);
                      else nameRefs.current.delete(step.id);
                    }}
                    className="cell-input"
                    aria-label="Step name"
                    placeholder="Step name"
                    value={step.name}
                    onChange={(e) => updateStep(process.id, step.id, { name: e.target.value })}
                    onKeyDown={(e) => onTextKeyDown(e, step)}
                  />
                </Td>
                <Td>
                  <OwnerCombobox
                    value={step.ownerId}
                    parties={parties}
                    onChange={(id) => setStepOwner(process.id, step.id, id)}
                    onAssign={(ids) => assign(step, ids)}
                    onCreateParty={createParty}
                    ariaLabel="Owner"
                  />
                </Td>
                <Td>
                  <select
                    className="cell-input h-8 px-2"
                    aria-label="Step type"
                    value={stepVariant(step)}
                    onChange={(e) =>
                      setStepVariant(process.id, step.id, e.target.value as StepVariant)
                    }
                  >
                    <optgroup label="Start">
                      <option value="start">start</option>
                      <option value="start:message">start · message</option>
                      <option value="start:timer">start · timer</option>
                    </optgroup>
                    <optgroup label="Task">
                      <option value="task">task</option>
                      <option value="task:sub">task · sub-process</option>
                    </optgroup>
                    <optgroup label="Decision">
                      <option value="decision">decision</option>
                    </optgroup>
                    <optgroup label="End">
                      <option value="end">end</option>
                      <option value="end:terminate">end · terminate</option>
                    </optgroup>
                  </select>
                </Td>
                <Td>
                  <NextPicker
                    step={isolate ? { ...step, next: visibleNext(step) } : step}
                    steps={routeSteps}
                    teams={teams}
                    brokenTargets={brokenByStep.get(step.id) ?? emptySet}
                    onChange={(next: NextLink[]) => changeNext(step, next)}
                    onCreateStep={() => {
                      const id = addAfter(step.id, { ownerId: step.ownerId });
                      const link: NextLink =
                        step.type === "decision" ? { targetId: id, label: "" } : { targetId: id };
                      changeNext(step, [...visibleNext(step), link]);
                    }}
                  />
                </Td>
                <Td>
                  <input
                    className="cell-input"
                    aria-label="Technology"
                    value={step.technology}
                    onChange={(e) =>
                      updateStep(process.id, step.id, { technology: e.target.value })
                    }
                    onKeyDown={(e) => onTextKeyDown(e, step)}
                  />
                </Td>
                <Td>
                  <ContributorsCombobox
                    value={step.contributorIds}
                    parties={parties}
                    onChange={(ids) => updateStep(process.id, step.id, { contributorIds: ids })}
                    onCreateParty={createParty}
                    ariaLabel="Contributors"
                  />
                </Td>
                <Td>
                  <TeamsCombobox
                    value={step.teamIds}
                    teams={teams}
                    onChange={(ids) => setStepTeams(process.id, step.id, ids)}
                    onCreateTeam={createTeam}
                    ariaLabel="Teams"
                  />
                </Td>
                <Td>
                  <input
                    className="cell-input"
                    aria-label="Notes"
                    value={step.notes}
                    onChange={(e) => updateStep(process.id, step.id, { notes: e.target.value })}
                    onKeyDown={(e) => onTextKeyDown(e, step)}
                  />
                </Td>
                <Td>
                  <div className="flex items-center justify-end gap-0.5 pr-1">
                    {isolate && isolateTeam && (
                      <RowMenu
                        step={step}
                        teamName={isolateTeam.name}
                        shared={sharedWithOthers(step)}
                        onLeave={() => leaveTeam(step)}
                        onFork={() => forkForTeam(step)}
                        onDelete={() => remove(step)}
                      />
                    )}
                    <button
                      type="button"
                      aria-label={
                        isolate && isolateTeam && sharedWithOthers(step)
                          ? `Remove step ${step.displayNo} from ${isolateTeam.name}'s route`
                          : `Delete step ${step.displayNo}`
                      }
                      title={
                        isolate && isolateTeam && sharedWithOthers(step)
                          ? `Not for ${isolateTeam.name}: other teams keep this step`
                          : "Delete step"
                      }
                      className="btn btn-ghost btn-icon h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => removeOrLeave(step)}
                    >
                      ×
                    </button>
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="p-2">
        <button
          type="button"
          className="btn"
          onClick={() => addAfter(undefined)}
          data-testid="add-step"
        >
          + Add step
        </button>
        {process.steps.length > 1 && (
          <button
            type="button"
            className="btn btn-ghost ml-2"
            title="Reorder rows to follow the flow from the start, one branch at a time"
            onClick={() => {
              reorderSteps(process.id, readingOrder(process));
              toast("Rows reordered to follow the flow.");
            }}
          >
            Sort by flow
          </button>
        )}
        {process.steps.length === 0 && (
          <p className="mt-2 px-1 text-xs text-[var(--text-muted)]">
            Add a step, then press Enter to add the next one. Use the Next column to link steps.
          </p>
        )}
      </div>
    </div>
  );
}

/** Per-row actions available while one team's route is shown alone. */
function RowMenu({
  step,
  teamName,
  shared,
  onLeave,
  onFork,
  onDelete,
}: {
  step: Step;
  teamName: string;
  shared: boolean;
  onLeave: () => void;
  onFork: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Team actions for step ${step.displayNo}`}
        title={`What ${teamName} does with this step`}
        className="btn btn-ghost btn-icon h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={260}>
        <div role="menu" className="flex flex-col">
          {shared ? (
            <>
              <button role="menuitem" className="menu-item" onClick={() => pick(onLeave)}>
                <span className="flex flex-col leading-tight">
                  <span>Not for {teamName}</span>
                  <span className="text-xs text-[var(--text-muted)]">
                    Skip this step; arrows reconnect around it
                  </span>
                </span>
              </button>
              <button role="menuitem" className="menu-item" onClick={() => pick(onFork)}>
                <span className="flex flex-col leading-tight">
                  <span>Make a {teamName} copy</span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {teamName} gets its own version to edit
                  </span>
                </span>
              </button>
            </>
          ) : (
            <div className="px-2 py-1.5 text-xs text-[var(--text-muted)]">
              Only {teamName} uses this step, so edits here affect no other team.
            </div>
          )}
          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          <button role="menuitem" className="menu-item" onClick={() => pick(onDelete)}>
            Delete step for every team
          </button>
        </div>
      </Popover>
    </>
  );
}

const KEY_STEP = 16;

/** Header cell with a drag handle on its right edge. Arrow keys resize too; Enter resets. */
function Th({
  label,
  width,
  onResize,
  onReset,
}: {
  label: string;
  width: number;
  onResize?: (width: number) => void;
  onReset?: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; width: number } | null>(null);
  return (
    <th className="relative h-8 border-b px-2 font-medium" style={{ borderColor: "var(--border)" }}>
      <span className="block truncate">{label}</span>
      {onResize && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize column"
          aria-valuenow={Math.round(width)}
          tabIndex={0}
          title={`Resize the ${label} column. Drag, or use the arrow keys; double-click resets.`}
          className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize select-none hover:bg-[var(--color-accent)]/40 focus-visible:bg-[var(--color-accent)]/40"
          style={{ background: dragging ? "var(--color-accent)" : undefined, outline: "none" }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
            start.current = { x: e.clientX, width };
            setDragging(true);
          }}
          onPointerMove={(e) => {
            if (!start.current) return;
            onResize(start.current.width + (e.clientX - start.current.x));
          }}
          onPointerUp={() => {
            start.current = null;
            setDragging(false);
          }}
          onPointerCancel={() => {
            start.current = null;
            setDragging(false);
          }}
          onDoubleClick={() => onReset?.()}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              onResize(width + (e.key === "ArrowLeft" ? -KEY_STEP : KEY_STEP));
            } else if (e.key === "Enter") {
              e.preventDefault();
              onReset?.();
            }
          }}
        />
      )}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="h-10 border-b p-0 align-middle" style={{ borderColor: "var(--border)" }}>
      {children}
    </td>
  );
}
