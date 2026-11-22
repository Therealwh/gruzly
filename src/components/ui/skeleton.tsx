import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

/** Analysis-loading card skeleton (video preview). */
export function PreviewSkeleton() {
  return (
    <div className="flex gap-4" role="status" aria-live="polite">
      <Skeleton className="aspect-video w-64 shrink-0 rounded-xl" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 pt-1">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
        <div className="mt-3 flex gap-2">
          <Skeleton className="h-8 w-24 rounded-lg" />
          <Skeleton className="h-8 w-24 rounded-lg" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
        <span className="sr-only">Loading…</span>
      </div>
    </div>
  );
}
