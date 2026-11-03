import { getWorkspace, useStore } from "./workspace";
import { loadWorkspace, saveWorkspace } from "../persistence/db";
import { migrate } from "../model/schema";
import type { Workspace } from "../model/types";

const DEBOUNCE_MS = 500;

/** JSON of the last workspace written to IndexedDB. Used for "unsaved differences" checks. */
let lastSavedJson = "";

export function workspaceJson(ws: Workspace): string {
  return JSON.stringify(ws);
}

export function hasUnsavedChanges(): boolean {
  return workspaceJson(getWorkspace()) !== lastSavedJson;
}

export function markSaved(ws: Workspace): void {
  lastSavedJson = workspaceJson(ws);
}

/** Load the saved workspace, hydrate the store, and begin autosaving. Returns a stop function. */
export async function startAutosave(): Promise<() => void> {
  let stored: Workspace | undefined;
  try {
    const raw = await loadWorkspace();
    stored = raw ? migrate(raw) : undefined;
  } catch (err) {
    console.error("Stored workspace could not be read; starting fresh.", err);
    stored = undefined;
  }
  useStore.getState().hydrate(stored);
  markSaved(getWorkspace());

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Workspace | null = null;
  let writing = false;

  const flush = async () => {
    if (writing || !pending) return;
    writing = true;
    const ws = pending;
    pending = null;
    useStore.getState().setSaveStatus("saving");
    try {
      await saveWorkspace(ws);
      markSaved(ws);
      if (!pending) useStore.getState().setSaveStatus("saved");
    } catch (err) {
      console.error("Autosave failed", err);
      useStore.getState().setSaveStatus("unsaved");
    } finally {
      writing = false;
      if (pending) void flush();
    }
  };

  const unsubscribe = useStore.subscribe((state, prev) => {
    if (!state.hydrated) return;
    if (
      state.meta === prev.meta &&
      state.parties === prev.parties &&
      state.processes === prev.processes &&
      state.view === prev.view
    ) {
      return;
    }
    const ws = getWorkspace();
    if (workspaceJson(ws) === lastSavedJson) return;
    pending = ws;
    if (state.saveStatus !== "unsaved") state.setSaveStatus("unsaved");
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), DEBOUNCE_MS);
  });

  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (pending || useStore.getState().saveStatus !== "saved") {
      e.preventDefault();
    }
  };
  window.addEventListener("beforeunload", onBeforeUnload);

  return () => {
    unsubscribe();
    window.removeEventListener("beforeunload", onBeforeUnload);
    if (timer) clearTimeout(timer);
  };
}
