import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  testCases,
  testResults,
  testSuites,
  plans,
  projects,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { spawn } from "child_process";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId } = await params;
  const db = getDb();

  const testCase = db
    .select()
    .from(testCases)
    .where(eq(testCases.id, caseId))
    .get();
  if (!testCase) {
    return NextResponse.json(
      { error: "Test case not found" },
      { status: 404 }
    );
  }

  const suite = db
    .select()
    .from(testSuites)
    .where(eq(testSuites.id, testCase.testSuiteId))
    .get();
  if (!suite) {
    return NextResponse.json(
      { error: "Test suite not found" },
      { status: 404 }
    );
  }

  const plan = db
    .select()
    .from(plans)
    .where(eq(plans.id, suite.planId))
    .get();
  if (!plan) {
    return NextResponse.json(
      { error: "Plan not found" },
      { status: 404 }
    );
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

  // Update case status
  db.update(testCases)
    .set({ status: "running" })
    .where(eq(testCases.id, caseId))
    .run();

  // Build test command using Claude Code
  const prompt = `Run the following test and report the results.

Test file: ${testCase.filePath || "auto-detect"}
Test name: ${testCase.name}

Test code:
\`\`\`
${testCase.generatedCode || ""}
\`\`\`

If the test file doesn't exist, create it first, then run it. Report pass/fail status.`;

  const startTime = Date.now();

  return new Promise<Response>((resolve) => {
    let output = "";
    let errorOutput = "";

    const proc = spawn("claude", ["-p", prompt, "--output-format", "text"], {
      cwd: project.targetRepoPath,
      env: { ...process.env },
    });

    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });

    proc.on("close", (code) => {
      const durationMs = Date.now() - startTime;
      const status = code === 0 ? "passed" : "failed";

      // Create test result
      const resultId = crypto.randomUUID();
      db.insert(testResults)
        .values({
          id: resultId,
          testCaseId: caseId,
          status,
          output: output || "No output",
          errorMessage: errorOutput || null,
          durationMs,
        })
        .run();

      // Update case status
      db.update(testCases)
        .set({ status })
        .where(eq(testCases.id, caseId))
        .run();

      const result = db
        .select()
        .from(testResults)
        .where(eq(testResults.id, resultId))
        .get();

      resolve(NextResponse.json(result));
    });

    proc.on("error", (err) => {
      const durationMs = Date.now() - startTime;

      const resultId = crypto.randomUUID();
      db.insert(testResults)
        .values({
          id: resultId,
          testCaseId: caseId,
          status: "error",
          output: "",
          errorMessage: `Failed to start: ${err.message}`,
          durationMs,
        })
        .run();

      db.update(testCases)
        .set({ status: "failed" })
        .where(eq(testCases.id, caseId))
        .run();

      const result = db
        .select()
        .from(testResults)
        .where(eq(testResults.id, resultId))
        .get();

      resolve(NextResponse.json(result));
    });
  });
}
