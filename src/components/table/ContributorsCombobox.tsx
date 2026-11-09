import type { Party } from "../../model/types";
import { PartySwatch } from "../ui/PartySwatch";
import { TagCombobox } from "./TagCombobox";

interface Props {
  value: string[];
  parties: Party[];
  onChange: (ids: string[]) => void;
  onCreateParty: (name: string) => string;
  ariaLabel: string;
}

export function ContributorsCombobox({
  value,
  parties,
  onChange,
  onCreateParty,
  ariaLabel,
}: Props) {
  return (
    <TagCombobox
      value={value}
      options={parties}
      onChange={onChange}
      onCreate={onCreateParty}
      ariaLabel={ariaLabel}
      placeholder="Add…"
      swatch={(p, size) => <PartySwatch party={p} size={size} />}
      noun="parties"
      unknownLabel="Unknown party"
    />
  );
}
