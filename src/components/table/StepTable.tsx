import { useCallback, useEffect, useMemo, useRef } from "react";
import type { NextLink, Process, Step } from "../../model/types";
import type { Flag } from "../../model/validate";
import { worstSeverity } from "../../model/validate";
import { stepVariant, useStore, type StepVariant } from "../../store/workspace";
import { OwnerCombobox } from "./OwnerCombobox";
import { ContributorsCombobox } from "./ContributorsCombobox";
import { NextPicker } from "./NextPicker";
import { Tooltip } from "../ui/Tooltip";
import { toast } from "../ui/toast";

interface Props {
  process: Process;
  flags: Map<string, Flag[]>;
}

export function StepTable({ process, flags }: Props) {
  const parties = useStore((s) => s.parties);
  const selectedStepId = useStore((s) => s.selectedStepId);
  const selectStep = useStore((s) => s.selectStep);
  const addStep = useStore((s) => s.addStep);
  const updateStep = useStore((s) => s.updateStep);
  const setStepVariant = useStore((s) => s.setStepVariant);
  const setStepOwner = useStore((s) => s.setStepOwner);
  const setStepNext = useStore((s) => s.setStepNext);
  const deleteStep = useStore((s) => s.deleteStep);
  const duplicateStep = useStore((s) => s.duplicateStep);
  const restoreStep = useStore((s) => s.restoreStep);
  const addParty = useStore((s) => s.addParty);

  const nameRefs = useRef(new Map<string, HTMLInputElement>());
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const pendingFocus = useRef<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

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
      const id = addStep(process.id, { afterStepId, partial });
      pendingFocus.current = id;
      selectStep(id);
      return id;
    },
    [addStep, process.id, selectStep],
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
      remove(step);
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

  return (
    <div ref={tableRef} className="h-full overflow-auto" data-testid="step-table">
      <table className="w-full min-w-[1180px] table-fixed border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10" style={{ background: "var(--surface)" }}>
          <tr className="text-left text-xs font-medium text-[var(--text-muted)]">
            <Th className="w-14">No</Th>
            <Th className="w-[22%]">Name</Th>
            <Th className="w-[13%]">Owner</Th>
            <Th className="w-[168px]">Type</Th>
            <Th className="w-[19%]">Next</Th>
            <Th className="w-[11%]">Technology</Th>
            <Th className="w-[13%]">Contributors</Th>
            <Th>Notes</Th>
            <Th className="w-9"> </Th>
          </tr>
        </thead>
        <tbody>
          {process.steps.map((step) => {
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
                className="group"
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
                    step={step}
                    steps={process.steps}
                    brokenTargets={brokenByStep.get(step.id) ?? emptySet}
                    onChange={(next: NextLink[]) => setStepNext(process.id, step.id, next)}
                    onCreateStep={() => {
                      const id = addAfter(step.id, { ownerId: step.ownerId });
                      const link: NextLink =
                        step.type === "decision" ? { targetId: id, label: "" } : { targetId: id };
                      setStepNext(process.id, step.id, [...step.next, link]);
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
                  <input
                    className="cell-input"
                    aria-label="Notes"
                    value={step.notes}
                    onChange={(e) => updateStep(process.id, step.id, { notes: e.target.value })}
                    onKeyDown={(e) => onTextKeyDown(e, step)}
                  />
                </Td>
                <Td>
                  <button
                    type="button"
                    aria-label={`Delete step ${step.displayNo}`}
                    className="btn btn-ghost btn-icon h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => remove(step)}
                  >
                    ×
                  </button>
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
        {process.steps.length === 0 && (
          <p className="mt-2 px-1 text-xs text-[var(--text-muted)]">
            Add a step, then press Enter to add the next one. Use the Next column to link steps.
          </p>
        )}
      </div>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`h-8 border-b px-2 font-medium ${className}`}
      style={{ borderColor: "var(--border)" }}
    >
      {children}
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
