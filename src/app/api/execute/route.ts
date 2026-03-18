import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  scheduleItems,
  schedules,
  plans,
  projects,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { execSync } from "child_process";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { getConfiguredModel } from "@/lib/ai/config";
import { scanAllSkills, getSkillContent } from "@/lib/skills/registry";
import { parseJsonBody } from "@/lib/utils";
import fs from "fs";
import path from "path";

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
    writeFile: tool({
      description: "Write content to a file within the project (creates or overwrites)",
      inputSchema: z.object({
        relativePath: z.string().describe("Relative path to the file from project root"),
        content: z.string().describe("File content to write"),
      }),
      execute: async ({ relativePath, content }) => {
        const targetPath = path.resolve(repoPath, relativePath);
        if (!targetPath.startsWith(repoPath)) return "Access denied: path outside project";
        try {
          const dir = path.dirname(targetPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(targetPath, content, "utf-8");
          return `Written ${content.length} bytes to ${relativePath}`;
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : e}`;
        }
      },
    }),
    editFile: tool({
      description: "Replace a specific string in a file (for surgical edits)",
      inputSchema: z.object({
        relativePath: z.string().describe("Relative path to the file from project root"),
        oldString: z.string().describe("The exact string to find and replace"),
        newString: z.string().describe("The replacement string"),
      }),
      execute: async ({ relativePath, oldString, newString }) => {
        const targetPath = path.resolve(repoPath, relativePath);
        if (!targetPath.startsWith(repoPath)) return "Access denied: path outside project";
        try {
          const content = fs.readFileSync(targetPath, "utf-8");
          if (!content.includes(oldString)) return `Error: old string not found in ${relativePath}`;
          const updated = content.replace(oldString, newString);
          fs.writeFileSync(targetPath, updated, "utf-8");
          return `Edited ${relativePath} successfully`;
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : e}`;
        }
      },
    }),
    bash: tool({
      description: "Run a shell command within the project directory (build, test, grep, etc.)",
      inputSchema: z.object({
        command: z.string().describe("Shell command to execute"),
      }),
      execute: async ({ command }) => {
        try {
          const output = execSync(command, {
            cwd: repoPath,
            encoding: "utf-8",
            timeout: 60000,
            maxBuffer: 1024 * 512,
          });
          return output.slice(0, 8000) || "(no output)";
        } catch (e: unknown) {
          const err = e as { stdout?: string; stderr?: string; message?: string };
          const out = (err.stdout || "") + (err.stderr || "");
          return out.slice(0, 8000) || `Error: ${err.message || e}`;
        }
      },
    }),
  };
}

export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;
  const { itemId, skills: requestSkills } = body as { itemId: string; skills?: string[] };

  if (!itemId) {
    return NextResponse.json({ error: "itemId is required" }, { status: 400 });
  }

  const db = getDb();
  const item = db.select().from(scheduleItems).where(eq(scheduleItems.id, itemId)).get();
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  const schedule = db.select().from(schedules).where(eq(schedules.id, item.scheduleId)).get();
  if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  const plan = db.select().from(plans).where(eq(plans.id, schedule.planId)).get();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const project = db.select().from(projects).where(eq(projects.id, plan.projectId)).get();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Skills
  const itemSkills: string[] = JSON.parse(item.skills || "[]");
  const allSkillNames = [...new Set([...itemSkills, ...(requestSkills || [])])];
  let skillsContent = "";
  if (allSkillNames.length > 0) {
    const allSkills = scanAllSkills();
    skillsContent = getSkillContent(allSkills, allSkillNames);
  }

  // Update status
  db.update(scheduleItems)
    .set({ status: "in_progress", progress: 0 })
    .where(eq(scheduleItems.id, itemId))
    .run();

  if (plan.status === "scheduled") {
    db.update(plans)
      .set({ status: "executing", updatedAt: new Date().toISOString() })
      .where(eq(plans.id, plan.id))
      .run();
  }

  // Previous tasks context
  const allItems = db.select().from(scheduleItems)
    .where(eq(scheduleItems.scheduleId, item.scheduleId))
    .all()
    .sort((a, b) => a.order - b.order);

  let previousContext = "";
  for (const prev of allItems) {
    if (prev.id === item.id) break;
    if (prev.status === "completed" && prev.executionLog) {
      previousContext += `\nCompleted Task #${prev.order} "${prev.title}":\n${prev.executionLog.slice(0, 3000)}\n`;
    }
  }

  const prompt = `${previousContext ? `Previously completed tasks:\n${previousContext}\n---\n` : ""}

Implement task #${item.order}: ${item.title}

${item.description || ""}

${skillsContent ? `Skills context:\n${skillsContent}` : ""}

Use the provided tools to read the codebase, write/edit files, and run commands. Implement the changes and verify they work.`;

  const cwd = fs.existsSync(project.targetRepoPath) ? project.targetRepoPath : process.cwd();
  const configuredModel = getConfiguredModel();
  const tools = createProjectTools(cwd);

  const encoder = new TextEncoder();
  let fullLog = "";

  const responseStream = new ReadableStream({
    async start(controller) {
      try {
        const result = streamText({
          model: configuredModel,
          prompt,
          tools,
          stopWhen: stepCountIs(15),
        });

        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            fullLog += part.text;
            controller.enqueue(encoder.encode(part.text));
          } else if (part.type === "tool-call") {
            const msg = `\n> **Tool: ${part.toolName}**\n`;
            fullLog += msg;
            controller.enqueue(encoder.encode(msg));
          }
        }

        // Save log and mark completed
        db.update(scheduleItems)
          .set({
            status: "completed",
            progress: 100,
            executionLog: fullLog || "No output",
          })
          .where(eq(scheduleItems.id, itemId))
          .run();

        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fullLog += `\nError: ${msg}`;
        controller.enqueue(encoder.encode(`\nError: ${msg}`));

        db.update(scheduleItems)
          .set({
            status: "failed",
            progress: 0,
            executionLog: fullLog || "Error",
          })
          .where(eq(scheduleItems.id, itemId))
          .run();

        controller.close();
      }
    },
  });

  return new Response(responseStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
