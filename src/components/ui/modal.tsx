import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = "md",
  hideClose = false,
  onInteractOutside,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  hideClose?: boolean;
  onInteractOutside?: (e: Event) => void;
}) {
  const sizes = {
    sm: "max-w-sm",
    md: "max-w-lg",
    lg: "max-w-3xl",
    xl: "max-w-5xl",
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          onInteractOutside={onInteractOutside}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2",
            "glass-strong rounded-2xl border border-border-strong shadow-pop",
            "data-[state=open]:animate-scale-in",
            "max-h-[calc(100vh-3rem)] overflow-y-auto",
            sizes[size],
          )}
        >
          {(title || (!hideClose)) && (
            <div className="flex items-start justify-between gap-4 px-5 pt-4">
              <div className="min-w-0">
                {title && (
                  <DialogPrimitive.Title className="text-sm font-semibold text-text">
                    {title}
                  </DialogPrimitive.Title>
                )}
                {description && (
                  <DialogPrimitive.Description className="mt-1 text-xs leading-relaxed text-text-secondary">
                    {description}
                  </DialogPrimitive.Description>
                )}
              </div>
              {!hideClose && (
                <DialogPrimitive.Close
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted",
                    "transition-colors hover:bg-surface-3 hover:text-text",
                  )}
                  aria-label={t("common.close")}
                >
                  <X className="h-4 w-4" />
                </DialogPrimitive.Close>
              )}
            </div>
          )}
          <div className="px-5 pb-5 pt-3">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Inline confirm dialog (delete/clear confirmation). */
export function ConfirmModal({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = true,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} size="sm">
      <p className="text-xs leading-relaxed text-text-secondary">{body}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          className="h-9 rounded-lg px-3.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text"
          onClick={() => onOpenChange(false)}
        >
          {cancelLabel}
        </button>
        <button
          className={cn(
            "h-9 rounded-lg px-3.5 text-xs font-medium text-white transition-colors active:brightness-95",
            danger ? "bg-danger hover:bg-danger" : "bg-accent hover:bg-accent-hover",
          )}
          onClick={() => {
            onConfirm();
            onOpenChange(false);
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
