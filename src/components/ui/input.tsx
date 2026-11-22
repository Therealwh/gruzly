import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        spellCheck={false}
        className={cn(
          "h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text",
          "placeholder:text-text-muted",
          "transition-colors duration-100",
          "hover:border-border-strong",
          "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
          "disabled:opacity-40",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        spellCheck={false}
        className={cn(
          "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-text",
          "placeholder:text-text-muted",
          "transition-colors duration-100",
          "hover:border-border-strong",
          "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
          "disabled:opacity-40",
          className,
        )}
        {...props}
      />
    );
  },
);

/** Icon rendered inside an Input's left edge. Pair with `pl-9` on Input. */
export function InputIcon({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
