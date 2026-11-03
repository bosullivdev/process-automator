import type { Party, Process, Step } from "../model/types";
import { datestamp, downloadBlob, safeFilename } from "./download";

export const CSV_COLUMNS = [
  "No",
  "Name",
  "Owner",
  "Type",
  "Next",
  "Technology",
  "Contributors",
  "Notes",
] as const;

/** Quote a CSV field when it contains a comma, quote or line break. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function typeLabel(step: Step): string {
  switch (step.type) {
    case "start":
      return step.startKind && step.startKind !== "none" ? `start · ${step.startKind}` : "start";
    case "task":
      return step.isSubProcess ? "task · sub-process" : "task";
    case "end":
      return step.endKind === "terminate" ? "end · terminate" : "end";
    default:
      return "decision";
  }
}

/** The table as CSV rows, in table order, with names instead of ids. */
export function processToCsv(process: Process, parties: readonly Party[]): string {
  const partyName = (id: string | null) =>
    id === null ? "" : (parties.find((p) => p.id === id)?.name ?? "Unknown party");
  const byId = new Map(process.steps.map((s) => [s.id, s]));
  const rows = process.steps.map((s) => {
    const next = s.next
      .map((l) => {
        const t = byId.get(l.targetId);
        const base = t ? `${t.displayNo}: ${t.name || "Untitled"}` : "missing step";
        const label =
          s.type === "decision" && l.label ? ` [${l.label}${l.isDefault ? ", default" : ""}]` : "";
        return base + label;
      })
      .join("; ");
    return [
      String(s.displayNo),
      s.name,
      partyName(s.ownerId),
      typeLabel(s),
      next,
      s.technology,
      s.contributorIds.map(partyName).join("; "),
      s.notes,
    ];
  });
  const lines = [CSV_COLUMNS.join(","), ...rows.map((r) => r.map(csvField).join(","))];
  return lines.join("\r\n") + "\r\n";
}

export function exportProcessCsv(process: Process, parties: readonly Party[]): void {
  // The byte-order mark makes Excel read the file as UTF-8.
  const blob = new Blob(["﻿", processToCsv(process, parties)], {
    type: "text/csv;charset=utf-8",
  });
  downloadBlob(blob, `${safeFilename(process.name)}-${datestamp()}.csv`);
}
