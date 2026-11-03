import type { Process, Step, Workspace } from "./types";
import { newId } from "./ids";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createStep(partial: Partial<Step> & { displayNo: number }): Step {
  return {
    id: newId(),
    name: "",
    type: "task",
    ownerId: null,
    next: [],
    technology: "",
    contributorIds: [],
    notes: "",
    ...partial,
  };
}

export function nextDisplayNo(process: Process): number {
  return process.steps.reduce((m, s) => Math.max(m, s.displayNo), 0) + 1;
}

export function createProcess(name: string): Process {
  return { id: newId(), name, laneOrder: [], steps: [] };
}

export function createEmptyWorkspace(name = "Untitled workspace"): Workspace {
  const process = createProcess("Process 1");
  const ts = nowIso();
  return {
    schemaVersion: 1,
    meta: { name, createdAt: ts, updatedAt: ts },
    parties: [],
    processes: [process],
    view: {
      orientation: "horizontal",
      shapeMode: "simple",
      theme: "system",
      splitRatio: 0.5,
      activeProcessId: process.id,
      annotations: "full",
    },
  };
}

export function isWorkspaceEmpty(ws: Workspace): boolean {
  return (
    ws.parties.length === 0 &&
    ws.processes.every((p) => p.steps.length === 0) &&
    ws.processes.length <= 1
  );
}

/** Deep-copy a process with fresh IDs for process and steps, remapping links. */
export function duplicateProcess(process: Process, name: string): Process {
  const idMap = new Map<string, string>();
  for (const s of process.steps) idMap.set(s.id, newId());
  return {
    ...process,
    id: newId(),
    name,
    laneOrder: [...process.laneOrder],
    steps: process.steps.map((s) => ({
      ...s,
      id: idMap.get(s.id)!,
      next: s.next.map((l) => ({ ...l, targetId: idMap.get(l.targetId) ?? l.targetId })),
      contributorIds: [...s.contributorIds],
    })),
  };
}
