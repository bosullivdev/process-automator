import type { PickerItem } from "./usePartyPicker";
import { PartySwatch } from "../ui/PartySwatch";

interface Props {
  items: PickerItem[];
  active: number;
  onPick: (item: PickerItem) => void;
  onHover: (index: number) => void;
}

export function PartyList({ items, active, onPick, onHover }: Props) {
  if (items.length === 0) {
    return (
      <div className="px-2 py-1.5 text-xs text-[var(--text-muted)]">
        No parties yet. Type a name to create one.
      </div>
    );
  }
  return (
    <ul role="listbox" className="flex flex-col">
      {items.map((item, i) => {
        const key = item.kind === "party" ? item.party.id : item.kind;
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
                <PartySwatch party={item.party} />
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
                <PartySwatch party={null} />
                <span className="text-[var(--text-muted)]">Unassigned</span>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
