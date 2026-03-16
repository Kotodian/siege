import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  scheduleItems,
  schedules,
  plans,
  projects,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { spawn } from "child_process";
import { scanAllSkills, getSkillContent } from "@/lib/skills/registry";
import { parseJsonBody } from "@/lib/utils";

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
  // Merge skills from item config and request
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

  // Build prompt for claude CLI (with tool use)
  const prompt = `${previousContext ? `Previously completed tasks:\n${previousContext}\n---\n` : ""}

Implement task #${item.order}: ${item.title}

${item.description || ""}

${skillsContent ? `Skills context:\n${skillsContent}` : ""}

Read the relevant files, implement the changes, and run tests if applicable.`;

  // Validate cwd exists
  const fs = await import("fs");
  const cwd = fs.existsSync(project.targetRepoPath) ? project.targetRepoPath : process.cwd();

  // Use claude CLI with tool use, streaming output
  const proc = spawn("claude", ["-p", prompt, "--output-format", "stream-json", "--verbose"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
  });

  const encoder = new TextEncoder();
  let fullLog = "";

  const responseStream = new ReadableStream({
    start(controller) {
      let buffer = "";

      proc.stdout?.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);

            // Extract text output from assistant messages
            if (event.type === "assistant" && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === "text" && block.text) {
                  fullLog += block.text;
                  controller.enqueue(encoder.encode(block.text));
                }
                if (block.type === "tool_use") {
                  const toolMsg = `\n> **Tool: ${block.name}**\n`;
                  fullLog += toolMsg;
                  controller.enqueue(encoder.encode(toolMsg));
                }
              }
            }

            // Tool results
            if (event.type === "result" && event.result) {
              const resultMsg = `\n> Result: ${String(event.result).slice(0, 200)}\n`;
              fullLog += resultMsg;
              controller.enqueue(encoder.encode(resultMsg));
            }
          } catch {
            // skip non-JSON lines
          }
        }
      });

      proc.stderr?.on("data", () => {});

      proc.on("close", (code) => {
        // Save log and update status
        const db = getDb();
        db.update(scheduleItems)
          .set({
            status: code === 0 ? "completed" : "failed",
            progress: code === 0 ? 100 : 0,
            executionLog: fullLog || "No output",
          })
          .where(eq(scheduleItems.id, itemId))
          .run();

        controller.close();
      });

      proc.on("error", (err) => {
        fullLog += `\nError: ${err.message}`;
        controller.enqueue(encoder.encode(`\nError: ${err.message}`));
        controller.close();
      });
    },
  });

  return new Response(responseStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
