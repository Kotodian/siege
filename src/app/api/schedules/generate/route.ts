import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { plans, schemes, schedules, scheduleItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateSchedule } from "@/lib/ai/schedule-generator";
import { getPlanSessionId, savePlanSessionId } from "@/lib/ai/session";
import type { Provider } from "@/lib/ai/provider";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { planId, provider, model } = body as {
    planId: string;
    provider: Provider;
    model?: string;
  };

  if (!planId || !provider) {
    return NextResponse.json(
      { error: "planId and provider are required" },
      { status: 400 }
    );
  }

  const db = getDb();
  const plan = db.select().from(plans).where(eq(plans.id, planId)).get();
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }
  if (plan.status !== "confirmed") {
    return NextResponse.json(
      { error: "Plan must be confirmed to generate schedule" },
      { status: 400 }
    );
  }

  const schemeList = db
    .select()
    .from(schemes)
    .where(eq(schemes.planId, planId))
    .all();

  const sessionId = getPlanSessionId(planId);

  // Run async — return immediately
  generateSchedule({
    planName: plan.name,
    schemes: schemeList.map((s) => ({
      id: s.id,
      title: s.title,
      content: s.content || "",
    })),
    provider,
    model,
    sessionId,
  })
    .then((result) => {
      const items = result.items;
      if (result.sessionId) {
        savePlanSessionId(planId, result.sessionId);
      }
      const db = getDb();

      // Delete existing schedule
      const existing = db
        .select()
        .from(schedules)
        .where(eq(schedules.planId, planId))
        .get();
      if (existing) {
        db.delete(schedules).where(eq(schedules.id, existing.id)).run();
      }

      const today = new Date();
      let currentDate = new Date(today);
      const scheduleId = crypto.randomUUID();
      const totalDays = items.reduce((sum, item) => sum + item.durationDays, 0);
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() + totalDays);

      db.insert(schedules)
        .values({
          id: scheduleId,
          planId,
          startDate: today.toISOString().split("T")[0],
          endDate: endDate.toISOString().split("T")[0],
        })
        .run();

      for (const item of items) {
        const itemStart = new Date(currentDate);
        const itemEnd = new Date(currentDate);
        itemEnd.setDate(itemEnd.getDate() + item.durationDays);

        db.insert(scheduleItems)
          .values({
            id: crypto.randomUUID(),
            scheduleId,
            schemeId: item.schemeId,
            title: item.title,
            description: item.description,
            startDate: itemStart.toISOString().split("T")[0],
            endDate: itemEnd.toISOString().split("T")[0],
            order: item.order,
            status: "pending",
            progress: 0,
            engine: "claude-code",
            skills: "[]",
          })
          .run();

        currentDate = itemEnd;
      }

      db.update(plans)
        .set({ status: "scheduled", updatedAt: new Date().toISOString() })
        .where(eq(plans.id, planId))
        .run();
    })
    .catch((err) => {
      console.error("[schedule-generate] failed:", err);
    });

  return NextResponse.json({ status: "generating" }, { status: 202 });
}
