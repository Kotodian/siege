import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { schedules, scheduleItems, plans } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * POST /api/schedules/tick
 *
 * Called by the frontend every 30s when auto-execute is enabled.
 * Returns the next pending task to execute. The frontend then calls
 * /api/execute directly to get streaming progress display.
 */
export async function POST() {
  const db = getDb();

  const autoSchedules = db.select().from(schedules)
    .where(eq(schedules.autoExecute, true))
    .all();

  if (autoSchedules.length === 0) {
    return NextResponse.json({ executed: false });
  }

  for (const schedule of autoSchedules) {
    const allItems = db.select().from(scheduleItems)
      .where(eq(scheduleItems.scheduleId, schedule.id))
      .all()
      .sort((a, b) => a.order - b.order);

    // Skip if any task is already running (but auto-reset stuck tasks)
    const runningItem = allItems.find(i => i.status === "in_progress");
    if (runningItem) {
      // If in_progress with no log for >10 min, reset to pending (stuck)
      const stuckMinutes = (Date.now() - new Date(runningItem.startDate).getTime()) / 60000;
      if (stuckMinutes > 10 && !runningItem.executionLog) {
        db.update(scheduleItems)
          .set({ status: "pending", progress: 0 })
          .where(eq(scheduleItems.id, runningItem.id))
          .run();
      } else {
        continue;
      }
    }

    // Build execution order: parents sorted by order, subtasks within each parent
    // Parent tasks with children are never executed directly
    const executionOrder: typeof allItems = [];
    const topLevel = allItems.filter(i => !i.parentId).sort((a, b) => a.order - b.order);
    for (const parent of topLevel) {
      const children = allItems.filter(i => i.parentId === parent.id).sort((a, b) => a.order - b.order);
      if (children.length > 0) {
        executionOrder.push(...children);
      } else {
        executionOrder.push(parent);
      }
    }

    // Find first pending task from execution order
    const nextPending = executionOrder.find(i => i.status === "pending");
    if (!nextPending) continue;

    // Update plan status if needed
    const plan = db.select().from(plans).where(eq(plans.id, schedule.planId)).get();
    if (plan?.status === "scheduled") {
      db.update(plans)
        .set({ status: "executing", updatedAt: new Date().toISOString() })
        .where(eq(plans.id, plan.id))
        .run();
    }

    return NextResponse.json({
      executed: true,
      nextTask: { itemId: nextPending.id, title: nextPending.title, order: nextPending.order },
      allTasks: allItems.map(i => ({
        id: i.id,
        order: i.order,
        title: i.title,
        status: i.id === nextPending.id ? "running" : i.status === "completed" ? "completed" : i.status === "failed" ? "failed" : "pending",
      })),
    });
  }

  return NextResponse.json({ executed: false });
}
