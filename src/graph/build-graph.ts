import type { NextLink, Party, Process, Step, Team } from "../model/types";
import { effectiveTeams, teamNames } from "../model/team";
import { buildAdjacency, canReachEnd } from "./analysis";
import {
  NODE_SIZE,
  UNASSIGNED_LANE,
  type LayoutEdge,
  type LayoutGraph,
  type LayoutNode,
  type LayoutNodeKind,
  type NodeText,
  type Orientation,
} from "./layout-types";
import { linesWidth, measureText, wrapToWidth } from "./text-metrics";

const NAME_SIZE = 12;
const SUB_SIZE = 10;
/** Technology pill row: a gap above it, then the pill. Badge row holds the contributor badges. */
export const TECH_GAP = 6;
export const TECH_ROW = 20;
export const BADGE_ROW = 24;
export const BADGE_SIZE = 18;
export const BADGE_GAP = 4;
/** Team scope pill row, under the badges. */
export const TEAM_ROW = 18;
/** Control marker row, last in the block: a shield icon and the control's reference. */
export const CONTROL_ROW = 18;
export const CONTROL_ICON = 12;
export type Annotations = "full" | "minimal";
const OUTSIDE_SIZE = 11;
const LINE_H = 14;
const TASK_PAD_X = 12;
const TASK_PAD_Y = 12;
const MAX_NAME_LINES = 8;
const OUTSIDE_MAX_WIDTH = 150;
const OUTSIDE_MAX_LINES = 4;
const OUTSIDE_GAP = 4;

type Sized = Pick<
  LayoutNode,
  "width" | "height" | "shapeWidth" | "shapeHeight" | "cx" | "cy" | "text"
>;

function sizeGateway(kind: "fork" | "join"): Sized {
  const { width, height } = NODE_SIZE[kind];
  return {
    width,
    height,
    shapeWidth: width,
    shapeHeight: height,
    cx: width / 2,
    cy: height / 2,
    text: {
      nameLines: [],
      techWidth: 0,
      badges: 0,
      teamsWidth: 0,
      controlWidth: 0,
      outside: false,
      labelWidth: 0,
      labelHeight: 0,
      symmetric: false,
    },
  };
}

/**
 * Size a step's node to its content. A task keeps its name inside a fixed-width
 * box that grows in height; start, end and decision shapes keep their size and
 * carry the name outside. Every kind carries its technology pill,
 * contributor badges and team scope outside the shape, in one annotation block
 * together with an outside name: below the shape when flow runs left-to-right,
 * to the right of it when flow runs top-to-bottom. The box includes that block
 * so rows reserve room for it; edges attach to the shape via (cx, cy).
 */
