import ELK from "elkjs/lib/elk.bundled.js";
import { layoutGraph } from "../graph/layout";
import type { LayoutGraph, LayoutResult, Orientation } from "../graph/layout-types";

export interface LayoutRequest {
  id: number;
  graph: LayoutGraph;
  orientation: Orientation;
}
export type LayoutResponse = { id: number; result: LayoutResult } | { id: number; error: string };

const elk = new ELK();

self.onmessage = async (e: MessageEvent<LayoutRequest>) => {
  const { id, graph, orientation } = e.data;
  try {
    const result = await layoutGraph(graph, orientation, elk);
    (self as unknown as Worker).postMessage({ id, result } satisfies LayoutResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    } satisfies LayoutResponse);
  }
};
