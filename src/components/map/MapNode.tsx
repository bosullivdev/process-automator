import type { Step } from "../../model/types";
import type { Flag } from "../../model/validate";
import type { LayoutNode, PositionedNode } from "../../graph/layout-types";
import type { ResolvedColour } from "../../design/palette";
import { BADGE_GAP, BADGE_ROW, BADGE_SIZE, TECH_GAP, TECH_ROW } from "../../graph/build-graph";
import { partyInitials } from "../../model/party";

export const MONO_FONT = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace';

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
  const showTech = !!text.tech;
  const badges = colours.contributors.slice(0, text.badges);
  const hasBadgeRow = badges.length > 0 || (isTask && !!step?.isSubProcess);
  const techW = text.techWidth;
  const badgesW = badges.length ? badges.length * (BADGE_SIZE + BADGE_GAP) - BADGE_GAP : 0;

  // The annotation block (name, technology pill, badges) sits inside a task and
  // beside or below the other shapes, on the side chosen by the layout.
  const outside = text.outside;
  const side = node.labelSide;
  const labelRight = outside && side === "right";
  const labelLeft = outside && side === "left";
  const blockH =
    nameLines.length * LINE_H +
    (showTech ? TECH_GAP + TECH_ROW : 0) +
    (hasBadgeRow ? BADGE_ROW : 0);
  const blockTop = !outside
    ? cy - blockH / 2
    : labelRight || labelLeft
      ? cy - blockH / 2
      : side === "above"
        ? y - 4 - blockH
        : y + height + 4;
  const labelX = labelRight ? x + width + 4 : labelLeft ? x - 4 : cx;
  const anchor = labelRight ? "start" : labelLeft ? "end" : "middle";
  /** Left edge of an element of width w, aligned like the text. */
  const alignLeft = (w: number) => (labelRight ? labelX : labelLeft ? labelX - w : cx - w / 2);
  const techY = blockTop + nameLines.length * LINE_H + TECH_GAP + TECH_ROW / 2;
  const badgeY =
    blockTop + nameLines.length * LINE_H + (showTech ? TECH_GAP + TECH_ROW : 0) + BADGE_ROW / 2;
  // Inside a task, badges hug the left padding; outside they follow the text alignment.
  const badgesLeft = isTask ? x + 10 : alignLeft(badgesW);
  const techLeft = isTask ? cx - techW / 2 : alignLeft(techW);

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
          x={labelX}
          y={blockTop + LINE_H / 2}
          textAnchor={anchor}
          dominantBaseline="central"
          fontSize={outside ? 11 : 12}
          fontWeight={500}
          fill="var(--text)"
          style={{ pointerEvents: "none" }}
        >
          {nameLines.map((line, i) => (
            <tspan key={i} x={labelX} dy={i === 0 ? 0 : LINE_H}>
              {line}
            </tspan>
          ))}
        </text>
      )}
      {showTech && (
        <g style={{ pointerEvents: "none" }}>
          <rect
            x={techLeft}
            y={techY - 8}
            width={techW}
            height={16}
            rx={8}
            fill="var(--surface-2)"
            stroke="var(--border)"
            strokeWidth={1}
          />
          <text
            x={techLeft + techW / 2}
            y={techY}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={10}
            fontFamily={MONO_FONT}
            data-font="mono"
            fill="var(--text-muted)"
          >
            {text.tech}
          </text>
        </g>
      )}
      {badges.map((c, i) => {
        const bx = badgesLeft + i * (BADGE_SIZE + BADGE_GAP) + BADGE_SIZE / 2;
        return (
          <g key={c.id}>
            <title>{`Contributor: ${c.name}`}</title>
            <circle
              cx={bx}
              cy={badgeY}
              r={BADGE_SIZE / 2}
              fill={c.colour.fill}
              stroke="var(--surface)"
              strokeWidth={1}
            />
            <text
              x={bx}
              y={badgeY}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={8}
              fontWeight={700}
              fill={c.colour.text}
              style={{ pointerEvents: "none" }}
            >
              {partyInitials(c.name)}
            </text>
          </g>
        );
      })}
      {isTask && step?.isSubProcess && (
        <g
          transform={`translate(${x + width - 10 - 12}, ${badgeY - 6})`}
          stroke={colours.owner.fill}
          fill="none"
          strokeWidth={1.2}
        >
          <title>Sub-process</title>
          <rect x={0} y={0} width={12} height={12} rx={2} />
          <line x1={3} y1={6} x2={9} y2={6} />
          <line x1={6} y1={3} x2={6} y2={9} />
        </g>
      )}
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
