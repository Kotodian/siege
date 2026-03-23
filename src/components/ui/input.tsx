import { InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = "", style, ...props }, ref) => {
    return (
      <div className="space-y-1">
        {label && (
          <label className="block text-sm font-medium" style={{ color: "var(--on-surface)" }}>
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`w-full rounded-md border px-3 py-2 text-sm
            focus:outline-none focus:ring-1 focus:[border-color:var(--primary)] [--tw-ring-color:var(--focus-ring)]
            ${className}`}
          style={{
            background: "var(--surface-container)",
            color: "var(--on-surface)",
            borderColor: error ? "var(--error)" : "var(--ghost-border)",
            ...style,
          } as React.CSSProperties}
          {...props}
        />
        {error && <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
