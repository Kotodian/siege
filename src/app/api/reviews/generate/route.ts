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
import { generateTextAuto } from "@/lib/ai/generate";
import type { Provider } from "@/lib/ai/provider";
import { parseJsonBody } from "@/lib/utils";

function buildReviewPrompt(
  type: "scheme" | "implementation",
  planName: string,
  items: Array<{ id: string; title: string; content: string }>
) {
  const contextLabel =
    type === "scheme" ? "technical schemes/proposals" : "implemented code changes";
  const itemsSummary = items
    .map((item) => `### ${item.title} (id: ${item.id})\n${item.content}`)
    .join("\n\n");

  return {
    system: `You are a senior software engineer conducting a thorough review of ${contextLabel}.

Review for: completeness, correctness, quality, risks, security.

Output a JSON object with:
- summary: overall review summary as markdown (string)
- items: array of findings, each with targetId (string), title (string), content (string), severity ("info"|"warning"|"critical")
- approved: boolean (false if any critical items)

Output ONLY the JSON object.`,
    prompt: `Plan: ${planName}\n\n${itemsSummary}`,
  };
}

export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;
  const { planId, type, provider, model } = body as {
    planId: string;
    type: "scheme" | "implementation";
    provider: Provider;
    model?: string;
  };

  if (!planId || !type) {
    return NextResponse.json({ error: "planId and type are required" }, { status: 400 });
  }

  const db = getDb();
  const plan = db.select().from(plans).where(eq(plans.id, planId)).get();
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  let itemsToReview: Array<{ id: string; title: string; content: string }>;

  if (type === "scheme") {
    itemsToReview = db
      .select()
      .from(schemes)
      .where(eq(schemes.planId, planId))
      .all()
      .map((s) => ({ id: s.id, title: s.title, content: s.content || "" }));
  } else {
    const schedule = db.select().from(schedules).where(eq(schedules.planId, planId)).get();
    if (!schedule) {
      return NextResponse.json({ error: "No schedule found" }, { status: 400 });
    }
    itemsToReview = db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.scheduleId, schedule.id))
      .all()
      .map((i) => ({
        id: i.id,
        title: i.title,
        content: `${i.description || ""}\n\n### Execution Log\n\`\`\`\n${i.executionLog || "No output"}\n\`\`\``,
      }));
  }

  if (itemsToReview.length === 0) {
    return NextResponse.json({ error: "Nothing to review" }, { status: 400 });
  }

  // Create review record immediately
  const reviewId = crypto.randomUUID();
  db.insert(reviews)
    .values({ id: reviewId, planId, type, status: "in_progress" })
    .run();

  // Start async generation — don't await, return immediately
  const { system, prompt } = buildReviewPrompt(type, plan.name, itemsToReview);

  generateTextAuto({ provider: provider || "anthropic", model, system, prompt })
    .then((text) => {
      const jsonStr = text.startsWith("{") ? text : text.match(/\{[\s\S]*\}/)?.[0];
      let parsed: any = null;
      try {
        if (jsonStr) parsed = JSON.parse(jsonStr);
      } catch {}

      if (parsed) {
        const finalStatus = parsed.approved ? "approved" : "changes_requested";
        db.update(reviews)
          .set({ status: finalStatus, content: parsed.summary, updatedAt: new Date().toISOString() })
          .where(eq(reviews.id, reviewId))
          .run();

        for (const item of parsed.items || []) {
          db.insert(reviewItems)
            .values({
              id: crypto.randomUUID(),
              reviewId,
              targetType: type === "scheme" ? "scheme" : "schedule_item",
              targetId: item.targetId || "",
              title: item.title || "Finding",
              content: item.content || "",
              severity: item.severity || "info",
              resolved: false,
            })
            .run();
        }

        if (type === "implementation" && parsed.approved) {
          db.update(plans)
            .set({ status: "testing", updatedAt: new Date().toISOString() })
            .where(eq(plans.id, planId))
            .run();
        }
      } else {
        db.update(reviews)
          .set({ status: "changes_requested", content: text.trim() || "Review completed.", updatedAt: new Date().toISOString() })
          .where(eq(reviews.id, reviewId))
          .run();
      }
    })
    .catch((err) => {
      console.error("[review-generate] failed:", err);
      db.update(reviews)
        .set({ status: "changes_requested", content: `Review failed: ${err}`, updatedAt: new Date().toISOString() })
        .where(eq(reviews.id, reviewId))
        .run();
    });

  // Return immediately with the review ID — frontend will poll
  return NextResponse.json({ id: reviewId, status: "in_progress" }, { status: 202 });
}
