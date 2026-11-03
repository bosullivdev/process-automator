import { useState } from "react";
import type { Flag } from "../model/validate";

interface Props {
  flags: Flag[];
  onSelectStep: (stepId: string) => void;
  onRemoveLink?: (stepId: string, targetId: string) => void;
}

export function ValidationPanel({ flags, onSelectStep, onRemoveLink }: Props) {
  const [open, setOpen] = useState(true);
  const errors = flags.filter((f) => f.severity === "error").length;
  const warnings = flags.length - errors;

  return (
    <div
      className="flex shrink-0 flex-col border-t"
      style={{ borderColor: "var(--border)" }}
      data-testid="validation-panel"
    >
      <button
        type="button"
        className="flex h-8 items-center gap-2 px-3 text-left text-xs font-medium"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="inline-block w-3 text-[var(--text-muted)]">{open ? "▾" : "▸"}</span>
        <span>Validation</span>
        <span className="ml-1 flex items-center gap-2 text-[var(--text-muted)]">
          {errors > 0 && (
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: "var(--color-danger)" }}
              />
              {errors} error{errors === 1 ? "" : "s"}
            </span>
          )}
          {warnings > 0 && (
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: "var(--color-warn)" }}
              />
              {warnings} warning{warnings === 1 ? "" : "s"}
            </span>
          )}
          {flags.length === 0 && <span style={{ color: "var(--color-ok)" }}>No issues</span>}
        </span>
      </button>
      {open && flags.length > 0 && (
        <ul className="max-h-40 overflow-auto px-2 pb-2 text-xs" role="list">
          {flags.map((f, i) => (
            <li key={i} className="flex items-center gap-2 py-0.5">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: f.severity === "error" ? "var(--color-danger)" : "var(--color-warn)",
                }}
              />
              {f.stepId ? (
                <button
                  type="button"
                  className="truncate text-left hover:underline"
                  onClick={() => onSelectStep(f.stepId!)}
                >
                  {f.message}
                </button>
              ) : (
                <span className="truncate">{f.message}</span>
              )}
              {f.code === "broken-link" && f.stepId && f.targetId && onRemoveLink && (
                <button
                  type="button"
                  className="ml-auto shrink-0 text-[var(--color-accent)] hover:underline"
                  onClick={() => onRemoveLink(f.stepId!, f.targetId!)}
                >
                  Remove link
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
