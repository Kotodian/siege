import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { schedules, scheduleItems, plans } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { parseJsonBody } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const planId = req.nextUrl.searchParams.get("planId");
  if (!planId) {
    return NextResponse.json(
      { error: "planId is required" },
      { status: 400 }
    );
  }

  const db = getDb();
  const schedule = db
    .select()
    .from(schedules)
    .where(eq(schedules.planId, planId))
    .get();

  if (!schedule) {
    return NextResponse.json(null);
  }

  const items = db
    .select()
    .from(scheduleItems)
    .where(eq(scheduleItems.scheduleId, schedule.id))
    .all();

  return NextResponse.json({ ...schedule, items });
}

// POST: add a manual task to a schedule, or create schedule if none exists
export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;

  const { planId, title, description, startDate, endDate, estimatedHours, afterItemId } = body as {
    planId: string;
    title: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    estimatedHours?: number;
    afterItemId?: string;
  };

  if (!planId || !title) {
    return NextResponse.json({ error: "planId and title are required" }, { status: 400 });
  }

  const db = getDb();

  // Find or create schedule
  let schedule = db.select().from(schedules).where(eq(schedules.planId, planId)).get();
  if (!schedule) {
    const now = new Date();
    const scheduleId = crypto.randomUUID();
    db.insert(schedules).values({
      id: scheduleId,
      planId,
      startDate: now.toISOString(),
      endDate: now.toISOString(),
    }).run();
    schedule = db.select().from(schedules).where(eq(schedules.id, scheduleId)).get()!;

    // Set plan to scheduled
    db.update(plans)
      .set({ status: "scheduled", updatedAt: new Date().toISOString() })
      .where(eq(plans.id, planId))
      .run();
  }

  // Determine order: after parent task, or at end
  const existing = db.select().from(scheduleItems)
    .where(eq(scheduleItems.scheduleId, schedule.id))
    .all()
    .sort((a, b) => a.order - b.order);

  let newOrder: number;
  if (afterItemId) {
    const parentItem = existing.find(i => i.id === afterItemId);
    const parentOrder = parentItem?.order ?? existing.length;
    newOrder = parentOrder + 1;
    // Shift subsequent items down
    for (const item of existing) {
      if (item.order >= newOrder) {
        db.update(scheduleItems)
          .set({ order: item.order + 1 })
          .where(eq(scheduleItems.id, item.id))
          .run();
      }
    }
  } else {
    newOrder = existing.reduce((max, i) => Math.max(max, i.order), 0) + 1;
  }

  const now = new Date();
  const hours = estimatedHours || 2;
  const parentItem = afterItemId ? existing.find(i => i.id === afterItemId) : null;
  const start = startDate || (parentItem ? parentItem.endDate : now.toISOString());
  const end = endDate || new Date(new Date(start).getTime() + hours * 3600000).toISOString();

  const itemId = crypto.randomUUID();
  db.insert(scheduleItems).values({
    id: itemId,
    scheduleId: schedule.id,
    schemeId: parentItem?.schemeId || null,
    title,
    description: description || "",
    startDate: start,
    endDate: end,
    order: newOrder,
    status: "pending",
    progress: 0,
    engine: "claude-code",
    skills: "[]",
  }).run();

  const item = db.select().from(scheduleItems).where(eq(scheduleItems.id, itemId)).get();
  return NextResponse.json(item, { status: 201 });
}
