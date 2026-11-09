import type { Party, Process, Step } from "./types";
import { newId } from "./ids";
import { nextDisplayNo } from "./workspace";
import { normaliseName } from "./party";

/**
 * Characters that separate several team names typed into one Owner cell:
 * "Sales, Legal", "Sales + Legal", "Sales; Legal". Slash and ampersand are
 * not separators because they appear inside single team names ("R&D").
 */
const OWNER_SEPARATOR = /[,;+]/;

/** Split an Owner cell entry into distinct, non-empty team names. */
export function splitOwnerQuery(query: string): string[] {
  if (!OWNER_SEPARATOR.test(query)) {
    const one = query.trim();
    return one ? [one] : [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of query.split(OWNER_SEPARATOR)) {
    const name = raw.trim();
    const key = normaliseName(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export interface AssignOwnersResult {
  process: Process;
  /** IDs of the steps created, one per extra party, in the order given. */
  copyIds: string[];
}

/**
 * Give a step several responsible teams. The first party becomes the step's
 * owner; every further party gets a copy of the step in its own lane.
 *
 * Each copy keeps the name, type, technology, notes and type variants, and
 * the same outgoing links, so the successors become implicit joins. Every
 * step that linked to the original also links to each copy, so the
 * predecessor becomes a parallel fork. A decision predecessor needs unique
 * labels, so the copied outcome is labelled "<label> (<team>)" and is never
 * the default. Teams in the group are dropped from the contributors of every
 * step in the group, because each now has a step of its own.
 *
 * Returns the process unchanged when the step is missing or no party is given.
 */
export function assignOwners(
  process: Process,
  stepId: string,
  partyIds: readonly string[],
  parties: readonly Party[],
): AssignOwnersResult {
  const ids = [...new Set(partyIds)];
  const idx = process.steps.findIndex((s) => s.id === stepId);
  if (idx < 0 || ids.length === 0) return { process, copyIds: [] };

  const src = process.steps[idx];
  const ownerId = ids[0];
  const group = new Set(ids);
  const contributorIds = src.contributorIds.filter((c) => !group.has(c));
  const nameOf = (id: string) => parties.find((p) => p.id === id)?.name ?? "copy";

  let displayNo = nextDisplayNo(process);
  const copies: Step[] = ids.slice(1).map((pid) => ({
    ...src,
    id: newId(),
    displayNo: displayNo++,
    ownerId: pid,
    next: src.next.map((l) => ({ ...l })),
    contributorIds: [...contributorIds],
  }));
  const owner: Step = { ...src, ownerId, contributorIds };

  const steps = process.steps.flatMap((s) => {
    if (s.id === stepId) return [owner, ...copies];
    const incoming = s.next.filter((l) => l.targetId === stepId);
    if (incoming.length === 0 || copies.length === 0) return [s];
    const added = copies.flatMap((copy) =>
      incoming.map((l) =>
        s.type === "decision"
          ? { targetId: copy.id, label: `${l.label ?? ""} (${nameOf(copy.ownerId!)})`.trim() }
          : { targetId: copy.id },
      ),
    );
    return [{ ...s, next: [...s.next, ...added] }];
  });

  const laneOrder = [...process.laneOrder];
  for (const id of ids) if (!laneOrder.includes(id)) laneOrder.push(id);

  return { process: { ...process, laneOrder, steps }, copyIds: copies.map((c) => c.id) };
}
