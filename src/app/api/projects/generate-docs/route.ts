import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { getStepModel } from "@/lib/ai/config";
import { streamText } from "ai";
import fs from "fs";
import path from "path";

function gatherProjectInfo(repoPath: string): string {
  let info = "";

  // File tree
  try {
    const tree = execSync(
      `find . -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/vendor/*' -not -path '*/__pycache__/*' -not -name '.*' | sort | head -80`,
      { cwd: repoPath, encoding: "utf-8", timeout: 5000 }
    );
    info += `## File Structure\n\`\`\`\n${tree}\`\`\`\n\n`;
  } catch {}

  // Config files
  for (const f of ["package.json", "go.mod", "Cargo.toml", "pyproject.toml", "pom.xml", "Makefile", "Dockerfile"]) {
    const fp = path.join(repoPath, f);
    if (fs.existsSync(fp)) {
      try {
        info += `## ${f}\n\`\`\`\n${fs.readFileSync(fp, "utf-8").slice(0, 2000)}\n\`\`\`\n\n`;
      } catch {}
    }
  }

  // README
  for (const f of ["README.md", "readme.md"]) {
    const fp = path.join(repoPath, f);
    if (fs.existsSync(fp)) {
      try {
        info += `## README\n${fs.readFileSync(fp, "utf-8").slice(0, 3000)}\n\n`;
      } catch {}
      break;
    }
  }

  // Existing CLAUDE.md
  const claudeMd = path.join(repoPath, "CLAUDE.md");
  if (fs.existsSync(claudeMd)) {
    try {
      info += `## Existing CLAUDE.md\n${fs.readFileSync(claudeMd, "utf-8").slice(0, 3000)}\n\n`;
    } catch {}
  }

  return info;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { repoPath, type } = body as { repoPath: string; type: "claude" | "agents" };

  if (!repoPath || !type) {
    return NextResponse.json({ error: "repoPath and type required" }, { status: 400 });
  }

  if (!fs.existsSync(repoPath)) {
    return NextResponse.json({ error: "Directory not found" }, { status: 404 });
  }

  const projectInfo = gatherProjectInfo(repoPath);
  let model;
  try {
    model = getStepModel("scheme");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  let prompt: string;
  if (type === "claude") {
    prompt = `<IMPORTANT>
You are being called as an API. Output ONLY the CLAUDE.md content in Markdown.
Do NOT use tools, read files, or ask questions. Work from the project info provided.
</IMPORTANT>

Generate a CLAUDE.md file for this project. CLAUDE.md tells AI assistants about the project.

Include these sections:
# Project Overview
Brief description of what this project does and its architecture.

# Tech Stack
Languages, frameworks, key dependencies.

# Project Structure
Important directories and their purpose.

# Development
How to build, test, and run. Key commands.

# Coding Conventions
Style, naming, patterns used in this codebase.

# Key Files
Most important files to understand the codebase.

---
Project info:
${projectInfo}

Output the CLAUDE.md content now:`;
  } else {
    prompt = `<IMPORTANT>
You are being called as an API. Output ONLY the AGENTS.md content in Markdown.
Do NOT use tools, read files, or ask questions.
</IMPORTANT>

Generate an AGENTS.md file for this project. AGENTS.md configures AI agent behavior.

Include:
# Agent Guidelines
- What the agent should know about this project
- Preferred approaches and patterns
- Things to avoid
- Testing requirements
- Review checklist

---
Project info:
${projectInfo}

Output the AGENTS.md content now:`;
  }

  const result = streamText({ model, prompt });
  const textStream = result.textStream;
  const encoder = new TextEncoder();
  let fullText = "";

  const responseStream = new ReadableStream({
    async start(controller) {
      for await (const chunk of textStream) {
        fullText += chunk;
        controller.enqueue(encoder.encode(chunk));
      }

      // Write file to repo
      const fileName = type === "claude" ? "CLAUDE.md" : "AGENTS.md";
      const filePath = path.join(repoPath, fileName);
      try {
        fs.writeFileSync(filePath, fullText.trim() + "\n");
        console.log(`[generate-docs] Wrote ${filePath}`);
      } catch (err) {
        console.error(`[generate-docs] Failed to write ${filePath}:`, err);
      }

      controller.close();
    },
  });

  return new Response(responseStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
