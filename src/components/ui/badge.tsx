import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-surface-3 text-text-secondary border-border",
  accent: "bg-accent/10 text-accent-text border-accent/20",
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  danger: "bg-danger/10 text-danger border-danger/20",
  info: "bg-info/10 text-info border-info/20",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs font-medium leading-4",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Colored status dot used in lists and engine rows. */
export function StatusDot({ tone = "neutral", pulse = false }: { tone?: BadgeTone; pulse?: boolean }) {
  const color: Record<BadgeTone, string> = {
    neutral: "bg-text-muted",
    accent: "bg-accent",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    info: "bg-info",
  };
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {pulse && <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-40", color[tone])} />}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", color[tone])} />
    </span>
  );
}
