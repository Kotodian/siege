import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { plans, schemes, schedules, scheduleItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getConfiguredModel } from "@/lib/ai/config";
import { streamText } from "ai";
import type { Provider } from "@/lib/ai/provider";

function saveScheduleFromJson(planId: string, jsonText: string) {
  const jsonStr = jsonText.startsWith("[")
    ? jsonText
    : jsonText.match(/\[[\s\S]*\]/)?.[0];
  if (!jsonStr) throw new Error("No JSON array found");

  const items = JSON.parse(jsonStr);
  const db = getDb();

  const existing = db.select().from(schedules).where(eq(schedules.planId, planId)).get();
  if (existing) db.delete(schedules).where(eq(schedules.id, existing.id)).run();

  const today = new Date();
  let currentHour = 0;
  const scheduleId = crypto.randomUUID();
  const totalHours = items.reduce((sum: number, item: any) => sum + (item.estimatedHours || item.durationDays * 8 || 4), 0);
  const totalDays = Math.ceil(totalHours / 8);
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + totalDays);

  db.insert(schedules).values({
    id: scheduleId, planId,
    startDate: today.toISOString().split("T")[0],
    endDate: endDate.toISOString().split("T")[0],
  }).run();

  for (const item of items) {
    const hours = item.estimatedHours || item.durationDays * 8 || 4;
    const startDay = Math.floor(currentHour / 8);
    const endDay = Math.floor((currentHour + hours) / 8);
    const itemStart = new Date(today);
    itemStart.setDate(itemStart.getDate() + startDay);
    const itemEnd = new Date(today);
    itemEnd.setDate(itemEnd.getDate() + endDay);
    currentHour += hours;
    db.insert(scheduleItems).values({
      id: crypto.randomUUID(), scheduleId,
      schemeId: item.schemeId || null,
      title: item.title, description: item.description || "",
      startDate: itemStart.toISOString().split("T")[0],
      endDate: itemEnd.toISOString().split("T")[0],
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
  const { planId, provider, model } = body as { planId: string; provider: Provider; model?: string };

  if (!planId || !provider) {
    return NextResponse.json({ error: "planId and provider required" }, { status: 400 });
  }

  const db = getDb();
  const plan = db.select().from(plans).where(eq(plans.id, planId)).get();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  if (plan.status !== "confirmed" && plan.status !== "scheduled") {
    return NextResponse.json({ error: "Plan must be confirmed or scheduled" }, { status: 400 });
  }

  const schemeList = db.select().from(schemes).where(eq(schemes.planId, planId)).all();
  const schemeSummary = schemeList
    .map((s, i) => `### Scheme ${i + 1}: ${s.title} (id: ${s.id})\n${s.content}`)
    .join("\n\n");

  const aiModel = getConfiguredModel(provider || undefined, model);
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
