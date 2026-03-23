"use client";

import { useState, ReactNode } from "react";

interface Tab {
  id: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
}

export function Tabs({ tabs, defaultTab }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id);

  const active = tabs.find((t) => t.id === activeTab);

  return (
    <div>
      <div>
        <nav className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => !tab.disabled && setActiveTab(tab.id)}
              disabled={tab.disabled}
              className={`py-1.5 px-3 text-sm font-medium rounded-md transition-colors
                ${tab.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              style={activeTab === tab.id
                ? { background: "var(--surface-container-high)", color: "var(--primary)" }
                : { color: "var(--on-surface-variant)" }
              }
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="pt-4">{active?.content}</div>
    </div>
  );
}
