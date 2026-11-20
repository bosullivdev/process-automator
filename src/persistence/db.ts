import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Workspace } from "../model/types";
import { newId } from "../model/ids";

interface MapperDB extends DBSchema {
  /** One record per workspace, keyed by a workspace id that never appears in the data itself. */
  workspace: {
    key: string;
    value: Workspace;
  };
  prefs: {
    key: string;
    value: { key: string; value: unknown };
  };
}

const DB_NAME = "process-mapper";
/** The key the single workspace was stored under before there could be several. */
const LEGACY_KEY = "current";

/** What the workspace switcher needs to know about a stored workspace. */
export interface WorkspaceInfo {
  id: string;
  name: string;
}

let dbPromise: Promise<IDBPDatabase<MapperDB>> | null = null;

function db(): Promise<IDBPDatabase<MapperDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MapperDB>(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore("workspace");
        d.createObjectStore("prefs", { keyPath: "key" });
      },
    });
  }
  return dbPromise;
}

/** Drop the cached connection, so the next call reopens the database. */
export function closeDb(): void {
  void dbPromise?.then((d) => d.close());
  dbPromise = null;
}

/**
 * Give the workspace saved by an older version of the app an id of its own.
 * Returns that id, or null when there was nothing to carry over.
 */
export async function adoptLegacyWorkspace(): Promise<string | null> {
  const tx = (await db()).transaction("workspace", "readwrite");
  const legacy = await tx.store.get(LEGACY_KEY);
  if (legacy === undefined) {
    await tx.done;
    return null;
  }
  const id = newId();
  await tx.store.put(legacy, id);
  await tx.store.delete(LEGACY_KEY);
  await tx.done;
  return id;
}

function nameOf(raw: unknown): string {
  const meta = (raw as { meta?: { name?: unknown } } | null)?.meta;
  return typeof meta?.name === "string" && meta.name.trim() ? meta.name : "Untitled workspace";
}

/** Every stored workspace, by name. Records are not validated here, only named. */
export async function listWorkspaces(): Promise<WorkspaceInfo[]> {
  const out: WorkspaceInfo[] = [];
  let cursor = await (await db()).transaction("workspace").store.openCursor();
  while (cursor) {
    if (cursor.key !== LEGACY_KEY) out.push({ id: cursor.key, name: nameOf(cursor.value) });
    cursor = await cursor.continue();
  }
  return sortWorkspaces(out);
}

export function sortWorkspaces(list: WorkspaceInfo[]): WorkspaceInfo[] {
  return [...list].sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** The stored record as it is; the caller runs it through `migrate`. */
export async function loadWorkspace(id: string): Promise<unknown> {
  return await (await db()).get("workspace", id);
}

export async function saveWorkspace(id: string, ws: Workspace): Promise<void> {
  await (await db()).put("workspace", ws, id);
}

export async function deleteWorkspace(id: string): Promise<void> {
  await (await db()).delete("workspace", id);
}

export async function getPref<T>(key: string): Promise<T | undefined> {
  try {
    const row = await (await db()).get("prefs", key);
    return row?.value as T | undefined;
  } catch {
    return undefined;
  }
}

export async function setPref(key: string, value: unknown): Promise<void> {
  await (await db()).put("prefs", { key, value });
}
