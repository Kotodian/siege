import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scheduleItems, schedules, plans, projects, appSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { resolveStepConfig, getStepModel } from "@/lib/ai/config";
import { AcpClient } from "@/lib/acp/client";
import { streamText } from "ai";
import fs from "fs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await params;
  const body = await req.json();
  const { mode, subtasks: manualSubtasks, provider: rawProvider, model, locale } = body as {
    mode: "ai" | "manual";
    subtasks?: Array<{ title: string; description: string; estimatedHours: number }>;
    provider?: string;
    model?: string;
    locale?: string;
  };

  const db = getDb();
  const item = db.select().from(scheduleItems).where(eq(scheduleItems.id, itemId)).get();
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  // Cannot split a subtask (single-level nesting only)
  if (item.parentId) {
    return NextResponse.json({ error: "Cannot split a subtask" }, { status: 400 });
  }

  // Cannot split if already has children
  const existingChildren = db.select().from(scheduleItems)
    .where(eq(scheduleItems.parentId, itemId)).all();
  if (existingChildren.length > 0) {
    return NextResponse.json({ error: "Task already has subtasks" }, { status: 400 });
  }

  if (mode === "manual") {
    if (!manualSubtasks || manualSubtasks.length === 0) {
      return NextResponse.json({ error: "subtasks array required for manual mode" }, { status: 400 });
    }
    const created = insertSubtasks(itemId, item, manualSubtasks);
    return NextResponse.json({ parentId: itemId, subtasks: created }, { status: 201 });
  }

  // AI-assisted split — stream response
  const schedule = db.select().from(schedules).where(eq(schedules.id, item.scheduleId)).get();
  const plan = schedule ? db.select().from(plans).where(eq(plans.id, schedule.planId)).get() : null;
  const project = plan ? db.select().from(projects).where(eq(projects.id, plan.projectId)).get() : null;

  const isZh = locale === "zh";
  const langNote = isZh ? "\n用中文写标题和描述。" : "";

  const splitPrompt = `<IMPORTANT>
You are being called as an API. Output ONLY a JSON array. No conversation, no markdown fences.
Start directly with [ and end with ].
</IMPORTANT>

Break this task into 2-5 concrete implementation subtasks.

Task: ${item.title}
Description: ${item.description || "N/A"}

Each subtask should be a specific, actionable coding step.

JSON array format — each object:
- title: concise subtask title (string)
- description: specific implementation details (string)
- estimatedHours: number (0.5-2)${langNote}

Output the JSON array now:`;

  const provider = rawProvider || db.select().from(appSettings).where(eq(appSettings.key, "default_provider")).get()?.value || "anthropic";
  const resolved = resolveStepConfig("schedule", provider, model);
  const encoder = new TextEncoder();

  if (resolved.provider === "acp" || resolved.provider === "codex-acp" || resolved.provider === "copilot-acp") {
    const cwd = project?.targetRepoPath && fs.existsSync(project.targetRepoPath) ? project.targetRepoPath : process.cwd();
    let fullText = "";
    const stream = new ReadableStream({
      async start(controller) {
        const acp = new AcpClient(cwd, resolved.provider === "codex-acp" ? "codex" : resolved.provider === "copilot-acp" ? "copilot" : "claude");
        try {
          await acp.start();
          const session = await acp.createSession(resolved.model);
          await acp.prompt(session.sessionId, splitPrompt, (type, text) => {
            if (type === "text") { fullText += text; controller.enqueue(encoder.encode(text)); }
          });
          try {
            const parsed = parseSubtaskJson(fullText.trim());
            insertSubtasks(itemId, item, parsed);
          } catch (e) {
            controller.enqueue(encoder.encode(`\nError: ${e instanceof Error ? e.message : e}`));
          }
          controller.close();
        } catch (err) {
          controller.enqueue(encoder.encode(`\nError: ${err instanceof Error ? err.message : err}`));
          controller.close();
        } finally {
          await acp.stop();
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  // SDK path
  let aiModel;
  try {
    aiModel = getStepModel("schedule", provider, model);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }

  const result = streamText({ model: aiModel, prompt: splitPrompt });
  let fullText = "";
  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of result.textStream) {
        fullText += chunk;
        controller.enqueue(encoder.encode(chunk));
      }
      try {
        const parsed = parseSubtaskJson(fullText.trim());
        insertSubtasks(itemId, item, parsed);
      } catch (e) {
        controller.enqueue(encoder.encode(`\nError: ${e instanceof Error ? e.message : e}`));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

function parseSubtaskJson(text: string): Array<{ title: string; description: string; estimatedHours: number }> {
  const jsonStr = text.startsWith("[") ? text : text.match(/\[[\s\S]*\]/)?.[0];
  if (!jsonStr) throw new Error("No JSON array found");
  return JSON.parse(jsonStr);
}

function insertSubtasks(
  parentId: string,
  parent: { scheduleId: string; schemeId: string | null; startDate: string; endDate: string; order: number; engine: string | null },
  subtasks: Array<{ title: string; description: string; estimatedHours: number }>
) {
  const db = getDb();
  const parentStart = new Date(parent.startDate).getTime();
  const parentEnd = new Date(parent.endDate).getTime();
  const totalHours = subtasks.reduce((s, st) => s + (st.estimatedHours || 1), 0);
  const msPerHour = (parentEnd - parentStart) / totalHours;

  const created = [];
  let cursor = parentStart;

  for (let i = 0; i < subtasks.length; i++) {
    const st = subtasks[i];
    const hours = st.estimatedHours || 1;
    const stStart = new Date(cursor);
    const stEnd = new Date(cursor + msPerHour * hours);
    cursor += msPerHour * hours;

    const id = crypto.randomUUID();
    db.insert(scheduleItems).values({
      id,
      scheduleId: parent.scheduleId,
      schemeId: parent.schemeId,
      parentId,
      title: st.title,
      description: st.description || "",
      startDate: stStart.toISOString(),
      endDate: stEnd.toISOString(),
      order: parent.order * 100 + i + 1,
      status: "pending",
      progress: 0,
      engine: parent.engine || "claude-code",
      skills: "[]",
    }).run();
    created.push({ id, title: st.title });
  }
  return created;
}
