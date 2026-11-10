import type { ReactNode } from "react";
import type { Named, PickerItem } from "./usePartyPicker";

interface Props<T extends Named> {
  items: PickerItem<T>[];
  active: number;
  onPick: (item: PickerItem<T>) => void;
  onHover: (index: number) => void;
  /** Icon drawn before a name; null item means "Unassigned". */
  swatch: (item: T | null, size?: number) => ReactNode;
  /** What the list offers, for the empty state: "parties" or "teams". */
  noun?: string;
}

export function PartyList<T extends Named>({
  items,
  active,
  onPick,
  onHover,
  swatch,
  noun = "parties",
}: Props<T>) {
  if (items.length === 0) {
    return (
      <div className="px-2 py-1.5 text-xs text-[var(--text-muted)]">
        No {noun} yet. Type a name to create one.
      </div>
    );
  }
  return (
    <ul role="listbox" className="flex flex-col">
      {items.map((item, i) => {
        const key = item.kind === "party" ? item.party.id : item.kind;
        const also = item.kind === "multi" ? item.parts.slice(1) : [];
        return (
          <li
            key={key}
            role="option"
            aria-selected={i === active}
            data-active={i === active}
            className="menu-item"
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(item);
            }}
          >
            {item.kind === "party" && (
              <>
                {swatch(item.party)}
                <span className="truncate">
                  {item.near ? `Use ${item.party.name}?` : item.party.name}
                </span>
              </>
            )}
            {item.kind === "create" && (
              <>
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-[var(--text-muted)]" />
                <span className="truncate">
                  Create <strong>{item.name}</strong>
                </span>
              </>
            )}
            {item.kind === "clear" && (
              <>
                {swatch(null)}
                <span className="text-[var(--text-muted)]">Unassigned</span>
              </>
            )}
            {item.kind === "share" && (
              <>
                {swatch(item.party)}
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate">
                    Also <strong>{item.party.name}</strong>
                  </span>
                  <span className="truncate text-xs text-[var(--text-muted)]">
                    Drawn in their lane too; still one row
                  </span>
                </span>
              </>
            )}
            {item.kind === "multi" && (
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="flex min-w-0 items-center gap-1.5">
                  {swatch(item.parts[0].party)}
                  <span className="truncate">
                    <strong>{item.parts[0].name}</strong>
                    {item.parts[0].party ? "" : " (new)"} owns
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--text-muted)]">
                  <span className="flex shrink-0 items-center gap-0.5">
                    {also.map((p) => (
                      <span key={p.name}>{swatch(p.party, 8)}</span>
                    ))}
                  </span>
                  <span className="truncate">
                    Also {also.map((p) => p.name + (p.party ? "" : " (new)")).join(", ")}; one row,
                    drawn in each lane
                  </span>
                </span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
