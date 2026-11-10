import type { Process, Step } from "./types";
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

/**
 * Give a step several responsible parties. The first becomes the owner and
 * the rest its co-owners. The step stays one table row; the map draws it once
 * in each party's lane with the same links into and out of every copy, so the
 * step before fans out to every lane and the steps after join them again.
 *
 * Parties in the group are dropped from the step's contributors, because each
 * now has the step in its own lane. Every party's lane is added to laneOrder.
 * A single party simply becomes the owner and clears any co-owners.
 *
 * Returns the process unchanged when the step is missing or no party is given.
 */
export function assignOwners(
  process: Process,
  stepId: string,
  partyIds: readonly string[],
): Process {
  const ids = [...new Set(partyIds)];
  const idx = process.steps.findIndex((s) => s.id === stepId);
  if (idx < 0 || ids.length === 0) return process;

  const src = process.steps[idx];
  const [ownerId, ...coOwnerIds] = ids;
  const group = new Set(ids);
  const step: Step = {
    ...src,
    ownerId,
    coOwnerIds,
    contributorIds: src.contributorIds.filter((c) => !group.has(c)),
  };
  const steps = process.steps.map((s) => (s.id === stepId ? step : s));

  const laneOrder = [...process.laneOrder];
  for (const id of ids) if (!laneOrder.includes(id)) laneOrder.push(id);

  return { ...process, laneOrder, steps };
}

/** Every party a step is drawn for: its owner (null = Unassigned) then its distinct co-owners. */
export function stepParties(step: Pick<Step, "ownerId" | "coOwnerIds">): Array<string | null> {
  const out: Array<string | null> = [step.ownerId];
  for (const id of step.coOwnerIds) if (!out.includes(id)) out.push(id);
  return out;
}
