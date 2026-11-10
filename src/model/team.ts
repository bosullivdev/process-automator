import type { NextLink, Process, Step, Team, Workspace } from "./types";
import { newId } from "./ids";
import { nextColourIndex } from "./party";
import { nextDisplayNo } from "./workspace";

/** Teams take the lowest free colour among teams; their palette is independent of the parties'. */
export function createTeam(name: string, teams: readonly Team[]): Team {
  return { id: newId(), name: name.trim(), colourIndex: nextColourIndex(teams) };
}

/** A step with no team tags applies to every team. */
export function stepInTeam(step: Pick<Step, "teamIds">, teamId: string): boolean {
  return step.teamIds.length === 0 || step.teamIds.includes(teamId);
}

/** A link with no team tags applies wherever both of its ends do. */
export function linkInTeam(link: Pick<NextLink, "teamIds">, teamId: string): boolean {
  return !link.teamIds || link.teamIds.length === 0 || link.teamIds.includes(teamId);
}

/**
 * Whether two team scopes can both be in force for some team. An empty scope
 * means "all teams", so it overlaps with everything.
 */
export function scopesOverlap(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  if (!a?.length || !b?.length) return true;
  return a.some((id) => b.includes(id));
}

// ---- scope arithmetic. A scope is a list of team ids; empty means every team.

/** Collapse a scope that names every team back to "all teams". */
export function normaliseScope(scope: readonly string[], all: readonly string[]): string[] {
  const set = new Set(scope);
  return all.length > 0 && all.every((id) => set.has(id)) ? [] : [...set];
}

/** The scope with one team added. An all-teams scope already has it. */
export function scopeWith(
  scope: readonly string[] | undefined,
  teamId: string,
  all: readonly string[],
): string[] {
  if (!scope?.length) return [];
  return normaliseScope(scope.includes(teamId) ? scope : [...scope, teamId], all);
}

/**
 * The scope with one team removed. An all-teams scope becomes every other
 * team, spelled out. Returns null when no team would be left.
 */
export function scopeWithout(
  scope: readonly string[] | undefined,
  teamId: string,
  all: readonly string[],
): string[] | null {
  const base = scope?.length ? scope : all;
  const out = base.filter((id) => id !== teamId);
  return out.length ? normaliseScope(out, all) : null;
}

/** Link scopes are stored as undefined rather than [] when they mean "all teams". */
function linkScope(ids: readonly string[] | null | undefined): string[] | undefined {
  return ids && ids.length ? [...ids] : undefined;
}

/** A link with the team removed from its scope, or null when the link would apply to nobody. */
function linkWithout(link: NextLink, teamId: string, all: readonly string[]): NextLink | null {
  const scope = scopeWithout(link.teamIds, teamId, all);
  return scope ? tidyLink({ ...link, teamIds: scope }) : null;
}

function linkWith(link: NextLink, teamId: string, all: readonly string[]): NextLink {
  return tidyLink({ ...link, teamIds: scopeWith(link.teamIds, teamId, all) });
}

/** Drop undefined and empty fields so links compare cleanly. */
function tidyLink(l: NextLink): NextLink {
  const out: NextLink = { targetId: l.targetId };
  if (l.label !== undefined) out.label = l.label;
  if (l.isDefault) out.isDefault = true;
  const scope = linkScope(l.teamIds);
  if (scope) out.teamIds = scope;
  return out;
}

// ---- views of one team's route

/**
 * The process as one team runs it: only the steps that apply to the team,
 * with only the links that apply and whose target also applies. A pure view;
 * step IDs and display numbers are unchanged so selection and edits still
 * address the master process.
 */
export function processForTeam(process: Process, teamId: string): Process {
  const keep = new Set(process.steps.filter((s) => stepInTeam(s, teamId)).map((s) => s.id));
  return {
    ...process,
    steps: process.steps
      .filter((s) => keep.has(s.id))
      .map((s) => ({
        ...s,
        next: s.next.filter((l) => keep.has(l.targetId) && linkInTeam(l, teamId)),
      })),
  };
}

export interface TeamView {
  /** Steps that take part in the team's variant. */
  stepIds: Set<string>;
  /** Links that take part, as "sourceId->targetId". */
  linkKeys: Set<string>;
}

/** Which steps and links of the master process belong to a team's variant. */
export function teamView(process: Process, teamId: string): TeamView {
  const scoped = processForTeam(process, teamId);
  const stepIds = new Set(scoped.steps.map((s) => s.id));
  const linkKeys = new Set<string>();
  for (const s of scoped.steps) for (const l of s.next) linkKeys.add(`${s.id}->${l.targetId}`);
  return { stepIds, linkKeys };
}

