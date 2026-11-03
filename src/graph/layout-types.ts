export type Orientation = "horizontal" | "vertical";

export type LayoutNodeKind = "start" | "task" | "decision" | "end" | "fork" | "join";

export const UNASSIGNED_LANE = "__unassigned";

export interface LayoutNode {
  /** Step id, or a synthetic id for inserted gateways. */
  id: string;
  kind: LayoutNodeKind;
  laneId: string;
  /** Screen-space size, independent of orientation. */
  width: number;
  height: number;
  /** Pin to the first layer (start steps). */
  pinFirst?: boolean;
  /** For gateways: the step this gateway was inserted for. */
  stepId: string;
}

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  isDefault?: boolean;
  dashed?: boolean;
  /** The step whose `next` produced this edge, for selection highlighting. */
  sourceStepId: string;
  targetStepId: string;
}

export interface LayoutGraph {
  /** Lane ids in display order; only lanes with at least one node. */
  laneOrder: string[];
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export interface Point {
  x: number;
  y: number;
}

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
}

export interface RoutedEdge {
  id: string;
  points: Point[];
  /** Where to draw the label pill, if the edge has a label. */
  labelAt?: Point;
}

export interface LaneBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Header strip, at the flow-axis start of the lane. */
  header: { x: number; y: number; width: number; height: number };
}

export interface LayoutResult {
  width: number;
  height: number;
  orientation: Orientation;
  lanes: LaneBox[];
  nodes: PositionedNode[];
  edges: RoutedEdge[];
}

export const NODE_SIZE: Record<LayoutNodeKind, { width: number; height: number }> = {
  start: { width: 44, height: 44 },
  end: { width: 44, height: 44 },
  task: { width: 168, height: 60 },
  decision: { width: 76, height: 76 },
  fork: { width: 40, height: 40 },
  join: { width: 40, height: 40 },
};
