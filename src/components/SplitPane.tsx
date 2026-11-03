import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  ratio: number;
  onRatioChange: (ratio: number) => void;
  left: ReactNode;
  right: ReactNode;
}

const MIN = 0.2;
const MAX = 0.8;

export function SplitPane({ ratio, onRatioChange, left, right }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const r = (e.clientX - rect.left) / rect.width;
      onRatioChange(Math.min(MAX, Math.max(MIN, r)));
    };
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, onRatioChange]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") onRatioChange(Math.max(MIN, ratio - 0.02));
    if (e.key === "ArrowRight") onRatioChange(Math.min(MAX, ratio + 0.02));
  };

  return (
    <div ref={containerRef} className="flex h-full min-h-0 w-full" style={{ cursor: dragging ? "col-resize" : undefined }}>
      <div className="min-w-0 min-h-0 overflow-hidden" style={{ width: `${ratio * 100}%` }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={20}
        aria-valuemax={80}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        className="group relative z-10 w-0 shrink-0 cursor-col-resize"
      >
        <div
          className="absolute top-0 bottom-0 -left-1 w-2"
          style={{ background: "transparent" }}
        />
        <div
          className="absolute top-1/2 -left-[5px] h-10 w-[10px] -translate-y-1/2 rounded-lg border transition-colors group-hover:border-[var(--color-accent)] group-focus-visible:border-[var(--color-accent)]"
          style={{
            background: "var(--surface)",
            borderColor: dragging ? "var(--color-accent)" : "var(--border-strong)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
          }}
        />
        <div className="absolute top-0 bottom-0 left-0 w-px" style={{ background: "var(--border)" }} />
      </div>
      <div className="min-w-0 min-h-0 flex-1 overflow-hidden">{right}</div>
    </div>
  );
}
