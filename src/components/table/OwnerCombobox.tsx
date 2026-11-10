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
  /** Further parties the step is drawn for; shown after the owner as "Sales, Legal". */
  coOwnerIds: string[];
  parties: Party[];
  onChange: (partyId: string | null) => void;
  /**
   * Several responsible teams: the first owns the step, the rest are its
   * co-owners, and the one row is drawn in every one of their lanes. Entered
   * as "Sales, Legal" or via the "Also X" option. One id alone clears the
   * co-owners.
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
  coOwnerIds,
  parties,
  onChange,
  onAssign,
  onCreateParty,
  ariaLabel,
}: Props) {
  const current = parties.find((p) => p.id === value) ?? null;
  const coOwners = useMemo(
    () =>
      current
        ? coOwnerIds
            .filter((id) => id !== current.id)
            .map((id) => parties.find((p) => p.id === id))
            .filter((p): p is Party => !!p)
        : [],
    [coOwnerIds, current, parties],
  );
  // What the cell shows when not being edited: every party, owner first.
  const settled = current ? [current, ...coOwners].map((p) => p.name).join(", ") : "";
  // null = "not editing": show the settled text.
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const query = draft ?? settled;
  const [open, setOpenRaw] = useState(false);
  const [activeOverride, setActiveOverride] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);

  // Until the user types, the list is the registry around the owner, not a search for "Sales, Legal".
  const base = usePartyPicker(editing ? query : (current?.name ?? ""), parties, {
    allowClear: true,
  });
  const { items, defaultIndex } = useMemo(() => {
    const parts = editing ? splitOwnerQuery(query) : [];
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
    if (coOwners.some((p) => p.id === m.party.id)) return base;
    // Offer to share with the matched party, just after the party entries.
    const at = base.items.findIndex((i) => i.kind === "create" || i.kind === "clear");
    const idx = at < 0 ? base.items.length : at;
    const list = [...base.items];
    list.splice(idx, 0, { kind: "share", party: m.party });
    return {
      items: list,
      defaultIndex: base.defaultIndex >= idx ? base.defaultIndex + 1 : base.defaultIndex,
    };
  }, [base, coOwners, current, editing, parties, query]);

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

  const shared = coOwners.length > 0;
  const commit = useCallback(
    (item: PickerItem | undefined) => {
      if (!item) {
        if (query.trim() === "") onChange(null);
      } else if (item.kind === "party") {
        if (item.party.id !== current?.id) {
          // Another party replaces the whole group.
          if (shared) onAssign([item.party.id]);
          else onChange(item.party.id);
        } else if (shared && editing && query.trim() !== settled) {
          // Typing just the owner's name again drops the co-owners; merely
          // opening the list and confirming the owner changes nothing.
          onAssign([item.party.id]);
        }
      } else if (item.kind === "create") {
        const id = onCreateParty(item.name);
        if (shared) onAssign([id]);
        else onChange(id);
      } else if (item.kind === "share") {
        onAssign([current!.id, ...coOwners.map((p) => p.id), item.party.id]);
      } else if (item.kind === "multi") {
        onAssign(item.parts.map((p) => p.party?.id ?? onCreateParty(p.name)));
      } else onChange(null);
      setOpen(false);
    },
    [coOwners, current, editing, onAssign, onChange, onCreateParty, query, settled, shared],
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
      if (open && query.trim() !== settled) commit(items[active]);
      else setOpen(false);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const onBlur = () => {
    if (!open) return;
    if (query.trim() !== settled) commit(items[active]);
    else setOpen(false);
  };

  return (
    <div ref={setAnchor} className="flex h-full items-center gap-1.5 pl-2">
      <span className="flex shrink-0 items-center gap-0.5">
        <PartySwatch party={current} />
        {coOwners.map((p) => (
          <PartySwatch key={p.id} party={p} />
        ))}
      </span>
      <input
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        className="cell-input pl-0"
        value={query}
        placeholder="Unassigned"
        title="One team, or several separated by commas: the first owns the step and the rest also do it, so the one row is drawn in each of their lanes."
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
