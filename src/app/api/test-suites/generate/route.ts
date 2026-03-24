import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { plans, schedules, scheduleItems, fileSnapshots, testSuites, testCases, projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateTests } from "@/lib/ai/test-generator";
import { resolveStepConfig, withLocale } from "@/lib/ai/config";
import { AcpClient } from "@/lib/acp/client";
import type { Provider } from "@/lib/ai/provider";
import fs from "fs";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { planId, provider, model, scheduleItemIds, locale } = body as {
    planId: string;
    provider?: string;
    model?: string;
    scheduleItemIds?: string[];
    locale?: string;
  };

  if (!planId) {
    return NextResponse.json({ error: "planId is required" }, { status: 400 });
  }

  const db = getDb();
  const plan = db.select().from(plans).where(eq(plans.id, planId)).get();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const project = db.select().from(projects).where(eq(projects.id, plan.projectId)).get();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Get completed schedule items
  const schedule = db.select().from(schedules).where(eq(schedules.planId, planId)).get();
  if (!schedule) return NextResponse.json({ error: "No schedule found" }, { status: 400 });

  let completedItems = db.select().from(scheduleItems)
    .where(eq(scheduleItems.scheduleId, schedule.id))
    .all()
    .filter(i => i.status === "completed")
    .sort((a, b) => a.order - b.order);

  // Filter to selected items if provided
  if (scheduleItemIds && scheduleItemIds.length > 0) {
    const idSet = new Set(scheduleItemIds);
    completedItems = completedItems.filter(i => idSet.has(i.id));
  }

  if (completedItems.length === 0) {
    return NextResponse.json({ error: "No completed tasks to test" }, { status: 400 });
  }

  // Build task contexts from file snapshots
  const tasks = completedItems.map((item) => {
    const snaps = db.select().from(fileSnapshots)
      .where(eq(fileSnapshots.scheduleItemId, item.id))
      .all();
    // Deduplicate by filePath
    const fileMap = new Map<string, { filePath: string; contentAfter: string }>();
    for (const snap of snaps) {
      fileMap.set(snap.filePath, { filePath: snap.filePath, contentAfter: snap.contentAfter || "" });
    }
    return {
      scheduleItemId: item.id,
      order: item.order,
      title: item.title,
      description: item.description || "",
      files: Array.from(fileMap.values()),
    };
  });

  // Create or update suite
  let suite = db.select().from(testSuites).where(eq(testSuites.planId, planId)).get();
  if (!suite) {
    const suiteId = crypto.randomUUID();
    db.insert(testSuites).values({ id: suiteId, planId, status: "generating" }).run();
    suite = db.select().from(testSuites).where(eq(testSuites.id, suiteId)).get()!;
  } else {
    db.update(testSuites)
      .set({ status: "generating", updatedAt: new Date().toISOString() })
      .where(eq(testSuites.id, suite.id))
      .run();
  }

  try {
    const resolved = resolveStepConfig("test", provider, model);
    let generatedCases;

    if (resolved.provider === "acp" || resolved.provider === "codex-acp" || resolved.provider === "copilot-acp") {
      // ACP: let agent inspect code and generate tests directly
      const cwd = fs.existsSync(project.targetRepoPath) ? project.targetRepoPath : process.cwd();
      const acpClient = new AcpClient(cwd, resolved.provider === "codex-acp" ? "codex" : resolved.provider === "copilot-acp" ? "copilot" : "claude");
      try {
        await acpClient.start();
        const session = await acpClient.createSession(resolved.model);
        if (resolved.model) await acpClient.setModel(session.sessionId, resolved.model);

        const zh = locale ? locale === "zh" : /[\u4e00-\u9fff]/.test(plan.name);
        const taskList = tasks.map(t => `- #${t.order} ${t.title} (id: "${t.scheduleItemId}")`).join("\n");
        const acpPrompt = `You are a test engineer. Generate test cases for recently implemented code changes.

Plan: ${plan.name}
Tasks:
${taskList}

Steps:
1. Run \`git log --oneline -10\` to see recent commits
2. Read the changed files to understand what was implemented
3. Generate 2-4 test cases per task

Output a JSON array. Each object: scheduleItemId (must match task id), name, description, type ("unit"|"integration"|"e2e"), generatedCode (full test code), filePath.
Output ONLY the JSON array.${zh ? " 用中文写描述。" : ""}`;

        let fullText = "";
        await acpClient.prompt(session.sessionId, withLocale(acpPrompt, locale), (t, text) => {
          if (t === "text") fullText += text;
        });

        const jsonStr = fullText.startsWith("[") ? fullText : fullText.match(/\[[\s\S]*\]/)?.[0];
        if (!jsonStr) throw new Error("ACP agent did not return JSON test cases");
        generatedCases = JSON.parse(jsonStr);
      } finally {
        await acpClient.stop();
      }
    } else {
      generatedCases = await generateTests({
        planName: plan.name,
        tasks,
        targetRepoPath: project.targetRepoPath,
        provider: resolved.provider as Provider,
        model: resolved.model,
      });
    }

    // Delete old cases for the selected tasks only (keep other tasks' tests)
    if (scheduleItemIds && scheduleItemIds.length > 0) {
      for (const itemId of scheduleItemIds) {
        const oldCases = db.select().from(testCases)
          .where(eq(testCases.testSuiteId, suite.id))
          .all()
          .filter(c => c.scheduleItemId === itemId);
        for (const c of oldCases) {
          db.delete(testCases).where(eq(testCases.id, c.id)).run();
        }
      }
    } else {
      db.delete(testCases).where(eq(testCases.testSuiteId, suite.id)).run();
    }

    // Insert generated cases
    for (const tc of generatedCases) {
      db.insert(testCases).values({
        id: crypto.randomUUID(),
        testSuiteId: suite.id,
        scheduleItemId: tc.scheduleItemId || null,
        name: tc.name,
        description: tc.description,
        type: tc.type,
        generatedCode: tc.generatedCode,
        filePath: tc.filePath,
        status: "pending",
      }).run();
    }

    db.update(testSuites)
      .set({ status: "pending", updatedAt: new Date().toISOString() })
      .where(eq(testSuites.id, suite.id))
      .run();

    if (plan.status === "executing" || plan.status === "code_review") {
      db.update(plans)
        .set({ status: "testing", updatedAt: new Date().toISOString() })
        .where(eq(plans.id, planId))
        .run();
    }

    const cases = db.select().from(testCases).where(eq(testCases.testSuiteId, suite.id)).all();
    return NextResponse.json({ ...suite, cases }, { status: 201 });
  } catch (err) {
    db.update(testSuites)
      .set({ status: "failed", updatedAt: new Date().toISOString() })
      .where(eq(testSuites.id, suite.id))
      .run();
    return NextResponse.json({ error: `Failed: ${err}` }, { status: 500 });
  }
}
