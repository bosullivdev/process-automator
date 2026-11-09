import { useMemo } from "react";
import type { Party } from "../../model/types";
import { matchParty, normaliseName } from "../../model/party";

/** Anything the picker can offer: parties for owners and contributors, teams for scopes. */
export interface Named {
  id: string;
  name: string;
}

/** One team name typed into a multi-owner entry and the party it resolves to (null = create). */
export interface OwnerPart<T extends Named = Party> {
  name: string;
  party: T | null;
}

export type PickerItem<T extends Named = Party> =
  | { kind: "party"; party: T; near?: boolean }
  | { kind: "create"; name: string }
  | { kind: "clear" }
  /** Owner only: copy this step into another party's lane as well. */
  | { kind: "share"; party: T }
  /** Owner only: several teams typed at once; the first owns, the rest get copies. */
  | { kind: "multi"; parts: OwnerPart<T>[] };

/**
 * Builds the dropdown list for a combobox from the typed query, and chooses
 * the default highlight: exact match > "Use X?" near match > create new.
 * Items already excluded (e.g. chosen contributors) are hidden.
 */
export function usePartyPicker<T extends Named>(
  query: string,
  parties: readonly T[],
  opts: { allowClear: boolean; exclude?: readonly string[] },
): { items: PickerItem<T>[]; defaultIndex: number } {
  return useMemo(() => {
    const q = normaliseName(query);
    const exclude = new Set(opts.exclude ?? []);
    const visible = parties.filter((p) => !exclude.has(p.id));
    const filtered = q ? visible.filter((p) => normaliseName(p.name).includes(q)) : visible;
    const match = matchParty(query, visible);
    const items: PickerItem<T>[] = [];
    let defaultIndex: number;

    if (match.kind === "near" && !filtered.some((p) => p.id === match.party.id)) {
      items.push({ kind: "party", party: match.party, near: true });
    }
    for (const p of filtered) {
      items.push({
        kind: "party",
        party: p,
        near: match.kind === "near" && match.party.id === p.id,
      });
    }
    if (q && match.kind !== "exact") {
      items.push({ kind: "create", name: query.trim() });
    }
    if (opts.allowClear && !q) items.push({ kind: "clear" });

    if (match.kind === "exact") {
      defaultIndex = items.findIndex((i) => i.kind === "party" && i.party.id === match.party.id);
    } else if (match.kind === "near") {
      defaultIndex = items.findIndex((i) => i.kind === "party" && i.party.id === match.party.id);
    } else if (q) {
      defaultIndex = items.findIndex((i) => i.kind === "create");
    } else {
      defaultIndex = -1;
    }
    return { items, defaultIndex: Math.max(-1, defaultIndex) };
  }, [query, parties, opts.allowClear, opts.exclude]);
}
