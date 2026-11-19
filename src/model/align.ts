import type { NextLink, Party, Process, Step, Team } from "./types";
import { levenshtein } from "./party";
import { stepParties } from "./share";
import { mergeSteps, setOwnersForTeam, tidyOwnerTeams } from "./owner-teams";
import {
  linkInTeam,
  linkWith,
  linkWithout,
  normaliseScope,
  ownersForTeam,
  processForTeam,
  scopeWith,
  stepInTeam,
  tidyLink,
} from "./team";

/*
 * Comparing the teams' variants of one process and suggesting edits that
 * bring them closer together. Everything here is a pure function of the
 * process: suggestions are worked out fresh each time and never stored.
 *
 * The suggestions are structural. They can say "most teams do it this way";
 * they cannot say which way is better.
 */

// ---- how alike two teams' routes are

/** What one team's route consists of: its steps, who does each, and its arrows. */
function routeItems(process: Process, teamId: string): Set<string> {
  const items = new Set<string>();
  for (const s of processForTeam(process, teamId).steps) {
    items.add(`s:${s.id}`);
    for (const p of stepParties(s)) if (p) items.add(`o:${s.id}:${p}`);
    for (const l of s.next) items.add(`l:${s.id}>${l.targetId}`);
  }
  return items;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Share of steps, owners and arrows two teams have in common, 0 to 1. */
export function teamSimilarity(process: Process, a: string, b: string): number {
  return jaccard(routeItems(process, a), routeItems(process, b));
}

export interface TeamPair {
  a: string;
  b: string;
  similarity: number;
}

export interface TeamComparison {
  /** Mean similarity over every pair of teams; 1 when there are fewer than two teams. */
  average: number;
  /** Every pair, in registry order. */
  pairs: TeamPair[];
}

export function compareTeams(process: Process, teams: readonly Team[]): TeamComparison {
  const items = teams.map((t) => routeItems(process, t.id));
  const pairs: TeamPair[] = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      pairs.push({ a: teams[i].id, b: teams[j].id, similarity: jaccard(items[i], items[j]) });
    }
  }
  const average = pairs.length ? pairs.reduce((sum, p) => sum + p.similarity, 0) / pairs.length : 1;
  return { average, pairs };
}

// ---- edits a suggestion can make

export type AlignAction =
  /** Fold one team's copy of a step into another team's. */
  | { kind: "merge"; keepId: string; dropId: string }
  /** Put a step on more teams' routes, connected the way `likeTeamId` has it. */
  | { kind: "add-step"; stepId: string; teamIds: string[]; likeTeamId: string }
  /** Remove a step few teams do, reconnecting their arrows around it. */
  | { kind: "drop-step"; stepId: string }
  /** Have the listed teams use the same parties for a step as the others. */
  | { kind: "align-owner"; stepId: string; teamIds: string[]; partyIds: string[] };

/**
 * Put a step on a team's route the way another team has it: the team gets
 * the reference team's arrows into and out of the step and its parties for
 * it, and loses any arrow of its own that skipped past the step. The reverse
 * of removing a step from a team's route.
 */
export function addStepToTeam(
  process: Process,
  stepId: string,
  teamId: string,
  likeTeamId: string,
  all: readonly string[],
): Process {
  const x = process.steps.find((s) => s.id === stepId);
  if (!x || stepInTeam(x, teamId) || !stepInTeam(x, likeTeamId)) return process;
  const mine = new Set(process.steps.filter((s) => stepInTeam(s, teamId)).map((s) => s.id));
  const theirs = new Set(process.steps.filter((s) => stepInTeam(s, likeTeamId)).map((s) => s.id));
  /** A link the reference team travels whose other end this team also has. */
  const follows = (l: NextLink, otherEnd: string) =>
    linkInTeam(l, likeTeamId) && mine.has(otherEnd) && theirs.has(otherEnd);
  const succs = x.next.filter((l) => follows(l, l.targetId)).map((l) => l.targetId);

  const steps = process.steps.map((s): Step => {
    if (s.id === stepId) {
      const ownerTeams = Object.fromEntries(
        Object.entries(s.ownerTeams ?? {}).map(([p, scope]) => [
          p,
          scope.includes(likeTeamId) ? scopeWith(scope, teamId, all) : scope,
        ]),
      );
      return tidyOwnerTeams(
        {
          ...s,
          teamIds: scopeWith(s.teamIds, teamId, all),
          ownerTeams,
          next: s.next.map((l) => (follows(l, l.targetId) ? linkWith(l, teamId, all) : l)),
        },
        all,
      );
    }
    if (!s.next.some((l) => l.targetId === stepId && follows(l, s.id))) return s;
    const next = s.next
      .map((l) => {
        if (l.targetId === stepId) return follows(l, s.id) ? linkWith(l, teamId, all) : l;
        // The team's own shortcut past the step is no longer needed.
        const shortcut =
          succs.includes(l.targetId) && linkInTeam(l, teamId) && !linkInTeam(l, likeTeamId);
        return shortcut ? linkWithout(l, teamId, all) : l;
      })
      .filter((l): l is NextLink => !!l);
    return { ...s, next };
  });
  return { ...process, steps };
}

