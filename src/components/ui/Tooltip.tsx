import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Hover/focus tooltip. Wraps children in an inline-flex span. */
export function Tooltip({ content, children, className }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const show = (e: React.SyntheticEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ x: r.left + r.width / 2, y: r.bottom + 6 });
  };
  const hide = () => setPos(null);
  if (!content) return <>{children}</>;
  return (
    <span
      className={className ?? "inline-flex"}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[60] max-w-xs rounded-lg px-2 py-1 text-xs shadow-lg"
            style={{
              left: pos.x,
              top: pos.y,
              transform: "translateX(-50%)",
              background: "var(--text)",
              color: "var(--bg)",
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
