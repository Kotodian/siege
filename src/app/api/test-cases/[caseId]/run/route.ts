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
import { execSync } from "child_process";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { getStepModel } from "@/lib/ai/config";
import fs from "fs";
import path from "path";

function createTestTools(repoPath: string) {
  return {
    readFile: tool({
      description: "Read a file within the project",
      inputSchema: z.object({
        relativePath: z.string().describe("Relative path from project root"),
      }),
      execute: async ({ relativePath }) => {
        const targetPath = path.resolve(repoPath, relativePath);
        if (!targetPath.startsWith(repoPath)) return "Access denied";
        try {
          return fs.readFileSync(targetPath, "utf-8").slice(0, 10000);
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : e}`;
        }
      },
    }),
    writeFile: tool({
      description: "Write content to a file within the project",
      inputSchema: z.object({
        relativePath: z.string().describe("Relative path from project root"),
        content: z.string().describe("File content"),
      }),
      execute: async ({ relativePath, content }) => {
        const targetPath = path.resolve(repoPath, relativePath);
        if (!targetPath.startsWith(repoPath)) return "Access denied";
        try {
          const dir = path.dirname(targetPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(targetPath, content, "utf-8");
          return `Written to ${relativePath}`;
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : e}`;
        }
      },
    }),
    bash: tool({
      description: "Run a shell command in the project directory",
      inputSchema: z.object({
        command: z.string().describe("Shell command to execute"),
      }),
      execute: async ({ command }) => {
        try {
          const output = execSync(command, {
            cwd: repoPath,
            encoding: "utf-8",
            timeout: 60000,
            maxBuffer: 1024 * 512,
          });
          return output.slice(0, 8000) || "(no output)";
        } catch (e: unknown) {
          const err = e as { stdout?: string; stderr?: string; message?: string };
          return ((err.stdout || "") + (err.stderr || "")).slice(0, 8000) || `Error: ${err.message || e}`;
        }
      },
    }),
  };
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId } = await params;
  const db = getDb();

  const testCase = db.select().from(testCases).where(eq(testCases.id, caseId)).get();
  if (!testCase) return NextResponse.json({ error: "Test case not found" }, { status: 404 });

  const suite = db.select().from(testSuites).where(eq(testSuites.id, testCase.testSuiteId)).get();
  if (!suite) return NextResponse.json({ error: "Test suite not found" }, { status: 404 });

  const plan = db.select().from(plans).where(eq(plans.id, suite.planId)).get();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const project = db.select().from(projects).where(eq(projects.id, plan.projectId)).get();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  db.update(testCases).set({ status: "running" }).where(eq(testCases.id, caseId)).run();

  const prompt = `Run the following test and report the results.

Test file: ${testCase.filePath || "auto-detect"}
Test name: ${testCase.name}

Test code:
\`\`\`
${testCase.generatedCode || ""}
\`\`\`

If the test file doesn't exist, create it first, then run it. Report pass/fail status.`;

  const startTime = Date.now();
  const repoPath = fs.existsSync(project.targetRepoPath) ? project.targetRepoPath : process.cwd();

  let configuredModel;
  try {
    configuredModel = getStepModel("test");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.update(testCases).set({ status: "failed" }).where(eq(testCases.id, caseId)).run();
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  try {
    const tools = createTestTools(repoPath);

    const result = await generateText({
      model: configuredModel,
      prompt,
      tools,
      stopWhen: stepCountIs(10),
    });

    const durationMs = Date.now() - startTime;
    // Collect both text output and tool call results (bash/readFile/writeFile)
    let output = result.text || "";
    for (const step of result.steps || []) {
      for (const tr of step.toolResults || []) {
        const val = (tr as { output?: unknown }).output;
        if (val && typeof val === "string" && val.length > 0) {
          output += (output ? "\n\n" : "") + `[${tr.toolName}] ${val}`;
        }
      }
    }
    if (!output) output = "No output";
    // Detect pass/fail: look for definitive signals, not just word presence
    const hasTestFailure = /(\d+)\s*fail/i.test(output) && !/0\s*fail/i.test(output);
    const hasError = /error\[E/i.test(output) || /FAILED/i.test(output) || /panicked/i.test(output);
    const hasPass = /pass/i.test(output) || /\bok\b/i.test(output) || /succeeded/i.test(output);
    const passed = hasPass && !hasTestFailure && !hasError;
    const status = passed ? "passed" : "failed";

    const resultId = crypto.randomUUID();
    db.insert(testResults).values({
      id: resultId, testCaseId: caseId, status,
      output: output || "No output",
      errorMessage: !passed ? (output || "Test failed — no output from AI") : null,
      durationMs,
    }).run();

    db.update(testCases).set({ status }).where(eq(testCases.id, caseId)).run();

    return NextResponse.json(
      db.select().from(testResults).where(eq(testResults.id, resultId)).get()
    );
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const resultId = crypto.randomUUID();
    db.insert(testResults).values({
      id: resultId, testCaseId: caseId, status: "error",
      output: "", errorMessage: `Error: ${err instanceof Error ? err.message : err}`, durationMs,
    }).run();

    db.update(testCases).set({ status: "failed" }).where(eq(testCases.id, caseId)).run();

    return NextResponse.json(
      db.select().from(testResults).where(eq(testResults.id, resultId)).get()
    );
  }
}
