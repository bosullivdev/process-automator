import { useCallback, useState } from "react";
import type { Party } from "../../model/types";
import { Popover } from "../ui/Popover";
import { PartySwatch } from "../ui/PartySwatch";
import { PartyList } from "./PartyList";
import { usePartyPicker, type PickerItem } from "./usePartyPicker";

interface Props {
  value: string | null;
  parties: Party[];
  onChange: (partyId: string | null) => void;
  onCreateParty: (name: string) => string;
  onEnterRow?: () => void;
  ariaLabel: string;
}

export function OwnerCombobox({ value, parties, onChange, onCreateParty, ariaLabel }: Props) {
  const current = parties.find((p) => p.id === value) ?? null;
  // null = "not editing": show the current party name.
  const [draft, setDraft] = useState<string | null>(null);
  const query = draft ?? current?.name ?? "";
  const [open, setOpenRaw] = useState(false);
  const [activeOverride, setActiveOverride] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);

  const { items, defaultIndex } = usePartyPicker(query, parties, { allowClear: true });
  const active = activeOverride ?? defaultIndex;
  const setActive = (fn: number | ((a: number) => number)) =>
    setActiveOverride(typeof fn === "function" ? fn(active) : fn);
  const setQuery = (q: string) => {
    setDraft(q);
    setActiveOverride(null);
  };
  const setOpen = (o: boolean) => {
    setOpenRaw(o);
    if (!o) {
      setDraft(null);
      setActiveOverride(null);
    }
  };

  const commit = useCallback(
    (item: PickerItem | undefined) => {
      if (!item) {
        if (query.trim() === "") onChange(null);
      } else if (item.kind === "party") onChange(item.party.id);
      else if (item.kind === "create") onChange(onCreateParty(item.name));
      else onChange(null);
      setOpen(false);
    },
    [onChange, onCreateParty, query],
  );

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
      if (open) commit(items[active]);
      else setOpen(true);
    } else if (e.key === "Tab") {
      if (open && query.trim() !== (current?.name ?? "")) commit(items[active]);
      else setOpen(false);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const onBlur = () => {
    if (!open) return;
    if (query.trim() !== (current?.name ?? "").trim()) commit(items[active]);
    else setOpen(false);
  };

  return (
    <div ref={setAnchor} className="flex h-full items-center gap-1.5 pl-2">
      <PartySwatch party={current} />
      <input
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        className="cell-input pl-0"
        value={query}
        placeholder="Unassigned"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)}>
        <PartyList items={items} active={active} onPick={commit} onHover={setActive} />
      </Popover>
    </div>
  );
}
