"use client";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  height?: number;
  placeholder?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  height = 200,
  placeholder,
}: MarkdownEditorProps) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono
        focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
        resize-y"
      style={{ minHeight: height }}
    />
  );
}
