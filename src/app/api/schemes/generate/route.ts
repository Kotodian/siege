import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { plans, projects, schemes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { execSync } from "child_process";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { getConfiguredModel } from "@/lib/ai/config";
import type { Provider } from "@/lib/ai/provider";
import { parseJsonBody } from "@/lib/utils";
import fs from "fs";
import path from "path";

function saveScheme(planId: string, content: string, planStatus: string) {
  const db = getDb();
  db.insert(schemes).values({
    id: crypto.randomUUID(), planId,
    title: "Generated Scheme", content, sourceType: "local_analysis",
  }).run();

  if (planStatus === "draft") {
    db.update(plans)
      .set({ status: "reviewing", updatedAt: new Date().toISOString() })
      .where(eq(plans.id, planId)).run();
  }
}

function buildPrompt(project: { name: string; targetRepoPath: string }, plan: { name: string; description: string | null }) {
  return `You are a senior software architect. Generate a detailed technical scheme for this plan.

Project: ${project.name}
Repository: ${project.targetRepoPath}
Plan: ${plan.name}

Description:
${plan.description || "No description provided."}

Steps:
1. Use the provided tools to explore the project structure (listDir, readFile, bash)
2. Read relevant source files to understand the codebase
3. Generate a Markdown technical scheme with:
   ## Overview
   ## Technical Details (reference specific file paths, describe what needs to change and why, but DO NOT include code blocks or code snippets — code changes belong in the scheduling/implementation phase)
   ## Key Decisions
   ## Risks & Mitigations
   ## Estimated Effort

IMPORTANT: The scheme is a design document, not an implementation. Describe architecture, approaches, and file-level changes in prose. Do NOT write code blocks, code examples, or implementation snippets. Code will be written during the scheduling and execution phase.

Write in the same language as the description.`;
}

function createProjectTools(repoPath: string) {
  return {
    listDir: tool({
      description: "List files and directories at a given path within the project",
      inputSchema: z.object({
        relativePath: z.string().describe("Relative path from project root, use '.' for root"),
      }),
      execute: async ({ relativePath }) => {
        const targetPath = path.resolve(repoPath, relativePath);
        if (!targetPath.startsWith(repoPath)) return "Access denied: path outside project";
        try {
          const entries = fs.readdirSync(targetPath, { withFileTypes: true });
          return entries.map(e => `${e.isDirectory() ? "[dir]" : "[file]"} ${e.name}`).join("\n");
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : e}`;
        }
      },
    }),
    readFile: tool({
      description: "Read the contents of a file within the project (max 500 lines)",
      inputSchema: z.object({
        relativePath: z.string().describe("Relative path to the file from project root"),
      }),
      execute: async ({ relativePath }) => {
        const targetPath = path.resolve(repoPath, relativePath);
        if (!targetPath.startsWith(repoPath)) return "Access denied: path outside project";
        try {
          const content = fs.readFileSync(targetPath, "utf-8");
          const lines = content.split("\n");
          if (lines.length > 500) {
            return lines.slice(0, 500).join("\n") + `\n\n... (truncated, ${lines.length} total lines)`;
          }
          return content;
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : e}`;
        }
      },
    }),
    bash: tool({
      description: "Run a shell command within the project directory (for find, grep, wc, etc.)",
      inputSchema: z.object({
        command: z.string().describe("Shell command to execute"),
      }),
      execute: async ({ command }) => {
        try {
          const output = execSync(command, {
            cwd: repoPath,
            encoding: "utf-8",
            timeout: 10000,
            maxBuffer: 1024 * 256,
          });
          return output.slice(0, 5000) || "(no output)";
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : e}`;
        }
      },
    }),
    webSearch: tool({
      description: "Search the web for technical information, libraries, best practices, etc.",
      inputSchema: z.object({
        query: z.string().describe("Search query"),
      }),
      execute: async ({ query }) => {
        try {
          const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; Siege/1.0)" },
          });
          const html = await res.text();
          const results: string[] = [];
          const resultBlocks = html.match(/<div class="result results_links[\s\S]*?<\/div>\s*<\/div>/g) || [];
          for (const block of resultBlocks.slice(0, 5)) {
            const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)<\/a>/);
            const urlMatch = block.match(/uddg=([^&"]+)/);
            const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/[a-z]/);
            const title = titleMatch?.[1]?.trim() || "";
            const link = urlMatch ? decodeURIComponent(urlMatch[1]) : "";
            const snippet = snippetMatch?.[1]?.replace(/<[^>]+>/g, "").trim() || "";
            if (title) results.push(`**${title}**\n${link}\n${snippet}`);
          }
          return results.length > 0 ? results.join("\n\n") : "No results found";
        } catch (e) {
          return `Search error: ${e instanceof Error ? e.message : e}`;
        }
      },
    }),
  };
}

export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;
  const { planId, provider, model } = body as { planId: string; provider?: Provider; model?: string };

  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 });

  const db = getDb();
  const plan = db.select().from(plans).where(eq(plans.id, planId)).get();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const project = db.select().from(projects).where(eq(projects.id, plan.projectId)).get();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const cwd = fs.existsSync(project.targetRepoPath) ? project.targetRepoPath : process.cwd();
  const prompt = buildPrompt(project, plan);
  const configuredModel = getConfiguredModel(provider, model);
  const tools = createProjectTools(cwd);

  const encoder = new TextEncoder();
  let fullText = "";

  const responseStream = new ReadableStream({
    async start(controller) {
      try {
        const result = streamText({
          model: configuredModel,
          prompt,
          tools,
          stopWhen: stepCountIs(10),
        });

        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            fullText += part.text;
            controller.enqueue(encoder.encode(part.text));
          } else if (part.type === "tool-call") {
            const msg = `\n> **Tool: ${part.toolName}**\n`;
            controller.enqueue(encoder.encode(msg));
          }
        }

        if (fullText.trim()) {
          saveScheme(planId, fullText.trim(), plan.status);
        }
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`\nError: ${msg}`));
        controller.close();
      }
    },
  });

  return new Response(responseStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
