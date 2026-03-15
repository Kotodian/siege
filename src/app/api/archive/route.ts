import { NextResponse } from "next/server";
import { archiveCompletedPlans, cleanupArchivedPlans } from "@/lib/archive";

// Triggered by cron or manually
export async function POST() {
  const archived = archiveCompletedPlans();
  const cleaned = cleanupArchivedPlans();

  return NextResponse.json({ archived, cleaned });
}
