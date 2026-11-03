import { create } from "zustand";
import { temporal } from "zundo";
import { produce } from "immer";
import type {
  NextLink,
  Party,
  Process,
  Step,
  StepType,
  ViewSettings,
  Workspace,
} from "../model/types";
import {
  createParty,
  deleteParty as deletePartyPure,
  mergeParties as mergePartiesPure,
} from "../model/party";
import {
  createEmptyWorkspace,
  createProcess,
  createStep,
  duplicateProcess as duplicatePure,
  nextDisplayNo,
  nowIso,
} from "../model/workspace";

export type SaveStatus = "saved" | "saving" | "unsaved";

/** The undoable part of the state. */
export interface DocState {
  meta: Workspace["meta"];
  parties: Party[];
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
  setStepOwner: (processId: string, stepId: string, partyId: string | null) => void;
  setStepNext: (processId: string, stepId: string, next: NextLink[]) => void;
  removeLink: (processId: string, stepId: string, targetId: string) => void;
  deleteStep: (processId: string, stepId: string) => void;
  duplicateStep: (processId: string, stepId: string) => string | null;
  restoreStep: (processId: string, step: Step, index: number) => void;

  addParty: (name: string) => string;
  renameParty: (partyId: string, name: string) => void;
  mergeParties: (survivorId: string, droppedId: string) => void;
  deleteParty: (partyId: string) => void;
  setPartyOverride: (partyId: string, colour: string | undefined) => void;

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
          produce({ meta: state.meta, parties: state.parties, processes: state.processes }, (d) => {
            recipe(d);
            touch(d);
          }),
        );
        coalesceNext = false;
      };

      return {
        meta: initial.meta,
        parties: initial.parties,
        processes: initial.processes,
        view: initial.view,
        selectedStepId: null,
        saveStatus: "saved",
        hydrated: false,

        replaceWorkspace: (ws) =>
          set({
            meta: ws.meta,
            parties: ws.parties,
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
            if (!s) return;
            s.type = type;
            if (type === "end") s.next = [];
            if (type !== "decision") {
              s.next = s.next.map((l) => ({ targetId: l.targetId }));
            }
            if (type !== "start") delete s.startKind;
            if (type !== "end") delete s.endKind;
          }),
        setStepOwner: (processId, stepId, partyId) =>
          edit((d) => {
            const proc = findProcess(d, processId);
            const s = proc?.steps.find((x) => x.id === stepId);
            if (!proc || !s) return;
            s.ownerId = partyId;
            ensureLane(proc, partyId);
          }),
        setStepNext: (processId, stepId, next) =>
          edit((d) => {
            const s = findProcess(d, processId)?.steps.find((x) => x.id === stepId);
            if (!s) return;
            s.next = next.filter((l) => l.targetId !== stepId);
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
            processes: base.processes,
            view: {
              ...base.view,
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
        processes: state.processes,
      }),
      equality: (a, b) =>
        a.parties === b.parties && a.processes === b.processes && a.meta === b.meta,
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
