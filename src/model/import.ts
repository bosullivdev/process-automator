import type { Party, Process, Step, Team, Workspace } from "./types";
import { newId } from "./ids";
import { createParty, normaliseName } from "./party";
import { createTeam } from "./team";

export interface Merged {
  parties: Party[];
  teams: Team[];
  processes: Process[];
  /** The first process added, to make it the active one. */
  activeProcessId: string | null;
}

/**
 * Add a file's processes to the current workspace rather than replacing it.
 * Parties and teams are matched to the registry by name (case-insensitive,
 * trimmed); the rest are created with the next free colour. Every process
 * and step gets a fresh ID so a file can be added more than once, and an
 * added process whose name is already taken is marked "(imported)".
 */
export function mergeWorkspace(
  current: Pick<Workspace, "parties" | "teams" | "processes">,
  incoming: Pick<Workspace, "parties" | "teams" | "processes">,
): Merged {
  const parties = [...current.parties];
  const partyId = new Map<string, string>();
  for (const p of incoming.parties) {
    const key = normaliseName(p.name);
    let match = parties.find((q) => normaliseName(q.name) === key);
    if (!match) {
      match = createParty(p.name, parties);
      if (p.colourOverride) match.colourOverride = p.colourOverride;
      parties.push(match);
    }
    partyId.set(p.id, match.id);
  }

  const teams = [...current.teams];
  const teamId = new Map<string, string>();
  for (const t of incoming.teams) {
    const key = normaliseName(t.name);
    let match = teams.find((q) => normaliseName(q.name) === key);
    if (!match) {
      match = createTeam(t.name, teams);
      teams.push(match);
    }
    teamId.set(t.id, match.id);
  }

  // Unknown references stay as they are, so validation can still flag them.
  const party = (id: string) => partyId.get(id) ?? id;
  const team = (id: string) => teamId.get(id) ?? id;
  const names = new Set(current.processes.map((p) => normaliseName(p.name)));
  const processes = [...current.processes];
  let activeProcessId: string | null = null;
  for (const src of incoming.processes) {
    const stepId = new Map(src.steps.map((s) => [s.id, newId()]));
    const steps: Step[] = src.steps.map((s) => {
      const step: Step = {
        ...s,
        id: stepId.get(s.id)!,
        ownerId: s.ownerId === null ? null : party(s.ownerId),
        coOwnerIds: s.coOwnerIds.map(party),
        contributorIds: s.contributorIds.map(party),
        teamIds: s.teamIds.map(team),
        next: s.next.map((l) => ({
          ...l,
          targetId: stepId.get(l.targetId) ?? l.targetId,
          ...(l.teamIds ? { teamIds: l.teamIds.map(team) } : {}),
        })),
      };
      if (s.ownerTeams) {
        step.ownerTeams = Object.fromEntries(
          Object.entries(s.ownerTeams).map(([p, scope]) => [party(p), scope.map(team)]),
        );
      }
      return step;
    });
    const taken = names.has(normaliseName(src.name));
    const name = taken ? `${src.name} (imported)` : src.name;
    names.add(normaliseName(name));
    const proc: Process = {
      ...src,
      id: newId(),
      name,
      laneOrder: src.laneOrder.map(party),
      steps,
    };
    processes.push(proc);
    activeProcessId ??= proc.id;
  }

  return { parties, teams, processes, activeProcessId };
}
