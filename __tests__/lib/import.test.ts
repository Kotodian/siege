import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// Test the markdown parsing logic directly
function parseMarkdown(
  content: string,
  fileName: string
): {
  name: string;
  description: string;
  schemes: Array<{ title: string; content: string }>;
} {
  const lines = content.split("\n");
  const planName = path.basename(fileName, ".md");
  const parsedSchemes: Array<{ title: string; content: string }> = [];
  let description = "";
  let currentScheme: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)/);
    if (h2Match) {
      if (currentScheme) {
        parsedSchemes.push({
          title: currentScheme.title,
          content: currentScheme.lines.join("\n").trim(),
        });
      }
      currentScheme = { title: h2Match[1], lines: [] };
    } else if (currentScheme) {
      currentScheme.lines.push(line);
    } else {
      description += line + "\n";
    }
  }
  if (currentScheme) {
    parsedSchemes.push({
      title: currentScheme.title,
      content: currentScheme.lines.join("\n").trim(),
    });
  }

  return { name: planName, description: description.trim(), schemes: parsedSchemes };
}

describe("Markdown Import Parser", () => {
  it("should parse file name as plan name", () => {
    const result = parseMarkdown("Hello", "my-plan.md");
    expect(result.name).toBe("my-plan");
  });

  it("should parse content before first ## as description", () => {
    const md = `# Top Level
Some description here

## First Section
Section content`;

    const result = parseMarkdown(md, "test.md");
    expect(result.description).toContain("Some description here");
  });

  it("should parse ## headings as schemes", () => {
    const md = `Overview

## API Design
Design the REST API

## Database Schema
Create the schema

## Testing
Write tests`;

    const result = parseMarkdown(md, "test.md");
    expect(result.schemes).toHaveLength(3);
    expect(result.schemes[0].title).toBe("API Design");
    expect(result.schemes[1].title).toBe("Database Schema");
    expect(result.schemes[2].title).toBe("Testing");
  });

  it("should preserve scheme content with code blocks", () => {
    const md = `## Code Example

\`\`\`typescript
const x = 1;
\`\`\`

Some more text`;

    const result = parseMarkdown(md, "test.md");
    expect(result.schemes[0].content).toContain("```typescript");
    expect(result.schemes[0].content).toContain("const x = 1;");
  });

  it("should handle empty file", () => {
    const result = parseMarkdown("", "empty.md");
    expect(result.name).toBe("empty");
    expect(result.schemes).toHaveLength(0);
  });

  it("should handle file with only description, no schemes", () => {
    const result = parseMarkdown("Just some text\nNo sections", "test.md");
    expect(result.description).toBe("Just some text\nNo sections");
    expect(result.schemes).toHaveLength(0);
  });
});
