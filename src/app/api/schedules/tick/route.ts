import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { schedules, scheduleItems, plans, projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { execSync } from "child_process";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { getConfiguredModel } from "@/lib/ai/config";
import { scanAllSkills, getSkillContent } from "@/lib/skills/registry";
import fs from "fs";
import path from "path";

export async function POST() {
  const db = getDb();
  const now = new Date();

  // Find all schedules with auto-execute enabled
  const autoSchedules = db.select().from(schedules)
    .where(eq(schedules.autoExecute, true))
    .all();

  if (autoSchedules.length === 0) {
    return NextResponse.json({ executed: false, reason: "no auto-execute schedules" });
  }

  for (const schedule of autoSchedules) {
    // Check if any task is currently in_progress
    const running = db.select().from(scheduleItems)
      .where(and(
        eq(scheduleItems.scheduleId, schedule.id),
        eq(scheduleItems.status, "in_progress")
      ))
      .get();

    if (running) continue; // Already executing a task

    // Find next pending task whose startDate has arrived, ordered by `order`
    const items = db.select().from(scheduleItems)
      .where(and(
        eq(scheduleItems.scheduleId, schedule.id),
        eq(scheduleItems.status, "pending")
      ))
      .all()
      .sort((a, b) => a.order - b.order);

    const dueItem = items.find(item => new Date(item.startDate) <= now);
    if (!dueItem) continue;

    // Get plan and project
    const plan = db.select().from(plans).where(eq(plans.id, schedule.planId)).get();
    if (!plan) continue;

    const project = db.select().from(projects).where(eq(projects.id, plan.projectId)).get();
    if (!project) continue;

    // Mark as in_progress
    db.update(scheduleItems)
      .set({ status: "in_progress", progress: 0 })
      .where(eq(scheduleItems.id, dueItem.id))
      .run();

    if (plan.status === "scheduled") {
      db.update(plans)
        .set({ status: "executing", updatedAt: new Date().toISOString() })
        .where(eq(plans.id, plan.id))
        .run();
    }

    // Build context from previous completed tasks
    const allItems = db.select().from(scheduleItems)
      .where(eq(scheduleItems.scheduleId, schedule.id))
      .all()
      .sort((a, b) => a.order - b.order);

    let previousContext = "";
    for (const prev of allItems) {
      if (prev.id === dueItem.id) break;
      if (prev.status === "completed" && prev.executionLog) {
        previousContext += `\nCompleted Task #${prev.order} "${prev.title}":\n${prev.executionLog.slice(0, 3000)}\n`;
      }
    }

    // Skills
    const itemSkills: string[] = JSON.parse(dueItem.skills || "[]");
    let skillsContent = "";
    if (itemSkills.length > 0) {
      const allSkills = scanAllSkills();
      skillsContent = getSkillContent(allSkills, itemSkills);
    }

    const prompt = `${previousContext ? `Previously completed tasks:\n${previousContext}\n---\n` : ""}

Implement task #${dueItem.order}: ${dueItem.title}

${dueItem.description || ""}

${skillsContent ? `Skills context:\n${skillsContent}` : ""}

Use the provided tools to read the codebase, write/edit files, and run commands. Implement the changes and verify they work.`;

    const cwd = fs.existsSync(project.targetRepoPath) ? project.targetRepoPath : process.cwd();

    // Execute asynchronously (fire and forget — the tick will be called again later)
    executeTask(dueItem.id, cwd, prompt).catch(err => {
      console.error(`[auto-execute] Task ${dueItem.id} failed:`, err);
    });

    return NextResponse.json({
      executed: true,
      taskId: dueItem.id,
      taskTitle: dueItem.title
    });
  }

  return NextResponse.json({ executed: false, reason: "no due tasks" });
}

async function executeTask(itemId: string, cwd: string, prompt: string) {
  const configuredModel = getConfiguredModel();
  const tools = {
    listDir: tool({
      description: "List files and directories at a given path within the project",
      inputSchema: z.object({ relativePath: z.string() }),
      execute: async ({ relativePath }) => {
        const targetPath = path.resolve(cwd, relativePath);
        if (!targetPath.startsWith(cwd)) return "Access denied";
        try {
          const entries = fs.readdirSync(targetPath, { withFileTypes: true });
          return entries.map(e => `${e.isDirectory() ? "[dir]" : "[file]"} ${e.name}`).join("\n");
        } catch (e) { return `Error: ${e instanceof Error ? e.message : e}`; }
      },
    }),
    readFile: tool({
      description: "Read the contents of a file (max 500 lines)",
      inputSchema: z.object({ relativePath: z.string() }),
      execute: async ({ relativePath }) => {
        const targetPath = path.resolve(cwd, relativePath);
        if (!targetPath.startsWith(cwd)) return "Access denied";
        try {
          const content = fs.readFileSync(targetPath, "utf-8");
          const lines = content.split("\n");
          return lines.length > 500 ? lines.slice(0, 500).join("\n") + `\n... (${lines.length} lines)` : content;
        } catch (e) { return `Error: ${e instanceof Error ? e.message : e}`; }
      },
    }),
    writeFile: tool({
      description: "Write content to a file",
      inputSchema: z.object({ relativePath: z.string(), content: z.string() }),
      execute: async ({ relativePath, content }) => {
        const targetPath = path.resolve(cwd, relativePath);
        if (!targetPath.startsWith(cwd)) return "Access denied";
        try {
          const dir = path.dirname(targetPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(targetPath, content, "utf-8");
          return `Written ${content.length} bytes to ${relativePath}`;
        } catch (e) { return `Error: ${e instanceof Error ? e.message : e}`; }
      },
    }),
    editFile: tool({
      description: "Replace a specific string in a file",
      inputSchema: z.object({ relativePath: z.string(), oldString: z.string(), newString: z.string() }),
      execute: async ({ relativePath, oldString, newString }) => {
        const targetPath = path.resolve(cwd, relativePath);
        if (!targetPath.startsWith(cwd)) return "Access denied";
        try {
          const content = fs.readFileSync(targetPath, "utf-8");
          if (!content.includes(oldString)) return `Error: old string not found`;
          fs.writeFileSync(targetPath, content.replace(oldString, newString), "utf-8");
          return `Edited ${relativePath} successfully`;
        } catch (e) { return `Error: ${e instanceof Error ? e.message : e}`; }
      },
    }),
    bash: tool({
      description: "Run a shell command",
      inputSchema: z.object({ command: z.string() }),
      execute: async ({ command }) => {
        try {
          const output = execSync(command, { cwd, encoding: "utf-8", timeout: 60000, maxBuffer: 512 * 1024 });
          return output.slice(0, 8000) || "(no output)";
        } catch (e: unknown) {
          const err = e as { stdout?: string; stderr?: string; message?: string };
          return ((err.stdout || "") + (err.stderr || "")).slice(0, 8000) || `Error: ${err.message || e}`;
        }
      },
    }),
  };

  let fullLog = "";
  try {
    const result = streamText({ model: configuredModel, prompt, tools, stopWhen: stepCountIs(15) });
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") fullLog += part.text;
      else if (part.type === "tool-call") fullLog += `\n> **Tool: ${part.toolName}**\n`;
    }

    const db = getDb();
    db.update(scheduleItems)
      .set({ status: "completed", progress: 100, executionLog: fullLog || "No output" })
      .where(eq(scheduleItems.id, itemId))
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fullLog += `\nError: ${msg}`;
    const db = getDb();
    db.update(scheduleItems)
      .set({ status: "failed", progress: 0, executionLog: fullLog || "Error" })
      .where(eq(scheduleItems.id, itemId))
      .run();
  }
}
