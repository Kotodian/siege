import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { plans, schemes, schedules, scheduleItems, projects, appSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { resolveStepConfig, getStepModel } from "@/lib/ai/config";
import { streamText } from "ai";
import { AcpClient } from "@/lib/acp/client";
import fs from "fs";

function getDefaultEngine(): string {
  const { provider } = resolveStepConfig("execute");
  if (provider === "codex-acp") return "codex-acp";
  if (provider === "copilot-acp") return "copilot-acp";
  if (provider === "anthropic" || provider === "openai" || provider === "glm") return "claude-code";
  return "acp";
}

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

  // Calculate total hours (support both flat and hierarchical formats)
  const totalHours = items.reduce((sum: number, item: any) => {
    if (item.subtasks?.length > 0) {
      return sum + item.subtasks.reduce((s: number, st: any) => s + (st.estimatedHours || 1), 0);
    }
    return sum + (item.estimatedHours || 4);
  }, 0);
  const endDate = new Date(now);
  endDate.setHours(endDate.getHours() + totalHours);

  db.insert(schedules).values({
    id: scheduleId, planId,
    startDate: now.toISOString(),
    endDate: endDate.toISOString(),
  }).run();

  const engine = getDefaultEngine();

  for (const item of items) {
    const hasSubtasks = item.subtasks && item.subtasks.length > 0;

    if (hasSubtasks) {
      // Hierarchical: insert parent + children
      const parentHours = item.subtasks.reduce((s: number, st: any) => s + (st.estimatedHours || 1), 0);
      const parentStart = new Date(now);
      parentStart.setHours(parentStart.getHours() + currentHour);
      const parentEnd = new Date(now);
      parentEnd.setHours(parentEnd.getHours() + currentHour + parentHours);

      const parentId = crypto.randomUUID();
      db.insert(scheduleItems).values({
        id: parentId, scheduleId,
        schemeId: item.schemeId || null, parentId: null,
        title: item.title, description: item.description || "",
        startDate: parentStart.toISOString(), endDate: parentEnd.toISOString(),
        order: item.order || 0, status: "pending", progress: 0,
        engine, skills: "[]",
      }).run();

      // Insert subtasks
      let childHour = currentHour;
      for (let i = 0; i < item.subtasks.length; i++) {
        const st = item.subtasks[i];
        const stHours = st.estimatedHours || 1;
        const stStart = new Date(now);
        stStart.setHours(stStart.getHours() + childHour);
        const stEnd = new Date(now);
        stEnd.setHours(stEnd.getHours() + childHour + stHours);
        childHour += stHours;

        db.insert(scheduleItems).values({
          id: crypto.randomUUID(), scheduleId,
          schemeId: item.schemeId || null, parentId,
          title: st.title, description: st.description || "",
          startDate: stStart.toISOString(), endDate: stEnd.toISOString(),
          order: (item.order || 0) * 100 + i + 1, status: "pending", progress: 0,
          engine, skills: "[]",
        }).run();
      }
      currentHour += parentHours;
    } else {
      // Flat: insert as leaf task (backward compatible)
      const hours = item.estimatedHours || 4;
      const itemStart = new Date(now);
      itemStart.setHours(itemStart.getHours() + currentHour);
      const itemEnd = new Date(now);
      itemEnd.setHours(itemEnd.getHours() + currentHour + hours);
      currentHour += hours;
      db.insert(scheduleItems).values({
        id: crypto.randomUUID(), scheduleId,
        schemeId: item.schemeId || null, parentId: null,
        title: item.title, description: item.description || "",
        startDate: itemStart.toISOString(), endDate: itemEnd.toISOString(),
        order: item.order || 0, status: "pending", progress: 0,
        engine, skills: "[]",
      }).run();
    }
  }

  db.update(plans)
    .set({ status: "scheduled", updatedAt: new Date().toISOString() })
    .where(eq(plans.id, planId)).run();
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { planId, provider: rawProvider, model, locale } = body as { planId: string; provider?: string; model?: string; locale?: string };

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

  const isZh = locale ? locale === "zh" : /[\u4e00-\u9fff]/.test(schemeSummary);
  const langNote = isZh
    ? "\n\nIMPORTANT: Write task title and description in Chinese (中文), matching the language of the schemes."
    : "";

  const schedulePrompt = `<IMPORTANT>
You are being called as an API. Do NOT use tools, read files, or ask questions.
Output ONLY a JSON array. No conversation, no markdown fences, no explanation.
Start directly with [ and end with ].
</IMPORTANT>

Break these confirmed schemes into executable IMPLEMENTATION tasks with subtasks.
These tasks will be executed by an AI coding agent (Claude Code / Codex), NOT a human developer.

CRITICAL task granularity rules:
- Each PARENT task = ONE COMPLETE FEATURE or functional module
- Each parent task MUST have 2-5 subtasks that break it into concrete steps
- Aim for 3-8 parent tasks total
- Each subtask should be a specific, actionable coding step (0.5-2 hours)

Estimation: each subtask 0.5-2 hours (realistic for AI agent execution).

IMPORTANT: Do NOT include testing tasks. Testing is handled in a separate phase.
Focus only on implementation: code changes, new files, refactoring, configuration.

JSON array format — each object has:
- schemeId: scheme ID string or null
- title: short PARENT task title describing the feature/module
- description: overall description of this task group
- order: execution order starting from 1
- subtasks: array of subtask objects (REQUIRED, 2-5 items):
  - title: concise subtask title
  - description: specific implementation details
  - estimatedHours: number (0.5-2)

Plan: ${plan.name}

${schemeSummary}${langNote}

Output the JSON array now:`;

  // Resolve step-specific provider/model for "schedule" step
  const resolved = resolveStepConfig("schedule", provider as string, model);

  // ACP engine
  if (resolved.provider === "acp" || resolved.provider === "codex-acp" || resolved.provider === "copilot-acp") {
    const project = db.select().from(projects).where(eq(projects.id, plan.projectId)).get();
    const cwd = project?.targetRepoPath && fs.existsSync(project.targetRepoPath) ? project.targetRepoPath : process.cwd();

    const encoder = new TextEncoder();
    let fullText = "";
    const responseStream = new ReadableStream({
      async start(controller) {
        const acpClient = new AcpClient(cwd, resolved.provider === "codex-acp" ? "codex" : resolved.provider === "copilot-acp" ? "copilot" : "claude");
        try {
          await acpClient.start();
          let session;
          if (project?.sessionId) {
            session = await acpClient.resumeSession(project.sessionId);
          } else {
            session = await acpClient.createSession(resolved.model);
          }
          if (project && session.sessionId !== project.sessionId) {
            db.update(projects).set({ sessionId: session.sessionId }).where(eq(projects.id, project.id)).run();
          }
          if (resolved.model) {
            await acpClient.setModel(session.sessionId, resolved.model);
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
        } finally {
          await acpClient.stop();
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
    prompt: schedulePrompt,
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
