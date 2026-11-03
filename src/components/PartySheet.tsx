import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Party } from "../model/types";
import { isPartyReferenced, partyUsage } from "../model/party";
import { useStore } from "../store/workspace";
import { PartySwatch } from "./ui/PartySwatch";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function PartySheet({ open, onClose }: Props) {
  const parties = useStore((s) => s.parties);
  const processes = useStore((s) => s.processes);
  const renameParty = useStore((s) => s.renameParty);
  const mergeParties = useStore((s) => s.mergeParties);
  const deleteParty = useStore((s) => s.deleteParty);
  const setPartyOverride = useStore((s) => s.setPartyOverride);
  const addParty = useStore((s) => s.addParty);
  const [newName, setNewName] = useState("");
  const [merging, setMerging] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const { used, unused } = useMemo(() => {
    const used: Party[] = [];
    const unused: Party[] = [];
    for (const p of [...parties].sort((a, b) => a.name.localeCompare(b.name))) {
      (isPartyReferenced(p.id, processes) ? used : unused).push(p);
    }
    return { used, unused };
  }, [parties, processes]);

  if (!open) return null;

  const row = (p: Party) => {
    const usage = partyUsage(p.id, processes);
    const referenced = usage.some((u) => u.asOwner > 0 || u.asContributor > 0);
    return (
      <li
        key={p.id}
        className="flex flex-col gap-1 rounded-lg border p-2"
        style={{ borderColor: "var(--border)" }}
        data-party-id={p.id}
      >
        <div className="flex items-center gap-2">
          <PartySwatch party={p} size={12} />
          <input
            className="cell-input h-7 flex-1 rounded px-1 font-medium"
            aria-label={`Rename ${p.name}`}
            defaultValue={p.name}
            key={p.name}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== p.name) renameParty(p.id, v);
              else e.target.value = p.name;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                (e.target as HTMLInputElement).value = p.name;
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          <label
            className="flex items-center gap-1 text-xs text-[var(--text-muted)]"
            title="Override colour"
          >
            <input
              type="color"
              aria-label={`Colour override for ${p.name}`}
              className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
              value={p.colourOverride ?? "#888888"}
              onChange={(e) => setPartyOverride(p.id, e.target.value)}
            />
            {p.colourOverride && (
              <button className="hover:underline" onClick={() => setPartyOverride(p.id, undefined)}>
                reset
              </button>
            )}
          </label>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span className="flex-1 truncate">
            {referenced
              ? usage
                  .filter((u) => u.asOwner || u.asContributor)
                  .map((u) => `${u.processName} (${u.asOwner + u.asContributor})`)
                  .join(", ")
              : "Unused"}
          </span>
          <button
            className="btn h-6 px-2 text-xs"
            onClick={() => setMerging(merging === p.id ? null : p.id)}
            aria-label={`Merge ${p.name} into another party`}
          >
            Merge…
          </button>
          <button
            className="btn h-6 px-2 text-xs"
            aria-label={`Delete ${p.name}`}
            onClick={() =>
              referenced ? setDeleting(deleting === p.id ? null : p.id) : deleteParty(p.id)
            }
          >
            Delete
          </button>
        </div>
        {merging === p.id && (
          <div className="flex items-center gap-2 text-xs">
            <span>Merge into</span>
            <select
              className="input h-7 flex-1 text-xs"
              aria-label={`Merge ${p.name} into`}
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  mergeParties(e.target.value, p.id);
                  setMerging(null);
                }
              }}
            >
              <option value="">Choose survivor…</option>
              {parties
                .filter((o) => o.id !== p.id)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          </div>
        )}
        {deleting === p.id && referenced && (
          <div
            className="rounded-md p-2 text-xs"
            style={{ background: "var(--color-warn-soft)", color: "#78350f" }}
          >
            <p className="mb-1">
              <strong>{p.name}</strong> is used in{" "}
              {usage
                .filter((u) => u.asOwner || u.asContributor)
                .map((u) => u.processName)
                .join(", ")}
              . Remove those references or merge it into another party instead.
            </p>
            <button
              className="btn h-6 px-2 text-xs"
              onClick={() => {
                setDeleting(null);
                setMerging(p.id);
              }}
            >
              Merge instead
            </button>
          </div>
        )}
      </li>
    );
  };

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Parties"
    >
      <div className="flex-1" style={{ background: "rgba(0,0,0,0.25)" }} onClick={onClose} />
      <div
        className="flex h-full w-[380px] max-w-full flex-col border-l shadow-xl"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div
          className="flex h-12 items-center gap-2 border-b px-3"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="font-semibold">Parties</span>
          <span className="text-xs text-[var(--text-muted)]">{parties.length}</span>
          <div className="flex-1" />
          <button className="btn btn-ghost btn-icon" aria-label="Close" onClick={onClose} autoFocus>
            ×
          </button>
        </div>
        <form
          className="flex gap-2 border-b p-3"
          style={{ borderColor: "var(--border)" }}
          onSubmit={(e) => {
            e.preventDefault();
            const v = newName.trim();
            if (!v) return;
            addParty(v);
            setNewName("");
          }}
        >
          <input
            className="input"
            placeholder="New party name"
            aria-label="New party name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="btn btn-primary" type="submit">
            Add
          </button>
        </form>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {parties.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">
              No parties yet. Type an owner in the table to create one.
            </p>
          )}
          {used.length > 0 && <ul className="flex flex-col gap-2">{used.map(row)}</ul>}
          {unused.length > 0 && (
            <>
              <h3 className="mt-4 mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                Unused
              </h3>
              <ul className="flex flex-col gap-2">{unused.map(row)}</ul>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
