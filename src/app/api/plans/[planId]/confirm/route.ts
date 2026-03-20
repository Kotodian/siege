import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { plans, schemes, reviews, reviewItems } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const { planId } = await params;
  const body = await req.json();
  const { action } = body;
  const db = getDb();

  const plan = db.select().from(plans).where(eq(plans.id, planId)).get();
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  if (action === "confirm") {
    if (plan.status !== "reviewing") {
      return NextResponse.json(
        { error: "Plan must be in reviewing status to confirm" },
        { status: 400 }
      );
    }

    const schemeList = db
      .select()
      .from(schemes)
      .where(eq(schemes.planId, planId))
      .all();
    if (schemeList.length === 0) {
      return NextResponse.json(
        { error: "Plan must have at least one scheme to confirm" },
        { status: 400 }
      );
    }

    db.update(plans)
      .set({ status: "confirmed", updatedAt: new Date().toISOString() })
      .where(eq(plans.id, planId))
      .run();

    // Mark all unresolved scheme review findings as resolved
    const schemeReviews = db.select().from(reviews)
      .where(and(eq(reviews.planId, planId), eq(reviews.type, "scheme")))
      .all();
    for (const review of schemeReviews) {
      db.update(reviewItems)
        .set({ resolved: true })
        .where(and(eq(reviewItems.reviewId, review.id), eq(reviewItems.resolved, false)))
        .run();
      if (review.status !== "approved") {
        db.update(reviews)
          .set({ status: "approved", updatedAt: new Date().toISOString() })
          .where(eq(reviews.id, review.id))
          .run();
      }
    }
  } else if (action === "revoke") {
    if (plan.status !== "confirmed") {
      return NextResponse.json(
        { error: "Plan must be in confirmed status to revoke" },
        { status: 400 }
      );
    }

    db.update(plans)
      .set({ status: "reviewing", updatedAt: new Date().toISOString() })
      .where(eq(plans.id, planId))
      .run();
  } else {
    return NextResponse.json(
      { error: "action must be 'confirm' or 'revoke'" },
      { status: 400 }
    );
  }

  const updated = db.select().from(plans).where(eq(plans.id, planId)).get();
  return NextResponse.json(updated);
}
