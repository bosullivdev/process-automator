import { getWorkspace, useStore } from "./workspace";
import {
  adoptLegacyWorkspace,
  deleteWorkspace as deleteStored,
  getPref,
  listWorkspaces,
  loadWorkspace,
  saveWorkspace,
  setPref,
  sortWorkspaces,
  type WorkspaceInfo,
} from "../persistence/db";
import { migrate } from "../model/schema";
import { createEmptyWorkspace, uniqueName } from "../model/workspace";
import { newId } from "../model/ids";
import type { Workspace } from "../model/types";

const DEBOUNCE_MS = 500;
const ACTIVE_PREF = "activeWorkspaceId";

/** The stored record the open workspace autosaves to. */
let currentId: string | null = null;
/** JSON of the last workspace written to IndexedDB. Used for "unsaved differences" checks. */
let lastSavedJson = "";
let timer: ReturnType<typeof setTimeout> | null = null;
let pending: { id: string; ws: Workspace } | null = null;
/** Writes run one after another, so a later save can never land before an earlier one. */
let chain: Promise<void> = Promise.resolve();
/** True while another workspace is being put into the store; that is not an edit to save. */
let opening = false;
/** Ids deleted in this session; a save still queued for one must not bring it back. */
const deleted = new Set<string>();

export function workspaceJson(ws: Workspace): string {
  return JSON.stringify(ws);
}

export function hasUnsavedChanges(): boolean {
  return workspaceJson(getWorkspace()) !== lastSavedJson;
}

export function markSaved(ws: Workspace): void {
  lastSavedJson = workspaceJson(ws);
}

/** Write whatever is waiting to be saved, now. Resolves once every queued write has finished. */
function flush(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  chain = chain.then(async () => {
    const job = pending;
    if (!job) return;
    pending = null;
    if (deleted.has(job.id)) return;
    useStore.getState().setSaveStatus("saving");
    try {
      await saveWorkspace(job.id, job.ws);
      if (job.id === currentId) markSaved(job.ws);
      if (!pending) useStore.getState().setSaveStatus("saved");
    } catch (err) {
      console.error("Autosave failed", err);
      useStore.getState().setSaveStatus("unsaved");
    }
  });
  return chain;
}

/** Save the open workspace before leaving it; refuses to leave when that fails. */
async function settle(): Promise<void> {
  await flush();
  if (useStore.getState().saveStatus === "unsaved") {
    throw new Error("The open workspace could not be saved, so it was left open.");
  }
}

/** Put a workspace into the store as the open one. Clears undo history. */
function open(id: string, ws: Workspace | undefined): void {
  opening = true;
  try {
    currentId = id;
    useStore.getState().hydrate(ws);
    markSaved(getWorkspace());
  } finally {
    opening = false;
  }
  void setPref(ACTIVE_PREF, id).catch(() => undefined);
}

/** Tell the store which workspaces exist. The open one is listed even before its first save. */
async function refreshList(): Promise<void> {
  let list: WorkspaceInfo[] = [];
  try {
    list = await listWorkspaces();
  } catch (err) {
    console.error("Stored workspaces could not be listed.", err);
  }
  if (currentId && !list.some((w) => w.id === currentId)) {
    list = sortWorkspaces([...list, { id: currentId, name: useStore.getState().meta.name }]);
  }
  useStore.getState().setWorkspaces(currentId, list);
}

/** Open the first of these stored workspaces that can be read. */
async function openFirstReadable(ids: string[]): Promise<boolean> {
  for (const id of ids) {
    try {
      const raw = await loadWorkspace(id);
      if (raw === undefined) continue;
      open(id, migrate(raw));
      return true;
    } catch (err) {
      console.error("A stored workspace could not be read; trying the next.", err);
    }
  }
  return false;
}

/** Create, store and open a workspace with nothing in it. */
async function openFresh(ws: Workspace): Promise<void> {
  const id = newId();
  try {
    await saveWorkspace(id, ws);
  } catch (err) {
    console.error("The new workspace could not be stored.", err);
  }
  open(id, ws);
}

/** Names of every workspace in this browser, with the open one's current name. */
function takenNames(): string[] {
  const s = useStore.getState();
  return s.workspaceList.map((w) => (w.id === currentId ? s.meta.name : w.name));
}

/**
 * Add a workspace beside the ones already in this browser and open it: the
 * given one (an imported file), or a blank one with no parties, teams or steps.
 * The workspace that was open stays stored, untouched.
 */
export async function createWorkspace(from?: Workspace): Promise<void> {
  await settle();
  let ws = from;
  if (!ws) {
    // A blank workspace keeps how the app is set up (theme, orientation, shapes), nothing else.
    const blank = createEmptyWorkspace();
    ws = {
      ...blank,
      view: {
        ...useStore.getState().view,
        activeProcessId: blank.view.activeProcessId,
        highlightTeamId: null,
        tableHidden: false,
      },
    };
  }
  ws = { ...ws, meta: { ...ws.meta, name: uniqueName(ws.meta.name, takenNames()) } };
  const id = newId();
  await saveWorkspace(id, ws);
  open(id, ws);
  await refreshList();
}

/** Save the open workspace and open another stored one. */
export async function switchWorkspace(id: string): Promise<void> {
  if (id === currentId) return;
  await settle();
  const raw = await loadWorkspace(id);
  if (raw === undefined) {
    await refreshList();
    throw new Error("That workspace is no longer stored in this browser.");
  }
  open(id, migrate(raw));
  await refreshList();
}

/**
 * Remove a workspace from this browser for good. Deleting the open one opens
 * another, or a fresh empty one when it was the last.
 */
export async function deleteWorkspace(id: string): Promise<void> {
  deleted.add(id);
  if (pending?.id === id) {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  }
  await chain;
  await deleteStored(id);
  if (id === currentId) {
    const rest = (await listWorkspaces()).map((w) => w.id);
    if (!(await openFirstReadable(rest))) await openFresh(createEmptyWorkspace());
  }
  await refreshList();
}

/** Load the workspace last open, hydrate the store, and begin autosaving. Returns a stop function. */
export async function startAutosave(): Promise<() => void> {
  let opened = false;
  try {
    const adopted = await adoptLegacyWorkspace();
    const wanted = adopted ?? (await getPref<string>(ACTIVE_PREF));
    const ids = (await listWorkspaces()).map((w) => w.id);
    opened = await openFirstReadable([
      ...ids.filter((id) => id === wanted),
      ...ids.filter((id) => id !== wanted),
    ]);
  } catch (err) {
    console.error("Stored workspaces could not be read; starting fresh.", err);
  }
  if (!opened) await openFresh(createEmptyWorkspace());
  await refreshList();

  const unsubscribe = useStore.subscribe((state, prev) => {
    if (opening || !state.hydrated || !currentId) return;
    if (
      state.meta === prev.meta &&
      state.parties === prev.parties &&
      state.teams === prev.teams &&
      state.processes === prev.processes &&
      state.view === prev.view
    ) {
      return;
    }
    const ws = getWorkspace();
    if (workspaceJson(ws) === lastSavedJson) return;
    pending = { id: currentId, ws };
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
    timer = null;
  };
}
