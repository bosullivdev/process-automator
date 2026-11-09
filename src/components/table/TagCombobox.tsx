import { useCallback, useRef, useState, type ReactNode } from "react";
import { Popover } from "../ui/Popover";
import { PartyList } from "./PartyList";
import { usePartyPicker, type Named, type PickerItem } from "./usePartyPicker";

interface Props<T extends Named> {
  value: string[];
  options: T[];
  onChange: (ids: string[]) => void;
  onCreate: (name: string) => string;
  ariaLabel: string;
  /** Shown in the input while nothing is selected. */
  placeholder: string;
  /** Icon before each chip and list entry. */
  swatch: (item: T | undefined | null, size?: number) => ReactNode;
  noun: string;
  /** Chip text for an id that is not in the registry. */
  unknownLabel: string;
}

/** Multi-select combobox over a registry of named things, shown as removable chips. */
export function TagCombobox<T extends Named>({
  value,
  options,
  onChange,
  onCreate,
  ariaLabel,
  placeholder,
  swatch,
  noun,
  unknownLabel,
}: Props<T>) {
  const [query, setQueryRaw] = useState("");
  const [open, setOpen] = useState(false);
  const [activeOverride, setActiveOverride] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { items, defaultIndex } = usePartyPicker(query, options, {
    allowClear: false,
    exclude: value,
  });
  const active = activeOverride ?? (defaultIndex < 0 && items.length ? 0 : defaultIndex);
  const setActive = (fn: number | ((a: number) => number)) =>
    setActiveOverride(typeof fn === "function" ? fn(active) : fn);
  const setQuery = (q: string) => {
    setQueryRaw(q);
    setActiveOverride(null);
  };

  const add = useCallback(
    (item: PickerItem<T> | undefined) => {
      if (!item) return;
      let id: string | null = null;
      if (item.kind === "party") id = item.party.id;
      else if (item.kind === "create") id = onCreate(item.name);
      if (id && !value.includes(id)) onChange([...value, id]);
      setQuery("");
      inputRef.current?.focus();
    },
    [onChange, onCreate, value],
  );

  const remove = (id: string) => onChange(value.filter((v) => v !== id));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => (a + 1) % Math.max(1, items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (open && items.length) add(items[active]);
      else setOpen(true);
    } else if (e.key === "Backspace" && query === "" && value.length) {
      remove(value[value.length - 1]);
    } else if (e.key === "Tab") {
      if (open && query.trim()) add(items[active]);
      setOpen(false);
    } else if (e.key === "Escape") {
      setQuery("");
      setOpen(false);
    }
  };

  return (
    <div
      ref={setAnchor}
      className="flex h-full min-w-0 flex-wrap items-center gap-1 px-1.5 py-0.5"
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((id) => {
        const p = options.find((x) => x.id === id);
        return (
          <span
            key={id}
            className="inline-flex h-5 max-w-[140px] items-center gap-1 rounded-md border px-1.5 text-xs"
            style={{ borderColor: p ? "var(--border)" : "var(--color-danger)" }}
          >
            {swatch(p, 8)}
            <span className="truncate">{p?.name ?? unknownLabel}</span>
            <button
              type="button"
              aria-label={`Remove ${p?.name ?? noun}`}
              className="ml-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text)]"
              onClick={(e) => {
                e.stopPropagation();
                remove(id);
              }}
            >
              ×
            </button>
          </span>
        );
      })}
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        className="cell-input h-6 min-w-[60px] flex-1 px-1"
        value={query}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (open && query.trim()) add(items[active]);
          setOpen(false);
        }}
        onKeyDown={onKeyDown}
      />
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)}>
        <PartyList
          items={items}
          active={active}
          onPick={add}
          onHover={setActive}
          swatch={swatch}
          noun={noun}
        />
      </Popover>
    </div>
  );
}
