import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";

describe("MarkdownRenderer", () => {
  it("renders headings", () => {
    render(<MarkdownRenderer content="## Hello World" />);
    expect(
      screen.getByRole("heading", { level: 2 })
    ).toHaveTextContent("Hello World");
  });

  it("renders code blocks", () => {
    const content = "```typescript\nconst x = 1;\n```";
    const { container } = render(<MarkdownRenderer content={content} />);
    expect(container.querySelector("code")).toBeTruthy();
  });

  it("renders empty content without crashing", () => {
    const { container } = render(<MarkdownRenderer content="" />);
    expect(container).toBeTruthy();
  });

  it("renders GFM tables", () => {
    const content = "| A | B |\n|---|---|\n| 1 | 2 |";
    const { container } = render(<MarkdownRenderer content={content} />);
    expect(container.querySelector("table")).toBeTruthy();
  });

  it("renders inline code", () => {
    const { container } = render(
      <MarkdownRenderer content="Use `console.log` for debugging" />
    );
    expect(container.querySelector("code")).toBeTruthy();
  });
});
