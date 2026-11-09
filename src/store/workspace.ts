import { create } from "zustand";
import { temporal } from "zundo";
import { produce } from "immer";
import type {
  NextLink,
  Party,
  Process,
  Step,
  StepType,
  Team,
  ViewSettings,
  Workspace,
} from "../model/types";
import {
  createParty,
  deleteParty as deletePartyPure,
  mergeParties as mergePartiesPure,
} from "../model/party";
import { assignOwners as assignOwnersPure } from "../model/share";
import {
  createTeam,
  deleteTeam as deleteTeamPure,
  renameTeam as renameTeamPure,
} from "../model/team";
import {
  createEmptyWorkspace,
  createProcess,
  createStep,
  duplicateProcess as duplicatePure,
  nextDisplayNo,
  nowIso,
} from "../model/workspace";

export type SaveStatus = "saved" | "saving" | "unsaved";

/** The options offered in the table's Type dropdown. */
export type StepVariant =
  | "start"
  | "start:message"
  | "start:timer"
  | "task"
  | "task:sub"
  | "decision"
  | "end"
  | "end:terminate";

export function stepVariant(
  step: Pick<Step, "type" | "startKind" | "endKind" | "isSubProcess">,
): StepVariant {
  switch (step.type) {
    case "start":
      return step.startKind === "message" || step.startKind === "timer"
        ? `start:${step.startKind}`
        : "start";
    case "task":
      return step.isSubProcess ? "task:sub" : "task";
    case "end":
      return step.endKind === "terminate" ? "end:terminate" : "end";
    default:
      return "decision";
  }
}

/** Apply a type change to a step in place: links and kind fields are kept consistent. */
function applyType(s: Step, type: StepType): void {
  s.type = type;
  if (type === "end") s.next = [];
  if (type !== "decision") s.next = s.next.map((l) => ({ targetId: l.targetId }));
  if (type !== "start") delete s.startKind;
  if (type !== "end") delete s.endKind;
  if (type !== "task") delete s.isSubProcess;
}

/** The undoable part of the state. */
export interface DocState {
  meta: Workspace["meta"];
  parties: Party[];
  teams: Team[];
  processes: Process[];
}

export interface StoreState extends DocState {
  view: ViewSettings;
  selectedStepId: string | null;
  saveStatus: SaveStatus;
  hydrated: boolean;

  // --- document edits (undoable)
  replaceWorkspace: (ws: Workspace) => void;
  setWorkspaceName: (name: string) => void;

  addStep: (processId: string, opts?: { afterStepId?: string; partial?: Partial<Step> }) => string;
  updateStep: (processId: string, stepId: string, patch: Partial<Step>) => void;
  setStepType: (processId: string, stepId: string, type: StepType) => void;
  /** Set type and its variant (start kind, end kind, sub-process marker) as one undoable edit. */
  setStepVariant: (processId: string, stepId: string, variant: StepVariant) => void;
  setStepOwner: (processId: string, stepId: string, partyId: string | null) => void;
  /**
   * Give a step several responsible teams in one undoable edit: the first
   * becomes the owner, each further team gets a linked copy in its own lane.
   * Returns the IDs of the copies.
   */
  assignOwners: (processId: string, stepId: string, partyIds: string[]) => string[];
  setStepNext: (processId: string, stepId: string, next: NextLink[]) => void;
  /** Scope a step to some teams; an empty list means every team. */
  setStepTeams: (processId: string, stepId: string, teamIds: string[]) => void;
  removeLink: (processId: string, stepId: string, targetId: string) => void;
  deleteStep: (processId: string, stepId: string) => void;
  duplicateStep: (processId: string, stepId: string) => string | null;
  restoreStep: (processId: string, step: Step, index: number) => void;
  /** Reorder table rows. Ids not listed keep their relative order after the listed ones. */
  reorderSteps: (processId: string, orderedIds: string[]) => void;

  addParty: (name: string) => string;
  renameParty: (partyId: string, name: string) => void;
  mergeParties: (survivorId: string, droppedId: string) => void;
  deleteParty: (partyId: string) => void;
  setPartyOverride: (partyId: string, colour: string | undefined) => void;

  addTeam: (name: string) => string;
  renameTeam: (teamId: string, name: string) => void;
  /** No-op while the team is referenced by any step or link. */
  deleteTeam: (teamId: string) => void;

  addProcess: (name?: string) => string;
  renameProcess: (processId: string, name: string) => void;
  updateProcessMeta: (
    processId: string,
    patch: Partial<Pick<Process, "owner" | "version" | "date">>,
  ) => void;
  duplicateProcess: (processId: string) => string;
  deleteProcess: (processId: string) => void;
  setLaneOrder: (processId: string, laneOrder: string[]) => void;

