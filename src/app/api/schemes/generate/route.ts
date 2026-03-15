import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { plans, projects, schemes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateSchemeStream } from "@/lib/ai/scheme-generator";
import { hasApiKey } from "@/lib/ai/config";
import { generateViaCli } from "@/lib/ai/cli-fallback";
import type { Provider } from "@/lib/ai/provider";
import { parseJsonBody } from "@/lib/utils";

function buildSchemePrompt(
  planName: string,
  planDescription: string,
  projectName: string,
  targetRepoPath: string
): string {
  return `You are a senior software architect. Generate a detailed technical scheme for this plan.

Project: ${projectName}
Repository: ${targetRepoPath}
Plan: ${planName}
Description: ${planDescription || "No description provided."}

Output in Markdown with sections:
- ## Overview
- ## Technical Details
- ## Key Decisions
- ## Risks & Mitigations
- ## Estimated Effort

Be specific, actionable, and practical.`;
}

export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;
  const { planId, provider, model } = body as {
    planId: string;
    provider: Provider;
    model?: string;
  };

  if (!planId) {
    return NextResponse.json(
      { error: "planId is required" },
      { status: 400 }
    );
  }

  const db = getDb();
  const plan = db.select().from(plans).where(eq(plans.id, planId)).get();
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, plan.projectId))
    .get();
  if (!project) {
    return NextResponse.json(
      { error: "Project not found" },
      { status: 404 }
    );
  }

  const useCliMode = !hasApiKey(provider || "anthropic");

  if (useCliMode) {
    // Fallback: use claude CLI (leverages claude login)
    const prompt = buildSchemePrompt(
      plan.name,
      plan.description || "",
      project.name,
      project.targetRepoPath
    );

    const stream = generateViaCli(prompt);

    // Tee the stream: one for response, one for collecting full text
    const [responseStream, collectStream] = stream.tee();

    // Collect full text in background and save to DB
    (async () => {
      const reader = collectStream.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
      }

      if (fullText.trim()) {
        const id = crypto.randomUUID();
        db.insert(schemes)
          .values({
            id,
            planId,
            title: "Generated Scheme",
            content: fullText.trim(),
            sourceType: "web_search",
          })
          .run();

        if (plan.status === "draft") {
          db.update(plans)
            .set({ status: "reviewing", updatedAt: new Date().toISOString() })
            .where(eq(plans.id, planId))
            .run();
        }
      }
    })().catch((err) => {
      console.error(`[scheme-generate] CLI fallback save failed:`, err);
    });

    return new Response(responseStream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // SDK mode: has API key
  const result = generateSchemeStream({
    planName: plan.name,
    planDescription: plan.description || "",
    projectName: project.name,
    targetRepoPath: project.targetRepoPath,
    provider: provider || "anthropic",
    model,
  });

  const response = result.toTextStreamResponse();

  Promise.resolve(result.text)
    .then((fullText) => {
      const id = crypto.randomUUID();
      db.insert(schemes)
        .values({
          id,
          planId,
          title: "Generated Scheme",
          content: fullText,
          sourceType: "web_search",
        })
        .run();

      if (plan.status === "draft") {
        db.update(plans)
          .set({ status: "reviewing", updatedAt: new Date().toISOString() })
          .where(eq(plans.id, planId))
          .run();
      }
    })
    .catch((err) => {
      console.error(
        `[scheme-generate] SDK save failed for plan ${planId}:`,
        err
      );
    });

  return response;
}
