import type { Step } from "../../model/types";
import type { Flag } from "../../model/validate";
import type { LayoutNode, Orientation, PositionedNode } from "../../graph/layout-types";
import type { ResolvedColour } from "../../design/palette";

export interface NodeColours {
  owner: ResolvedColour;
  contributors: Array<{ id: string; name: string; colour: ResolvedColour }>;
}

interface Props {
  node: PositionedNode;
  layoutNode: LayoutNode;
  step: Step | undefined;
  colours: NodeColours;
  mode: "simple" | "bpmn";
  orientation: Orientation;
  selected: boolean;
  flags: Flag[] | undefined;
  onSelect: (stepId: string) => void;
}

const LINE_H = 14;

export function MapNode({
  node,
  layoutNode,
  step,
  colours,
  mode,
  orientation,
  selected,
  flags,
  onSelect,
}: Props) {
  const { kind, text } = layoutNode;
  // The shape sits inside the node box at (cx, cy); outside labels use the rest.
  const width = layoutNode.shapeWidth;
  const height = layoutNode.shapeHeight;
  const x = node.x + layoutNode.cx - width / 2;
  const y = node.y + layoutNode.cy - height / 2;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const stroke = selected ? "var(--color-accent)" : colours.owner.fill;
  const strokeWidth = selected ? 3 : 2;
  const fill = "var(--surface)";
  const dash =
    colours.owner.pattern === "stripe"
      ? "6 3"
      : colours.owner.pattern === "dot"
        ? "2 3"
        : undefined;
  const sev = flags?.some((f) => f.severity === "error")
    ? "error"
    : flags?.length
      ? "warning"
      : null;
  const title = step
    ? [
        `${step.displayNo}: ${step.name || "Untitled"}`,
        step.technology ? `Technology: ${step.technology}` : "",
        step.notes ? `Notes: ${step.notes}` : "",
        ...(flags ?? []).map(
          (f) => `${f.severity === "error" ? "Error" : "Warning"}: ${f.message}`,
        ),
      ]
        .filter(Boolean)
        .join("\n")
    : kind === "fork"
      ? "Parallel split"
      : "Parallel join";

  const common = { fill, stroke, strokeWidth, strokeDasharray: dash };

  let shape: React.ReactNode;
  switch (kind) {
    case "start":
      shape = (
        <>
          <circle
            cx={cx}
            cy={cy}
            r={width / 2 - 1}
            {...common}
            strokeWidth={mode === "bpmn" ? 1.5 : strokeWidth}
          />
          {mode === "bpmn" && step?.startKind === "message" && (
            <g stroke={stroke} strokeWidth={1.5} fill="none">
              <rect x={cx - 9} y={cy - 6} width={18} height={12} rx={1} />
              <path d={`M${cx - 9},${cy - 6} L${cx},${cy + 1} L${cx + 9},${cy - 6}`} />
            </g>
          )}
          {mode === "bpmn" && step?.startKind === "timer" && (
            <g stroke={stroke} strokeWidth={1.5} fill="none">
              <circle cx={cx} cy={cy} r={9} />
              <path d={`M${cx},${cy - 6} L${cx},${cy} L${cx + 4},${cy + 3}`} />
            </g>
          )}
        </>
      );
      break;
    case "end":
      shape = (
        <>
          <circle cx={cx} cy={cy} r={width / 2 - 2} {...common} strokeWidth={selected ? 5 : 4} />
          {mode === "bpmn" && step?.endKind === "terminate" && (
            <circle cx={cx} cy={cy} r={width / 2 - 10} fill={stroke} />
          )}
        </>
      );
      break;
    case "decision":
      shape = (
        <>
          <polygon
            points={`${cx},${y + 1} ${x + width - 1},${cy} ${cx},${y + height - 1} ${x + 1},${cy}`}
            {...common}
            strokeLinejoin="round"
          />
          {mode === "bpmn" && (
            <g stroke={stroke} strokeWidth={2.5} strokeLinecap="round">
              <line x1={cx - 10} y1={cy - 10} x2={cx + 10} y2={cy + 10} />
              <line x1={cx + 10} y1={cy - 10} x2={cx - 10} y2={cy + 10} />
            </g>
          )}
        </>
      );
      break;
    case "fork":
    case "join":
      shape = (
        <>
          <polygon
            points={`${cx},${y + 1} ${x + width - 1},${cy} ${cx},${y + height - 1} ${x + 1},${cy}`}
            {...common}
            strokeLinejoin="round"
          />
          <g stroke={stroke} strokeWidth={2.5} strokeLinecap="round">
            <line x1={cx - 9} y1={cy} x2={cx + 9} y2={cy} />
            <line x1={cx} y1={cy - 9} x2={cx} y2={cy + 9} />
          </g>
        </>
      );
      break;
    default:
      shape = <rect x={x + 1} y={y + 1} width={width - 2} height={height - 2} rx={8} {...common} />;
  }

  const isTask = kind === "task";
  const nameLines = text.nameLines;
  const showTech = isTask && text.tech;
  const hasDots = isTask && (colours.contributors.length > 0 || !!step?.isSubProcess);
  // Inside text block: name lines, optional tech line, optional dot row; centred vertically.
  const blockH = nameLines.length * LINE_H + (showTech ? LINE_H : 0);
  const blockTop = cy - blockH / 2 - (hasDots ? 4 : 0);
  const outside = text.outside;
  const labelRight = outside && orientation === "vertical";
  const labelX = labelRight ? x + width + 4 : cx;
  const labelTop = labelRight ? cy - text.labelHeight / 2 : y + height + 4;

  return (
    <g
      data-node-id={node.id}
      data-step-id={step?.id}
      className="cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        if (step) onSelect(step.id);
      }}
      tabIndex={step ? 0 : -1}
      role={step ? "button" : undefined}
      aria-label={step ? `Step ${step.displayNo}: ${step.name || "Untitled"}` : undefined}
      onKeyDown={(e) => {
        if (step && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect(step.id);
        }
      }}
      style={{ outline: "none" }}
    >
      <title>{title}</title>
      {shape}
      {step && nameLines.length > 0 && (
        <text
          x={outside ? labelX : cx}
          y={outside ? labelTop + LINE_H / 2 : blockTop + LINE_H / 2}
          textAnchor={labelRight ? "start" : "middle"}
          dominantBaseline="central"
          fontSize={outside ? 11 : 12}
          fontWeight={500}
          fill="var(--text)"
          style={{ pointerEvents: "none" }}
        >
          {nameLines.map((line, i) => (
            <tspan key={i} x={outside ? labelX : cx} dy={i === 0 ? 0 : LINE_H}>
              {line}
            </tspan>
          ))}
        </text>
      )}
      {showTech && (
        <text
          x={cx}
          y={blockTop + nameLines.length * LINE_H + LINE_H / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={10}
          fill="var(--text-muted)"
          style={{ pointerEvents: "none" }}
        >
          {text.tech}
        </text>
      )}
      {isTask && step?.isSubProcess && (
        <g
          transform={`translate(${cx - 6}, ${y + height - 16})`}
          stroke={colours.owner.fill}
          fill="none"
          strokeWidth={1.2}
        >
          <rect x={0} y={0} width={12} height={12} rx={2} />
          <line x1={3} y1={6} x2={9} y2={6} />
          <line x1={6} y1={3} x2={6} y2={9} />
        </g>
      )}
      {isTask &&
        colours.contributors.map((c, i) => (
          <circle
            key={c.id}
            cx={x + 12 + i * 12}
            cy={y + height - 10}
            r={4}
            fill={c.colour.fill}
            stroke="var(--surface)"
            strokeWidth={1}
          >
            <title>{`Contributor: ${c.name}`}</title>
          </circle>
        ))}
      {sev && (
        <circle
          cx={x + width - (outside ? 2 : 4)}
          cy={y + (outside ? 2 : 4)}
          r={5}
          fill={sev === "error" ? "var(--color-danger)" : "var(--color-warn)"}
          stroke="var(--surface)"
          strokeWidth={1.5}
        >
          <title>{(flags ?? []).map((f) => f.message).join("\n")}</title>
        </circle>
      )}
    </g>
  );
}
