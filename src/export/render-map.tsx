import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { Party, Process, Team } from "../model/types";
import type { LayoutGraph, LayoutResult } from "../graph/layout-types";
import { flagsByStep, validateProcess } from "../model/validate";
import { MapView } from "../components/map/MapView";

export interface RenderMapInput {
  process: Process;
  parties: Party[];
  /** Teams the map tells apart; empty draws a plain process. */
  teams: Team[];
  graph: LayoutGraph;
  layout: LayoutResult;
  mode: "simple" | "bpmn";
  annotations: "full" | "minimal";
}

const noop = () => {};

/**
 * Draw a map that is not on screen and return its <svg>, for exporting a
 * process other than the one being looked at. The same component draws it, so
 * the picture matches what the map pane would show. It is mounted off-screen
 * and taken down again within this call, so nothing is ever painted.
 */
export function renderMapSvg(input: RenderMapInput): SVGSVGElement {
  const { process, parties, teams, graph, layout, mode, annotations } = input;
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1200px;height:800px;visibility:hidden;pointer-events:none";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    const flags = flagsByStep(validateProcess(process, { parties, teams }));
    flushSync(() =>
      root.render(
        <MapView
          process={process}
          parties={parties}
          teams={teams}
          focus={null}
          graph={graph}
          layout={layout}
          updating={false}
          mode={mode}
          annotations={annotations}
          selectedStepId={null}
          flags={flags}
          onSelect={noop}
          onReorderLanes={noop}
        />,
      ),
    );
    const svg = host.querySelector("svg");
    if (!svg) throw new Error("The map could not be drawn.");
    return svg.cloneNode(true) as SVGSVGElement;
  } finally {
    root.unmount();
    host.remove();
  }
}
