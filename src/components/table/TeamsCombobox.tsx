import type { Team } from "../../model/types";
import { TagCombobox } from "./TagCombobox";

interface Props {
  value: string[];
  teams: Team[];
  onChange: (ids: string[]) => void;
  onCreateTeam: (name: string) => string;
  ariaLabel: string;
}

/** Small neutral tag glyph: teams are not coloured, colour belongs to lanes. */
export function TeamGlyph({ size = 10 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-sm border"
      style={{ width: size, height: size, borderColor: "var(--text-muted)" }}
    />
  );
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
      swatch={(t, size) => (t === null ? null : <TeamGlyph size={size} />)}
      noun="teams"
      unknownLabel="Unknown team"
    />
  );
}
