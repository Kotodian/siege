import { getDb } from "@/lib/db";
import { plans, projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export function getPlanSessionId(planId: string): string | undefined {
  const db = getDb();
  const plan = db.select().from(plans).where(eq(plans.id, planId)).get();
  if (plan?.sessionId) return plan.sessionId;
  // Fall back to project session
  if (plan?.projectId) return getProjectSessionId(plan.projectId);
  return undefined;
}

export function savePlanSessionId(planId: string, sessionId: string) {
  const db = getDb();
  db.update(plans)
    .set({ sessionId })
    .where(eq(plans.id, planId))
    .run();

  // Also save to project for reuse
  const plan = db.select().from(plans).where(eq(plans.id, planId)).get();
  if (plan?.projectId) {
    saveProjectSessionId(plan.projectId, sessionId);
  }
}

export function getProjectSessionId(projectId: string): string | undefined {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  return project?.sessionId || undefined;
}

export function saveProjectSessionId(projectId: string, sessionId: string) {
  const db = getDb();
  db.update(projects)
    .set({ sessionId })
    .where(eq(projects.id, projectId))
    .run();
}
