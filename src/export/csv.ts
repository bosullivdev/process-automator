import type { Party, Process, Step, Team } from "../model/types";
import { teamNames } from "../model/team";
import { datestamp, downloadBlob, safeFilename } from "./download";

export const CSV_COLUMNS = [
  "No",
  "Name",
  "Owner",
  "Type",
  "Next",
  "Technology",
  "Contributors",
  "Teams",
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

/**
 * The table as CSV rows, in table order, with names instead of ids. A step
 * scoped to some teams lists them; a link scoped to some teams shows them in
 * braces after the target. Empty means every team.
 */
export function processToCsv(
  process: Process,
  parties: readonly Party[],
  teams: readonly Team[] = [],
): string {
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
        const scope = l.teamIds?.length ? ` {${teamNames(l.teamIds, teams).join(", ")}}` : "";
        return base + label + scope;
      })
      .join("; ");
    return [
      String(s.displayNo),
      s.name,
      [s.ownerId, ...s.coOwnerIds]
        .map((id) => {
          const scope = id ? teamNames(s.ownerTeams?.[id], teams) : [];
          return partyName(id) + (scope.length ? ` {${scope.join(", ")}}` : "");
        })
        .join("; "),
      typeLabel(s),
      next,
      s.technology,
      s.contributorIds.map(partyName).join("; "),
      teamNames(s.teamIds, teams).join("; "),
      s.notes,
    ];
  });
  const lines = [CSV_COLUMNS.join(","), ...rows.map((r) => r.map(csvField).join(","))];
  return lines.join("\r\n") + "\r\n";
}

export function exportProcessCsv(
  process: Process,
  parties: readonly Party[],
  teams: readonly Team[] = [],
  fileBase = safeFilename(process.name),
): void {
  // The byte-order mark makes Excel read the file as UTF-8.
  const blob = new Blob(["﻿", processToCsv(process, parties, teams)], {
    type: "text/csv;charset=utf-8",
  });
  downloadBlob(blob, `${fileBase}-${datestamp()}.csv`);
}
