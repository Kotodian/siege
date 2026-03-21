"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { ComponentPropsWithoutRef } from "react";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  headingIds?: boolean;
}

function textToId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

function childrenToText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(childrenToText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return childrenToText((children as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
}

function createHeadingComponent(Tag: "h1" | "h2" | "h3" | "h4") {
  return function HeadingWithId(props: ComponentPropsWithoutRef<typeof Tag>) {
    const text = childrenToText(props.children);
    const id = textToId(text);
    return <Tag {...props} id={id} />;
  };
}

export function MarkdownRenderer({
  content,
  className = "",
  headingIds = false,
}: MarkdownRendererProps) {
  return (
    <div
      className={`prose prose-sm max-w-none ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={
          headingIds
            ? {
                h1: createHeadingComponent("h1"),
                h2: createHeadingComponent("h2"),
                h3: createHeadingComponent("h3"),
                h4: createHeadingComponent("h4"),
              }
            : undefined
        }
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
