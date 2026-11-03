import type { Process, Step } from "../model/types";

export interface Adjacency {
  byId: Map<string, Step>;
  out: Map<string, string[]>; // only links whose target exists
  inc: Map<string, string[]>;
}

export function buildAdjacency(process: Process): Adjacency {
  const byId = new Map<string, Step>();
  for (const s of process.steps) byId.set(s.id, s);
  const out = new Map<string, string[]>();
  const inc = new Map<string, string[]>();
  for (const s of process.steps) {
    out.set(s.id, []);
    inc.set(s.id, []);
  }
  for (const s of process.steps) {
    for (const l of s.next) {
      if (!byId.has(l.targetId)) continue;
      out.get(s.id)!.push(l.targetId);
      inc.get(l.targetId)!.push(s.id);
    }
  }
  return { byId, out, inc };
}

function bfs(seeds: string[], edges: Map<string, string[]>): Set<string> {
  const seen = new Set<string>(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const id = queue.shift()!;
    for (const n of edges.get(id) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
}

/** IDs of every step reachable from any start step (starts included). */
export function reachableFromStarts(process: Process, adj = buildAdjacency(process)): Set<string> {
  const starts = process.steps.filter((s) => s.type === "start").map((s) => s.id);
  return bfs(starts, adj.out);
}

/** IDs of every step from which some end step can be reached (ends included). */
export function canReachEnd(process: Process, adj = buildAdjacency(process)): Set<string> {
  const ends = process.steps.filter((s) => s.type === "end").map((s) => s.id);
  return bfs(ends, adj.inc);
}

/**
 * Back-edges found by a DFS in displayNo order: each is a (from, to) pair that
 * closes a cycle. Deterministic for a given process.
 */
export function findBackEdges(
  process: Process,
  adj = buildAdjacency(process),
): Array<{ from: string; to: string }> {
  const order = [...process.steps].sort((a, b) => a.displayNo - b.displayNo);
  const state = new Map<string, 0 | 1 | 2>();
  const back: Array<{ from: string; to: string }> = [];
  const visit = (id: string) => {
    state.set(id, 1);
    const outs = (adj.out.get(id) ?? [])
      .slice()
      .sort((a, b) => adj.byId.get(a)!.displayNo - adj.byId.get(b)!.displayNo);
    for (const n of outs) {
      const st = state.get(n) ?? 0;
      if (st === 1) back.push({ from: id, to: n });
      else if (st === 0) visit(n);
    }
    state.set(id, 2);
  };
  // Visit from starts first so back-edges follow the natural flow direction.
  for (const s of order.filter((x) => x.type === "start")) if (!state.get(s.id)) visit(s.id);
  for (const s of order) if (!state.get(s.id)) visit(s.id);
  return back;
}

export function hasCycle(process: Process): boolean {
  return findBackEdges(process).length > 0;
}
