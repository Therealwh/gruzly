import { cn } from "@/lib/utils";

/** Thin rounded progress bar with gradient fill. 0..1 or indeterminate. */
export function ProgressBar({
  value,
  indeterminate = false,
  className,
  tone = "accent",
}: {
  value?: number;
  indeterminate?: boolean;
  className?: string;
  tone?: "accent" | "success" | "danger";
}) {
  const pct = !indeterminate && typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(value, 0), 1) * 100
    : null;
  const fillTone =
    tone === "success" ? "bg-success" : tone === "danger" ? "bg-danger" : "accent-gradient";
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct === null ? undefined : Math.round(pct)}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
    >
      {indeterminate ? (
        <div
          className={cn("absolute h-full rounded-full", fillTone)}
          style={{ animation: "indeterminate 1.1s ease-in-out infinite" }}
        />
      ) : (
        <div
          className={cn("h-full rounded-full transition-[width] duration-300 ease-out", fillTone)}
          style={{ width: `${pct ?? 0}%` }}
        />
      )}
    </div>
  );
}

/** Circular progress ring for cards and the dashboard. */
export function ProgressRing({
  value,
  size = 36,
  strokeWidth = 3.5,
  className,
  children,
}: {
  value: number; // 0..1
  size?: number;
  strokeWidth?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  const clamped = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 1);
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-surface-3"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          className="stroke-accent transition-[stroke-dashoffset] duration-300 ease-out"
        />
      </svg>
      {children && <span className="absolute inset-0 flex items-center justify-center">{children}</span>}
    </div>
  );
}
