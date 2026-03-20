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
          <label className="block text-sm font-medium" style={{ color: "var(--foreground)" }}>
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`w-full rounded-md border px-3 py-2 text-sm
            focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
            ${error ? "border-red-500" : ""} ${className}`}
          style={{ background: "var(--card)", color: "var(--foreground)", borderColor: error ? undefined : "var(--card-border)", ...style }}
          {...props}
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
