export type Orientation = "horizontal" | "vertical";

export type LayoutNodeKind = "start" | "task" | "decision" | "end" | "fork" | "join";

export const UNASSIGNED_LANE = "__unassigned";

export interface NodeText {
  /** Wrapped name lines, sized to the shape (or to the outside label width). */
  nameLines: string[];
  /** Technology line, already fitted to one line. */
  tech?: string;
  /** Whether the name is drawn outside the shape (start, end, decision). */
  outside: boolean;
  /** Outside label box size (0 when the name is inside). */
  labelWidth: number;
  labelHeight: number;
  /** Label space is reserved on both sides so the name can move away from a side exit. */
  symmetric: boolean;
}

export interface LayoutNode {
  /** Step id, or a synthetic id for inserted gateways. */
  id: string;
  kind: LayoutNodeKind;
  laneId: string;
  /** Screen-space size of the whole node box (shape plus any outside label). */
  width: number;
  height: number;
  /** Size of the drawn shape inside the box. */
  shapeWidth: number;
  shapeHeight: number;
  /** Shape centre relative to the box's top-left; edges attach to the shape. */
  cx: number;
  cy: number;
  text: NodeText;
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

/** Which side of the shape an outside name is drawn on. */
export type LabelSide = "below" | "above" | "right" | "left";

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
  labelSide: LabelSide;
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