/** The team the user is looking at, if any, and how: fade the rest or show the team alone. */
export interface TeamFocus {
  teamId: string;
  mode: "highlight" | "isolate";
  view: TeamView;
}

/** The teams that actually travel a link: both ends and the link itself must apply. */
export function linkTeams(
  source: Pick<Step, "teamIds">,
  link: Pick<NextLink, "teamIds">,
  target: Pick<Step, "teamIds">,
  teams: readonly Team[],
): Team[] {
  return teams.filter(
    (t) => stepInTeam(source, t.id) && stepInTeam(target, t.id) && linkInTeam(link, t.id),
  );
}

// ---- editing one team's route inside the master process

/**
 * Give `to` the same route as `from` in this process: every step and link
 * `from` uses gains `to`. Steps and links already open to every team are
 * left alone, so starting a new team from an untagged process changes
 * nothing, which is the intended "identical copy".
 */
export function copyTeamRoute(
  process: Process,
  from: string,
  to: string,
  all: readonly string[],
): Process {
  if (from === to) return process;
  const route = new Set(process.steps.filter((s) => stepInTeam(s, from)).map((s) => s.id));
  return {
    ...process,
    steps: process.steps.map((s) => {
      if (!route.has(s.id)) return s;
      return {
        ...s,
        teamIds: scopeWith(s.teamIds, to, all),
        next: s.next.map((l) =>
          linkInTeam(l, from) && route.has(l.targetId) ? linkWith(l, to, all) : l,
        ),
      };
    }),
  };
}

/**
 * Apply an edit made to one team's view of a step's links back to the
 * master. `after` is the team's visible link list as the user left it;
 * links the team did not see (to steps outside its route) are untouched.
 * Dropping a link removes only this team from it; adding one that another
 * team already has shares it; a brand-new link belongs to this team alone.
 */
export function applyScopedNext(
  step: Step,
  after: readonly NextLink[],
  teamId: string,
  all: readonly string[],
  inRoute: ReadonlySet<string>,
): NextLink[] {
  const visible = (l: NextLink) => linkInTeam(l, teamId) && inRoute.has(l.targetId);
  const keep = new Set(after.map((l) => l.targetId));
  const pending = new Map(after.map((l) => [l.targetId, l]));
  const next: NextLink[] = [];
  for (const l of step.next) {
    if (visible(l) && !keep.has(l.targetId)) {
      const left = linkWithout(l, teamId, all);
      if (left) next.push(left);
      continue;
    }
    const a = pending.get(l.targetId);
    if (!a) {
      next.push(l);
      continue;
    }
    const shared = linkInTeam(l, teamId) ? l : linkWith(l, teamId, all);
    next.push(tidyLink({ ...shared, label: a.label, isDefault: a.isDefault }));
    pending.delete(l.targetId);
  }
  for (const a of pending.values()) {
    if (a.targetId === step.id) continue;
    next.push(tidyLink({ ...a, teamIds: normaliseScope([teamId], all) }));
  }
  return next;
}

/**
 * Take a step out of one team's route and reconnect the team's arrows
 * around it: every predecessor the team used now leads to every successor
 * the team used. Other teams are unchanged. Returns the process unchanged
 * when the step is not in the team's route, or when the team is the only
 * one it applies to (delete the step instead).
 */
export function removeStepFromTeam(
  process: Process,
  stepId: string,
  teamId: string,
  all: readonly string[],
): Process {
  const x = process.steps.find((s) => s.id === stepId);
  if (!x || !stepInTeam(x, teamId)) return process;
  const remaining = scopeWithout(x.teamIds, teamId, all);
  if (!remaining) return process;
  const inRoute = new Set(process.steps.filter((s) => stepInTeam(s, teamId)).map((s) => s.id));
  const succs = x.next
    .filter((l) => linkInTeam(l, teamId) && inRoute.has(l.targetId))
    .map((l) => l.targetId);

  const steps = process.steps.map((s): Step => {
    if (s.id === stepId) {
      return {
        ...s,
        teamIds: remaining,
        next: s.next
          .map((l) => (linkInTeam(l, teamId) ? linkWithout(l, teamId, all) : l))
          .filter((l): l is NextLink => !!l),
      };
    }
    if (!inRoute.has(s.id)) return s;
    const toX = s.next.filter((l) => l.targetId === stepId && linkInTeam(l, teamId));
    if (toX.length === 0) return s;
    const next = s.next
      .map((l) =>
        l.targetId === stepId && linkInTeam(l, teamId) ? linkWithout(l, teamId, all) : l,
      )
      .filter((l): l is NextLink => !!l);
    for (const succ of succs) {
      if (succ === s.id) continue;
      const i = next.findIndex((l) => l.targetId === succ);
      if (i >= 0) {
        if (!linkInTeam(next[i], teamId)) next[i] = linkWith(next[i], teamId, all);
      } else {
        next.push(
          tidyLink({
            targetId: succ,
            label: s.type === "decision" ? toX[0].label : undefined,
            isDefault: s.type === "decision" ? toX[0].isDefault : undefined,
            teamIds: normaliseScope([teamId], all),
          }),
        );
      }
    }
    return { ...s, next };
  });
  return { ...process, steps };
}

