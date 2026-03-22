import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { reviews } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { parseJsonBody } from "@/lib/utils";

export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;
  const { planId } = body as { planId: string };

  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 });

  const db = getDb();
  const inProgress = db.select().from(reviews)
    .where(and(eq(reviews.planId, planId), eq(reviews.status, "in_progress")))
    .all();

  for (const r of inProgress) {
    db.update(reviews)
      .set({ status: "changes_requested", content: "已取消 / Cancelled", updatedAt: new Date().toISOString() })
      .where(eq(reviews.id, r.id))
      .run();
  }

  return NextResponse.json({ cancelled: inProgress.length });
}
