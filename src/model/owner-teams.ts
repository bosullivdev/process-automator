import type { NextLink, Process, Step } from "./types";
import { linkInTeam, normaliseScope, scopeWith, scopeWithout } from "./team";
import { stepParties } from "./share";

/*
 * Per-team ownership. A step shared by several teams can be done by
 * different parties for different teams: each party on the step may carry a
 * scope (Step.ownerTeams[partyId]) naming the teams it does the step for. No
 * scope means every team the step applies to. The map draws the party's lane
 * copy only for those teams, so "Review central targets" stays one row even
 * when one team adds a second party to it.
 */

/** Drop scope entries for parties no longer on the step, and entries that name every team. */
export function tidyOwnerTeams(step: Step, all: readonly string[]): Step {
  const parties = new Set(stepParties(step).filter((p): p is string => !!p));
  const out: Record<string, string[]> = {};
  for (const [p, scope] of Object.entries(step.ownerTeams ?? {})) {
    if (!parties.has(p)) continue;
    const norm = normaliseScope(scope, all);
    if (norm.length) out[p] = norm;
  }
  const next: Step = { ...step };
  delete next.ownerTeams;
  return Object.keys(out).length ? { ...next, ownerTeams: out } : next;
}

/**
 * Set which parties do the step for one team, leaving the other teams'
 * owners alone. Parties already on the step keep their other teams; a party
 * dropped for this team keeps the rest, or leaves the step when none is
 * left; a new party joins for this team only. The step's owner changes only
 * when it leaves the step entirely. Parties in the group leave the
 * contributors; their lanes join the lane order.
 */
export function setOwnersForTeam(
  process: Process,
  stepId: string,
  partyIds: readonly string[],
  teamId: string,
  all: readonly string[],
): Process {
  const idx = process.steps.findIndex((s) => s.id === stepId);
  if (idx < 0) return process;
  const step = process.steps[idx];
  const wanted = [...new Set(partyIds)];
  const existing = stepParties(step).filter((p): p is string => !!p);
  const scopes: Record<string, string[]> = { ...(step.ownerTeams ?? {}) };
  const kept: string[] = [];
  for (const p of existing) {
    if (wanted.includes(p)) {
      scopes[p] = scopeWith(scopes[p], teamId, all);
      kept.push(p);
    } else {
      const rest = scopeWithout(scopes[p], teamId, all);
      if (rest) {
        scopes[p] = rest;
        kept.push(p);
      } else {
        delete scopes[p];
      }
    }
  }
  for (const p of wanted) if (!existing.includes(p)) scopes[p] = normaliseScope([teamId], all);
  const parties = [...kept, ...wanted.filter((p) => !existing.includes(p))];
  const ownerId =
    step.ownerId && parties.includes(step.ownerId) ? step.ownerId : (parties[0] ?? null);
  const ordered = ownerId ? [ownerId, ...parties.filter((p) => p !== ownerId)] : [];
  const group = new Set(ordered);
  const next = tidyOwnerTeams(
    {
      ...step,
      ownerId,
      coOwnerIds: ordered.slice(1),
      ownerTeams: scopes,
      contributorIds: step.contributorIds.filter((c) => !group.has(c)),
    },
    all,
  );
  const laneOrder = [...process.laneOrder];
  for (const p of ordered) if (!laneOrder.includes(p)) laneOrder.push(p);
  return { ...process, laneOrder, steps: process.steps.map((s) => (s.id === stepId ? next : s)) };
}

/**
 * Fold `dropId` into `keepId`: typically one team's copy of a step back into
 * the shared step. The merged step applies to both steps' teams; each party
 * does it for the teams it did either step for; each link out applies to the
 * teams it applied to on either step, with the kept step's label where both
 * have one; links into the dropped step move to the kept one. Name, type and
 * number are the kept step's; technology and notes fall back to the dropped
 * step's when the kept step has none.
 */
