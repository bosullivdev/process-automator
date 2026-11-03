import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Workspace } from "../model/types";

interface MapperDB extends DBSchema {
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
const RECORD_KEY = "current";

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

export async function loadWorkspace(): Promise<Workspace | undefined> {
  try {
    return await (await db()).get("workspace", RECORD_KEY);
  } catch {
    return undefined;
  }
}

export async function saveWorkspace(ws: Workspace): Promise<void> {
  await (await db()).put("workspace", ws, RECORD_KEY);
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
