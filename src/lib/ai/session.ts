import { getDb } from "@/lib/db";
import { plans } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export function getPlanSessionId(planId: string): string | undefined {
  const db = getDb();
  const plan = db.select().from(plans).where(eq(plans.id, planId)).get();
  return plan?.sessionId || undefined;
}

export function savePlanSessionId(planId: string, sessionId: string) {
  const db = getDb();
  db.update(plans)
    .set({ sessionId })
    .where(eq(plans.id, planId))
    .run();
}
