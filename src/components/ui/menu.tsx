import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Menu = DropdownPrimitive.Root;
export const MenuTrigger = DropdownPrimitive.Trigger;

export function MenuContent({
  children,
  className,
  align = "end",
  width = "w-48",
}: {
  children: ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
  width?: string;
}) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={5}
        className={cn(
          "z-[70] overflow-hidden rounded-xl border border-border-strong bg-surface-2-opaque p-1 shadow-pop",
          "data-[state=open]:animate-scale-in",
          width,
          className,
        )}
      >
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}

export function MenuItem({
  icon: Icon,
  label,
  onSelect,
  danger = false,
  disabled = false,
  shortcut,
}: {
  icon?: LucideIcon;
  label: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
}) {
  return (
    <DropdownPrimitive.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex h-8 cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 text-xs outline-none",
        "data-[highlighted]:bg-surface-3 data-[disabled]:opacity-40",
        danger ? "text-danger data-[highlighted]:bg-danger/10" : "text-text-secondary data-[highlighted]:text-text",
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      <span className="flex-1 truncate">{label}</span>
      {shortcut && (
        <span className="tnum text-2xs text-text-disabled">{shortcut}</span>
      )}
    </DropdownPrimitive.Item>
  );
}

export function MenuSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-border" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownPrimitive.Label className="px-2.5 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wide text-text-disabled">
      {children}
    </DropdownPrimitive.Label>
  );
}
