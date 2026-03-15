import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { plans, schemes, testSuites, testCases, projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateTests } from "@/lib/ai/test-generator";
import type { Provider } from "@/lib/ai/provider";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { planId, provider, model } = body as {
    planId: string;
    provider: Provider;
    model?: string;
  };

  if (!planId || !provider) {
    return NextResponse.json(
      { error: "planId and provider are required" },
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
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const schemeList = db
    .select()
    .from(schemes)
    .where(eq(schemes.planId, planId))
    .all();

  // Update suite status
  let suite = db
    .select()
    .from(testSuites)
    .where(eq(testSuites.planId, planId))
    .get();

  if (!suite) {
    const suiteId = crypto.randomUUID();
    db.insert(testSuites)
      .values({ id: suiteId, planId, status: "generating" })
      .run();
    suite = db
      .select()
      .from(testSuites)
      .where(eq(testSuites.id, suiteId))
      .get()!;
  } else {
    db.update(testSuites)
      .set({ status: "generating", updatedAt: new Date().toISOString() })
      .where(eq(testSuites.id, suite.id))
      .run();
  }

  try {
    const generatedCases = await generateTests({
      planName: plan.name,
      schemes: schemeList.map((s) => ({
        title: s.title,
        content: s.content || "",
      })),
      targetRepoPath: project.targetRepoPath,
      provider,
      model,
    });

    // Delete existing cases
    db.delete(testCases)
      .where(eq(testCases.testSuiteId, suite.id))
      .run();

    // Insert generated cases
    for (const tc of generatedCases) {
      db.insert(testCases)
        .values({
          id: crypto.randomUUID(),
          testSuiteId: suite.id,
          name: tc.name,
          description: tc.description,
          type: tc.type,
          generatedCode: tc.generatedCode,
          filePath: tc.filePath,
          status: "pending",
        })
        .run();
    }

    db.update(testSuites)
      .set({ status: "pending", updatedAt: new Date().toISOString() })
      .where(eq(testSuites.id, suite.id))
      .run();

    // Transition plan to testing if needed
    if (plan.status === "executing") {
      db.update(plans)
        .set({ status: "testing", updatedAt: new Date().toISOString() })
        .where(eq(plans.id, planId))
        .run();
    }

    const cases = db
      .select()
      .from(testCases)
      .where(eq(testCases.testSuiteId, suite.id))
      .all();

    return NextResponse.json({ ...suite, cases }, { status: 201 });
  } catch (err) {
    db.update(testSuites)
      .set({ status: "failed", updatedAt: new Date().toISOString() })
      .where(eq(testSuites.id, suite.id))
      .run();

    return NextResponse.json(
      { error: `Failed to generate tests: ${err}` },
      { status: 500 }
    );
  }
}