export function sizeStep(
  step: Step,
  orientation: Orientation,
  multiExit = false,
  annotations: Annotations = "full",
  teamLabel = "",
): Sized {
  const kind: LayoutNodeKind = step.type;
  const name = step.name.trim() || "Untitled";
  const full = annotations === "full";
  const badges = full ? step.contributorIds.length : 0;
  const badgesWidth = badges ? badges * (BADGE_SIZE + BADGE_GAP) - BADGE_GAP : 0;
  const techText = full ? step.technology.trim() : "";
  const tech = techText ? wrapToWidth(techText, OUTSIDE_MAX_WIDTH - 16, SUB_SIZE, 1)[0] : undefined;
  const techWidth = tech ? Math.ceil(measureText(tech, SUB_SIZE)) + 16 : 0;
  const teamsText = full ? teamLabel.trim() : "";
  const teams = teamsText
    ? wrapToWidth(teamsText, OUTSIDE_MAX_WIDTH - 16, SUB_SIZE, 1)[0]
    : undefined;
  const teamsWidth = teams ? Math.ceil(measureText(teams, SUB_SIZE)) + 16 : 0;

  // A control is part of what the step is, so its marker shows in minimal mode too.
  const controlRef = step.controlRef?.trim() ?? "";
  const control = step.hasControl
    ? wrapToWidth(
        controlRef ? `Control · ${controlRef}` : "Control",
        OUTSIDE_MAX_WIDTH - 16 - CONTROL_ICON,
        SUB_SIZE,
        1,
        600,
      )[0]
    : undefined;
  const controlWidth = control
    ? Math.ceil(measureText(control, SUB_SIZE, 600)) + 16 + CONTROL_ICON
    : 0;

  // Shape and inside text.
  let sw: number;
  let sh: number;
  let nameLines: string[];
  const outside = kind !== "task";
  if (kind === "task") {
    sw = NODE_SIZE.task.width;
    nameLines = wrapToWidth(name, sw - TASK_PAD_X * 2, NAME_SIZE, MAX_NAME_LINES, 500);
    sh = Math.max(
      NODE_SIZE.task.height,
      TASK_PAD_Y * 2 + nameLines.length * LINE_H + (step.isSubProcess ? 12 : 0),
    );
  } else {
    ({ width: sw, height: sh } = NODE_SIZE[kind]);
    nameLines = wrapToWidth(name, OUTSIDE_MAX_WIDTH, OUTSIDE_SIZE, OUTSIDE_MAX_LINES, 500);
  }

  // Outside block: name lines (non-task), then the technology pill, then badges, then teams.
  const nameH = outside ? nameLines.length * LINE_H : 0;
  const nameW = outside ? linesWidth(nameLines, OUTSIDE_SIZE, 500) : 0;
  const aboveTeams =
    nameH + (tech ? (nameH ? TECH_GAP : 0) + TECH_ROW : 0) + (badges ? BADGE_ROW : 0);
  const aboveControl = aboveTeams + (teams ? (aboveTeams ? TECH_GAP : 0) + TEAM_ROW : 0);
  const labelHeight = aboveControl + (control ? (aboveControl ? TECH_GAP : 0) + CONTROL_ROW : 0);
  const labelWidth = Math.ceil(Math.max(nameW, techWidth, badgesWidth, teamsWidth, controlWidth));
  const text: NodeText = {
    nameLines,
    tech,
    techWidth,
    badges,
    teams,
    teamsWidth,
    control,
    controlWidth,
    outside,
    labelWidth,
    labelHeight,
    symmetric: multiExit && labelHeight > 0,
  };
  if (labelHeight === 0) {
    return { width: sw, height: sh, shapeWidth: sw, shapeHeight: sh, cx: sw / 2, cy: sh / 2, text };
  }
  // A node with several outgoing links may send one of them out of the top or
  // bottom of the shape; the block then moves to the other side, so reserve
  // space on both sides.
  const reserve = multiExit ? 2 : 1;
  if (orientation === "horizontal") {
    const extra = OUTSIDE_GAP + labelHeight;
    return {
      width: Math.max(sw, labelWidth),
      height: sh + extra * reserve,
      shapeWidth: sw,
      shapeHeight: sh,
      cx: Math.max(sw, labelWidth) / 2,
      cy: sh / 2 + (multiExit ? extra : 0),
      text,
    };
  }
  const extra = OUTSIDE_GAP + labelWidth;
  return {
    width: sw + extra * reserve,
    height: Math.max(sh, labelHeight),
    shapeWidth: sw,
    shapeHeight: sh,
    cx: sw / 2 + (multiExit ? extra : 0),
    cy: Math.max(sh, labelHeight) / 2,
    text,
  };
}

export type ShapeMode = "simple" | "bpmn";

/** Gateway node ids take the node they belong to (a step id, or a co-owner copy's id). */
export function forkId(nodeId: string): string {
  return `gw:fork:${nodeId}`;
}
export function joinId(nodeId: string): string {
  return `gw:join:${nodeId}`;
}
/** Node id of a step's copy in a co-owner's lane; the owner's lane keeps the step id itself. */
export function laneNodeId(stepId: string, laneId: string): string {
  return `${stepId}@${laneId}`;
}

/**
 * Pure function from workspace data to the graph handed to layout. Nodes and
 * edges are emitted in displayNo order so layout is deterministic. Links to
 * missing steps and self-links are dropped (validation flags them). A step
 * with co-owners is drawn once per lane: every node of it carries the step's
 * links, so the step before fans out to every lane and the steps after join
 * them. In BPMN mode, parallel gateways are inserted after a task with two or
 * more outgoing arrows and before a node with two or more incoming arrows.
 */
