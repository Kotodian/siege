import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { plans, projects, schemes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateSchemeStream } from "@/lib/ai/scheme-generator";
import { hasApiKey } from "@/lib/ai/config";
import { generateTextAuto } from "@/lib/ai/generate";
import { getPlanSessionId, savePlanSessionId } from "@/lib/ai/session";
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

function saveScheme(planId: string, content: string, planStatus: string) {
  const db = getDb();
  db.insert(schemes)
    .values({
      id: crypto.randomUUID(),
      planId,
      title: "Generated Scheme",
      content,
      sourceType: "web_search",
    })
    .run();

  if (planStatus === "draft") {
    db.update(plans)
      .set({ status: "reviewing", updatedAt: new Date().toISOString() })
      .where(eq(plans.id, planId))
      .run();
  }
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
    return NextResponse.json({ error: "planId is required" }, { status: 400 });
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
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const prompt = buildSchemePrompt(
    plan.name,
    plan.description || "",
    project.name,
    project.targetRepoPath
  );

  const useCliMode = !hasApiKey(provider || "anthropic");

  const sessionId = getPlanSessionId(planId);

  if (useCliMode) {
    generateTextAuto({
      provider: provider || "anthropic",
      model,
      system: "",
      prompt,
      sessionId,
    })
      .then((result) => {
        if (result.sessionId) savePlanSessionId(planId, result.sessionId);
        if (result.text.trim()) {
          saveScheme(planId, result.text.trim(), plan.status);
        }
      })
      .catch((err) => {
        console.error(`[scheme-generate] CLI failed:`, err);
      });

    return NextResponse.json({ status: "generating" }, { status: 202 });
  }

  // SDK mode: has API key — use streaming
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
      if (fullText.trim()) {
        saveScheme(planId, fullText.trim(), plan.status);
      }
    })
    .catch((err) => {
      console.error(`[scheme-generate] SDK failed:`, err);
    });

  return response;
}
