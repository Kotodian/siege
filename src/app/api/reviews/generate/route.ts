import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  plans,
  schemes,
  scheduleItems,
  schedules,
  reviews,
  reviewItems,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateReview } from "@/lib/ai/review-generator";
import type { Provider } from "@/lib/ai/provider";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { planId, type, provider, model } = body as {
    planId: string;
    type: "scheme" | "implementation";
    provider: Provider;
    model?: string;
  };

  if (!planId || !type || !provider) {
    return NextResponse.json(
      { error: "planId, type, and provider are required" },
      { status: 400 }
    );
  }

  const db = getDb();
  const plan = db.select().from(plans).where(eq(plans.id, planId)).get();
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  // Get items to review based on type
  let itemsToReview: Array<{ id: string; title: string; content: string }>;

  if (type === "scheme") {
    const schemeList = db
      .select()
      .from(schemes)
      .where(eq(schemes.planId, planId))
      .all();
    itemsToReview = schemeList.map((s) => ({
      id: s.id,
      title: s.title,
      content: s.content || "",
    }));
  } else {
    // Implementation review — review schedule items with their execution logs
    const schedule = db
      .select()
      .from(schedules)
      .where(eq(schedules.planId, planId))
      .get();
    if (!schedule) {
      return NextResponse.json(
        { error: "No schedule found" },
        { status: 400 }
      );
    }
    const items = db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.scheduleId, schedule.id))
      .all();
    itemsToReview = items.map((i) => ({
      id: i.id,
      title: i.title,
      content: `${i.description || ""}\n\n### Execution Log\n\`\`\`\n${i.executionLog || "No output"}\n\`\`\``,
    }));
  }

  if (itemsToReview.length === 0) {
    return NextResponse.json(
      { error: "Nothing to review" },
      { status: 400 }
    );
  }

  // Create review record
  const reviewId = crypto.randomUUID();
  db.insert(reviews)
    .values({ id: reviewId, planId, type, status: "in_progress" })
    .run();

  try {
    const result = await generateReview({
      type,
      planName: plan.name,
      items: itemsToReview,
      provider,
      model,
    });

    // Update review with summary
    const finalStatus = result.approved ? "approved" : "changes_requested";
    db.update(reviews)
      .set({
        status: finalStatus,
        content: result.summary,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(reviews.id, reviewId))
      .run();

    // Insert review items
    for (const item of result.items) {
      db.insert(reviewItems)
        .values({
          id: crypto.randomUUID(),
          reviewId,
          targetType: type === "scheme" ? "scheme" : "schedule_item",
          targetId: item.targetId,
          title: item.title,
          content: item.content,
          severity: item.severity,
          resolved: false,
        })
        .run();
    }

    // Update plan status for implementation review
    if (type === "implementation" && result.approved) {
      db.update(plans)
        .set({ status: "testing", updatedAt: new Date().toISOString() })
        .where(eq(plans.id, planId))
        .run();
    }

    const review = db
      .select()
      .from(reviews)
      .where(eq(reviews.id, reviewId))
      .get();
    const items = db
      .select()
      .from(reviewItems)
      .where(eq(reviewItems.reviewId, reviewId))
      .all();

    return NextResponse.json({ ...review, items }, { status: 201 });
  } catch (err) {
    db.update(reviews)
      .set({
        status: "changes_requested",
        content: `Review failed: ${err}`,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(reviews.id, reviewId))
      .run();

    return NextResponse.json(
      { error: `Review generation failed: ${err}` },
      { status: 500 }
    );
  }
}
