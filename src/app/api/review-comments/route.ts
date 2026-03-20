import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { reviewComments, reviews, plans, projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { parseJsonBody } from "@/lib/utils";
import { getStepModel } from "@/lib/ai/config";
import { generateText } from "ai";
import fs from "fs";
import path from "path";

export async function GET(req: NextRequest) {
  const reviewId = req.nextUrl.searchParams.get("reviewId");

  if (!reviewId) {
    return NextResponse.json(
      { error: "reviewId is required" },
      { status: 400 }
    );
  }

  const db = getDb();
  const comments = db
    .select()
    .from(reviewComments)
    .where(eq(reviewComments.reviewId, reviewId))
    .all();

  return NextResponse.json(comments);
}

export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;

  const { reviewId, filePath, lineNumber, content, provider, model } = body as {
    reviewId: string;
    filePath: string;
    lineNumber: number;
    content: string;
    provider?: string;
    model?: string;
  };

  if (!reviewId || !filePath || lineNumber == null || !content) {
    return NextResponse.json(
      { error: "reviewId, filePath, lineNumber, and content are required" },
      { status: 400 }
    );
  }

  const db = getDb();

  const commentId = crypto.randomUUID();
  db.insert(reviewComments)
    .values({
      id: commentId,
      reviewId,
      filePath,
      lineNumber,
      content,
      status: "pending",
    })
    .run();

  let aiResponse = "";

  try {
    // Load the review to get planId
    const review = db.select().from(reviews).where(eq(reviews.id, reviewId)).get();
    if (!review) throw new Error("Review not found");

    // Load the plan to get projectId
    const plan = db.select().from(plans).where(eq(plans.id, review.planId)).get();
    if (!plan) throw new Error("Plan not found");

    // Load the project to get targetRepoPath
    const project = db.select().from(projects).where(eq(projects.id, plan.projectId)).get();
    if (!project) throw new Error("Project not found");

    // Try to read the file
    const fullPath = path.join(project.targetRepoPath, filePath);
    let fileContent = "";
    try {
      fileContent = fs.readFileSync(fullPath, "utf-8");
    } catch {
      fileContent = "(File could not be read)";
    }

    let aiModel;
    try {
      aiModel = getStepModel("review", provider, model);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 503 });
    }

    const result = await generateText({
      model: aiModel,
      system: `You are a code review assistant. Based on the user's comment about a specific location in the code, suggest a fix or improvement. Output ONLY the suggested code change or explanation. Be concise and actionable.`,
      prompt: `File: ${filePath}\nLine: ${lineNumber}\n\nUser comment: ${content}\n\nFile content:\n\`\`\`\n${fileContent}\n\`\`\`\n\nProvide a suggested fix or response:`,
    });

    aiResponse = result.text || "";

    // Save the AI response to the comment
    db.update(reviewComments)
      .set({ aiResponse })
      .where(eq(reviewComments.id, commentId))
      .run();
  } catch (err) {
    console.error("[review-comments] AI response generation failed:", err);
    // Comment is still saved, just without AI response
  }

  const comment = db
    .select()
    .from(reviewComments)
    .where(eq(reviewComments.id, commentId))
    .get();

  return NextResponse.json(comment, { status: 201 });
}
