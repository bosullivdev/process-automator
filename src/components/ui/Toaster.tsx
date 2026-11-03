import { useToasts } from "./toast";

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto flex items-center gap-3 rounded-lg border px-3 py-2 text-sm shadow-lg"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <span>{t.message}</span>
          {t.action && (
            <button
              className="font-medium text-[var(--color-accent)] hover:underline"
              onClick={() => {
                t.action?.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            className="btn btn-ghost btn-icon h-6 w-6"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
