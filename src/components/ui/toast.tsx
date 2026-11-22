import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { create } from "zustand";
import { cn } from "@/lib/utils";

export type ToastTone = "info" | "success" | "warning" | "error";

type Toast = {
  id: number;
  tone: ToastTone;
  message: string;
};

type ToastState = {
  toasts: Toast[];
  push: (tone: ToastTone, message: string) => void;
  dismiss: (id: number) => void;
};

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (tone, message) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, tone, message }] }));
    window.setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  info: (message: string) => useToastStore.getState().push("info", message),
  success: (message: string) => useToastStore.getState().push("success", message),
  warning: (message: string) => useToastStore.getState().push("warning", message),
  error: (message: string) => useToastStore.getState().push("error", message),
};

const toneIcon: Record<ToastTone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

const toneColor: Record<ToastTone, string> = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  error: "text-danger",
};

export function Toaster() {
  const { toasts, dismiss } = useToastStore();
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[90] flex w-80 flex-col gap-2"
      role="region"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = toneIcon[t.tone];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className={cn(
                "pointer-events-auto flex items-start gap-2.5 rounded-xl border border-border-strong",
                "glass-strong px-3.5 py-3 shadow-pop",
              )}
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", toneColor[t.tone])} aria-hidden />
              <p className="flex-1 text-xs leading-relaxed text-text" data-selectable>
                {t.message}
              </p>
              <button
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
                onClick={() => dismiss(t.id)}
                aria-label="Close"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
