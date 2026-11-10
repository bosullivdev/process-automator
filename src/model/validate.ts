import type { Process, Workspace } from "./types";
import { buildAdjacency, canReachEnd, reachableFromStarts } from "../graph/analysis";
import { scopesOverlap } from "./team";

export type Severity = "error" | "warning";

export type FlagCode =
  | "broken-link"
  | "self-link"
  | "start-has-incoming"
  | "end-has-next"
  | "decision-missing-label"
  | "decision-duplicate-label"
  | "decision-multiple-default"
  | "unknown-party"
  | "unknown-team"
  | "incomplete"
  | "decision-too-few"
  | "decision-many"
  | "no-start"
  | "no-end"
  | "unreachable"
  | "dead-end"
  | "orphan"
  | "unassigned-owner";

export interface Flag {
  severity: Severity;
  code: FlagCode;
  stepId?: string;
  partyId?: string;
  /** For broken-link: the dangling target id, so the UI can offer "remove link". */
  targetId?: string;
  message: string;
}

/**
 * Flags for one process. Team checks run only when the registry is given, so
 * callers that have no teams can pass just the parties.
 */
export function validateProcess(
  process: Process,
  ws: Pick<Workspace, "parties"> & Partial<Pick<Workspace, "teams">>,
): Flag[] {
  const flags: Flag[] = [];
  const partyIds = new Set(ws.parties.map((p) => p.id));
  const teamIds = ws.teams ? new Set(ws.teams.map((t) => t.id)) : null;
  const adj = buildAdjacency(process);
  const label = (id: string) => {
    const s = adj.byId.get(id);
    return s ? `${s.displayNo}${s.name ? ` "${s.name}"` : ""}` : id;
  };

  const steps = [...process.steps].sort((a, b) => a.displayNo - b.displayNo);

  for (const s of steps) {
    // Links
    for (const l of s.next) {
      if (l.targetId === s.id) {
        flags.push({
          severity: "error",
          code: "self-link",
          stepId: s.id,
          targetId: l.targetId,
          message: `Step ${label(s.id)} points at itself.`,
        });
        continue;
      }
      if (!adj.byId.has(l.targetId)) {
        flags.push({
          severity: "error",
          code: "broken-link",
          stepId: s.id,
          targetId: l.targetId,
          message: `Step ${label(s.id)} links to a step that no longer exists.`,
        });
      }
    }

    if (s.type === "end" && s.next.length > 0) {
      flags.push({
        severity: "error",
        code: "end-has-next",
        stepId: s.id,
        message: `End step ${label(s.id)} must not have next steps.`,
      });
    }

    if (s.type === "start" && (adj.inc.get(s.id)?.length ?? 0) > 0) {
      flags.push({
        severity: "error",
        code: "start-has-incoming",
        stepId: s.id,
        message: `Start step ${label(s.id)} has incoming links from ${adj.inc
          .get(s.id)!
          .map(label)
          .join(", ")}.`,
      });
    }

    if (s.type === "decision") {
      // Two outcomes may share a label when they are scoped to different teams,
      // since no single team then sees both.
      const seen = new Map<string, typeof s.next>();
      let defaults = 0;
      let missing = 0;
      for (const l of s.next) {
        const t = (l.label ?? "").trim().toLowerCase();
        if (!t) missing++;
        else seen.set(t, [...(seen.get(t) ?? []), l]);
        if (l.isDefault) defaults++;
      }
      if (missing > 0) {
        flags.push({
          severity: "error",
          code: "decision-missing-label",
          stepId: s.id,
          message: `Decision ${label(s.id)} has ${missing} outcome${missing > 1 ? "s" : ""} without a label.`,
        });
      }
      const dupes = [...seen.entries()]
        .filter(([, links]) =>
          links.some((a, i) => links.slice(i + 1).some((b) => scopesOverlap(a.teamIds, b.teamIds))),
        )
        .map(([t]) => t);
      if (dupes.length) {
        flags.push({
          severity: "error",
          code: "decision-duplicate-label",
          stepId: s.id,
          message: `Decision ${label(s.id)} repeats the label${dupes.length > 1 ? "s" : ""} ${dupes
            .map((d) => `"${d}"`)
            .join(", ")}.`,
        });
      }
      if (defaults > 1) {
        flags.push({
          severity: "error",
          code: "decision-multiple-default",
          stepId: s.id,
          message: `Decision ${label(s.id)} has more than one default outcome.`,
        });
      }
      if (s.next.length < 2) {
        flags.push({
          severity: "warning",
          code: "decision-too-few",
          stepId: s.id,
          message: `Decision ${label(s.id)} has fewer than two outcomes.`,
        });
      }
      if (s.next.length > 5) {
        flags.push({
          severity: "warning",
          code: "decision-many",
          stepId: s.id,
          message: `Decision ${label(s.id)} has ${s.next.length} outcomes; consider splitting it.`,
        });
      }
    }

    // Parties
    if (s.ownerId !== null && !partyIds.has(s.ownerId)) {
      flags.push({
        severity: "error",
        code: "unknown-party",
        stepId: s.id,
        partyId: s.ownerId,
        message: `Step ${label(s.id)} is owned by a party that is not in the registry.`,
      });
    }
    for (const c of s.coOwnerIds) {
      if (!partyIds.has(c)) {
        flags.push({
          severity: "error",
          code: "unknown-party",
          stepId: s.id,
          partyId: c,
          message: `Step ${label(s.id)} lists a co-owner that is not in the registry.`,
        });
      }
    }
    for (const c of s.contributorIds) {
      if (!partyIds.has(c)) {
        flags.push({
          severity: "error",
          code: "unknown-party",
          stepId: s.id,
          partyId: c,
          message: `Step ${label(s.id)} lists a contributor that is not in the registry.`,
        });
      }
    }
    // Teams
    if (teamIds) {
      const unknown = [...s.teamIds, ...s.next.flatMap((l) => l.teamIds ?? [])].filter(
        (id) => !teamIds.has(id),
      );
      if (unknown.length) {
        flags.push({
          severity: "error",
          code: "unknown-team",
          stepId: s.id,
          message: `Step ${label(s.id)} is scoped to a team that is not in the registry.`,
        });
      }
    }
    if (s.ownerId === null) {
      flags.push({
        severity: "warning",
        code: "unassigned-owner",
        stepId: s.id,
        message: `Step ${label(s.id)} has no owner.`,
      });
    }

    if (s.type !== "end" && s.next.length === 0 && s.type !== "decision") {
      flags.push({
        severity: "warning",
        code: "incomplete",
        stepId: s.id,
        message: `Step ${label(s.id)} has no next step.`,
      });
    } else if (s.type === "decision" && s.next.length === 0) {
      flags.push({
        severity: "warning",
        code: "incomplete",
        stepId: s.id,
        message: `Decision ${label(s.id)} has no outcomes.`,
      });
    }
  }

  // Process level
  const hasStart = steps.some((s) => s.type === "start");
  const hasEnd = steps.some((s) => s.type === "end");
  if (steps.length > 0 && !hasStart) {
    flags.push({
      severity: "warning",
      code: "no-start",
      message: "The process has no start step.",
    });
  }
  if (steps.length > 0 && !hasEnd) {
    flags.push({ severity: "warning", code: "no-end", message: "The process has no end step." });
  }

  // Reachability
  const fromStart = reachableFromStarts(process, adj);
  const toEnd = canReachEnd(process, adj);
  for (const s of steps) {
    if (hasStart && !fromStart.has(s.id)) {
      flags.push({
        severity: "warning",
        code: "unreachable",
        stepId: s.id,
        message: `Step ${label(s.id)} cannot be reached from any start.`,
      });
    }
    if (hasEnd && !toEnd.has(s.id)) {
      flags.push({
        severity: "warning",
        code: "dead-end",
        stepId: s.id,
        message: `Step ${label(s.id)} can never reach an end.`,
      });
    }
    if (s.type !== "start" && (adj.inc.get(s.id)?.length ?? 0) === 0) {
      flags.push({
        severity: "warning",
        code: "orphan",
        stepId: s.id,
        message: `Step ${label(s.id)} has no incoming links.`,
      });
    }
  }

  return flags;
}

export function flagsByStep(flags: Flag[]): Map<string, Flag[]> {
  const m = new Map<string, Flag[]>();
  for (const f of flags) {
    if (!f.stepId) continue;
    const arr = m.get(f.stepId) ?? [];
    arr.push(f);
    m.set(f.stepId, arr);
  }
  return m;
}

export function worstSeverity(flags: Flag[] | undefined): Severity | null {
  if (!flags || flags.length === 0) return null;
  return flags.some((f) => f.severity === "error") ? "error" : "warning";
}
