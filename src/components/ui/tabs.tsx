import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Underlined tab bar (page-level navigation). */
export function Tabs({
  value,
  onValueChange,
  items,
  className,
}: {
  value: string;
  onValueChange: (v: string) => void;
  items: { value: string; label: ReactNode; count?: number }[];
  className?: string;
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange} className={className}>
      <TabsPrimitive.List className="flex items-center gap-1 border-b border-border">
        {items.map((item) => (
          <TabsPrimitive.Trigger
            key={item.value}
            value={item.value}
            className={cn(
              "relative -mb-px flex h-9 items-center gap-1.5 rounded-t-md px-3 text-xs font-medium",
              "text-text-muted transition-colors hover:text-text-secondary",
              "data-[state=active]:text-text",
            )}
          >
            {item.label}
            {typeof item.count === "number" && (
              <span className="tnum rounded bg-surface-3 px-1.5 py-0.5 text-2xs text-text-muted">
                {item.count}
              </span>
            )}
            <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-transparent data-[state=active]:bg-accent" />
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150",
        "border-border bg-surface-3",
        "data-[state=checked]:border-transparent data-[state=checked]:bg-accent",
        "disabled:opacity-40",
      )}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "block h-3.5 w-3.5 translate-x-[3px] rounded-full bg-text-secondary shadow-sm transition-transform duration-150",
          "data-[state=checked]:translate-x-[19px] data-[state=checked]:bg-white",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

/** Horizontal segmented picker (theme, density, quality presets). */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  size = "md",
  className,
  ariaLabel,
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            onClick={() => onValueChange(opt.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-md font-medium transition-all duration-100",
              size === "sm" ? "h-6 px-2 text-2xs" : "h-7 px-2.5 text-xs",
              active
                ? "bg-surface-3 text-text shadow-panel"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
