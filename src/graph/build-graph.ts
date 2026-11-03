import type { Party, Process } from "../model/types";
import { buildAdjacency, canReachEnd } from "./analysis";
import {
  NODE_SIZE,
  UNASSIGNED_LANE,
  type LayoutEdge,
  type LayoutGraph,
  type LayoutNode,
} from "./layout-types";

export type ShapeMode = "simple" | "bpmn";

export function forkId(stepId: string): string {
  return `gw:fork:${stepId}`;
}
export function joinId(stepId: string): string {
  return `gw:join:${stepId}`;
}

/**
 * Pure function from workspace data to the graph handed to layout. Nodes and
 * edges are emitted in displayNo order so layout is deterministic. Links to
 * missing steps and self-links are dropped (validation flags them). In BPMN
 * mode, parallel gateways are inserted after a task with two or more next
 * links and before a step with two or more incoming links.
 */
export function buildLayoutGraph(
  process: Process,
  parties: readonly Party[],
  mode: ShapeMode,
): LayoutGraph {
  const steps = [...process.steps].sort((a, b) => a.displayNo - b.displayNo);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const partyIds = new Set(parties.map((p) => p.id));
  const laneOf = (ownerId: string | null) =>
    ownerId && partyIds.has(ownerId) ? ownerId : UNASSIGNED_LANE;

  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];

  const incoming = new Map<string, number>();
  for (const s of steps) {
    for (const l of s.next) {
      if (l.targetId !== s.id && byId.has(l.targetId)) {
        incoming.set(l.targetId, (incoming.get(l.targetId) ?? 0) + 1);
      }
    }
  }

  const bpmn = mode === "bpmn";
  const dashedEdges = bpmn ? terminateDashedEdges(process) : new Set<string>();

  for (const s of steps) {
    const lane = laneOf(s.ownerId);
    const hasJoin = bpmn && (incoming.get(s.id) ?? 0) >= 2;
    if (hasJoin) {
      nodes.push({ id: joinId(s.id), kind: "join", laneId: lane, ...NODE_SIZE.join, stepId: s.id });
    }
    nodes.push({
      id: s.id,
      kind: s.type,
      laneId: lane,
      ...NODE_SIZE[s.type],
      pinFirst: s.type === "start",
      stepId: s.id,
    });
    const validLinks = s.next.filter((l) => l.targetId !== s.id && byId.has(l.targetId));
    const hasFork = bpmn && s.type === "task" && validLinks.length >= 2;
    if (hasFork) {
      nodes.push({ id: forkId(s.id), kind: "fork", laneId: lane, ...NODE_SIZE.fork, stepId: s.id });
      edges.push({
        id: `${s.id}->${forkId(s.id)}`,
        from: s.id,
        to: forkId(s.id),
        sourceStepId: s.id,
        targetStepId: s.id,
      });
    }
    const from = hasFork ? forkId(s.id) : s.id;
    for (const l of validLinks) {
      const targetHasJoin = bpmn && (incoming.get(l.targetId) ?? 0) >= 2;
      const to = targetHasJoin ? joinId(l.targetId) : l.targetId;
      edges.push({
        id: `${s.id}->${l.targetId}`,
        from,
        to,
        label: s.type === "decision" ? l.label?.trim() || "?" : undefined,
        isDefault: s.type === "decision" ? !!l.isDefault : undefined,
        dashed: dashedEdges.has(`${s.id}->${l.targetId}`) || undefined,
        sourceStepId: s.id,
        targetStepId: l.targetId,
      });
    }
  }
  // Join gateway -> step edges.
  if (bpmn) {
    for (const s of steps) {
      if ((incoming.get(s.id) ?? 0) >= 2) {
        edges.push({
          id: `${joinId(s.id)}->${s.id}`,
          from: joinId(s.id),
          to: s.id,
          sourceStepId: s.id,
          targetStepId: s.id,
          dashed: dashedEdges.has(`join:${s.id}`) || undefined,
        });
      }
    }
  }

  const used = new Set(nodes.map((n) => n.laneId));
  const laneOrder = process.laneOrder.filter((id) => used.has(id));
  if (used.has(UNASSIGNED_LANE)) laneOrder.push(UNASSIGNED_LANE);
  // Lanes referenced by nodes but missing from laneOrder (should not happen) go before Unassigned.
  for (const id of used) {
    if (!laneOrder.includes(id))
      laneOrder.splice(laneOrder.length - (used.has(UNASSIGNED_LANE) ? 1 : 0), 0, id);
  }

  return { laneOrder, nodes, edges };
}

/**
 * Edges (as "source->target") that should be drawn dashed in BPMN mode: when a
 * parallel fork has one branch that reaches a terminate end, the other
 * branches' downstream edges are cut short by that termination.
 */
export function terminateDashedEdges(process: Process): Set<string> {
  const out = new Set<string>();
  const adj = buildAdjacency(process);
  const terminates = new Set(
    process.steps.filter((s) => s.type === "end" && s.endKind === "terminate").map((s) => s.id),
  );
  if (terminates.size === 0) return out;
  const reachesTerminate = canReachEndOfKind(process, terminates);
  for (const s of process.steps) {
    if (s.type !== "task") continue;
    const branches = s.next.map((l) => l.targetId).filter((t) => t !== s.id && adj.byId.has(t));
    if (branches.length < 2) continue;
    const terminating = branches.filter((b) => reachesTerminate.has(b));
    if (terminating.length === 0 || terminating.length === branches.length) continue;
    const protectedNodes = reachAll(terminating, adj.out);
    for (const b of branches) {
      if (terminating.includes(b)) continue;
      // Everything downstream of the non-terminating branch that is not shared with the terminating one.
      const downstream = reachAll([b], adj.out);
      for (const id of downstream) {
        if (protectedNodes.has(id)) continue;
        for (const l of adj.byId.get(id)!.next) {
          if (adj.byId.has(l.targetId)) out.add(`${id}->${l.targetId}`);
        }
        if ((adj.inc.get(id)?.length ?? 0) >= 2) out.add(`join:${id}`);
      }
      out.add(`${s.id}->${b}`);
    }
  }
  return out;
}

function reachAll(seeds: string[], edges: Map<string, string[]>): Set<string> {
  const seen = new Set<string>(seeds);
  const q = [...seeds];
  while (q.length) {
    const id = q.shift()!;
    for (const n of edges.get(id) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        q.push(n);
      }
    }
  }
  return seen;
}

function canReachEndOfKind(process: Process, ends: Set<string>): Set<string> {
  const sub: Process = {
    ...process,
    steps: process.steps.map((s) =>
      s.type === "end" && !ends.has(s.id) ? { ...s, type: "task" as const } : s,
    ),
  };
  return canReachEnd(sub);
}
