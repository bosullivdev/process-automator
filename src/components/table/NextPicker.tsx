import { useMemo, useState } from "react";
import type { NextLink, Step } from "../../model/types";
import { Popover } from "../ui/Popover";

interface Props {
  step: Step;
  steps: Step[];
  onChange: (next: NextLink[]) => void;
  onCreateStep: () => void;
  brokenTargets: Set<string>;
}

type Item = { kind: "step"; step: Step } | { kind: "create" };

export function NextPicker({ step, steps, onChange, onCreateStep, brokenTargets }: Props) {
  const [open, setOpenRaw] = useState(false);
  const [query, setQueryRaw] = useState("");
  const [activeOverride, setActiveOverride] = useState<number | null>(null);
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const active = activeOverride ?? 0;
  const setActive = (fn: number | ((a: number) => number)) =>
    setActiveOverride(typeof fn === "function" ? fn(active) : fn);
  const setQuery = (q: string) => {
    setQueryRaw(q);
    setActiveOverride(null);
  };
  const setOpen = (o: boolean) => {
    setOpenRaw(o);
    if (!o) {
      setQueryRaw("");
      setActiveOverride(null);
    }
  };
  const disabled = step.type === "end";
  const isDecision = step.type === "decision";

  const byId = useMemo(() => new Map(steps.map((s) => [s.id, s])), [steps]);
  const items: Item[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = steps
      .filter((s) => s.id !== step.id)
      .filter((s) => !q || `${s.displayNo}: ${s.name}`.toLowerCase().includes(q))
      .sort((a, b) => a.displayNo - b.displayNo)
      .map((s): Item => ({ kind: "step", step: s }));
    return [...list, { kind: "create" }];
  }, [steps, step.id, query]);

  const selected = (id: string) => step.next.some((l) => l.targetId === id);
  const toggle = (id: string) => {
    if (id === step.id) return;
    if (selected(id)) onChange(step.next.filter((l) => l.targetId !== id));
    else onChange([...step.next, isDecision ? { targetId: id, label: "" } : { targetId: id }]);
  };
  const setLabel = (id: string, label: string) =>
    onChange(step.next.map((l) => (l.targetId === id ? { ...l, label } : l)));
  const setDefault = (id: string, isDefault: boolean) =>
    onChange(
      step.next.map((l) =>
        l.targetId === id
          ? { ...l, isDefault: isDefault || undefined }
          : { ...l, isDefault: undefined },
      ),
    );
  const pick = (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === "create") {
      setOpen(false);
      onCreateStep();
    } else toggle(item.step.id);
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      pick(items[active]);
    } else if (e.key === "Tab" && !isDecision) {
      setOpen(false);
    }
  };

  const onButtonKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      setOpen(true);
      setQuery(e.key);
      e.preventDefault();
    }
  };

  const summary = step.next.map((l) => {
    const t = byId.get(l.targetId);
    const broken = !t || brokenTargets.has(l.targetId);
    return { link: l, target: t, broken };
  });

  return (
    <div className="flex h-full min-w-0 items-center px-1">
      <button
        ref={setButton}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Next steps"
        className="flex h-7 w-full min-w-0 flex-wrap items-center gap-1 rounded px-1 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => setOpen(true)}
        onKeyDown={onButtonKey}
      >
        {disabled && <span className="text-xs text-[var(--text-muted)]">—</span>}
        {!disabled && summary.length === 0 && (
          <span className="text-xs text-[var(--text-muted)]">Pick…</span>
        )}
        {summary.map(({ link, target, broken }) => (
          <span
            key={link.targetId}
            className="inline-flex h-5 max-w-[150px] items-center gap-1 rounded-md border px-1.5 text-xs"
            style={{
              borderColor: broken ? "var(--color-danger)" : "var(--border)",
              color: broken ? "var(--color-danger)" : undefined,
            }}
          >
            {broken ? (
              <span className="truncate">missing</span>
            ) : (
              <>
                <span className="font-mono font-tabular text-[var(--text-muted)]">
                  {target!.displayNo}
                </span>
                <span className="truncate">{target!.name || "Untitled"}</span>
              </>
            )}
            {isDecision && !broken && (
              <span className="truncate rounded bg-[var(--surface-2)] px-1 italic">
                {link.label || "label?"}
              </span>
            )}
            {broken && (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Remove broken link"
                className="ml-0.5 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(step.next.filter((l) => l.targetId !== link.targetId));
                }}
              >
                ×
              </span>
            )}
          </span>
        ))}
      </button>
      <Popover anchor={button} open={open} onClose={() => setOpen(false)} width={340}>
        <div className="flex flex-col gap-1">
          <input
            autoFocus
            className="input h-7"
            placeholder="Search steps…"
            aria-label="Search steps"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
          {isDecision && step.next.length > 0 && (
            <div
              className="flex flex-col gap-1 border-b pb-1"
              style={{ borderColor: "var(--border)" }}
            >
              <div className="px-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                Outcomes
              </div>
              {step.next.map((l) => {
                const t = byId.get(l.targetId);
                return (
                  <div key={l.targetId} className="flex items-center gap-1 px-1">
                    <span className="w-16 shrink-0 truncate text-xs">
                      {t ? `${t.displayNo}: ${t.name || "Untitled"}` : "missing"}
                    </span>
                    <input
                      className="input h-6 flex-1 text-xs"
                      placeholder="Label"
                      aria-label={`Label for outcome to step ${t?.displayNo ?? "?"}`}
                      value={l.label ?? ""}
                      onChange={(e) => setLabel(l.targetId, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          setOpen(false);
                          button?.focus();
                        }
                      }}
                    />
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={!!l.isDefault}
                        onChange={(e) => setDefault(l.targetId, e.target.checked)}
                        aria-label="Default outcome"
                      />
                      default
                    </label>
                  </div>
                );
              })}
            </div>
          )}
          <ul role="listbox" aria-multiselectable className="flex flex-col">
            {items.map((item, i) => (
              <li
                key={item.kind === "step" ? item.step.id : "create"}
                role="option"
                aria-selected={item.kind === "step" ? selected(item.step.id) : false}
                data-active={i === active}
                className="menu-item"
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(item);
                }}
              >
                {item.kind === "step" ? (
                  <>
                    <input
                      type="checkbox"
                      readOnly
                      tabIndex={-1}
                      checked={selected(item.step.id)}
                    />
                    <span className="font-mono font-tabular text-xs text-[var(--text-muted)]">
                      {item.step.displayNo}
                    </span>
                    <span className="truncate">{item.step.name || "Untitled"}</span>
                    <span className="ml-auto text-[10px] uppercase text-[var(--text-muted)]">
                      {item.step.type}
                    </span>
                  </>
                ) : (
                  <span className="text-[var(--color-accent)]">+ Create new step</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Popover>
    </div>
  );
}
