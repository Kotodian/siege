import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { schedules, scheduleItems, plans } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * POST /api/schedules/tick
 *
 * Called by the frontend every 30s when auto-execute is enabled.
 * Finds the next pending task and launches it via /api/execute
 * (same path as manual execution — supports ACP, SDK, skills, snapshots).
 */
export async function POST(req: Request) {
  const db = getDb();

  const autoSchedules = db.select().from(schedules)
    .where(eq(schedules.autoExecute, true))
    .all();

  if (autoSchedules.length === 0) {
    return NextResponse.json({ executed: 0, reason: "no auto-execute schedules" });
  }

  const launched: Array<{ taskId: string; title: string }> = [];

  for (const schedule of autoSchedules) {
    const allItems = db.select().from(scheduleItems)
      .where(eq(scheduleItems.scheduleId, schedule.id))
      .all()
      .sort((a, b) => a.order - b.order);

    // Check if any task is already running in this schedule
    const hasRunning = allItems.some(i => i.status === "in_progress");
    if (hasRunning) continue;

    // Find first pending task
    const nextPending = allItems.find(i => i.status === "pending");
    if (!nextPending) continue;

    // Get plan for status update
    const plan = db.select().from(plans).where(eq(plans.id, schedule.planId)).get();

    if (plan?.status === "scheduled") {
      db.update(plans)
        .set({ status: "executing", updatedAt: new Date().toISOString() })
        .where(eq(plans.id, plan.id))
        .run();
    }

    // Delegate to /api/execute — fire and forget (don't await the stream)
    const baseUrl = req.headers.get("origin")
      || req.headers.get("x-forwarded-proto") + "://" + req.headers.get("host")
      || "http://127.0.0.1:3002";

    fetch(`${baseUrl}/api/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: nextPending.id }),
    }).then(async (res) => {
      // Consume the stream so the request completes
      if (res.body) {
        const reader = res.body.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
    }).catch(err => {
      console.error(`[auto-execute] Task ${nextPending.id} failed:`, err);
    });

    launched.push({ taskId: nextPending.id, title: nextPending.title });
  }

  return NextResponse.json({
    executed: launched.length,
    tasks: launched,
  });
}
