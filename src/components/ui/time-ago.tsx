"use client";

interface TimeAgoProps {
  date: string;
  locale?: string;
}

export function TimeAgo({ date, locale = "en" }: TimeAgoProps) {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  const isZh = locale === "zh";

  let text: string;
  if (diffMin < 1) text = isZh ? "刚刚" : "just now";
  else if (diffMin < 60) text = isZh ? `${diffMin} 分钟前` : `${diffMin}m ago`;
  else if (diffHr < 24) text = isZh ? `${diffHr} 小时前` : `${diffHr}h ago`;
  else if (diffDay < 30) text = isZh ? `${diffDay} 天前` : `${diffDay}d ago`;
  else text = new Date(date).toLocaleDateString();

  return <span className="text-xs text-gray-400">{text}</span>;
}
