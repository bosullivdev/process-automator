import type { Step } from "../../model/types";
import type { Flag } from "../../model/validate";
import type { LayoutNode, PositionedNode } from "../../graph/layout-types";
import type { ResolvedColour } from "../../design/palette";
import {
  BADGE_GAP,
  BADGE_ROW,
  BADGE_SIZE,
  CONTROL_ICON,
  CONTROL_ROW,
  TEAM_ROW,
  TECH_GAP,
  TECH_ROW,
} from "../../graph/build-graph";
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
  /** Names of the teams the step is scoped to, for the tooltip; empty = all teams. */
  teamNames?: string[];
  /** Faded because another team's variant is highlighted. */
  dimmed?: boolean;
  /** Colour of the team pill's border when the step belongs to exactly one team. */
  teamColour?: string;
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
  teamNames = [],
  dimmed = false,
  teamColour,
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
        step.hasControl
          ? `Control${step.controlRef?.trim() ? `: ${step.controlRef.trim()}` : ""}`
          : "",
        teamNames.length ? `Teams: ${teamNames.join(", ")}` : "",
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
  const techW = text.techWidth;
  const badgesW = badges.length ? badges.length * (BADGE_SIZE + BADGE_GAP) - BADGE_GAP : 0;

  // A task's name sits inside the box. Everything else (an outside name, the
  // technology pill, the badges) forms one block beside or below the shape, on
  // the side chosen by the layout.
  const outside = text.outside;
  const side = node.labelSide;
  const labelRight = side === "right";
  const labelLeft = side === "left";
  const nameH = outside ? nameLines.length * LINE_H : 0;
  const blockH = text.labelHeight;
  const blockTop =
    labelRight || labelLeft ? cy - blockH / 2 : side === "above" ? y - 4 - blockH : y + height + 4;
  const labelX = labelRight ? x + width + 4 : labelLeft ? x - 4 : cx;
  const anchor = labelRight ? "start" : labelLeft ? "end" : "middle";
  /** Left edge of an element of width w, aligned like the block's text. */
  const alignLeft = (w: number) => (labelRight ? labelX : labelLeft ? labelX - w : cx - w / 2);
  const techTop = blockTop + nameH + (nameH ? TECH_GAP : 0);
  const techY = techTop + TECH_ROW / 2;
  const badgeY = (showTech ? techTop + TECH_ROW : blockTop + nameH) + BADGE_ROW / 2;
  const badgesLeft = alignLeft(badgesW);
  const techLeft = alignLeft(techW);
  const showTeams = !!text.teams;
  const teamsW = text.teamsWidth;
  const afterBadges = badgeY - BADGE_ROW / 2 + (badges.length ? BADGE_ROW : 0);
  const teamsTop = afterBadges + (nameH || showTech || badges.length ? TECH_GAP : 0);
  const teamsY = teamsTop + TEAM_ROW / 2;
  const teamsLeft = alignLeft(teamsW);
  const showControl = !!text.control;
  const controlW = text.controlWidth;
  const afterTeams = showTeams ? teamsTop + TEAM_ROW : afterBadges;
  const controlTop = afterTeams + (nameH || showTech || badges.length || showTeams ? TECH_GAP : 0);
  const controlY = controlTop + CONTROL_ROW / 2;
  const controlLeft = alignLeft(controlW);
  // Inside name block for tasks, centred (nudged up when the sub-process marker needs room).
  const insideTop = cy - (nameLines.length * LINE_H) / 2 - (step?.isSubProcess ? 6 : 0);

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
      opacity={dimmed ? 0.18 : undefined}
      data-dimmed={dimmed || undefined}
    >
      <title>{title}</title>
      {shape}
      {step && nameLines.length > 0 && (
        <text
          x={outside ? labelX : cx}
          y={(outside ? blockTop : insideTop) + LINE_H / 2}
          textAnchor={outside ? anchor : "middle"}
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
      {showTeams && (
        <g style={{ pointerEvents: "none" }}>
          <rect
            x={teamsLeft}
            y={teamsY - 8}
            width={teamsW}
            height={16}
            rx={4}
            fill="var(--surface)"
            stroke={teamColour ?? "var(--border-strong)"}
            strokeWidth={teamColour ? 1.5 : 1}
            strokeDasharray="3 2"
          />
          <text
            x={teamsLeft + teamsW / 2}
            y={teamsY}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={10}
            fill="var(--text-muted)"
          >
            {text.teams}
          </text>
        </g>
      )}
      {showControl && (
        <g data-control style={{ pointerEvents: "none" }}>
          <rect
            x={controlLeft}
            y={controlY - 8}
            width={controlW}
            height={16}
            rx={4}
            fill="var(--surface)"
            stroke="var(--text)"
            strokeWidth={1}
          />
          {/* Shield with a tick */}
          <path
            transform={`translate(${controlLeft + 6}, ${controlY - 6})`}
            d="M5 0.5 L9.5 2 V5.5 C9.5 8.5 7.5 10.5 5 11.5 C2.5 10.5 0.5 8.5 0.5 5.5 V2 Z M2.8 5.8 L4.4 7.4 L7.3 4.2"
            fill="none"
            stroke="var(--text)"
            strokeWidth={1.1}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <text
            x={controlLeft + 8 + CONTROL_ICON + (controlW - 16 - CONTROL_ICON) / 2}
            y={controlY}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={10}
            fontWeight={600}
            fill="var(--text)"
          >
            {text.control}
          </text>
        </g>
      )}
      {isTask && step?.isSubProcess && (
        <g
          transform={`translate(${cx - 6}, ${y + height - 16})`}
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
