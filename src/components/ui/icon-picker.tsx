"use client";

import { useState } from "react";

const ICONS = [
  "📁", "📦", "🚀", "⚡", "🔧", "🎯", "💡", "🌐",
  "📱", "🖥️", "🤖", "🎮", "📊", "🔒", "🛠️", "📝",
  "🏗️", "🎨", "🧪", "📡", "💾", "🔥", "⭐", "🏠",
];

interface IconPickerProps {
  value: string;
  onChange: (icon: string) => void;
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-3xl hover:bg-gray-100 rounded-lg p-1 transition-colors"
      >
        {value}
      </button>
      {open && (
        <div className="absolute top-12 left-0 z-10 bg-white border rounded-lg shadow-lg p-2 grid grid-cols-8 gap-1">
          {ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              onClick={() => {
                onChange(icon);
                setOpen(false);
              }}
              className={`text-xl p-1.5 rounded hover:bg-gray-100 ${
                value === icon ? "bg-blue-100" : ""
              }`}
            >
              {icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
