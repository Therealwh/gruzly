import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "gradient";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-text-on-accent hover:bg-accent-hover active:brightness-95 shadow-glow-accent",
  gradient:
    "accent-gradient text-text-on-accent hover:brightness-110 active:brightness-95 shadow-glow-accent",
  secondary:
    "glass border border-border text-text hover:border-border-strong hover:bg-surface-2 active:brightness-95",
  ghost: "text-text-secondary hover:text-text hover:bg-surface-2",
  danger:
    "bg-danger/90 text-white hover:bg-danger active:brightness-95",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-2xs gap-1.5 rounded-md",
  md: "h-9 px-3.5 text-xs gap-2 rounded-lg",
  lg: "h-10 px-5 text-[13px] gap-2 rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex select-none items-center justify-center font-medium transition-colors duration-100",
        "disabled:pointer-events-none disabled:opacity-40",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
});
