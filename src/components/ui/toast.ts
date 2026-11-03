import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
  /** Set when dismissed by timeout or user; shown toasts drop out of the list. */
}

interface ToastState {
  toasts: Toast[];
  show: (t: Omit<Toast, "id">, ms?: number) => number;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  show: (t, ms = 6000) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), ms);
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export function toast(message: string, action?: Toast["action"]): void {
  useToasts.getState().show({ message, action });
}
