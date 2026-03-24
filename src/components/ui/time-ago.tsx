"use client";

import { useState, useEffect } from "react";

interface TimeAgoProps {
  date: string;
  locale?: string;
}

function formatTimeAgo(date: string, isZh: boolean): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return isZh ? "刚刚" : "just now";
  if (diffMin < 60) return isZh ? `${diffMin} 分钟前` : `${diffMin}m ago`;
  if (diffHr < 24) return isZh ? `${diffHr} 小时前` : `${diffHr}h ago`;
  if (diffDay < 30) return isZh ? `${diffDay} 天前` : `${diffDay}d ago`;
  return date.slice(0, 10);
}

export function TimeAgo({ date, locale = "en" }: TimeAgoProps) {
  const isZh = locale === "zh";
  // Use ISO date substring as initial value to avoid SSR/client locale mismatch
  const [text, setText] = useState(() => date?.slice(0, 10) || "");

  useEffect(() => {
    setText(formatTimeAgo(date, isZh));
    const interval = setInterval(() => {
      setText(formatTimeAgo(date, isZh));
    }, 60000);
    return () => clearInterval(interval);
  }, [date, isZh]);

  return <span className="text-xs text-[var(--on-surface-variant)]">{text}</span>;
}
