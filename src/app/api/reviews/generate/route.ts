import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  plans,
  schemes,
  scheduleItems,
  schedules,
  reviews,
  reviewItems,
  projects,
  appSettings,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getConfiguredModel } from "@/lib/ai/config";
import { streamText } from "ai";
import type { Provider } from "@/lib/ai/provider";
import { parseJsonBody } from "@/lib/utils";
import { execSync } from "child_process";
import fs from "fs";

function getGitUnifiedDiff(repoPath: string): string {
  try {
    // Get unified diff of all changes vs HEAD (staged + unstaged)
    const diff = execSync("git diff HEAD", {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });

    // Also include untracked files as diffs
    const untracked = execSync("git ls-files --others --exclude-standard", {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    let untrackedDiff = "";
    if (untracked) {
      for (const filePath of untracked.split("\n")) {
        if (!filePath) continue;
        try {
          const content = fs.readFileSync(`${repoPath}/${filePath}`, "utf-8");
          const lines = content.split("\n").map((l) => `+${l}`).join("\n");
          untrackedDiff += `\n--- /dev/null\n+++ b/${filePath}\n${lines}\n`;
        } catch { /* skip */ }
      }
    }

    return (diff + untrackedDiff).slice(0, 50000); // cap for prompt size
  } catch {
    return "";
  }
}

function buildReviewPrompt(
  type: "scheme" | "implementation",
  planName: string,
  items: Array<{ id: string; title: string; content: string }>
) {
  const itemsSummary = items
    .map((item) => `### ${item.title} (id: ${item.id})\n${item.content}`)
    .join("\n\n");

  const itemsSchema =
    type === "implementation"
      ? `- items: array of findings, each with targetId (string), title (string), content (string), severity ("info"|"warning"|"critical"), filePath (string, path of the file this finding relates to), lineNumber (number, the line in the new version of the file)`
      : `- items: array of findings, each with targetId (string), title (string), content (string), severity ("info"|"warning"|"critical")`;

  return {
    system: `You are a code review engine. Output JSON only. No conversation.

CRITICAL: Do NOT ask questions, request access, or use tools. Review based solely on the content provided.

Review for: completeness, correctness, quality, risks, security.

Output a JSON object with:
- summary: overall review summary as markdown (string)
${itemsSchema}
- approved: boolean (false if any critical items)

Output ONLY the JSON object. No other text before or after.`,
    prompt: `Plan: ${planName}\n\n${itemsSummary}`,
  };
}

export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;
  const { planId, type, provider: rawProvider, model } = body as {
    planId: string;
    type: "scheme" | "implementation";
    provider?: string;
    model?: string;
  };

  if (!planId || !type) {
    return NextResponse.json({ error: "planId and type are required" }, { status: 400 });
  }

  const db = getDb();
  const provider = rawProvider || db.select().from(appSettings).where(eq(appSettings.key, "default_provider")).get()?.value || "anthropic";
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

    const project = db.select().from(projects).where(eq(projects.id, plan.projectId)).get();
    const repoPath = project?.targetRepoPath;

    // Get git diff from the target repo
    let gitDiff = "";
    if (repoPath && fs.existsSync(repoPath)) {
      gitDiff = getGitUnifiedDiff(repoPath);
    }

    const allScheduleItems = db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.scheduleId, schedule.id))
      .all();

    if (gitDiff) {
      // Use git diff as the review content — associate with first schedule item as targetId
      const firstItemId = allScheduleItems[0]?.id || "";
      itemsToReview = [{
        id: firstItemId,
        title: "Code Changes (git diff)",
        content: `### Git Diff\n\`\`\`diff\n${gitDiff}\n\`\`\``,
      }];
    } else {
      // Fallback: use execution logs
      itemsToReview = allScheduleItems.map((i) => ({
        id: i.id,
        title: i.title,
        content: `${i.description || ""}\n\n### Execution Log\n\`\`\`\n${i.executionLog || "No output"}\n\`\`\``,
      }));
    }
  }

  if (itemsToReview.length === 0) {
    return NextResponse.json({ error: "Nothing to review" }, { status: 400 });
  }

  // Create review record immediately
  const reviewId = crypto.randomUUID();
  db.insert(reviews)
    .values({ id: reviewId, planId, type, status: "in_progress" })
    .run();

  const { system, prompt } = buildReviewPrompt(type, plan.name, itemsToReview);
  const aiModel = getConfiguredModel((provider !== "acp" && provider !== "codex-acp" ? provider : undefined) as Provider | undefined, model);

  const result = streamText({ model: aiModel, system, prompt });

  const textStream = result.textStream;
  const encoder = new TextEncoder();
  let fullText = "";

  const responseStream = new ReadableStream({
    async start(controller) {
      for await (const chunk of textStream) {
        fullText += chunk;
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();

      // Parse and save review
      try {
        const jsonStr = fullText.startsWith("{") ? fullText : fullText.match(/\{[\s\S]*\}/)?.[0];
        let parsed: any = null;
        try { if (jsonStr) parsed = JSON.parse(jsonStr); } catch {}

        const db = getDb();
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
                filePath: item.filePath || null,
                lineNumber: item.lineNumber || null,
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
            .set({ status: "changes_requested", content: fullText.trim() || "Review completed.", updatedAt: new Date().toISOString() })
            .where(eq(reviews.id, reviewId))
            .run();
        }
      } catch (err) {
        console.error("[review-generate] save failed:", err);
      }
    },
  });

  return new Response(responseStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
