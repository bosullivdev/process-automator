import { z } from "zod";
import type { Workspace } from "./types";

const nextLinkSchema = z.object({
  targetId: z.string(),
  label: z.string().optional(),
  isDefault: z.boolean().optional(),
});

const stepSchema = z.object({
  id: z.string().min(1),
  displayNo: z.number().int().positive(),
  name: z.string(),
  type: z.enum(["start", "task", "decision", "end"]),
  ownerId: z.string().nullable(),
  next: z.array(nextLinkSchema),
  technology: z.string(),
  contributorIds: z.array(z.string()),
  notes: z.string(),
  isSubProcess: z.boolean().optional(),
  startKind: z.enum(["none", "message", "timer"]).optional(),
  endKind: z.enum(["normal", "terminate"]).optional(),
});

const partySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  colourIndex: z.number().int().nonnegative(),
  colourOverride: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "colourOverride must be a 6-digit hex colour")
    .optional(),
});

const processSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  owner: z.string().optional(),
  version: z.string().optional(),
  date: z.string().optional(),
  laneOrder: z.array(z.string()),
  steps: z.array(stepSchema),
});

const viewSchema = z.object({
  orientation: z.enum(["horizontal", "vertical"]),
  shapeMode: z.enum(["simple", "bpmn"]),
  theme: z.enum(["system", "light", "dark"]),
  splitRatio: z.number().min(0.2).max(0.8),
  activeProcessId: z.string().nullable(),
  // Added after the first release; older files load with the default.
  annotations: z.enum(["full", "minimal"]).default("full"),
});

export const workspaceV1Schema = z.object({
  schemaVersion: z.literal(1),
  meta: z.object({
    name: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  parties: z.array(partySchema),
  processes: z.array(processSchema),
  view: viewSchema,
});

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

function formatIssues(issues: z.core.$ZodIssue[]): string {
  return issues
    .slice(0, 8)
    .map((i) => {
      const path = i.path.length ? i.path.map(String).join(".") : "(root)";
      return `${path}: ${i.message}`;
    })
    .join("; ");
}

/**
 * Validates an unknown JSON value as a workspace and upgrades older schema
 * versions. Version 1 is the only version today; the upgrade switch exists so
 * future versions have a place to live.
 */
export function migrate(json: unknown): Workspace {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new MigrationError("Workspace file must be a JSON object.");
  }
  const version = (json as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== "number") {
    throw new MigrationError("Workspace file is missing a numeric schemaVersion.");
  }
  const current: unknown = json;
  switch (version) {
    case 1:
      break;
    default:
      throw new MigrationError(
        `Unsupported schemaVersion ${version}. This app understands version 1.`,
      );
  }
  const result = workspaceV1Schema.safeParse(current);
  if (!result.success) {
    throw new MigrationError(`Workspace file is invalid: ${formatIssues(result.error.issues)}`);
  }
  return result.data as Workspace;
}
