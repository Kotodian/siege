import { getDb } from "@/lib/db";
import { plans, appSettings } from "@/lib/db/schema";
import { eq, and, isNull, lte } from "drizzle-orm";

function getSetting(key: string, defaultValue: string): string {
  const db = getDb();
  const setting = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .get();
  return setting?.value || defaultValue;
}

export function archiveCompletedPlans(): number {
  const db = getDb();
  const archiveDays = parseInt(getSetting("archive_after_days", "30"), 10);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - archiveDays);
  const cutoffStr = cutoff.toISOString();

  const result = db
    .update(plans)
    .set({ archivedAt: new Date().toISOString() })
    .where(
      and(
        eq(plans.status, "completed"),
        isNull(plans.archivedAt),
        lte(plans.updatedAt, cutoffStr)
      )
    )
    .run();

  return result.changes;
}

export function cleanupArchivedPlans(): number {
  const db = getDb();
  const cleanupDays = parseInt(getSetting("cleanup_after_days", "90"), 10);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - cleanupDays);
  const cutoffStr = cutoff.toISOString();

  const toDelete = db
    .select({ id: plans.id })
    .from(plans)
    .where(
      and(
        lte(plans.archivedAt, cutoffStr)
      )
    )
    .all();

  for (const plan of toDelete) {
    db.delete(plans).where(eq(plans.id, plan.id)).run();
  }

  return toDelete.length;
}
