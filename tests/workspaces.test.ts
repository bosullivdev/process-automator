import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adoptLegacyWorkspace,
  closeDb,
  deleteWorkspace as deleteStored,
  listWorkspaces,
  loadWorkspace,
  saveWorkspace,
} from "../src/persistence/db";
import { createEmptyWorkspace, uniqueName } from "../src/model/workspace";
import {
  createWorkspace,
  deleteWorkspace,
  startAutosave,
  switchWorkspace,
} from "../src/store/autosave";
import { getWorkspace, useStore } from "../src/store/workspace";
import type { Workspace } from "../src/model/types";

function named(name: string): Workspace {
  const ws = createEmptyWorkspace(name);
  return ws;
}

/** Write a workspace the way the app did before there could be several. */
async function seedLegacy(ws: Workspace): Promise<void> {
  const d = await openDB("process-mapper", 1, {
    upgrade(u) {
      u.createObjectStore("workspace");
      u.createObjectStore("prefs", { keyPath: "key" });
    },
  });
  await d.put("workspace", ws, "current");
  d.close();
}

beforeEach(() => {
  closeDb();
  globalThis.indexedDB = new IDBFactory();
});

describe("uniqueName", () => {
  it("keeps a free name and numbers a taken one, ignoring case", () => {
    expect(uniqueName("Ops", ["Sales"])).toBe("Ops");
    expect(uniqueName("Ops", ["ops "])).toBe("Ops 2");
    expect(uniqueName("Ops", ["Ops", "Ops 2"])).toBe("Ops 3");
    expect(uniqueName("  ", [])).toBe("Untitled workspace");
  });
});

describe("workspace storage", () => {
  it("stores workspaces side by side and lists them by name", async () => {
    await saveWorkspace("b", named("Zeta"));
    await saveWorkspace("a", named("alpha"));
    expect(await listWorkspaces()).toEqual([
      { id: "a", name: "alpha" },
      { id: "b", name: "Zeta" },
    ]);
    expect(((await loadWorkspace("b")) as Workspace).meta.name).toBe("Zeta");
    expect(await loadWorkspace("missing")).toBeUndefined();
  });

  it("deletes one workspace and leaves the others", async () => {
    await saveWorkspace("a", named("A"));
    await saveWorkspace("b", named("B"));
    await deleteStored("a");
    expect(await listWorkspaces()).toEqual([{ id: "b", name: "B" }]);
    expect(await loadWorkspace("a")).toBeUndefined();
  });

  it("carries the single workspace of an older version over, once", async () => {
    const old = named("Before");
    await seedLegacy(old);
    const id = await adoptLegacyWorkspace();
    expect(id).toBeTruthy();
    expect(await listWorkspaces()).toEqual([{ id, name: "Before" }]);
    expect(await loadWorkspace(id!)).toEqual(old);
    expect(await adoptLegacyWorkspace()).toBeNull();
    expect(await listWorkspaces()).toHaveLength(1);
  });

  it("has nothing to carry over in a new browser", async () => {
    expect(await adoptLegacyWorkspace()).toBeNull();
    expect(await listWorkspaces()).toEqual([]);
  });
});

describe("switching workspaces", () => {
  it("opens the old workspace, adds blank and imported ones, and deletes for good", async () => {
    vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
    const old = named("Before");
    await seedLegacy(old);
    const stop = await startAutosave();
    const store = () => useStore.getState();

    // The workspace from the older version is the one that opens.
    expect(store().meta.name).toBe("Before");
    expect(store().workspaceList).toHaveLength(1);
    const firstId = store().workspaceId!;

    store().addParty("Sales");
    store().setView({ orientation: "vertical" });
    store().addStep(store().processes[0].id, { partial: { name: "Take order" } });

    // A new workspace is blank, keeps the view setup, and cannot undo into the old one.
    await createWorkspace();
    expect(store().workspaceId).not.toBe(firstId);
    expect(store().meta.name).toBe("Untitled workspace");
    expect(store().parties).toEqual([]);
    expect(store().teams).toEqual([]);
    expect(store().processes).toHaveLength(1);
    expect(store().processes[0].steps).toEqual([]);
    expect(store().view.orientation).toBe("vertical");
    expect(useStore.temporal.getState().pastStates).toHaveLength(0);
    expect(store().workspaceList.map((w) => w.name)).toEqual(["Before", "Untitled workspace"]);
    const blankId = store().workspaceId!;

    // The old one was saved on the way out and comes back whole.
    await switchWorkspace(firstId);
    expect(store().meta.name).toBe("Before");
    expect(store().parties.map((p) => p.name)).toEqual(["Sales"]);
    expect(store().processes[0].steps.map((s) => s.name)).toEqual(["Take order"]);

    // An imported file becomes a third workspace; a clashing name is numbered.
    const file = named("Before");
    file.processes[0].name = "From file";
    await createWorkspace(file);
    expect(store().meta.name).toBe("Before 2");
    expect(store().processes[0].name).toBe("From file");
    expect(store().workspaceList).toHaveLength(3);
    const importedId = store().workspaceId!;

    // Deleting the open workspace removes its record and opens another.
    await deleteWorkspace(importedId);
    expect(await loadWorkspace(importedId)).toBeUndefined();
    expect(
      store()
        .workspaceList.map((w) => w.id)
        .sort(),
    ).toEqual([firstId, blankId].sort());
    expect([firstId, blankId]).toContain(store().workspaceId);

    // Deleting one that is not open leaves the open one alone.
    const openId = store().workspaceId!;
    const otherId = openId === firstId ? blankId : firstId;
    const before = getWorkspace();
    await deleteWorkspace(otherId);
    expect(store().workspaceId).toBe(openId);
    expect(getWorkspace()).toEqual(before);
    expect(store().workspaceList).toHaveLength(1);

    // Deleting the last one leaves a fresh empty workspace, stored under a new id.
    await deleteWorkspace(openId);
    expect(store().workspaceId).not.toBe(openId);
    expect(store().parties).toEqual([]);
    expect(store().processes[0].steps).toEqual([]);
    expect(await listWorkspaces()).toEqual([
      { id: store().workspaceId, name: "Untitled workspace" },
    ]);

    // An edit queued for a deleted workspace does not bring it back.
    store().addParty("Ghost");
    const doomed = store().workspaceId!;
    await deleteWorkspace(doomed);
    await new Promise((r) => setTimeout(r, 700));
    expect(await loadWorkspace(doomed)).toBeUndefined();

    stop();
    vi.unstubAllGlobals();
  });
});
