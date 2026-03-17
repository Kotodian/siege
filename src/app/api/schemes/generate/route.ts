import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { plans, projects, schemes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { spawn } from "child_process";
import { getPlanSessionId, savePlanSessionId } from "@/lib/ai/session";
import type { Provider } from "@/lib/ai/provider";
import { parseJsonBody } from "@/lib/utils";
import fs from "fs";

function saveScheme(planId: string, content: string, planStatus: string) {
  const db = getDb();
  db.insert(schemes).values({
    id: crypto.randomUUID(), planId,
    title: "Generated Scheme", content, sourceType: "web_search",
  }).run();

  if (planStatus === "draft") {
    db.update(plans)
      .set({ status: "reviewing", updatedAt: new Date().toISOString() })
      .where(eq(plans.id, planId)).run();
  }
}

export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;
  const { planId } = body as { planId: string };

  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 });

  const db = getDb();
  const plan = db.select().from(plans).where(eq(plans.id, planId)).get();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const project = db.select().from(projects).where(eq(projects.id, plan.projectId)).get();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const cwd = fs.existsSync(project.targetRepoPath) ? project.targetRepoPath : process.cwd();
  const sessionId = getPlanSessionId(planId);

  const prompt = `Read the project code and generate a detailed technical scheme for this plan.

Project: ${project.name}
Repository: ${project.targetRepoPath}
Plan: ${plan.name}

Description:
${plan.description || "No description provided."}

Steps:
1. Explore the project structure (ls, find key files)
2. Read relevant source files
3. Generate a Markdown technical scheme with:
   ## Overview
   ## Technical Details (specific files, functions, code examples from the actual codebase)
   ## Key Decisions
   ## Risks & Mitigations
   ## Estimated Effort

Write in the same language as the description.`;

  // Use claude CLI with tool use + session reuse
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
  if (sessionId) args.push("--resume", sessionId);

  const proc = spawn("claude", args, { cwd, shell: true, stdio: ["pipe", "pipe", "pipe"] });

  const encoder = new TextEncoder();
  let fullText = "";
  let detectedSessionId: string | undefined;

  const responseStream = new ReadableStream({
    start(controller) {
      let buffer = "";
      let hasContent = false;

      // Send heartbeat every 3s until first real content arrives
      const heartbeat = setInterval(() => {
        if (!hasContent) {
          controller.enqueue(encoder.encode(""));  // empty chunk keeps connection alive
        } else {
          clearInterval(heartbeat);
        }
      }, 3000);

      // Send immediate status
      controller.enqueue(encoder.encode("*Claude 正在启动并读取项目代码...*\n\n"));

      proc.stdout?.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.session_id && !detectedSessionId) {
              detectedSessionId = event.session_id;
            }
            if (event.type === "assistant" && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === "text" && block.text) {
                  if (!hasContent) { hasContent = true; clearInterval(heartbeat); }
                  fullText += block.text;
                  controller.enqueue(encoder.encode(block.text));
                }
                if (block.type === "tool_use") {
                  if (!hasContent) { hasContent = true; clearInterval(heartbeat); }
                  const msg = `\n> **Tool: ${block.name}**\n`;
                  fullText += msg;
                  controller.enqueue(encoder.encode(msg));
                }
              }
            }
          } catch {}
        }
      });

      proc.stderr?.on("data", () => {});

      proc.on("close", () => {
        clearInterval(heartbeat);
        // Save session for reuse
        if (detectedSessionId) savePlanSessionId(planId, detectedSessionId);

        // Save scheme
        if (fullText.trim()) {
          saveScheme(planId, fullText.trim(), plan.status);
        }
        controller.close();
      });

      proc.on("error", (err) => {
        controller.enqueue(encoder.encode(`\nError: ${err.message}`));
        controller.close();
      });
    },
  });

  return new Response(responseStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