export function mergeSteps(
  process: Process,
  keepId: string,
  dropId: string,
  all: readonly string[],
): Process {
  const keep = process.steps.find((s) => s.id === keepId);
  const drop = process.steps.find((s) => s.id === dropId);
  if (!keep || !drop || keepId === dropId) return process;
  const teamsOf = (s: Pick<Step, "teamIds">) => (s.teamIds.length ? s.teamIds : all);
  const linkTeamsOf = (s: Pick<Step, "teamIds">, l: NextLink) =>
    teamsOf(s).filter((id) => linkInTeam(l, id));
  const partyTeamsOf = (s: Step, p: string) => {
    const scope = s.ownerTeams?.[p];
    return scope?.length ? teamsOf(s).filter((id) => scope.includes(id)) : teamsOf(s);
  };
  const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])];
  const mergedTeams = union(teamsOf(keep), teamsOf(drop));
  const scopeFor = (teams: readonly string[]): string[] | undefined =>
    mergedTeams.every((id) => teams.includes(id)) ? undefined : normaliseScope(teams, all);

  // Owners: the kept step's owner stays owner; every other party follows.
  const partyTeams = new Map<string, string[]>();
  for (const s of [keep, drop]) {
    for (const p of stepParties(s)) {
      if (!p) continue;
      partyTeams.set(p, union(partyTeams.get(p) ?? [], partyTeamsOf(s, p)));
    }
  }
  const ownerId = keep.ownerId ?? drop.ownerId;
  const ordered = ownerId
    ? [ownerId, ...[...partyTeams.keys()].filter((p) => p !== ownerId)]
    : [...partyTeams.keys()];
  const ownerTeams: Record<string, string[]> = {};
  for (const p of ordered) {
    const scope = scopeFor(partyTeams.get(p) ?? []);
    if (scope?.length) ownerTeams[p] = scope;
  }

  // Links out, by target; a link to the dropped step becomes a self-link and goes.
  const out = new Map<string, { link: NextLink; teams: string[] }>();
  for (const s of [keep, drop]) {
    for (const l of s.next) {
      const target = l.targetId === dropId ? keepId : l.targetId;
      if (target === keepId) continue;
      const teams = linkTeamsOf(s, l);
      const prev = out.get(target);
      if (prev) {
        prev.teams = union(prev.teams, teams);
        if (prev.link.label === undefined && l.label !== undefined) prev.link.label = l.label;
        if (l.isDefault) prev.link.isDefault = true;
      } else {
        const link: NextLink = { targetId: target };
        if (l.label !== undefined) link.label = l.label;
        if (l.isDefault) link.isDefault = true;
        out.set(target, { link, teams });
      }
    }
  }
  const next: NextLink[] = [...out.values()].map(({ link, teams }) => {
    const scope = scopeFor(teams);
    return scope?.length ? { ...link, teamIds: scope } : link;
  });

  const group = new Set(ordered);
  const merged: Step = {
    ...keep,
    teamIds: normaliseScope(mergedTeams, all),
    ownerId,
    coOwnerIds: ordered.slice(1),
    ownerTeams,
    next,
    technology: keep.technology || drop.technology,
    notes: keep.notes || drop.notes,
    hasControl: keep.hasControl || drop.hasControl,
    controlRef: keep.controlRef || drop.controlRef,
    contributorIds: union(keep.contributorIds, drop.contributorIds).filter((c) => !group.has(c)),
  };
  const tidy = tidyOwnerTeams(merged, all);

  // Links into the dropped step move to the kept one, merging with any link already there.
  const steps = process.steps.flatMap((s): Step[] => {
    if (s.id === dropId) return [];
    if (s.id === keepId) return [tidy];
    if (!s.next.some((l) => l.targetId === dropId)) return [s];
    const links: NextLink[] = [];
    for (const l of s.next) {
      const target = l.targetId === dropId ? keepId : l.targetId;
      const at = links.findIndex((o) => o.targetId === target);
      if (at < 0) {
        links.push(l.targetId === dropId ? { ...l, targetId: keepId } : l);
        continue;
      }
      const prev = links[at];
      const teams = union(linkTeamsOf(s, prev), linkTeamsOf(s, l));
      const merged: NextLink = { targetId: target };
      const label = prev.label ?? l.label;
      if (label !== undefined) merged.label = label;
      if (prev.isDefault || l.isDefault) merged.isDefault = true;
      const scope = teamsOf(s).every((id) => teams.includes(id))
        ? undefined
        : normaliseScope(teams, all);
      if (scope?.length) merged.teamIds = scope;
      links[at] = merged;
    }
    return [{ ...s, next: links }];
  });

  const laneOrder = [...process.laneOrder];
  for (const p of ordered) if (!laneOrder.includes(p)) laneOrder.push(p);
  return { ...process, laneOrder, steps };
}

/**
 * Steps that look like another team's copy of this one: same name and type,
 * applying to teams this step does not. These are offered for merging.
 */
export function mergeCandidates(process: Process, stepId: string): Step[] {
  const step = process.steps.find((s) => s.id === stepId);
  if (!step) return [];
  const key = step.name.trim().toLowerCase();
  if (!key) return [];
  return process.steps.filter(
    (o) =>
      o.id !== step.id &&
      o.type === step.type &&
      o.name.trim().toLowerCase() === key &&
      o.teamIds.length > 0 &&
      step.teamIds.length > 0 &&
      !o.teamIds.some((id) => step.teamIds.includes(id)),
  );
}
