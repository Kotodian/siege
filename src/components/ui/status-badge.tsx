const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  reviewing: "bg-yellow-100 text-yellow-700",
  confirmed: "bg-blue-100 text-blue-700",
  scheduled: "bg-purple-100 text-purple-700",
  executing: "bg-orange-100 text-orange-700",
  code_review: "bg-indigo-100 text-indigo-700",
  testing: "bg-cyan-100 text-cyan-700",
  approved: "bg-green-100 text-green-700",
  changes_requested: "bg-red-100 text-red-700",
  critical: "bg-red-100 text-red-700",
  warning: "bg-yellow-100 text-yellow-700",
  info: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  pending: "bg-gray-100 text-gray-700",
  in_progress: "bg-orange-100 text-orange-700",
  passed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

interface StatusBadgeProps {
  status: string;
  label: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const color = statusColors[status] || "bg-gray-100 text-gray-700";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}
    >
      {label}
    </span>
  );
}
