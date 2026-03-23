import { ButtonHTMLAttributes, forwardRef } from "react";

const variants = {
  primary: "hover:opacity-90",
  secondary: "border hover:opacity-80",
  danger: "hover:opacity-90",
  ghost: "hover:opacity-80",
} as const;

const sizes = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = "primary", size = "md", className = "", children, style, ...props },
    ref
  ) => {
    const variantStyle: React.CSSProperties | undefined =
      variant === "primary"
        ? { background: "var(--primary)", color: "var(--background)", ...style }
        : variant === "secondary"
          ? { background: "var(--surface-container-high)", color: "var(--on-surface)", borderColor: "var(--ghost-border)", ...style }
          : variant === "danger"
            ? { background: "var(--error)", color: "var(--on-error)", ...style }
            : variant === "ghost"
              ? { color: "var(--on-surface-variant)", ...style }
              : style;

    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center rounded-md font-medium transition-colors
          disabled:opacity-50 disabled:pointer-events-none
          ${variants[variant]} ${sizes[size]} ${className}`}
        style={variantStyle}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