/**
 * Delete a step, first leading every team that used it straight from the
 * steps before it to the steps after it, so no route is left broken.
 */
export function dropStep(process: Process, stepId: string, all: readonly string[]): Process {
  const x = process.steps.find((s) => s.id === stepId);
  if (!x) return process;
  let steps = process.steps;
  for (const teamId of x.teamIds.length ? x.teamIds : all) {
    const route = new Set(steps.filter((s) => stepInTeam(s, teamId)).map((s) => s.id));
    const succs = x.next
      .filter((l) => l.targetId !== stepId && linkInTeam(l, teamId) && route.has(l.targetId))
      .map((l) => l.targetId);
    steps = steps.map((s): Step => {
      if (s.id === stepId || !route.has(s.id)) return s;
      const toX = s.next.filter((l) => l.targetId === stepId && linkInTeam(l, teamId));
      if (toX.length === 0) return s;
      const next = [...s.next];
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
  }
  return {
    ...process,
    steps: steps
      .filter((s) => s.id !== stepId)
      .map((s) =>
        s.next.some((l) => l.targetId === stepId)
          ? { ...s, next: s.next.filter((l) => l.targetId !== stepId) }
          : s,
      ),
  };
}

/** Make the edit a suggestion describes. `all` is every team id in the registry. */
export function applyAlignment(
  process: Process,
  action: AlignAction,
  all: readonly string[],
): Process {
  switch (action.kind) {
    case "merge":
      return mergeSteps(process, action.keepId, action.dropId, all);
    case "add-step":
      return action.teamIds.reduce(
        (p, t) => addStepToTeam(p, action.stepId, t, action.likeTeamId, all),
        process,
      );
    case "drop-step":
      return dropStep(process, action.stepId, all);
    case "align-owner":
      return action.teamIds.reduce(
        (p, t) => setOwnersForTeam(p, action.stepId, action.partyIds, t, all),
        process,
      );
  }
}

// ---- suggestions

export interface Suggestion {
  /** Stable for the same suggestion on the same data. */
  id: string;
  action: AlignAction;
  title: string;
  detail: string;
  /** Steps the suggestion is about, the first being the one to show. */
  stepIds: string[];
  /** How much the average similarity between teams rises if applied, 0 to 1. */
  gain: number;
}

function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Whether two step names read as the same step: equal apart from case and
 * punctuation, or within a few typing differences. Names that differ in a
 * number ("Review 1", "Review 2") are never alike.
 */
export function namesAlike(a: string, b: string): boolean {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.replace(/\D/g, "") !== y.replace(/\D/g, "")) return false;
  const longest = Math.max(x.length, y.length);
  return levenshtein(x, y) <= Math.max(1, Math.floor(longest * 0.2));
}

function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Edits that would bring the teams' variants of this process closer
 * together, the ones that help most first:
 *
 * - merge: two teams each have their own copy of what reads as the same step;
 * - add-step: at least half the teams do a step the rest skip;
 * - drop-step: at most half the teams do a step (start and end steps are left alone);
 * - align-owner: teams share a step but different parties do it.
 *
 * A step done by exactly half the teams gets both an add and a drop
 * suggestion, since neither side is the majority. Suggestions that would not
 * raise the similarity are left out.
 */
export function suggestAlignments(
  process: Process,
  teams: readonly Team[],
  parties: readonly Party[] = [],
): Suggestion[] {
  if (teams.length < 2) return [];
  const all = teams.map((t) => t.id);
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? "Unknown team";
  const partyName = (id: string) => parties.find((p) => p.id === id)?.name ?? "Unknown party";
  const quote = (s: Step) => `"${s.name.trim() || "Untitled"}"`;
  /** The teams a scoped step applies to, in registry order. */
  const scopeOf = (s: Step) => all.filter((id) => s.teamIds.includes(id));
  const found: Array<Omit<Suggestion, "gain">> = [];

  // Copies of one step kept separately by different teams. Each step is paired once.
  const scoped = process.steps.filter((s) => scopeOf(s).length > 0);
  const pairs: Array<{ a: Step; b: Step; exact: boolean }> = [];
  for (let i = 0; i < scoped.length; i++) {
    for (let j = i + 1; j < scoped.length; j++) {
      const a = scoped[i];
      const b = scoped[j];
      if (a.type !== b.type || a.teamIds.some((id) => b.teamIds.includes(id))) continue;
      if (!namesAlike(a.name, b.name)) continue;
      pairs.push({ a, b, exact: nameKey(a.name) === nameKey(b.name) });
    }
  }
  pairs.sort(
    (p, q) =>
      Number(q.exact) - Number(p.exact) ||
      p.a.displayNo - q.a.displayNo ||
      p.b.displayNo - q.b.displayNo,
  );
  const paired = new Set<string>();
  for (const { a, b } of pairs) {
    if (paired.has(a.id) || paired.has(b.id)) continue;
    paired.add(a.id);
    paired.add(b.id);
    const [keep, drop] =
      scopeOf(b).length > scopeOf(a).length ||
      (scopeOf(b).length === scopeOf(a).length && b.displayNo < a.displayNo)
        ? [b, a]
        : [a, b];
    found.push({
      id: `merge:${keep.id}:${drop.id}`,
      action: { kind: "merge", keepId: keep.id, dropId: drop.id },
      title: `Merge step ${drop.displayNo} into step ${keep.displayNo}`,
      detail:
        `${quote(keep)} (${listNames(scopeOf(keep).map(teamName))}) and ${quote(drop)} ` +
        `(${listNames(scopeOf(drop).map(teamName))}) read as the same step. ` +
        `One shared step keeps each team's own arrows and owners.`,
      stepIds: [keep.id, drop.id],
    });
  }

  for (const s of process.steps) {
    // A step some teams do and others skip.
    const doing = scopeOf(s);
    if (doing.length > 0 && doing.length < all.length && !paired.has(s.id)) {
      const missing = all.filter((id) => !doing.includes(id));
      if (doing.length * 2 >= all.length) {
        found.push({
          id: `add-step:${s.id}:${missing.join(",")}`,
          action: { kind: "add-step", stepId: s.id, teamIds: missing, likeTeamId: doing[0] },
          title: `Add step ${s.displayNo} to ${listNames(missing.map(teamName))}`,
          detail:
            `${quote(s)} is done by ${listNames(doing.map(teamName))} but not by ` +
            `${listNames(missing.map(teamName))}. It would be connected the way ` +
            `${teamName(doing[0])} has it.`,
          stepIds: [s.id],
        });
      }
      if (doing.length * 2 <= all.length && s.type !== "start" && s.type !== "end") {
        found.push({
          id: `drop-step:${s.id}`,
          action: { kind: "drop-step", stepId: s.id },
          title: `Remove step ${s.displayNo}`,
          detail:
            `Only ${listNames(doing.map(teamName))} ${doing.length === 1 ? "does" : "do"} ` +
            `${quote(s)}. The arrows into it would lead straight on to the steps after it.`,
          stepIds: [s.id],
        });
      }
    }

    // A step teams share but different parties do.
    const sharing = all.filter((id) => stepInTeam(s, id));
    if (sharing.length < 2) continue;
    const groups = new Map<string, { partyIds: string[]; teamIds: string[] }>();
    for (const teamId of sharing) {
      const o = ownersForTeam(s, teamId);
      const partyIds = o.ownerId ? [o.ownerId, ...o.coOwnerIds] : [];
      const key = [...partyIds].sort().join(",");
      const g = groups.get(key);
      if (g) g.teamIds.push(teamId);
      else groups.set(key, { partyIds, teamIds: [teamId] });
    }
    if (groups.size < 2) continue;
    const most = Math.max(...[...groups.values()].map((g) => g.teamIds.length));
    const describe = [...groups.values()]
      .map(
        (g) =>
          `${g.partyIds.length ? listNames(g.partyIds.map(partyName)) : "nobody"} for ` +
          listNames(g.teamIds.map(teamName)),
      )
      .join("; ");
    for (const g of groups.values()) {
      if (g.teamIds.length !== most || g.partyIds.length === 0) continue;
      const others = sharing.filter((id) => !g.teamIds.includes(id));
      found.push({
        id: `align-owner:${s.id}:${g.partyIds.join(",")}`,
        action: { kind: "align-owner", stepId: s.id, teamIds: others, partyIds: g.partyIds },
        title:
          `Step ${s.displayNo}: have ${listNames(g.partyIds.map(partyName))} do it for ` +
          listNames(others.map(teamName)),
        detail: `${quote(s)} is done by ${describe}.`,
        stepIds: [s.id],
      });
    }
  }

  const before = compareTeams(process, teams).average;
  const no = new Map(process.steps.map((s) => [s.id, s.displayNo]));
  return found
    .map((f) => ({
      ...f,
      gain: compareTeams(applyAlignment(process, f.action, all), teams).average - before,
    }))
    .filter((f) => f.gain > 1e-9)
    .sort(
      (a, b) =>
        b.gain - a.gain ||
        (no.get(a.stepIds[0]) ?? 0) - (no.get(b.stepIds[0]) ?? 0) ||
        a.id.localeCompare(b.id),
    );
}
