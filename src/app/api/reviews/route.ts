import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { reviews, reviewItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const planId = req.nextUrl.searchParams.get("planId");
  const type = req.nextUrl.searchParams.get("type");

  if (!planId) {
    return NextResponse.json(
      { error: "planId is required" },
      { status: 400 }
    );
  }

  const db = getDb();
  let query = db.select().from(reviews).where(eq(reviews.planId, planId));

  const allReviews = query.all().filter((r) => !type || r.type === type);

  const result = allReviews.map((review) => {
    const items = db
      .select()
      .from(reviewItems)
      .where(eq(reviewItems.reviewId, review.id))
      .all();
    return { ...review, items };
  });

  return NextResponse.json(result);
}
