import type { Workspace } from "../model/types";
import { migrate } from "../model/schema";
import { datestamp, downloadBlob, safeFilename } from "./download";

export function exportWorkspaceJson(ws: Workspace): void {
  const json = JSON.stringify(ws, null, 2);
  downloadBlob(
    new Blob([json], { type: "application/json" }),
    `${safeFilename(ws.meta.name)}-${datestamp()}.json`,
  );
}

export async function readWorkspaceFile(file: File): Promise<Workspace> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  return migrate(parsed);
}
