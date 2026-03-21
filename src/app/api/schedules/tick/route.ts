import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { schedules, scheduleItems, plans, projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { execSync } from "child_process";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { getStepModel } from "@/lib/ai/config";
import { scanAllSkills, getSkillContent } from "@/lib/skills/registry";
import fs from "fs";
import path from "path";

export async function POST() {
  const db = getDb();

  const autoSchedules = db.select().from(schedules)
    .where(eq(schedules.autoExecute, true))
    .all();

  if (autoSchedules.length === 0) {
    return NextResponse.json({ executed: 0, reason: "no auto-execute schedules" });
  }

  const launched: Array<{ taskId: string; title: string; schemeId: string | null }> = [];

  for (const schedule of autoSchedules) {
    const allItems = db.select().from(scheduleItems)
      .where(eq(scheduleItems.scheduleId, schedule.id))
      .all()
      .sort((a, b) => a.order - b.order);

    // Group items by schemeId (null schemeId = its own group)
    const groups = new Map<string, typeof allItems>();
    for (const item of allItems) {
      const key = item.schemeId || `_no_scheme_${item.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }

    // For each group (pipeline), find if we can launch a task
    for (const [groupKey, groupItems] of groups) {
      // Check if any task in this group is already running
      const groupRunning = groupItems.some(i => i.status === "in_progress");
      if (groupRunning) continue;

      // Find first pending task in this group
      const nextPending = groupItems.find(i => i.status === "pending");
      if (!nextPending) continue;

      // Get plan and project
      const plan = db.select().from(plans).where(eq(plans.id, schedule.planId)).get();
      if (!plan) continue;
      const project = db.select().from(projects).where(eq(projects.id, plan.projectId)).get();
      if (!project) continue;

      // Mark as in_progress
      db.update(scheduleItems)
        .set({ status: "in_progress", progress: 0 })
        .where(eq(scheduleItems.id, nextPending.id))
        .run();

      if (plan.status === "scheduled") {
        db.update(plans)
          .set({ status: "executing", updatedAt: new Date().toISOString() })
          .where(eq(plans.id, plan.id))
          .run();
      }

      // Build context from completed tasks in this group only (same pipeline)
      let previousContext = "";
      for (const prev of groupItems) {
        if (prev.id === nextPending.id) break;
        if (prev.status === "completed" && prev.executionLog) {
          previousContext += `\nCompleted Task #${prev.order} "${prev.title}":\n${prev.executionLog.slice(0, 3000)}\n`;
        }
      }

      // Skills — use configured skills, or auto-detect from all available
      let itemSkills: string[] = JSON.parse(nextPending.skills || "[]");
      const allSkills = scanAllSkills();
      if (itemSkills.length === 0 && allSkills.length > 0) {
        // Auto-select all available skills — let the AI use what it needs
        itemSkills = allSkills.map(s => s.name);
      }
      let skillsContent = "";
      if (itemSkills.length > 0) {
        skillsContent = getSkillContent(allSkills, itemSkills);
      }

      const prompt = `${previousContext ? `Previously completed tasks in this pipeline:\n${previousContext}\n---\n` : ""}

Implement task #${nextPending.order}: ${nextPending.title}

${nextPending.description || ""}

${skillsContent ? `Skills context:\n${skillsContent}` : ""}

Use the provided tools to read the codebase, write/edit files, and run commands. Implement the changes and verify they work.`;

      const cwd = fs.existsSync(project.targetRepoPath) ? project.targetRepoPath : process.cwd();

      // Launch asynchronously — multiple tasks from different groups run in parallel
      executeTask(nextPending.id, cwd, prompt).catch(err => {
        console.error(`[auto-execute] Task ${nextPending.id} failed:`, err);
      });

      launched.push({
        taskId: nextPending.id,
        title: nextPending.title,
        schemeId: nextPending.schemeId,
      });
    }
  }

  if (launched.length === 0) {
    return NextResponse.json({ executed: 0, reason: "no due tasks" });
  }

  return NextResponse.json({
    executed: launched.length,
    tasks: launched,
  });
}

async function executeTask(itemId: string, cwd: string, prompt: string) {
  let configuredModel;
  try {
    configuredModel = getStepModel("execute");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const db = getDb();
    db.update(scheduleItems)
      .set({ status: "failed", progress: 0, executionLog: `Error: ${msg}` })
      .where(eq(scheduleItems.id, itemId))
      .run();
    return;
  }
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
      else if (part.type === "tool-call") {
        const input = "input" in part ? JSON.stringify(part.input).slice(0, 200) : "";
        fullLog += `\n> **Tool: ${part.toolName}**(${input})\n`;
      } else if (part.type === "tool-result") {
        const raw = "output" in part ? part.output : "result" in part ? (part as Record<string, unknown>).result : "";
        const output = typeof raw === "string" ? raw : JSON.stringify(raw);
        fullLog += `\`\`\`\n${output.length > 500 ? output.slice(0, 500) + "..." : output}\n\`\`\`\n`;
      }
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
