import { useCallback, useMemo, useState } from "react";
import type { Party } from "../../model/types";
import { matchParty } from "../../model/party";
import { splitOwnerQuery } from "../../model/share";
import { Popover } from "../ui/Popover";
import { PartySwatch } from "../ui/PartySwatch";
import { PartyList } from "./PartyList";
import { usePartyPicker, type OwnerPart, type PickerItem } from "./usePartyPicker";

interface Props {
  value: string | null;
  parties: Party[];
  onChange: (partyId: string | null) => void;
  /**
   * Several responsible teams: the first owns the step, each further one
   * gets a linked copy in its own lane. Entered as "Sales, Legal" or via the
   * "Also X" option.
   */
  onAssign: (partyIds: string[]) => void;
  onCreateParty: (name: string) => string;
  onEnterRow?: () => void;
  ariaLabel: string;
}

/** Resolve a typed team name the way Enter would: exact or near match, else a new party. */
function resolvePart(name: string, parties: readonly Party[]): OwnerPart {
  const m = matchParty(name, parties);
  return { name, party: m.kind === "new" ? null : m.party };
}

export function OwnerCombobox({
  value,
  parties,
  onChange,
  onAssign,
  onCreateParty,
  ariaLabel,
}: Props) {
  const current = parties.find((p) => p.id === value) ?? null;
  // null = "not editing": show the current party name.
  const [draft, setDraft] = useState<string | null>(null);
  const query = draft ?? current?.name ?? "";
  const [open, setOpenRaw] = useState(false);
  const [activeOverride, setActiveOverride] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);

  const base = usePartyPicker(query, parties, { allowClear: true });
  const { items, defaultIndex } = useMemo(() => {
    const parts = splitOwnerQuery(query);
    if (parts.length >= 2) {
      const multi: PickerItem = {
        kind: "multi",
        parts: parts.map((n) => resolvePart(n, parties)),
      };
      return { items: [multi], defaultIndex: 0 };
    }
    if (!current || parts.length === 0) return base;
    const m = matchParty(query, parties);
    if (m.kind === "new" || m.party.id === current.id) return base;
    // Offer to share with the matched party, just after the party entries.
    const at = base.items.findIndex((i) => i.kind === "create" || i.kind === "clear");
    const idx = at < 0 ? base.items.length : at;
    const list = [...base.items];
    list.splice(idx, 0, { kind: "share", party: m.party });
    return {
      items: list,
      defaultIndex: base.defaultIndex >= idx ? base.defaultIndex + 1 : base.defaultIndex,
    };
  }, [base, current, parties, query]);

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
      else if (item.kind === "share") onAssign([current!.id, item.party.id]);
      else if (item.kind === "multi") {
        onAssign(item.parts.map((p) => p.party?.id ?? onCreateParty(p.name)));
      } else onChange(null);
      setOpen(false);
    },
    [current, onAssign, onChange, onCreateParty, query],
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
        title="One team, or several separated by commas: the first owns the step and each other team gets a copy in its own lane."
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
        <PartyList
          items={items}
          active={active}
          onPick={commit}
          onHover={setActive}
          swatch={(p, size) => <PartySwatch party={p} size={size} />}
        />
      </Popover>
    </div>
  );
}
