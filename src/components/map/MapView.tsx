import { useEffect, useMemo, useRef, useState } from "react";
import type { Party, Process } from "../../model/types";
import type { Flag } from "../../model/validate";
import type { LayoutGraph, LayoutResult } from "../../graph/layout-types";
import { UNASSIGNED_LANE } from "../../graph/layout-types";
import {
  resolveColour,
  UNASSIGNED_COLOUR,
  withAlpha,
  type ResolvedColour,
} from "../../design/palette";
import { useResolvedTheme } from "../../hooks/useTheme";
import { usePanZoom } from "../../hooks/usePanZoom";
import { MapNode, type NodeColours } from "./MapNode";
import { MapEdge } from "./MapEdge";

interface Props {
  process: Process;
  parties: Party[];
  graph: LayoutGraph;
  layout: LayoutResult | null;
  updating: boolean;
  mode: "simple" | "bpmn";
  selectedStepId: string | null;
  flags: Map<string, Flag[]>;
  onSelect: (stepId: string | null) => void;
  onReorderLanes: (laneOrder: string[]) => void;
}

export function MapView({
  process,
  parties,
  graph,
  layout,
  updating,
  mode,
  selectedStepId,
  flags,
  onSelect,
  onReorderLanes,
}: Props) {
  const theme = useResolvedTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const pz = usePanZoom(containerRef);
  const { t, fit, reveal } = pz;
  const fittedFor = useRef<string | null>(null);
  const selectionFromMap = useRef(false);

  const partyById = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);
  const stepById = useMemo(() => new Map(process.steps.map((s) => [s.id, s])), [process.steps]);
  const nodeKind = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const edgeById = useMemo(() => new Map(graph.edges.map((e) => [e.id, e])), [graph.edges]);

  const laneColour = (laneId: string): ResolvedColour => {
    if (laneId === UNASSIGNED_LANE) return UNASSIGNED_COLOUR[theme];
    const p = partyById.get(laneId);
    return p ? resolveColour(p.colourIndex, theme, p.colourOverride) : UNASSIGNED_COLOUR[theme];
  };
  const laneName = (laneId: string) =>
    laneId === UNASSIGNED_LANE ? "Unassigned" : (partyById.get(laneId)?.name ?? "Unknown");

  // Fit once per process / orientation.
  useEffect(() => {
    if (!layout || layout.width === 0) return;
    const key = `${process.id}:${layout.orientation}`;
    if (fittedFor.current !== key) {
      fittedFor.current = key;
      fit(layout.width, layout.height);
    }
  }, [layout, process.id, fit]);

  // When the selection changes from outside the map, pan to the node.
  useEffect(() => {
    if (!selectedStepId || !layout) return;
    if (selectionFromMap.current) {
      selectionFromMap.current = false;
      return;
    }
    const n = layout.nodes.find((x) => x.id === selectedStepId);
    if (n) reveal(n.x, n.y, n.width, n.height);
  }, [selectedStepId, layout, reveal]);

  // ---- lane header dragging
  const [drag, setDrag] = useState<{ laneId: string; pos: number } | null>(null);
  const laneAxis = layout?.orientation === "horizontal" ? "y" : "x";
  const dropIndex = useMemo(() => {
    if (!drag || !layout) return -1;
    const lanes = layout.lanes;
    let idx = lanes.length - 1;
    for (let i = 0; i < lanes.length; i++) {
      const ln = lanes[i];
      const start = laneAxis === "y" ? ln.y : ln.x;
      const size = laneAxis === "y" ? ln.height : ln.width;
      if (drag.pos < start + size / 2) {
        idx = i;
        break;
      }
    }
    return idx;
  }, [drag, layout, laneAxis]);

  const toContent = (clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - t.x) / t.k, y: (clientY - rect.top - t.y) / t.k };
  };

  const onHeaderPointerDown = (e: React.PointerEvent, laneId: string) => {
    if (!layout || layout.lanes.length < 2) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = toContent(e.clientX, e.clientY);
    setDrag({ laneId, pos: laneAxis === "y" ? p.y : p.x });
  };
  const onHeaderPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toContent(e.clientX, e.clientY);
    setDrag({ ...drag, pos: laneAxis === "y" ? p.y : p.x });
  };
  const onHeaderPointerUp = () => {
    if (!drag || !layout) return;
    const visible = layout.lanes.map((l) => l.id);
    const from = visible.indexOf(drag.laneId);
    const to = dropIndex;
    setDrag(null);
    if (from < 0 || to < 0 || from === to || drag.laneId === UNASSIGNED_LANE) return;
    const reordered = [...visible];
    reordered.splice(from, 1);
    reordered.splice(to, 0, drag.laneId);
    // Keep hidden lanes (zero steps) in laneOrder, after the visible ones, preserving their order.
    const hidden = process.laneOrder.filter((id) => !visible.includes(id));
    onReorderLanes([...reordered.filter((id) => id !== UNASSIGNED_LANE), ...hidden]);
  };

  const moveLaneByKeyboard = (laneId: string, delta: -1 | 1) => {
    if (!layout) return;
    const visible = layout.lanes.map((l) => l.id).filter((id) => id !== UNASSIGNED_LANE);
    const i = visible.indexOf(laneId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= visible.length) return;
    [visible[i], visible[j]] = [visible[j], visible[i]];
    const hidden = process.laneOrder.filter((id) => !visible.includes(id));
    onReorderLanes([...visible, ...hidden]);
  };

  const empty = !layout || layout.nodes.length === 0;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full select-none overflow-hidden"
      style={{ background: "var(--bg)", touchAction: "none" }}
      data-testid="map"
      data-updating={updating}
    >
      <svg
        className="h-full w-full"
        onWheel={pz.onWheel}
        onPointerDown={pz.onPointerDown}
        onPointerMove={(e) => {
          pz.onPointerMove(e);
          onHeaderPointerMove(e);
        }}
        onPointerUp={(e) => {
          const moved = pz.onPointerUp();
          if (drag) {
            onHeaderPointerUp();
            return;
          }
          if (moved) return;
          // Pointer capture means the click lands on the svg, so resolve the node ourselves.
          const hit = document
            .elementFromPoint(e.clientX, e.clientY)
            ?.closest<SVGElement>("[data-step-id]");
          const stepId = hit?.getAttribute("data-step-id") ?? null;
          if (stepId) selectionFromMap.current = true;
          onSelect(stepId);
        }}
        style={{ cursor: drag ? "grabbing" : "grab" }}
        role="img"
        aria-label={`Process map for ${process.name}`}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="var(--edge)" />
          </marker>
          <marker
            id="arrow-selected"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="var(--color-accent)" />
          </marker>
          <pattern
            id="lane-stripe"
            patternUnits="userSpaceOnUse"
            width="8"
            height="8"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(0,0,0,0.18)" strokeWidth="1" />
          </pattern>
          <pattern id="lane-dot" patternUnits="userSpaceOnUse" width="6" height="6">
            <circle cx="3" cy="3" r="1" fill="rgba(0,0,0,0.25)" />
          </pattern>
        </defs>
        <g transform={`translate(${t.x}, ${t.y}) scale(${t.k})`}>
          {layout?.lanes.map((lane, i) => {
            const c = laneColour(lane.id);
            const horizontal = layout.orientation === "horizontal";
            const hx = lane.header.x + lane.header.width / 2;
            const hy = lane.header.y + lane.header.height / 2;
            const isDragging = drag?.laneId === lane.id;
            return (
              <g key={lane.id} data-lane-id={lane.id} opacity={isDragging ? 0.6 : 1}>
                <rect
                  x={lane.x}
                  y={lane.y}
                  width={lane.width}
                  height={lane.height}
                  fill={withAlpha(c.fill, 0.09)}
                />
                <line
                  x1={lane.x}
                  y1={horizontal ? lane.y + lane.height : lane.y}
                  x2={horizontal ? lane.x + lane.width : lane.x + lane.width}
                  y2={lane.y + lane.height}
                  stroke="var(--border)"
                  strokeWidth={1}
                  style={{ display: horizontal ? undefined : "none" }}
                />
                {!horizontal && (
                  <line
                    x1={lane.x + lane.width}
                    y1={lane.y}
                    x2={lane.x + lane.width}
                    y2={lane.y + lane.height}
                    stroke="var(--border)"
                    strokeWidth={1}
                  />
                )}
                <g
                  className={lane.id === UNASSIGNED_LANE ? "" : "cursor-grab"}
                  onPointerDown={(e) =>
                    lane.id !== UNASSIGNED_LANE && onHeaderPointerDown(e, lane.id)
                  }
                  tabIndex={lane.id === UNASSIGNED_LANE ? -1 : 0}
                  role="button"
                  aria-label={`Lane ${laneName(lane.id)}. Use arrow keys to reorder.`}
                  onKeyDown={(e) => {
                    const back = horizontal ? "ArrowUp" : "ArrowLeft";
                    const fwd = horizontal ? "ArrowDown" : "ArrowRight";
                    if (e.key === back) moveLaneByKeyboard(lane.id, -1);
                    if (e.key === fwd) moveLaneByKeyboard(lane.id, 1);
                  }}
                  style={{ outline: "none" }}
                >
                  <rect
                    x={lane.header.x}
                    y={lane.header.y}
                    width={lane.header.width}
                    height={lane.header.height}
                    fill={c.fill}
                  />
                  {c.pattern !== "none" && (
                    <rect
                      x={lane.header.x}
                      y={lane.header.y}
                      width={lane.header.width}
                      height={lane.header.height}
                      fill={c.pattern === "stripe" ? "url(#lane-stripe)" : "url(#lane-dot)"}
                    />
                  )}
                  <text
                    x={hx}
                    y={hy}
                    transform={horizontal ? `rotate(-90 ${hx} ${hy})` : undefined}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={12}
                    fontWeight={600}
                    fill={c.text}
                    style={{ pointerEvents: "none" }}
                  >
                    {laneName(lane.id)}
                  </text>
                </g>
                {drag && dropIndex === i && (
                  <line
                    x1={lane.x}
                    y1={
                      horizontal
                        ? dropIndex >
                          layout.lanes.indexOf(layout.lanes.find((l) => l.id === drag.laneId)!)
                          ? lane.y + lane.height
                          : lane.y
                        : lane.y
                    }
                    x2={horizontal ? lane.x + lane.width : lane.x}
                    y2={
                      horizontal
                        ? dropIndex >
                          layout.lanes.indexOf(layout.lanes.find((l) => l.id === drag.laneId)!)
                          ? lane.y + lane.height
                          : lane.y
                        : lane.y + lane.height
                    }
                    stroke="var(--color-accent)"
                    strokeWidth={3}
                  />
                )}
              </g>
            );
          })}
          {layout?.edges.map((route) => {
            const e = edgeById.get(route.id);
            if (!e) return null;
            const selected =
              !!selectedStepId &&
              (e.sourceStepId === selectedStepId || e.targetStepId === selectedStepId);
            return (
              <MapEdge key={route.id} edge={e} route={route} selected={selected} mode={mode} />
            );
          })}
          {layout?.nodes.map((n) => {
            const ln = nodeKind.get(n.id);
            if (!ln) return null;
            const step = stepById.get(ln.stepId);
            const ownerColour = laneColour(ln.laneId);
            const colours: NodeColours = {
              owner: ownerColour,
              contributors: (step?.contributorIds ?? [])
                .map((id) => partyById.get(id))
                .filter((p): p is Party => !!p)
                .map((p) => ({
                  id: p.id,
                  name: p.name,
                  colour: resolveColour(p.colourIndex, theme, p.colourOverride),
                })),
            };
            return (
              <MapNode
                key={n.id}
                node={n}
                kind={ln.kind}
                step={ln.kind === "fork" || ln.kind === "join" ? undefined : step}
                colours={colours}
                mode={mode}
                selected={!!step && step.id === selectedStepId}
                flags={step ? flags.get(step.id) : undefined}
                onSelect={(id) => {
                  selectionFromMap.current = true;
                  onSelect(id);
                }}
              />
            );
          })}
        </g>
      </svg>
      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-[var(--text-muted)]">
          Add steps in the table to see the map.
        </div>
      )}
      <div className="absolute right-3 bottom-3 flex items-center gap-1">
        {updating && <span className="mr-1 text-[11px] text-[var(--text-muted)]">updating…</span>}
        <button className="btn btn-icon" aria-label="Zoom out" onClick={pz.zoomOut}>
          −
        </button>
        <button className="btn btn-icon" aria-label="Zoom in" onClick={pz.zoomIn}>
          +
        </button>
        <button
          className="btn"
          aria-label="Fit to view"
          onClick={() => layout && fit(layout.width, layout.height)}
        >
          Fit
        </button>
      </div>
    </div>
  );
}
