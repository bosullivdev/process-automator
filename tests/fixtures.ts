import type { Party, Process, Step, Workspace } from "../src/model/types";

let counter = 0;
export function id(prefix = "id"): string {
  counter++;
  return `${prefix}${counter}`;
}

export function party(name: string, colourIndex = 0, extra: Partial<Party> = {}): Party {
  return { id: id("p"), name, colourIndex, ...extra };
}

export function step(partial: Partial<Step> & { displayNo: number; id: string }): Step {
  const { id: stepId, displayNo, ...rest } = partial;
  return {
    id: stepId,
    displayNo,
    name: `Step ${displayNo}`,
    type: "task",
    ownerId: null,
    next: [],
    technology: "",
    contributorIds: [],
    notes: "",
    ...rest,
  };
}

export function process(steps: Step[], partial: Partial<Process> = {}): Process {
  return { id: id("proc"), name: "Proc", ...partial, laneOrder: partial.laneOrder ?? [], steps };
}

export function workspace(parties: Party[], processes: Process[]): Workspace {
  return {
    schemaVersion: 1,
    meta: {
      name: "ws",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    parties,
    processes,
    view: {
      orientation: "horizontal",
      shapeMode: "simple",
      theme: "system",
      splitRatio: 0.5,
      activeProcessId: processes[0]?.id ?? null,
      annotations: "full",
    },
  };
}

/** start(a) -> task(b) -> decision(c) -> {end(d), task(e) -> end(f)} */
export function linearProcess(ownerA: string | null = null): Process {
  const a = step({
    id: "a",
    displayNo: 1,
    type: "start",
    ownerId: ownerA,
    next: [{ targetId: "b" }],
  });
  const b = step({
    id: "b",
    displayNo: 2,
    type: "task",
    ownerId: ownerA,
    next: [{ targetId: "c" }],
  });
  const c = step({
    id: "c",
    displayNo: 3,
    type: "decision",
    ownerId: ownerA,
    next: [
      { targetId: "d", label: "Yes", isDefault: true },
      { targetId: "e", label: "No" },
    ],
  });
  const d = step({ id: "d", displayNo: 4, type: "end", ownerId: ownerA });
  const e = step({
    id: "e",
    displayNo: 5,
    type: "task",
    ownerId: ownerA,
    next: [{ targetId: "f" }],
  });
  const f = step({ id: "f", displayNo: 6, type: "end", ownerId: ownerA });
  return process([a, b, c, d, e, f], { laneOrder: ownerA ? [ownerA] : [] });
}
