import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { schedules } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { parseJsonBody } from "@/lib/utils";

export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;

  const { scheduleId, enabled } = body as { scheduleId: string; enabled: boolean };
  if (!scheduleId || enabled === undefined) {
    return NextResponse.json({ error: "scheduleId and enabled are required" }, { status: 400 });
  }

  const db = getDb();
  db.update(schedules)
    .set({ autoExecute: enabled })
    .where(eq(schedules.id, scheduleId))
    .run();

  return NextResponse.json({ success: true, autoExecute: enabled });
}
