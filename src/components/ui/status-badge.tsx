const statusStyles: Record<string, React.CSSProperties> = {
  // Plan statuses
  draft: { background: "rgba(144,143,160,0.15)", color: "var(--outline)" },
  pending: { background: "rgba(144,143,160,0.15)", color: "var(--outline)" },
  reviewing: { background: "rgba(253,224,71,0.12)", color: "var(--warning)" },
  confirmed: { background: "rgba(192,193,255,0.12)", color: "var(--primary)" },
  scheduled: { background: "rgba(221,183,255,0.12)", color: "var(--secondary)" },
  executing: { background: "rgba(255,183,131,0.12)", color: "var(--tertiary)" },
  code_review: { background: "rgba(128,131,255,0.12)", color: "var(--primary-container)" },
  testing: { background: "rgba(192,193,255,0.15)", color: "var(--primary)" },
  approved: { background: "var(--success-container)", color: "var(--success)" },
  completed: { background: "var(--success-container)", color: "var(--success)" },
  passed: { background: "var(--success-container)", color: "var(--success)" },
  failed: { background: "var(--error-container)", color: "var(--error)" },
  changes_requested: { background: "var(--error-container)", color: "var(--error)" },
  critical: { background: "var(--error-container)", color: "var(--error)" },
  in_progress: { background: "rgba(255,183,131,0.12)", color: "var(--tertiary)" },
  running: { background: "rgba(255,183,131,0.12)", color: "var(--tertiary)" },
  // Severity / info
  warning: { background: "rgba(253,224,71,0.12)", color: "var(--warning)" },
  info: { background: "rgba(192,193,255,0.12)", color: "var(--primary)" },
  // Tags
  feature: { background: "rgba(192,193,255,0.12)", color: "var(--primary)" },
  bug: { background: "var(--error-container)", color: "var(--error)" },
  enhance: { background: "var(--success-container)", color: "var(--success)" },
  refactor: { background: "rgba(221,183,255,0.12)", color: "var(--secondary)" },
  docs: { background: "rgba(192,193,255,0.12)", color: "var(--primary)" },
  test: { background: "rgba(192,193,255,0.15)", color: "var(--primary)" },
  chore: { background: "rgba(144,143,160,0.15)", color: "var(--outline)" },
  perf: { background: "rgba(253,224,71,0.12)", color: "var(--warning)" },
};

const defaultStyle: React.CSSProperties = {
  background: "rgba(144,143,160,0.15)",
  color: "var(--outline)",
};

interface StatusBadgeProps {
  status: string;
  label: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const style = statusStyles[status] || defaultStyle;
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={style}
    >
      {label}
    </span>
  );
}
