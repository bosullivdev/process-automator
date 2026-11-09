import type { Team } from "../../model/types";
import { PartySwatch } from "../ui/PartySwatch";
import { TagCombobox } from "./TagCombobox";

interface Props {
  value: string[];
  teams: Team[];
  onChange: (ids: string[]) => void;
  onCreateTeam: (name: string) => string;
  ariaLabel: string;
}

/** Which teams a step applies to. Nothing selected means every team. */
export function TeamsCombobox({ value, teams, onChange, onCreateTeam, ariaLabel }: Props) {
  return (
    <TagCombobox
      value={value}
      options={teams}
      onChange={onChange}
      onCreate={onCreateTeam}
      ariaLabel={ariaLabel}
      placeholder="All teams"
      swatch={(t, size) => (t === null ? null : <PartySwatch party={t} size={size} />)}
      noun="teams"
      unknownLabel="Unknown team"
    />
  );
}