  // --- view / transient (not undoable)
  setView: (patch: Partial<ViewSettings>) => void;
  setActiveProcess: (processId: string | null) => void;
  selectStep: (stepId: string | null) => void;
  setSaveStatus: (s: SaveStatus) => void;
  hydrate: (ws: Workspace | undefined) => void;
}

function touch(doc: DocState): void {
  doc.meta.updatedAt = nowIso();
}

function findProcess(doc: DocState, processId: string): Process | undefined {
  return doc.processes.find((p) => p.id === processId);
}

function ensureLane(proc: Process, partyId: string | null): void {
  if (partyId && !proc.laneOrder.includes(partyId)) proc.laneOrder.push(partyId);
}

const initial = createEmptyWorkspace();

/** Typing into a cell sets this so consecutive keystrokes share one undo entry. */
let coalesceNext = false;
let lastRecordAt = 0;
const COALESCE_MS = 800;

export const useStore = create<StoreState>()(
  temporal(
    (set, get) => {
      /** Apply an immer recipe to the document part of the state. */
      const edit = (recipe: (doc: DocState) => void, coalesce = false) => {
        coalesceNext = coalesce;
        set((state) =>
          produce(
            {
              meta: state.meta,
              parties: state.parties,
              teams: state.teams,
              processes: state.processes,
            },
            (d) => {
              recipe(d);
              touch(d);
            },
          ),
        );
        coalesceNext = false;
      };

      return {
        meta: initial.meta,
        parties: initial.parties,
        teams: initial.teams,
        processes: initial.processes,
        view: initial.view,
        selectedStepId: null,
        saveStatus: "saved",
        hydrated: false,

        replaceWorkspace: (ws) =>
          set({
            meta: ws.meta,
            parties: ws.parties,
            teams: ws.teams,
            processes: ws.processes,
            view: ws.view,
            selectedStepId: null,
          }),
        setWorkspaceName: (name) =>
          edit((d) => {
            d.meta.name = name;
          }),

        addStep: (processId, opts) => {
          const step = createStep({
            displayNo: 1,
            ...opts?.partial,
          });
          edit((d) => {
            const proc = findProcess(d, processId);
            if (!proc) return;
            step.displayNo = nextDisplayNo(proc);
            ensureLane(proc, step.ownerId);
            const idx = opts?.afterStepId
              ? proc.steps.findIndex((s) => s.id === opts.afterStepId)
              : -1;
            if (idx >= 0) proc.steps.splice(idx + 1, 0, step);
            else proc.steps.push(step);
          });
          return step.id;
        },
        updateStep: (processId, stepId, patch) =>
          edit(
            (d) => {
              const proc = findProcess(d, processId);
              const s = proc?.steps.find((x) => x.id === stepId);
              if (!proc || !s) return;
              Object.assign(s, patch);
              if ("ownerId" in patch) ensureLane(proc, s.ownerId);
            },
            // Text edits coalesce; structural edits always get their own entry.
            Object.keys(patch).every((k) => ["name", "technology", "notes"].includes(k)),
          ),
        setStepType: (processId, stepId, type) =>
          edit((d) => {
            const s = findProcess(d, processId)?.steps.find((x) => x.id === stepId);
            if (s) applyType(s, type);
          }),
        setStepVariant: (processId, stepId, variant) =>
          edit((d) => {
            const s = findProcess(d, processId)?.steps.find((x) => x.id === stepId);
            if (!s) return;
            const [type, kind] = variant.split(":") as [StepType, string | undefined];
            applyType(s, type);
            if (type === "start") {
              if (kind === "message" || kind === "timer") s.startKind = kind;
              else delete s.startKind;
            } else if (type === "end") {
              if (kind === "terminate") s.endKind = "terminate";
              else delete s.endKind;
            } else if (type === "task") {
              if (kind === "sub") s.isSubProcess = true;
              else delete s.isSubProcess;
            }
          }),
        setStepOwner: (processId, stepId, partyId) =>
          edit((d) => {
            const proc = findProcess(d, processId);
            const s = proc?.steps.find((x) => x.id === stepId);
            if (!proc || !s) return;
            s.ownerId = partyId;
            ensureLane(proc, partyId);
          }),
        assignOwners: (processId, stepId, partyIds) => {
          let copyIds: string[] = [];
          edit((d) => {
            const idx = d.processes.findIndex((p) => p.id === processId);
            if (idx < 0) return;
            const result = assignOwnersPure(d.processes[idx], stepId, partyIds, d.parties);
            d.processes[idx] = result.process;
            copyIds = result.copyIds;
          });
          return copyIds;
        },
        setStepNext: (processId, stepId, next) =>
          edit((d) => {
            const s = findProcess(d, processId)?.steps.find((x) => x.id === stepId);
            if (!s) return;
            s.next = next.filter((l) => l.targetId !== stepId);
          }),
        setStepTeams: (processId, stepId, teamIds) =>
          edit((d) => {
            const s = findProcess(d, processId)?.steps.find((x) => x.id === stepId);
            if (s) s.teamIds = [...new Set(teamIds)];
          }),
        removeLink: (processId, stepId, targetId) =>
          edit((d) => {
            const s = findProcess(d, processId)?.steps.find((x) => x.id === stepId);
            if (!s) return;
            s.next = s.next.filter((l) => l.targetId !== targetId);
          }),
        deleteStep: (processId, stepId) => {
          edit((d) => {
            const proc = findProcess(d, processId);
            if (!proc) return;
            proc.steps = proc.steps.filter((s) => s.id !== stepId);
          });
          if (get().selectedStepId === stepId) set({ selectedStepId: null });
        },
        duplicateStep: (processId, stepId) => {
          const proc = get().processes.find((p) => p.id === processId);
          const src = proc?.steps.find((s) => s.id === stepId);
          if (!proc || !src) return null;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id: _srcId, ...rest } = src;
          const copy = createStep({
            ...rest,
            displayNo: nextDisplayNo(proc),
            next: [],
            contributorIds: [...src.contributorIds],
          });
          edit((d) => {
            const p = findProcess(d, processId);
            if (!p) return;
            copy.displayNo = nextDisplayNo(p);
            const idx = p.steps.findIndex((s) => s.id === stepId);
            p.steps.splice(idx + 1, 0, copy);
          });
          return copy.id;
        },
        restoreStep: (processId, step, index) =>
          edit((d) => {
            const proc = findProcess(d, processId);
            if (!proc || proc.steps.some((s) => s.id === step.id)) return;
            proc.steps.splice(Math.min(index, proc.steps.length), 0, step);
            ensureLane(proc, step.ownerId);
          }),

        reorderSteps: (processId, orderedIds) =>
          edit((d) => {
            const proc = findProcess(d, processId);
            if (!proc) return;
            const byId = new Map(proc.steps.map((x) => [x.id, x]));
            const listed = orderedIds.map((id) => byId.get(id)).filter((x): x is Step => !!x);
            const rest = proc.steps.filter((x) => !orderedIds.includes(x.id));
            proc.steps = [...listed, ...rest];
          }),
        addParty: (name) => {
          const party = createParty(name, get().parties);
          edit((d) => {
            d.parties.push(party);
          });
          return party.id;
        },
        renameParty: (partyId, name) =>
          edit((d) => {
            const p = d.parties.find((x) => x.id === partyId);
            if (p) p.name = name.trim();
          }),
        mergeParties: (survivorId, droppedId) =>
          edit((d) => {
            const ws = mergePartiesPure(asWorkspace(d), survivorId, droppedId);
            d.parties = ws.parties;
            d.processes = ws.processes;
          }),
        deleteParty: (partyId) =>
          edit((d) => {
            const ws = deletePartyPure(asWorkspace(d), partyId);
            d.parties = ws.parties;
            d.processes = ws.processes;
          }),
        setPartyOverride: (partyId, colour) =>
          edit((d) => {
            const p = d.parties.find((x) => x.id === partyId);
            if (!p) return;
            if (colour) p.colourOverride = colour;
            else delete p.colourOverride;
          }),

        addTeam: (name) => {
          const team = createTeam(name);
          edit((d) => {
            d.teams.push(team);
          });
          return team.id;
        },
        renameTeam: (teamId, name) =>
          edit((d) => {
            d.teams = renameTeamPure(asWorkspace(d), teamId, name).teams;
          }),
        deleteTeam: (teamId) => {
          edit((d) => {
            d.teams = deleteTeamPure(asWorkspace(d), teamId).teams;
          });
          if (get().view.highlightTeamId === teamId && !get().teams.some((t) => t.id === teamId)) {
            set((s) => ({ view: { ...s.view, highlightTeamId: null } }));
          }
        },

        addProcess: (name) => {
          const proc = createProcess(name ?? `Process ${get().processes.length + 1}`);
          edit((d) => {
            d.processes.push(proc);
          });
          set((s) => ({ view: { ...s.view, activeProcessId: proc.id }, selectedStepId: null }));
          return proc.id;
        },
        renameProcess: (processId, name) =>
          edit((d) => {
            const p = findProcess(d, processId);
            if (p) p.name = name;
          }),
        updateProcessMeta: (processId, patch) =>
          edit((d) => {
            const p = findProcess(d, processId);
            if (!p) return;
            for (const key of ["owner", "version", "date"] as const) {
              if (key in patch) {
                const v = patch[key];
                if (v) p[key] = v;
                else delete p[key];
              }
            }
          }),
        duplicateProcess: (processId) => {
          const src = get().processes.find((p) => p.id === processId);
          if (!src) return processId;
          const copy = duplicatePure(src, `${src.name} (copy)`);
          edit((d) => {
            const idx = d.processes.findIndex((p) => p.id === processId);
            d.processes.splice(idx + 1, 0, copy);
          });
          set((s) => ({ view: { ...s.view, activeProcessId: copy.id }, selectedStepId: null }));
          return copy.id;
        },
        deleteProcess: (processId) => {
          let nextActive: string | null = null;
          edit((d) => {
            const idx = d.processes.findIndex((p) => p.id === processId);
            if (idx < 0) return;
            d.processes.splice(idx, 1);
            if (d.processes.length === 0) d.processes.push(createProcess("Process 1"));
            nextActive = d.processes[Math.min(idx, d.processes.length - 1)].id;
          });
          if (get().view.activeProcessId === processId) {
            set((s) => ({
              view: { ...s.view, activeProcessId: nextActive },
              selectedStepId: null,
            }));
          }
        },
        setLaneOrder: (processId, laneOrder) =>
          edit((d) => {
            const p = findProcess(d, processId);
            if (p) p.laneOrder = laneOrder;
          }),

        setView: (patch) => set((s) => ({ view: { ...s.view, ...patch } })),
        setActiveProcess: (processId) =>
          set((s) => ({ view: { ...s.view, activeProcessId: processId }, selectedStepId: null })),
        selectStep: (stepId) => set({ selectedStepId: stepId }),
        setSaveStatus: (saveStatus) => set({ saveStatus }),
        hydrate: (ws) => {
          const base = ws ?? createEmptyWorkspace();
          const activeOk = base.processes.some((p) => p.id === base.view.activeProcessId);
          set({
            meta: base.meta,
            parties: base.parties,
            teams: base.teams ?? [],
            processes: base.processes,
            view: {
              ...base.view,
              annotations: base.view.annotations ?? "full",
              highlightTeamId: base.teams?.some((t) => t.id === base.view.highlightTeamId)
                ? base.view.highlightTeamId
                : null,
              teamFocus: base.view.teamFocus ?? "highlight",
              activeProcessId: activeOk
                ? base.view.activeProcessId
                : (base.processes[0]?.id ?? null),
            },
            hydrated: true,
            saveStatus: "saved",
          });
          useStore.temporal.getState().clear();
        },
      };
    },
    {
      partialize: (state) => ({
        meta: state.meta,
        parties: state.parties,
        teams: state.teams,
        processes: state.processes,
      }),
      equality: (a, b) =>
        a.parties === b.parties &&
        a.teams === b.teams &&
        a.processes === b.processes &&
        a.meta === b.meta,
      limit: 200,
      handleSet: (handleSet) => (pastState, replace) => {
        const now = Date.now();
        if (coalesceNext && now - lastRecordAt < COALESCE_MS) {
          lastRecordAt = now;
          return;
        }
        lastRecordAt = now;
        // zundo only ever records partial (non-replacing) snapshots here.
        void replace;
        handleSet(pastState);
      },
    },
  ),
);

function asWorkspace(doc: DocState): Workspace {
  return {
    schemaVersion: 1,
    meta: doc.meta,
    parties: doc.parties,
    teams: doc.teams,
    processes: doc.processes,
    view: useStore.getState().view,
  };
}

/** Compose a full Workspace object from the store. */
export function selectWorkspace(s: StoreState): Workspace {
  return {
    schemaVersion: 1,
    meta: s.meta,
    parties: s.parties,
    teams: s.teams,
    processes: s.processes,
    view: s.view,
  };
}

export function getWorkspace(): Workspace {
  return selectWorkspace(useStore.getState());
}

export function selectActiveProcess(s: StoreState): Process | undefined {
  return s.processes.find((p) => p.id === s.view.activeProcessId) ?? s.processes[0];
}

export function undo(): void {
  useStore.temporal.getState().undo();
}
export function redo(): void {
  useStore.temporal.getState().redo();
}
