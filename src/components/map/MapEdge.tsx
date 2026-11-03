import type { LayoutEdge, RoutedEdge } from "../../graph/layout-types";
import { estimateTextWidth } from "./text";

interface Props {
  edge: LayoutEdge;
  route: RoutedEdge;
  selected: boolean;
  mode: "simple" | "bpmn";
}

export function MapEdge({ edge, route, selected, mode }: Props) {
  const pts = route.points;
  if (pts.length < 2) return null;
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const stroke = selected ? "var(--color-accent)" : "var(--edge)";
  const width = selected ? 2.5 : 1.5;
  const marker = selected ? "url(#arrow-selected)" : "url(#arrow)";
  const label = edge.label;
  const lw = label ? estimateTextWidth(label, 10) + 10 : 0;
  const la = route.labelAt;

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
        stroke={stroke}
        strokeWidth={width}
      />
    );
  })();

  return (
    <g data-edge-id={edge.id}>
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        strokeDasharray={edge.dashed ? "6 4" : undefined}
        markerEnd={marker}
        strokeLinejoin="round"
      />
      {slash}
      {label && la && (
        <g transform={`translate(${la.x}, ${la.y - 9})`}>
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
          )}
        </g>
      )}
    </g>
  );
}
