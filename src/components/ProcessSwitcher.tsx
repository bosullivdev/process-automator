import { useState } from "react";
import { useStore } from "../store/workspace";

export function ProcessSwitcher() {
  const processes = useStore((s) => s.processes);
  const activeId = useStore((s) => s.view.activeProcessId);
  const setActive = useStore((s) => s.setActiveProcess);
  const addProcess = useStore((s) => s.addProcess);
  const renameProcess = useStore((s) => s.renameProcess);
  const duplicateProcess = useStore((s) => s.duplicateProcess);
  const deleteProcess = useStore((s) => s.deleteProcess);
  const updateMeta = useStore((s) => s.updateProcessMeta);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const active = processes.find((p) => p.id === activeId) ?? processes[0];
  if (!active) return null;

  return (
    <div className="flex items-center gap-1" data-testid="process-switcher">
      <select
        className="input h-8 w-44"
        aria-label="Active process"
        value={active.id}
        onChange={(e) => setActive(e.target.value)}
      >
        {processes.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        className="btn btn-ghost"
        aria-label="Process details"
        onClick={() => setEditing((v) => !v)}
        title="Rename / details"
      >
        ✎
      </button>
      <button
        className="btn btn-ghost"
        aria-label="Add process"
        title="Add process"
        onClick={() => addProcess()}
      >
        +
      </button>
      <button
        className="btn btn-ghost"
        aria-label="Duplicate process"
        title="Duplicate process"
        onClick={() => duplicateProcess(active.id)}
      >
        ⧉
      </button>
      <button
        className="btn btn-ghost"
        aria-label="Delete process"
        title="Delete process"
        onClick={() => setConfirmDelete(true)}
      >
        🗑
      </button>
      {editing && (
        <div
          className="menu absolute top-12 left-3 z-40 flex w-72 flex-col gap-2 p-3"
          role="dialog"
          aria-label="Process details"
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        >
          <label className="flex flex-col gap-1 text-xs">
            Name
            <input
              className="input"
              aria-label="Process name"
              value={active.name}
              autoFocus
              onChange={(e) => renameProcess(active.id, e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Owner
            <input
              className="input"
              aria-label="Process owner"
              value={active.owner ?? ""}
              onChange={(e) => updateMeta(active.id, { owner: e.target.value })}
            />
          </label>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs">
              Version
              <input
                className="input"
                aria-label="Process version"
                value={active.version ?? ""}
                onChange={(e) => updateMeta(active.id, { version: e.target.value })}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs">
              Date
              <input
                className="input"
                aria-label="Process date"
                type="date"
                value={active.date ?? ""}
                onChange={(e) => updateMeta(active.id, { date: e.target.value })}
              />
            </label>
          </div>
          <button className="btn self-end" onClick={() => setEditing(false)}>
            Done
          </button>
        </div>
      )}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.3)" }}
          role="alertdialog"
          aria-label="Delete process"
        >
          <div className="menu flex w-80 flex-col gap-3 p-4">
            <p className="text-sm">
              Delete <strong>{active.name}</strong> and its {active.steps.length} step
              {active.steps.length === 1 ? "" : "s"}? You can undo this.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setConfirmDelete(false)} autoFocus>
                Cancel
              </button>
              <button
                className="btn"
                style={{
                  background: "var(--color-danger)",
                  borderColor: "var(--color-danger)",
                  color: "#fff",
                }}
                onClick={() => {
                  deleteProcess(active.id);
                  setConfirmDelete(false);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
