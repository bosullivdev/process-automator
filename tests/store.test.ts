import { beforeEach, describe, expect, it } from "vitest";
import { redo, undo, useStore } from "../src/store/workspace";
import { createEmptyWorkspace } from "../src/model/workspace";

describe("store undo/redo", () => {
  beforeEach(() => {
    useStore.getState().hydrate(createEmptyWorkspace());
  });

  it("undoes and redoes step edits but not view changes", () => {
    const s = useStore.getState();
    const procId = s.view.activeProcessId!;
    const stepId = s.addStep(procId, { partial: { name: "First" } });
    expect(useStore.getState().processes[0].steps).toHaveLength(1);

    useStore.getState().setView({ orientation: "vertical" });
    undo();
    expect(useStore.getState().processes[0].steps).toHaveLength(0);
    expect(useStore.getState().view.orientation).toBe("vertical");
    redo();
    expect(useStore.getState().processes[0].steps[0].id).toBe(stepId);
  });

  it("assigns stable display numbers", () => {
    const s = useStore.getState();
    const procId = s.view.activeProcessId!;
    const a = s.addStep(procId);
    const b = s.addStep(procId);
    useStore.getState().deleteStep(procId, a);
    const c = useStore.getState().addStep(procId);
    const steps = useStore.getState().processes[0].steps;
    expect(steps.map((x) => x.id)).toEqual([b, c]);
    expect(steps.map((x) => x.displayNo)).toEqual([2, 3]);
  });

  it("adds owner to lane order and removes links on end type", () => {
    const s = useStore.getState();
    const procId = s.view.activeProcessId!;
    const partyId = s.addParty("Ops");
    const a = useStore.getState().addStep(procId);
    const b = useStore.getState().addStep(procId);
    useStore.getState().setStepOwner(procId, a, partyId);
    useStore.getState().setStepNext(procId, a, [{ targetId: b }, { targetId: a }]);
    expect(useStore.getState().processes[0].laneOrder).toEqual([partyId]);
    expect(useStore.getState().processes[0].steps[0].next).toEqual([{ targetId: b }]);
    useStore.getState().setStepType(procId, a, "end");
    expect(useStore.getState().processes[0].steps[0].next).toEqual([]);
  });

  it("deleting the last process creates a fresh one", () => {
    const s = useStore.getState();
    const procId = s.view.activeProcessId!;
    s.deleteProcess(procId);
    const st = useStore.getState();
    expect(st.processes).toHaveLength(1);
    expect(st.processes[0].id).not.toBe(procId);
    expect(st.view.activeProcessId).toBe(st.processes[0].id);
  });

  it("duplicate step copies everything except next", () => {
    const s = useStore.getState();
    const procId = s.view.activeProcessId!;
    const a = s.addStep(procId, { partial: { name: "A", technology: "SAP", notes: "n" } });
    const b = useStore.getState().addStep(procId);
    useStore.getState().setStepNext(procId, a, [{ targetId: b }]);
    const c = useStore.getState().duplicateStep(procId, a)!;
    const steps = useStore.getState().processes[0].steps;
    const copy = steps.find((x) => x.id === c)!;
    expect(steps.map((x) => x.id)).toEqual([a, c, b]);
    expect(copy.name).toBe("A");
    expect(copy.technology).toBe("SAP");
    expect(copy.next).toEqual([]);
    expect(copy.displayNo).toBe(3);
  });
});

describe("step variants", () => {
  it("maps variants to type and kind fields and back, as one undo entry", async () => {
    const { stepVariant } = await import("../src/store/workspace");
    useStore.getState().hydrate(createEmptyWorkspace());
    const s = useStore.getState();
    const procId = s.view.activeProcessId!;
    const a = s.addStep(procId);
    const b = useStore.getState().addStep(procId);
    useStore.getState().setStepNext(procId, a, [{ targetId: b }]);
    const get = () => useStore.getState().processes[0].steps.find((x) => x.id === a)!;

    useStore.getState().setStepVariant(procId, a, "start:timer");
    expect(get()).toMatchObject({ type: "start", startKind: "timer" });
    expect(stepVariant(get())).toBe("start:timer");

    useStore.getState().setStepVariant(procId, a, "task:sub");
    expect(get()).toMatchObject({ type: "task", isSubProcess: true });
    expect(get().startKind).toBeUndefined();
    expect(stepVariant(get())).toBe("task:sub");

    useStore.getState().setStepVariant(procId, a, "end:terminate");
    expect(get()).toMatchObject({ type: "end", endKind: "terminate", next: [] });
    expect(get().isSubProcess).toBeUndefined();

    useStore.getState().setStepVariant(procId, a, "end");
    expect(get().endKind).toBeUndefined();
    expect(stepVariant(get())).toBe("end");

    undo();
    expect(stepVariant(get())).toBe("end:terminate");
  });
});