export interface ForkStepResult {
  process: Process;
  /** The new step's id, or null when the step already belonged to this team alone. */
  copyId: string | null;
}

/**
 * Give one team its own copy of a shared step: the copy carries the team's
 * links out of the step, the team's arrows into the step move to the copy,
 * and the original loses the team. The copy sits under the original in the
 * table so the two can be compared.
 */
export function forkStepForTeam(
  process: Process,
  stepId: string,
  teamId: string,
  all: readonly string[],
): ForkStepResult {
  const x = process.steps.find((s) => s.id === stepId);
  if (!x || !stepInTeam(x, teamId)) return { process, copyId: null };
  const remaining = scopeWithout(x.teamIds, teamId, all);
  if (!remaining) return { process, copyId: null };
  const inRoute = new Set(process.steps.filter((s) => stepInTeam(s, teamId)).map((s) => s.id));
  const own = normaliseScope([teamId], all);

  const copy: Step = {
    ...x,
    id: newId(),
    displayNo: nextDisplayNo(process),
    teamIds: own,
    coOwnerIds: [...x.coOwnerIds],
    contributorIds: [...x.contributorIds],
    next: x.next
      .filter((l) => linkInTeam(l, teamId) && inRoute.has(l.targetId))
      .map((l) => tidyLink({ ...l, teamIds: own })),
  };
  const original: Step = {
    ...x,
    teamIds: remaining,
    next: x.next
      .map((l) => (linkInTeam(l, teamId) ? linkWithout(l, teamId, all) : l))
      .filter((l): l is NextLink => !!l),
  };

  const steps = process.steps.flatMap((s): Step[] => {
    if (s.id === stepId) return [original, copy];
    if (!inRoute.has(s.id)) return [s];
    const toX = s.next.filter((l) => l.targetId === stepId && linkInTeam(l, teamId));
    if (toX.length === 0) return [s];
    const next = s.next
      .map((l) =>
        l.targetId === stepId && linkInTeam(l, teamId) ? linkWithout(l, teamId, all) : l,
      )
      .filter((l): l is NextLink => !!l);
    for (const l of toX) next.push(tidyLink({ ...l, targetId: copy.id, teamIds: own }));
    return [{ ...s, next }];
  });
  return { process: { ...process, steps }, copyId: copy.id };
}

// ---- registry

export interface TeamUsage {
  processId: string;
  processName: string;
  steps: number;
  links: number;
}

/** Where a team is referenced, by step tags and link tags, per process. */
export function teamUsage(teamId: string, processes: readonly Process[]): TeamUsage[] {
  const out: TeamUsage[] = [];
  for (const p of processes) {
    let steps = 0;
    let links = 0;
    for (const s of p.steps) {
      if (s.teamIds.includes(teamId)) steps++;
      for (const l of s.next) if (l.teamIds?.includes(teamId)) links++;
    }
    if (steps || links) out.push({ processId: p.id, processName: p.name, steps, links });
  }
  return out;
}

export function isTeamReferenced(teamId: string, processes: readonly Process[]): boolean {
  return teamUsage(teamId, processes).length > 0;
}

export function renameTeam(ws: Workspace, teamId: string, name: string): Workspace {
  return {
    ...ws,
    teams: ws.teams.map((t) => (t.id === teamId ? { ...t, name: name.trim() } : t)),
  };
}

/** Delete an unreferenced team. Returns the workspace unchanged if it is referenced. */
export function deleteTeam(ws: Workspace, teamId: string): Workspace {
  if (isTeamReferenced(teamId, ws.processes)) return ws;
  return {
    ...ws,
    teams: ws.teams.filter((t) => t.id !== teamId),
    view: ws.view.highlightTeamId === teamId ? { ...ws.view, highlightTeamId: null } : ws.view,
  };
}

/** Names of the teams a step or link is scoped to, in registry order; empty means all. */
export function teamNames(ids: readonly string[] | undefined, teams: readonly Team[]): string[] {
  if (!ids?.length) return [];
  return teams.filter((t) => ids.includes(t.id)).map((t) => t.name);
}
