import type { Party, Process, Workspace } from "./types";
import { newId } from "./ids";

export function normaliseName(name: string): string {
  return name.trim().toLowerCase();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export type PartyMatch =
  { kind: "exact"; party: Party } | { kind: "near"; party: Party } | { kind: "new" };

/**
 * Exact match (case-insensitive, trimmed) links the existing party. A near
 * match (Levenshtein distance 2 or less, or one is a prefix of the other)
 * is offered. Otherwise the caller should create a new party.
 */
export function matchParty(input: string, parties: readonly Party[]): PartyMatch {
  const q = normaliseName(input);
  if (!q) return { kind: "new" };
  const exact = parties.find((p) => normaliseName(p.name) === q);
  if (exact) return { kind: "exact", party: exact };
  let best: { party: Party; score: number } | null = null;
  for (const p of parties) {
    const n = normaliseName(p.name);
    if (!n) continue;
    const prefix = n.startsWith(q) || q.startsWith(n);
    const dist = levenshtein(q, n);
    const near = prefix || dist <= 2;
    if (!near) continue;
    const score = prefix ? Math.abs(n.length - q.length) : dist + 10;
    if (!best || score < best.score) best = { party: p, score };
  }
  return best ? { kind: "near", party: best.party } : { kind: "new" };
}

/** Lowest colourIndex not used by any party. Never fails: the palette repeats. */
export function nextColourIndex(parties: readonly Party[]): number {
  const used = new Set(parties.map((p) => p.colourIndex));
  let i = 0;
  while (used.has(i)) i++;
  return i;
}

export function createParty(name: string, parties: readonly Party[]): Party {
  return { id: newId(), name: name.trim(), colourIndex: nextColourIndex(parties) };
}

export interface PartyUsage {
  processId: string;
  processName: string;
  asOwner: number;
  asContributor: number;
  inLaneOrder: boolean;
}

/** Where a party is referenced across the workspace (lane order alone is not a blocking reference). */
export function partyUsage(partyId: string, processes: readonly Process[]): PartyUsage[] {
  const out: PartyUsage[] = [];
  for (const p of processes) {
    let asOwner = 0;
    let asContributor = 0;
    for (const s of p.steps) {
      if (s.ownerId === partyId) asOwner++;
      if (s.contributorIds.includes(partyId)) asContributor++;
    }
    const inLaneOrder = p.laneOrder.includes(partyId);
    if (asOwner || asContributor || inLaneOrder) {
      out.push({ processId: p.id, processName: p.name, asOwner, asContributor, inLaneOrder });
    }
  }
  return out;
}

export function isPartyReferenced(partyId: string, processes: readonly Process[]): boolean {
  return partyUsage(partyId, processes).some((u) => u.asOwner > 0 || u.asContributor > 0);
}

/**
 * Merge `droppedId` into `survivorId`: every ownerId and contributorId across
 * every process is updated, lane order keeps the survivor's slot (or takes the
 * dropped party's slot if the survivor was not in the lane), and the dropped
 * party is removed, releasing its colourIndex.
 */
export function mergeParties(ws: Workspace, survivorId: string, droppedId: string): Workspace {
  if (survivorId === droppedId) return ws;
  if (!ws.parties.some((p) => p.id === survivorId) || !ws.parties.some((p) => p.id === droppedId)) {
    return ws;
  }
  const processes = ws.processes.map((proc) => {
    const steps = proc.steps.map((s) => {
      const ownerId = s.ownerId === droppedId ? survivorId : s.ownerId;
      const contributorIds = Array.from(
        new Set(s.contributorIds.map((c) => (c === droppedId ? survivorId : c))),
      );
      return { ...s, ownerId, contributorIds };
    });
    let laneOrder = proc.laneOrder;
    if (laneOrder.includes(droppedId)) {
      laneOrder = laneOrder.includes(survivorId)
        ? laneOrder.filter((id) => id !== droppedId)
        : laneOrder.map((id) => (id === droppedId ? survivorId : id));
    }
    return { ...proc, steps, laneOrder };
  });
  return { ...ws, parties: ws.parties.filter((p) => p.id !== droppedId), processes };
}

export function renameParty(ws: Workspace, partyId: string, name: string): Workspace {
  return {
    ...ws,
    parties: ws.parties.map((p) => (p.id === partyId ? { ...p, name: name.trim() } : p)),
  };
}

/** Delete an unreferenced party. Returns the workspace unchanged if it is referenced. */
export function deleteParty(ws: Workspace, partyId: string): Workspace {
  if (isPartyReferenced(partyId, ws.processes)) return ws;
  return {
    ...ws,
    parties: ws.parties.filter((p) => p.id !== partyId),
    processes: ws.processes.map((p) => ({
      ...p,
      laneOrder: p.laneOrder.filter((id) => id !== partyId),
    })),
  };
}
