import type { NextLink, Process, Step, Team, Workspace } from "./types";
import { newId } from "./ids";

export function createTeam(name: string): Team {
  return { id: newId(), name: name.trim() };
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
