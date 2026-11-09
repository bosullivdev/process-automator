import { useMemo } from "react";
import type { Party } from "../../model/types";
import { matchParty, normaliseName } from "../../model/party";

/** One team name typed into a multi-owner entry and the party it resolves to (null = create). */
export interface OwnerPart {
  name: string;
  party: Party | null;
}

export type PickerItem =
  | { kind: "party"; party: Party; near?: boolean }
  | { kind: "create"; name: string }
  | { kind: "clear" }
  /** Owner only: copy this step into another party's lane as well. */
  | { kind: "share"; party: Party }
  /** Owner only: several teams typed at once; the first owns, the rest get copies. */
  | { kind: "multi"; parts: OwnerPart[] };

/**
 * Builds the dropdown list for an owner/contributor combobox from the typed
 * query, and chooses the default highlight: exact match > "Use X?" near match
 * > create new. Parties already excluded (e.g. chosen contributors) are hidden.
 */
export function usePartyPicker(
  query: string,
  parties: readonly Party[],
  opts: { allowClear: boolean; exclude?: readonly string[] },
): { items: PickerItem[]; defaultIndex: number } {
  return useMemo(() => {
    const q = normaliseName(query);
    const exclude = new Set(opts.exclude ?? []);
    const visible = parties.filter((p) => !exclude.has(p.id));
    const filtered = q ? visible.filter((p) => normaliseName(p.name).includes(q)) : visible;
    const match = matchParty(query, visible);
    const items: PickerItem[] = [];
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