export function buildLayoutGraph(
  process: Process,
  parties: readonly Party[],
  mode: ShapeMode,
  orientation: Orientation = "horizontal",
  annotations: Annotations = "full",
  teams: readonly Team[] = [],
): LayoutGraph {
  const steps = [...process.steps].sort((a, b) => a.displayNo - b.displayNo);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const partyIds = new Set(parties.map((p) => p.id));
  const laneOf = (ownerId: string | null) =>
    ownerId && partyIds.has(ownerId) ? ownerId : UNASSIGNED_LANE;

  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  const allTeamIds = teams.map((t) => t.id);

  // Lanes each step is drawn in, in order; the first node keeps the step id.
  const lanesOf = new Map<string, string[]>();
  const nodeIdsOf = new Map<string, string[]>();
  for (const s of steps) {
    const lanes = [laneOf(s.ownerId)];
    for (const id of s.coOwnerIds) if (partyIds.has(id) && !lanes.includes(id)) lanes.push(id);
    lanesOf.set(s.id, lanes);
    nodeIdsOf.set(
      s.id,
      lanes.map((lane, i) => (i === 0 ? s.id : laneNodeId(s.id, lane))),
    );
  }

  /*
   * Arrows between nodes. A link from step s to step t joins each copy of s
   * to each copy of t, except that a party's own copies stay together: when
   * both steps are drawn in the same lane, that lane's copies link to each
   * other only. So two consecutive steps shared by the same parties give one
   * clean run per lane; a lane that has only one of the steps fans out to, or
   * joins from, every copy of the other.
   */
  interface Arrow {
    link: NextLink;
    from: string;
    to: string;
  }
  const arrowsFrom = new Map<string, Arrow[]>();
  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();
  // Teams a lane copy applies to; an arrow between two copies needs a team in common
  // with both and with the link itself, else no team would ever travel it.
  const laneTeams = (s: Step, lane: string) =>
    effectiveTeams(s, lane === UNASSIGNED_LANE ? null : lane, allTeamIds);
  const sharesTeam = (a: readonly string[], b: readonly string[], link: readonly string[]) => {
    if (allTeamIds.length === 0) return true;
    const sets = [a, b, link].filter((x) => x.length > 0);
    if (sets.length === 0) return true;
    return allTeamIds.some((id) => sets.every((x) => x.includes(id)));
  };
  for (const s of steps) {
    const sLanes = lanesOf.get(s.id)!;
    const sIds = nodeIdsOf.get(s.id)!;
    const list: Arrow[] = [];
    for (const l of s.next) {
      if (l.targetId === s.id || !byId.has(l.targetId)) continue;
      const t = byId.get(l.targetId)!;
      const tLanes = lanesOf.get(l.targetId)!;
      const tIds = nodeIdsOf.get(l.targetId)!;
      sLanes.forEach((ls, si) => {
        tLanes.forEach((lt, ti) => {
          if (ls !== lt && tLanes.includes(ls) && sLanes.includes(lt)) return;
          if (!sharesTeam(laneTeams(s, ls), laneTeams(t, lt), l.teamIds ?? [])) return;
          const from = sIds[si];
          const to = tIds[ti];
          list.push({ link: l, from, to });
          outCount.set(from, (outCount.get(from) ?? 0) + 1);
          inCount.set(to, (inCount.get(to) ?? 0) + 1);
        });
      });
    }
    arrowsFrom.set(s.id, list);
  }

  const bpmn = mode === "bpmn";
  const dashedEdges = bpmn ? terminateDashedEdges(process) : new Set<string>();
  const hasJoin = (nodeId: string) => bpmn && (inCount.get(nodeId) ?? 0) >= 2;
  const hasFork = (step: Step, nodeId: string) =>
    bpmn && step.type === "task" && (outCount.get(nodeId) ?? 0) >= 2;

  for (const s of steps) {
    const lanes = lanesOf.get(s.id)!;
    nodeIdsOf.get(s.id)!.forEach((id, i) => {
      const lane = lanes[i];
      const teamIds = effectiveTeams(s, lane === UNASSIGNED_LANE ? null : lane, allTeamIds);
      if (hasJoin(id)) {
        nodes.push({
          id: joinId(id),
          kind: "join",
          laneId: lane,
          ...sizeGateway("join"),
          stepId: s.id,
          teamIds,
        });
      }
      nodes.push({
        id,
        kind: s.type,
        laneId: lane,
        ...sizeStep(
          s,
          orientation,
          (outCount.get(id) ?? 0) >= 2,
          annotations,
          teamNames(teamIds, teams).join(", "),
        ),
        pinFirst: s.type === "start",
        stepId: s.id,
        teamIds,
      });
      if (hasFork(s, id)) {
        nodes.push({
          id: forkId(id),
          kind: "fork",
          laneId: lane,
          ...sizeGateway("fork"),
          stepId: s.id,
          teamIds,
        });
        edges.push({
          id: `${id}->${forkId(id)}`,
          from: id,
          to: forkId(id),
          sourceStepId: s.id,
          targetStepId: s.id,
        });
      }
    });
    for (const a of arrowsFrom.get(s.id)!) {
      edges.push({
        id: `${a.from}->${a.to}`,
        from: hasFork(s, a.from) ? forkId(a.from) : a.from,
        to: hasJoin(a.to) ? joinId(a.to) : a.to,
        label: s.type === "decision" ? a.link.label?.trim() || "?" : undefined,
        isDefault: s.type === "decision" ? !!a.link.isDefault : undefined,
        dashed: dashedEdges.has(`${s.id}->${a.link.targetId}`) || undefined,
        sourceStepId: s.id,
        targetStepId: a.link.targetId,
      });
    }
  }
  // Join gateway -> node edges.
  if (bpmn) {
    for (const s of steps) {
      for (const id of nodeIdsOf.get(s.id)!) {
        if (!hasJoin(id)) continue;
        edges.push({
          id: `${joinId(id)}->${id}`,
          from: joinId(id),
          to: id,
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

  const laneNames: Record<string, string> = {};
  for (const id of laneOrder) {
    laneNames[id] =
      id === UNASSIGNED_LANE
        ? "Unassigned"
        : (parties.find((p) => p.id === id)?.name.trim() ?? "Unknown");
  }

  return { laneOrder, laneNames, nodes, edges };
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
