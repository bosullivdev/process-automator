import { useEffect, useRef, useState } from "react";
import type { LayoutGraph, LayoutResult, Orientation } from "../graph/layout-types";
import type { LayoutRequest, LayoutResponse } from "../workers/layout.worker";

const DEBOUNCE_MS = 150;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: LayoutResponse) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../workers/layout.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent<LayoutResponse>) => {
      const cb = pending.get(e.data.id);
      pending.delete(e.data.id);
      cb?.(e.data);
    };
  }
  return worker;
}

export function requestLayout(graph: LayoutGraph, orientation: Orientation): Promise<LayoutResult> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, (r) => ("result" in r ? resolve(r.result) : reject(new Error(r.error))));
    const req: LayoutRequest = { id, graph, orientation };
    getWorker().postMessage(req);
  });
}

/** Debounced layout in a web worker. Keeps the last result while a new one is computed. */
export function useLayout(
  graph: LayoutGraph,
  orientation: Orientation,
): { layout: LayoutResult | null; updating: boolean; error: string | null } {
  const [layout, setLayout] = useState<LayoutResult | null>(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const myId = ++latest.current;
    const timer = setTimeout(() => {
      setUpdating(true);
      requestLayout(graph, orientation)
        .then((r) => {
          if (latest.current !== myId) return;
          setLayout(r);
          setError(null);
        })
        .catch((err: Error) => {
          if (latest.current !== myId) return;
          setError(err.message);
        })
        .finally(() => {
          if (latest.current === myId) setUpdating(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [graph, orientation]);

  return { layout, updating, error };
}
