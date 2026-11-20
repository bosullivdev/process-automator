import { useState } from "react";
import { useStore } from "../store/workspace";
import { createWorkspace, deleteWorkspace, switchWorkspace } from "../store/autosave";
import { Popover } from "./ui/Popover";
import { toast } from "./ui/toast";

/**
 * Header control for the workspaces kept in this browser: open another one,
 * rename the open one, start a blank one, or delete the open one for good.
 */
export function WorkspaceSwitcher() {
  const name = useStore((s) => s.meta.name);
  const processCount = useStore((s) => s.processes.length);
  const workspaceId = useStore((s) => s.workspaceId);
  const list = useStore((s) => s.workspaceList);
  const setWorkspaceName = useStore((s) => s.setWorkspaceName);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (job: () => Promise<void>, done?: string) => {
    setBusy(true);
    try {
      await job();
      if (done) toast(done);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const commitName = () => {
    const next = draft?.trim();
    if (next && next !== name) setWorkspaceName(next);
    setDraft(null);
  };

  return (
    <>
      <button
        ref={setAnchor}
        className="btn max-w-56"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Workspace"
        title="Workspaces in this browser"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        data-testid="workspace-switcher"
      >
        <span className="truncate">{name}</span>
        <span aria-hidden className="text-xs text-[var(--text-muted)]">
          ▾
        </span>
      </button>
      <Popover
        anchor={anchor}
        open={open}
        onClose={() => {
          commitName();
          setOpen(false);
        }}
        width={260}
      >
        <div role="menu" aria-label="Workspaces" className="flex flex-col">
          {list.map((w) => {
            const current = w.id === workspaceId;
            return (
              <button
                key={w.id}
                role="menuitemradio"
                aria-checked={current}
                className="menu-item"
                data-active={current}
                onClick={() => {
                  commitName();
                  setOpen(false);
                  if (!current) void run(() => switchWorkspace(w.id));
                }}
              >
                <span className="truncate">{current ? name : w.name}</span>
              </button>
            );
          })}
          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          <label className="flex flex-col gap-1 px-2 py-1 text-xs">
            Name of this workspace
            <input
              className="input"
              aria-label="Workspace name"
              value={draft ?? name}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitName();
                  setOpen(false);
                }
              }}
            />
          </label>
          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          <button
            role="menuitem"
            className="menu-item"
            title="Start a blank workspace with no parties, teams or steps. This one stays saved in the browser."
            onClick={() => {
              commitName();
              setOpen(false);
              void run(() => createWorkspace());
            }}
          >
            New blank workspace
          </button>
          <button
            role="menuitem"
            className="menu-item"
            style={{ color: "var(--color-danger)" }}
            onClick={() => {
              commitName();
              setOpen(false);
              setConfirmDelete(true);
            }}
          >
            Delete this workspace…
          </button>
        </div>
      </Popover>
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.3)" }}
          role="alertdialog"
          aria-label="Delete workspace"
          onKeyDown={(e) => e.key === "Escape" && setConfirmDelete(false)}
        >
          <div className="menu flex w-[26rem] flex-col gap-3 p-4">
            <p className="text-sm">
              Delete <strong>{name}</strong> from this browser, with its{" "}
              {processCount === 1 ? "process" : `${processCount} processes`}, parties and teams?
              This cannot be undone. Export it first if you might want it back.
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
                  setConfirmDelete(false);
                  if (workspaceId)
                    void run(() => deleteWorkspace(workspaceId), `Deleted "${name}".`);
                }}
              >
                Delete workspace
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
