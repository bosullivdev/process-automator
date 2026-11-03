import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  /** Elements that count as "inside" for outside-click detection. */
  extraInside?: Array<HTMLElement | null>;
}

export function Popover({ anchor, open, onClose, children, width, extraInside = [] }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number }>({
    top: 0,
    left: 0,
    maxHeight: 320,
  });

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const w = width ?? Math.max(r.width, 240);
      const below = vh - r.bottom - 8;
      const above = r.top - 8;
      const openUp = below < 200 && above > below;
      const maxHeight = Math.max(120, Math.min(360, openUp ? above : below));
      const left = Math.min(Math.max(8, r.left), vw - w - 8);
      setPos({ top: openUp ? r.top - 4 : r.bottom + 4, left, maxHeight });
      if (ref.current) {
        ref.current.style.transform = openUp ? "translateY(-100%)" : "";
        ref.current.style.width = `${w}px`;
      }
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchor?.contains(t)) return;
      if (extraInside.some((el) => el?.contains(t))) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose, anchor, extraInside]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className="menu fixed z-50 overflow-auto"
      style={{ top: pos.top, left: pos.left, maxHeight: pos.maxHeight }}
      role="dialog"
    >
      {children}
    </div>,
    document.body,
  );
}
