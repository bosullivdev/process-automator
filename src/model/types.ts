export type StepType = "start" | "task" | "decision" | "end";
export type StartKind = "none" | "message" | "timer";
export type EndKind = "normal" | "terminate";

export interface Workspace {
  schemaVersion: 1;
  meta: { name: string; createdAt: string; updatedAt: string };
  parties: Party[];
  processes: Process[];
  view: ViewSettings;
}

export interface Party {
  id: string;
  name: string;
  colourIndex: number; // index into palette, see "Party colours"
  colourOverride?: string; // hex, workspace-wide manual override
}

export interface Process {
  id: string;
  name: string;
  owner?: string;
  version?: string;
  date?: string;
  laneOrder: string[]; // party IDs, per process
  steps: Step[]; // array order is table row order
}

export interface Step {
  id: string;
  displayNo: number; // 1-based, per process, stable once assigned
  name: string;
  type: StepType;
  ownerId: string | null; // null = Unassigned lane
  next: NextLink[]; // empty allowed only on "end"
  technology: string;
  contributorIds: string[]; // party IDs
  notes: string;
  isSubProcess?: boolean; // visual marker only
  startKind?: StartKind; // start only
  endKind?: EndKind; // end only
}

export interface NextLink {
  targetId: string; // step ID in the same process
  label?: string; // required on decision, ignored otherwise
  isDefault?: boolean; // decision only, at most one true per step
}

export interface ViewSettings {
  orientation: "horizontal" | "vertical";
  shapeMode: "simple" | "bpmn";
  theme: "system" | "light" | "dark";
  splitRatio: number; // 0.2 to 0.8
  activeProcessId: string | null;
  /** "full" shows technology and contributors on the map; "minimal" hides them. */
  annotations: "full" | "minimal";
}
