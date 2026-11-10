export type StepType = "start" | "task" | "decision" | "end";
export type StartKind = "none" | "message" | "timer";
export type EndKind = "normal" | "terminate";

export interface Workspace {
  schemaVersion: 1;
  meta: { name: string; createdAt: string; updatedAt: string };
  parties: Party[];
  /** Variants of a process: steps and links can be scoped to some teams only. */
  teams: Team[];
  processes: Process[];
  view: ViewSettings;
}

/**
 * A team that runs its own variant of the processes. Teams are not lanes:
 * their colour appears only on arrows and team pills, never on shapes or lane
 * backgrounds.
 */
export interface Team {
  id: string;
  name: string;
  colourIndex: number; // index into the same palette as parties, allocated among teams
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
  /**
   * Further parties that also do this step. The step stays one row; the map
   * draws it once in each co-owner's lane with the same links as the owner's.
   */
  coOwnerIds: string[];
  /**
   * Which teams each party (owner or co-owner) does this step for, by party
   * id. A party with no entry does it for every team the step applies to.
   * Lets one shared step have different owners per team.
   */
  ownerTeams?: Record<string, string[]>;
  next: NextLink[]; // empty allowed only on "end"
  technology: string;
  contributorIds: string[]; // party IDs
  notes: string;
  teamIds: string[]; // team IDs this step applies to; empty = every team
  isSubProcess?: boolean; // visual marker only
  startKind?: StartKind; // start only
  endKind?: EndKind; // end only
}

export interface NextLink {
  targetId: string; // step ID in the same process
  label?: string; // required on decision, ignored otherwise
  isDefault?: boolean; // decision only, at most one true per step
  teamIds?: string[]; // team IDs this link applies to; empty or absent = every team
}

export interface ViewSettings {
  orientation: "horizontal" | "vertical";
  shapeMode: "simple" | "bpmn";
  theme: "system" | "light" | "dark";
  splitRatio: number; // 0.2 to 0.8
  activeProcessId: string | null;
  /** "full" shows technology and contributors on the map; "minimal" hides them. */
  annotations: "full" | "minimal";
  /** The team whose variant is emphasised, or null for the whole process. */
  highlightTeamId: string | null;
  /** "highlight" fades everything outside the team; "isolate" shows the team's variant alone. */
  teamFocus: "highlight" | "isolate";
}
