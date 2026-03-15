import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { generateTextAuto } from "@/lib/ai/generate";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { repoPath } = body;

  if (!repoPath) {
    return NextResponse.json(
      { error: "repoPath is required" },
      { status: 400 }
    );
  }

  if (!fs.existsSync(repoPath)) {
    return NextResponse.json(
      { error: "Directory not found" },
      { status: 404 }
    );
  }

  // Check if directory has content
  const entries = fs.readdirSync(repoPath);
  const meaningfulFiles = entries.filter(
    (e) => !e.startsWith(".") && e !== "node_modules"
  );
  if (meaningfulFiles.length === 0) {
    return NextResponse.json({ empty: true, description: "", hasAgentDocs: false });
  }

  // Check for CLAUDE.md or AGENTS.md — if present, use as description directly
  for (const agentDoc of ["CLAUDE.md", "AGENTS.md", "claude.md", "agents.md"]) {
    const docPath = path.join(repoPath, agentDoc);
    if (fs.existsSync(docPath)) {
      try {
        const content = fs.readFileSync(docPath, "utf-8").slice(0, 5000);
        return NextResponse.json({
          empty: false,
          description: content,
          hasAgentDocs: true,
          source: agentDoc,
        });
      } catch {
        // fall through
      }
    }
  }

  // Gather project info
  let projectInfo = "";

  // File tree (depth 2)
  try {
    const tree = execSync(
      `find . -maxdepth 2 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -name '.*' | head -60`,
      { cwd: repoPath, encoding: "utf-8", timeout: 5000 }
    );
    projectInfo += `## File Structure\n\`\`\`\n${tree}\`\`\`\n\n`;
  } catch {
    // ignore
  }

  // Package.json or similar
  for (const configFile of [
    "package.json",
    "go.mod",
    "Cargo.toml",
    "pyproject.toml",
    "requirements.txt",
    "pom.xml",
  ]) {
    const filePath = path.join(repoPath, configFile);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8").slice(0, 2000);
        projectInfo += `## ${configFile}\n\`\`\`\n${content}\n\`\`\`\n\n`;
      } catch {
        // ignore
      }
      break;
    }
  }

  // README
  for (const readme of ["README.md", "readme.md", "README"]) {
    const filePath = path.join(repoPath, readme);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8").slice(0, 3000);
        projectInfo += `## README\n${content}\n\n`;
      } catch {
        // ignore
      }
      break;
    }
  }

  if (!projectInfo) {
    return NextResponse.json({ empty: false, description: "", hasAgentDocs: false });
  }

  // Use AI to summarize
  try {
    const description = await generateTextAuto({
      system: `You are a senior developer analyzing a project. Write a concise project description in Markdown (3-5 sentences) covering:
- What the project does
- Main tech stack
- Key components/features

Be factual and specific. Output ONLY the description, no headings or preamble.`,
      prompt: projectInfo,
    });

    return NextResponse.json({
      empty: false,
      description,
      hasAgentDocs: false,
    });
  } catch (err) {
    return NextResponse.json({
      empty: false,
      description: "",
      hasAgentDocs: false,
      error: `AI analysis failed: ${err instanceof Error ? err.message : err}`,
    });
  }
}
