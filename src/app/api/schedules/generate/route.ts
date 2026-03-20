import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { plans, schemes, schedules, scheduleItems, projects, appSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { resolveStepConfig, getStepModel } from "@/lib/ai/config";
import { streamText } from "ai";
import { AcpClient } from "@/lib/acp/client";
import fs from "fs";

function saveScheduleFromJson(planId: string, jsonText: string) {
  const jsonStr = jsonText.startsWith("[")
    ? jsonText
    : jsonText.match(/\[[\s\S]*\]/)?.[0];
  if (!jsonStr) throw new Error("No JSON array found");

  const items = JSON.parse(jsonStr);
  const db = getDb();

  const existing = db.select().from(schedules).where(eq(schedules.planId, planId)).get();
  if (existing) db.delete(schedules).where(eq(schedules.id, existing.id)).run();

  const now = new Date();
  let currentHour = 0;
  const scheduleId = crypto.randomUUID();
  const totalHours = items.reduce((sum: number, item: any) => sum + (item.estimatedHours || 4), 0);
  const endDate = new Date(now);
  endDate.setHours(endDate.getHours() + totalHours);

  db.insert(schedules).values({
    id: scheduleId, planId,
    startDate: now.toISOString(),
    endDate: endDate.toISOString(),
  }).run();

  for (const item of items) {
    const hours = item.estimatedHours || 4;
    const itemStart = new Date(now);
    itemStart.setHours(itemStart.getHours() + currentHour);
    const itemEnd = new Date(now);
    itemEnd.setHours(itemEnd.getHours() + currentHour + hours);
    currentHour += hours;
    db.insert(scheduleItems).values({
      id: crypto.randomUUID(), scheduleId,
      schemeId: item.schemeId || null,
      title: item.title, description: item.description || "",
      startDate: itemStart.toISOString(),
      endDate: itemEnd.toISOString(),
      order: item.order || 0, status: "pending", progress: 0,
      engine: "claude-code", skills: "[]",
    }).run();
  }

  db.update(plans)
    .set({ status: "scheduled", updatedAt: new Date().toISOString() })
    .where(eq(plans.id, planId)).run();
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { planId, provider: rawProvider, model } = body as { planId: string; provider?: string; model?: string };

  if (!planId) {
    return NextResponse.json({ error: "planId required" }, { status: 400 });
  }

  const db = getDb();
  const provider = rawProvider || db.select().from(appSettings).where(eq(appSettings.key, "default_provider")).get()?.value || "anthropic";
  const plan = db.select().from(plans).where(eq(plans.id, planId)).get();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  if (plan.status !== "confirmed" && plan.status !== "scheduled") {
    return NextResponse.json({ error: "Plan must be confirmed or scheduled" }, { status: 400 });
  }

  const schemeList = db.select().from(schemes).where(eq(schemes.planId, planId)).all();
  const schemeSummary = schemeList
    .map((s, i) => `### Scheme ${i + 1}: ${s.title} (id: ${s.id})\n${s.content}`)
    .join("\n\n");

  const schedulePrompt = `<IMPORTANT>
You are being called as an API. Do NOT use tools, read files, or ask questions.
Output ONLY a JSON array. No conversation, no markdown fences, no explanation.
Start directly with [ and end with ].
</IMPORTANT>

Break these confirmed schemes into executable IMPLEMENTATION tasks only.
Estimate effort in hours (1-8 hours per task).

IMPORTANT: Do NOT include testing tasks. Testing is handled in a separate phase.
Focus only on implementation: code changes, new files, refactoring, configuration.

JSON array format — each object has:
- schemeId: scheme ID string or null
- title: short task title
- description: markdown description of what to do
- estimatedHours: number (1-8)
- order: execution order starting from 1

Plan: ${plan.name}

${schemeSummary}

Output the JSON array now:`;

  // Resolve step-specific provider/model for "schedule" step
  const resolved = resolveStepConfig("schedule", provider as string, model);

  // ACP engine
  if (resolved.provider === "acp") {
    const project = db.select().from(projects).where(eq(projects.id, plan.projectId)).get();
    const cwd = project?.targetRepoPath && fs.existsSync(project.targetRepoPath) ? project.targetRepoPath : process.cwd();

    const encoder = new TextEncoder();
    let fullText = "";
    const responseStream = new ReadableStream({
      async start(controller) {
        const acpClient = new AcpClient(cwd);
        try {
          await acpClient.start();
          let session;
          if (project?.sessionId) {
            session = await acpClient.resumeSession(project.sessionId);
          } else {
            session = await acpClient.createSession();
          }
          if (project && session.sessionId !== project.sessionId) {
            db.update(projects).set({ sessionId: session.sessionId }).where(eq(projects.id, project.id)).run();
          }

          await acpClient.prompt(session.sessionId, schedulePrompt, (type, text) => {
            if (type === "text") { fullText += text; controller.enqueue(encoder.encode(text)); }
          });

          try { saveScheduleFromJson(planId, fullText.trim()); } catch (e) {
            console.error("[schedule-generate] Save failed:", e);
          }
          controller.close();
        } catch (err) {
          controller.enqueue(encoder.encode(`\nError: ${err instanceof Error ? err.message : err}`));
          controller.close();
        }
      },
    });
    return new Response(responseStream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  let aiModel;
  try {
    aiModel = getStepModel("schedule", provider as string, model);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 503 });
  }
  const result = streamText({
    model: aiModel,
    prompt: `<IMPORTANT>
You are being called as an API. Do NOT use tools, read files, or ask questions.
Output ONLY a JSON array. No conversation, no markdown fences, no explanation.
Start directly with [ and end with ].
</IMPORTANT>

Break these confirmed schemes into executable IMPLEMENTATION tasks only.
Estimate effort in hours (1-8 hours per task).

IMPORTANT: Do NOT include testing tasks. Testing is handled in a separate phase.
Focus only on implementation: code changes, new files, refactoring, configuration.

JSON array format — each object has:
- schemeId: scheme ID string or null
- title: short task title
- description: markdown description of what to do
- estimatedHours: number (1-8)
- order: execution order starting from 1

Plan: ${plan.name}

${schemeSummary}

Output the JSON array now:`,
  });

  const textStream = result.textStream;
  const encoder = new TextEncoder();
  let fullText = "";

  const responseStream = new ReadableStream({
    async start(controller) {
      for await (const chunk of textStream) {
        fullText += chunk;
        controller.enqueue(encoder.encode(chunk));
      }
      try {
        saveScheduleFromJson(planId, fullText.trim());
      } catch (err) {
        console.error("[schedule-generate] Save failed:", err);
      }
      controller.close();
    },
  });

  return new Response(responseStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
