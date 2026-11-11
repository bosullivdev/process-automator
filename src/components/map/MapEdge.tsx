import type { LayoutEdge, Point, RoutedEdge } from "../../graph/layout-types";
import { offsetPolyline } from "./geometry";
import { estimateTextWidth } from "./text";

/** One drawn line of an arrow: its colour and the arrowhead marker to use. */
export interface EdgeLine {
  stroke: string;
  marker: string;
}

interface Props {
  edge: LayoutEdge;
  route: RoutedEdge;
  selected: boolean;
  mode: "simple" | "bpmn";
  /** Faded because another team's variant is highlighted. */
  dimmed?: boolean;
  /**
   * Lines to draw along the route. One neutral line for an arrow every team
   * uses; one coloured line per team for an arrow only some teams use, drawn
   * side by side like a metro map.
   */
  lines: EdgeLine[];
  width: number;
  /**
   * The arrow's lines, or its outcome label. Labels are drawn in a second
   * pass, above every line, so no arrow strikes through a label.
   */
  part: "line" | "label";
}

/** Width of the "default" tag's backing, matching the room the layout keeps for it. */
const DEFAULT_TAG_W = 38;

/** Gap between parallel team lines. */
const LINE_GAP = 3;

export function MapEdge({
  edge,
  route,
  selected,
  mode,
  dimmed = false,
  lines,
  width,
  part,
}: Props) {
  const pts = route.points;
  if (pts.length < 2) return null;
  const toPath = (points: Point[]) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const main = lines[0];
  const label = edge.label;
  const lw = label ? estimateTextWidth(label, 10) + 10 : 0;
  const la = route.labelAt;
  const multi = lines.length > 1;

  if (part === "label") {
    if (!label || !la) return null;
    return (
      <g
        data-edge-label={edge.id}
        transform={`translate(${la.x}, ${la.y})`}
        opacity={dimmed ? 0.15 : undefined}
      >
        <rect
          x={-lw / 2}
          y={-9}
          width={lw}
          height={18}
          rx={9}
          fill="var(--surface)"
          stroke={selected ? "var(--color-accent)" : "var(--border-strong)"}
          strokeWidth={1}
        />
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={10}
          fill="var(--text)"
          style={{ pointerEvents: "none" }}
        >
          {label}
        </text>
        {edge.isDefault && mode === "simple" && (
          <>
            {/* Backing in the canvas colour, so the arrow under the tag does not strike it through. */}
            <rect x={lw / 2 + 1} y={-7} width={DEFAULT_TAG_W} height={14} rx={7} fill="var(--bg)" />
            <text
              x={lw / 2 + 4}
              textAnchor="start"
              dominantBaseline="central"
              fontSize={9}
              fill="var(--text-muted)"
              fontStyle="italic"
              style={{ pointerEvents: "none" }}
            >
              default
            </text>
          </>
        )}
      </g>
    );
  }

  // BPMN default-flow slash on the first segment.
  const slash = (() => {
    if (mode !== "bpmn" || !edge.isDefault) return null;
    const a = pts[0];
    const b = pts[1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = Math.min(8, len / 2) / len;
    const mx = a.x + (b.x - a.x) * t;
    const my = a.y + (b.y - a.y) * t;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const s = 5;
    return (
      <line
        x1={mx - ux * s + nx * s}
        y1={my - uy * s + ny * s}
        x2={mx + ux * s - nx * s}
        y2={my + uy * s - ny * s}
        stroke={main.stroke}
        strokeWidth={width}
      />
    );
  })();

  return (
    <g
      data-edge-id={edge.id}
      data-team-lines={multi || lines[0].marker !== "url(#arrow)" ? lines.length : undefined}
      opacity={dimmed ? 0.15 : undefined}
      data-dimmed={dimmed || undefined}
    >
      {lines.map((line, i) => {
        const d = (i - (lines.length - 1) / 2) * LINE_GAP;
        return (
          <path
            key={i}
            d={toPath(offsetPolyline(pts, d))}
            fill="none"
            stroke={line.stroke}
            strokeWidth={width}
            strokeDasharray={edge.dashed ? "6 4" : undefined}
            markerEnd={line.marker}
            strokeLinejoin="round"
          />
        );
      })}
      {slash}
    </g>
  );
}
