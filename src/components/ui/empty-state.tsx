import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function EmptyState({
  icon: Icon,
  title,
  hint,
  actionLabel,
  onAction,
  className,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-14 text-center",
        className,
      )}
    >
      <div className="relative">
        <div className="absolute -inset-4 rounded-full bg-accent/8 blur-xl" aria-hidden />
        <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-surface-2 shadow-panel">
          <Icon className="h-5 w-5 text-text-muted" strokeWidth={1.6} aria-hidden />
        </div>
      </div>
      <div>
        <p className="text-[13px] font-medium text-text">{title}</p>
        {hint && <p className="mt-1 max-w-sm text-xs leading-relaxed text-text-muted">{hint}</p>}
      </div>
      {actionLabel && onAction && (
        <Button variant="gradient" size="md" className="mt-1" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
