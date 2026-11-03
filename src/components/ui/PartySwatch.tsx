import type { Party } from "../../model/types";
import { resolveColour, UNASSIGNED_COLOUR } from "../../design/palette";
import { useResolvedTheme } from "../../hooks/useTheme";

export function PartySwatch({
  party,
  size = 10,
}: {
  party: Party | null | undefined;
  size?: number;
}) {
  const mode = useResolvedTheme();
  const c = party
    ? resolveColour(party.colourIndex, mode, party.colourOverride)
    : UNASSIGNED_COLOUR[mode];
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full ${c.pattern === "stripe" ? "stripe-pattern" : ""}`}
      style={{
        width: size,
        height: size,
        background: c.fill,
        outline: c.pattern === "dot" ? `2px dotted ${c.fill}` : undefined,
        outlineOffset: 1,
      }}
    />
  );
}
