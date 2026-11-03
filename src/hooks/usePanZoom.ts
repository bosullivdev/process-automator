import { useCallback, useRef, useState } from "react";

export interface Transform {
  x: number;
  y: number;
  k: number;
}

const MIN_K = 0.1;
const MAX_K = 4;

export function usePanZoom(containerRef: React.RefObject<HTMLElement | null>) {
  const [t, setT] = useState<Transform>({ x: 24, y: 24, k: 1 });
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(
    null,
  );

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setT((prev) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, prev.k * factor));
      const ratio = k / prev.k;
      return { k, x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio };
    });
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.01), cx, cy);
      } else {
        setT((prev) => ({ ...prev, x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
      }
    },
    [zoomAt],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      drag.current = { sx: e.clientX, sy: e.clientY, ox: t.x, oy: t.y, moved: false };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [t.x, t.y],
  );
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.moved) setT((prev) => ({ ...prev, x: d.ox + dx, y: d.oy + dy }));
  }, []);
  const onPointerUp = useCallback((): boolean => {
    const moved = drag.current?.moved ?? false;
    drag.current = null;
    return moved;
  }, []);

  /** Fit a content box into the container with padding. */
  const fit = useCallback(
    (w: number, h: number) => {
      const el = containerRef.current;
      if (!el || w === 0 || h === 0) return;
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const k = Math.min(MAX_K, Math.max(MIN_K, Math.min((cw - 48) / w, (ch - 48) / h, 1.5)));
      setT({ k, x: (cw - w * k) / 2, y: (ch - h * k) / 2 });
    },
    [containerRef],
  );

  /** Pan so that a content-space rect is visible (centred if it is off screen). */
  const reveal = useCallback(
    (x: number, y: number, w: number, h: number) => {
      const el = containerRef.current;
      if (!el) return;
      setT((prev) => {
        const sx = x * prev.k + prev.x;
        const sy = y * prev.k + prev.y;
        const sw = w * prev.k;
        const sh = h * prev.k;
        const inside =
          sx >= 0 && sy >= 0 && sx + sw <= el.clientWidth && sy + sh <= el.clientHeight;
        if (inside) return prev;
        return {
          ...prev,
          x: el.clientWidth / 2 - (x + w / 2) * prev.k,
          y: el.clientHeight / 2 - (y + h / 2) * prev.k,
        };
      });
    },
    [containerRef],
  );

  const zoomIn = useCallback(() => {
    const el = containerRef.current;
    zoomAt(1.25, (el?.clientWidth ?? 0) / 2, (el?.clientHeight ?? 0) / 2);
  }, [containerRef, zoomAt]);
  const zoomOut = useCallback(() => {
    const el = containerRef.current;
    zoomAt(0.8, (el?.clientWidth ?? 0) / 2, (el?.clientHeight ?? 0) / 2);
  }, [containerRef, zoomAt]);

  return { t, onWheel, onPointerDown, onPointerMove, onPointerUp, fit, reveal, zoomIn, zoomOut };
}
