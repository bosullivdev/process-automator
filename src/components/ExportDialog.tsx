import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getWorkspace, useStore } from "../store/workspace";
import { useResolvedTheme } from "../hooks/useTheme";
import { datestamp } from "../export/download";
import {
  FORMATS,
  planFiles,
  planMaps,
  zipName,
  type ExportFormat,
  type ExportOptions,
  type TeamMode,
} from "../export/plan";
import { toast } from "./ui/toast";

interface Props {
  onClose: () => void;
}

/** The choices worth keeping between exports; the rest start from what is on screen. */
type Remembered = Pick<ExportOptions, "formats" | "packaging" | "zip">;
const REMEMBER_KEY = "process-mapper:custom-export";

function remembered(): Remembered {
  const fallback: Remembered = { formats: ["vsdx"], packaging: "single", zip: true };
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(REMEMBER_KEY) ?? "null");
    if (!raw || typeof raw !== "object") return fallback;
    const r = raw as Partial<Record<keyof Remembered, unknown>>;
    const formats = Array.isArray(r.formats)
      ? FORMATS.map((f) => f.id).filter((id) => (r.formats as unknown[]).includes(id))
      : fallback.formats;
    return {
      formats,
      packaging: r.packaging === "separate" ? "separate" : "single",
      zip: r.zip !== false,
    };
  } catch {
    return fallback;
  }
}

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-xs font-semibold tracking-wide text-[var(--text-muted)] uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Check({
  checked,
  onChange,
  disabled,
  children,
  title,
  autoFocus,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  children: ReactNode;
  title?: string;
  autoFocus?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-sm ${disabled ? "opacity-50" : "cursor-pointer"}`}
      title={title}
    >
      <input
        type="checkbox"
        className="accent-[var(--color-accent)]"
        checked={checked}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={onChange}
      />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

function Radio<T extends string>({
  name,
  value,
  current,
  onChange,
  disabled,
  children,
}: {
  name: string;
  value: T;
  current: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-sm ${disabled ? "opacity-50" : "cursor-pointer"}`}
    >
      <input
        type="radio"
        className="accent-[var(--color-accent)]"
        name={name}
        checked={current === value}
        disabled={disabled}
        onChange={() => onChange(value)}
      />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<[T, string]>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm" role="group" aria-label={label}>
      <span className="w-24 shrink-0 text-[var(--text-muted)]">{label}</span>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          className={`btn h-7 px-2 text-xs ${value === v ? "btn-active" : ""}`}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * Custom export: tick the formats, processes and teams, choose one file or
 * several, and see the files that will come out before making them.
 */
export function ExportDialog({ onClose }: Props) {
  const processes = useStore((s) => s.processes);
  const teams = useStore((s) => s.teams);
  const view = useStore((s) => s.view);
  const workspaceName = useStore((s) => s.meta.name);
  const theme = useResolvedTheme();
  const [busy, setBusy] = useState<string | null>(null);

  const [o, setO] = useState<ExportOptions>(() => {
    const focused = view.highlightTeamId && teams.some((t) => t.id === view.highlightTeamId);
    const isolated = focused && view.teamFocus === "isolate";
    return {
      ...remembered(),
      processIds: processes.filter((p) => p.steps.length > 0).map((p) => p.id),
      // Start from the map as shown: one team alone when one is isolated, else everything.
      teamMode: isolated ? "together" : "all",
      teamIds: isolated ? [view.highlightTeamId!] : teams.map((t) => t.id),
      orientation: view.orientation,
      shapeMode: view.shapeMode,
      annotations: view.annotations,
    };
  });
  const set = (patch: Partial<ExportOptions>) => setO((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const plan = useMemo(() => {
    // The dialog is modal, so the workspace cannot change under it.
    const ws = getWorkspace();
    const date = datestamp();
    const maps = planMaps(ws, o);
    const files = planFiles(ws, o, maps, date);
    return { maps, files, zip: zipName(ws, o, files, date) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o, processes, teams, workspaceName]);

  const hasTeams = teams.length > 0;
  const narrowed = hasTeams && o.teamMode !== "all";
  const chosenFormats = FORMATS.filter((f) => o.formats.includes(f.id));
  const perMapOnly = chosenFormats.filter((f) => !f.holds);
  const problem =
    o.formats.length === 0
      ? "Tick at least one format."
      : o.processIds.length === 0
        ? "Tick at least one process."
        : narrowed && o.teamIds.length === 0
          ? "Tick at least one team."
          : plan.maps.length === 0
            ? narrowed
              ? "The ticked teams have no steps in the ticked processes."
              : "The ticked processes have no steps yet."
            : null;

  const run = async () => {
    setBusy("Preparing…");
    try {
      localStorage.setItem(
        REMEMBER_KEY,
        JSON.stringify({ formats: o.formats, packaging: o.packaging, zip: o.zip }),
      );
    } catch {
      // Remembering the choices is a convenience; the export goes ahead without it.
    }
    try {
      const { runExport } = await import("../export/run");
      const done = await runExport(getWorkspace(), o, theme, setBusy);
      toast(
        done.zip
          ? `Exported ${done.files} files in ${done.zip}.`
          : `Exported ${done.files} ${done.files === 1 ? "file" : "files"}.`,
      );
      onClose();
    } catch (err) {
      toast(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      setBusy(null);
    }
  };

  const shownFiles = plan.files.slice(0, 6);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.3)" }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Custom export"
        className="menu flex max-h-full w-[44rem] max-w-full flex-col"
      >
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <h2 className="text-sm font-semibold">Custom export</h2>
          <button className="btn btn-icon" aria-label="Close" onClick={onClose} disabled={!!busy}>
            ×
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-x-8 gap-y-5 overflow-auto p-4 sm:grid-cols-2">
          <Section title="Format">
            {FORMATS.map((f, i) => (
              <Check
                key={f.id}
                checked={o.formats.includes(f.id)}
                onChange={() => set({ formats: toggle<ExportFormat>(o.formats, f.id) })}
                title={f.hint}
                autoFocus={i === 0}
              >
                {f.label}
              </Check>
            ))}
          </Section>

          <Section title="Processes">
            <div className="mb-0.5 flex gap-2">
              <button
                type="button"
                className="btn h-6 px-2 text-xs"
                onClick={() => set({ processIds: processes.map((p) => p.id) })}
              >
                All
              </button>
              <button
                type="button"
                className="btn h-6 px-2 text-xs"
                onClick={() => set({ processIds: [] })}
              >
                None
              </button>
              <button
                type="button"
                className="btn h-6 px-2 text-xs"
                onClick={() =>
                  set({ processIds: view.activeProcessId ? [view.activeProcessId] : [] })
                }
              >
                Open one only
              </button>
            </div>
            <div className="flex max-h-40 flex-col gap-1.5 overflow-auto">
              {processes.map((p) => (
                <Check
                  key={p.id}
                  checked={o.processIds.includes(p.id)}
                  onChange={() => set({ processIds: toggle(o.processIds, p.id) })}
                >
                  {p.name || "Untitled"}
                  {p.steps.length === 0 && (
                    <span className="text-xs text-[var(--text-muted)]"> · no steps</span>
                  )}
                </Check>
              ))}
            </div>
          </Section>

          {hasTeams && (
            <Section title="Teams">
              <Radio<TeamMode>
                name="team-mode"
                value="all"
                current={o.teamMode}
                onChange={(teamMode) => set({ teamMode })}
              >
                Whole process, every team
              </Radio>
              <Radio<TeamMode>
                name="team-mode"
                value="together"
                current={o.teamMode}
                onChange={(teamMode) => set({ teamMode })}
              >
                Ticked teams together on one map
              </Radio>
              <Radio<TeamMode>
                name="team-mode"
                value="each"
                current={o.teamMode}
                onChange={(teamMode) => set({ teamMode })}
              >
                A map for each ticked team
              </Radio>
              <div className="mt-1 ml-6 flex max-h-32 flex-col gap-1.5 overflow-auto">
                {teams.map((t) => (
                  <Check
                    key={t.id}
                    checked={narrowed && o.teamIds.includes(t.id)}
                    disabled={!narrowed}
                    onChange={() => set({ teamIds: toggle(o.teamIds, t.id) })}
                  >
                    {t.name}
                  </Check>
                ))}
              </div>
            </Section>
          )}

          <Section title="Files">
            <Radio
              name="packaging"
              value="single"
              current={o.packaging}
              onChange={(packaging) => set({ packaging })}
            >
              Everything in one file per format
            </Radio>
            <Radio
              name="packaging"
              value="separate"
              current={o.packaging}
              onChange={(packaging) => set({ packaging })}
            >
              A separate file for each map
            </Radio>
            <Check checked={o.zip} onChange={() => set({ zip: !o.zip })}>
              Bundle several files into one .zip
            </Check>
            {o.packaging === "single" && perMapOnly.length > 0 && plan.maps.length > 1 && (
              <p className="text-xs text-[var(--text-muted)]">
                {perMapOnly.map((f) => f.label).join(", ")} can hold one map per file, so{" "}
                {perMapOnly.length === 1 ? "it comes" : "they come"} as a file for each map.
              </p>
            )}
          </Section>

          <Section title="Look">
            <Segmented
              label="Orientation"
              value={o.orientation}
              options={[
                ["horizontal", "Horizontal"],
                ["vertical", "Vertical"],
              ]}
              onChange={(orientation) => set({ orientation })}
            />
            <Segmented
              label="Shapes"
              value={o.shapeMode}
              options={[
                ["simple", "Simple"],
                ["bpmn", "BPMN"],
              ]}
              onChange={(shapeMode) => set({ shapeMode })}
            />
            <Segmented
              label="Detail"
              value={o.annotations}
              options={[
                ["full", "Details"],
                ["minimal", "Minimal"],
              ]}
              onChange={(annotations) => set({ annotations })}
            />
          </Section>

          <Section title="You will get">
            <div data-testid="export-summary" className="text-sm" aria-live="polite">
              {problem ? (
                <p className="text-[var(--text-muted)]">{problem}</p>
              ) : (
                <>
                  <p>
                    {plan.maps.length} {plan.maps.length === 1 ? "map" : "maps"} in{" "}
                    {plan.files.length} {plan.files.length === 1 ? "file" : "files"}
                    {plan.zip ? `, bundled as ${plan.zip}` : ""}
                  </p>
                  <ul className="mt-1 flex flex-col gap-0.5 text-xs text-[var(--text-muted)]">
                    {shownFiles.map((f) => (
                      <li key={f.name} className="truncate" title={f.name}>
                        {f.name}
                        {f.maps.length > 1 &&
                          ` · ${f.maps.length} ${FORMATS.find((x) => x.id === f.format)?.holds ?? "maps"}`}
                      </li>
                    ))}
                    {plan.files.length > shownFiles.length && (
                      <li>and {plan.files.length - shownFiles.length} more</li>
                    )}
                  </ul>
                </>
              )}
            </div>
          </Section>
        </div>

        <div
          className="flex items-center justify-end gap-2 border-t px-4 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          {busy && <span className="mr-auto text-xs text-[var(--text-muted)]">{busy}</span>}
          <button className="btn" onClick={onClose} disabled={!!busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void run()}
            disabled={!!problem || !!busy}
          >
            {busy ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}
