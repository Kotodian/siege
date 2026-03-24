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
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { getStepModel, resolveStepConfig } from "@/lib/ai/config";
import { AcpClient } from "@/lib/acp/client";
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

function saveTestResult(
  caseId: string,
  status: "passed" | "failed" | "error",
  output: string,
  durationMs: number,
) {
  const db = getDb();
  const passed = status === "passed";
  const resultId = crypto.randomUUID();
  db.insert(testResults).values({
    id: resultId,
    testCaseId: caseId,
    status,
    output: output || "No output",
    errorMessage: !passed ? (output || "Test failed") : null,
    durationMs,
  }).run();
  const caseStatus = status === "error" ? "failed" : status;
  db.update(testCases).set({ status: caseStatus }).where(eq(testCases.id, caseId)).run();
  return db.select().from(testResults).where(eq(testResults.id, resultId)).get();
}

function detectPassFail(output: string): "passed" | "failed" {
  const hasTestFailure = /(\d+)\s*fail/i.test(output) && !/0\s*fail/i.test(output);
  const hasError = /error\[E/i.test(output) || /FAILED/i.test(output) || /panicked/i.test(output);
  const hasPass = /pass/i.test(output) || /\bok\b/i.test(output) || /succeeded/i.test(output);
  return (hasPass && !hasTestFailure && !hasError) ? "passed" : "failed";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId } = await params;
  const db = getDb();

  const url = new URL(req.url);
  const overrideProvider = url.searchParams.get("provider") || undefined;
  const overrideModel = url.searchParams.get("model") || undefined;

  const testCase = db.select().from(testCases).where(eq(testCases.id, caseId)).get();
  if (!testCase) return NextResponse.json({ error: "Test case not found" }, { status: 404 });

  const suite = db.select().from(testSuites).where(eq(testSuites.id, testCase.testSuiteId)).get();
  if (!suite) return NextResponse.json({ error: "Test suite not found" }, { status: 404 });

  const plan = db.select().from(plans).where(eq(plans.id, suite.planId)).get();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const project = db.select().from(projects).where(eq(projects.id, plan.projectId)).get();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  db.update(testCases).set({ status: "running" }).where(eq(testCases.id, caseId)).run();

  const hasChinese = /[\u4e00-\u9fff]/.test(
    (testCase.description || "") + (testCase.name || "") + (plan.description || plan.name)
  );
  const langHint = hasChinese ? "\n\n请用中文回复。" : "";

  const prompt = `Run the following test and report the results.

Test file: ${testCase.filePath || "auto-detect"}
Test name: ${testCase.name}

Test code:
\`\`\`
${testCase.generatedCode || ""}
\`\`\`

If the test file doesn't exist, create it first, then run it. Report pass/fail status.${langHint}`;

  const startTime = Date.now();
  const repoPath = fs.existsSync(project.targetRepoPath) ? project.targetRepoPath : process.cwd();
  const { provider, model } = resolveStepConfig("test", overrideProvider, overrideModel);
  const isAcp = provider === "acp" || provider === "codex-acp" || provider === "copilot-acp";

  const encoder = new TextEncoder();

  if (isAcp) {
    // ACP path: use AcpClient
    const agentType = provider === "codex-acp" ? "codex" : provider === "copilot-acp" ? "copilot" : "claude";
    const stream = new ReadableStream({
      async start(controller) {
        let fullLog = "";
        const acp = new AcpClient(repoPath, agentType);
        try {
          await acp.start();
          const session = await acp.createSession(model);

          await acp.prompt(session.sessionId, prompt, (type, text) => {
            fullLog += text;
            controller.enqueue(encoder.encode(text));
          });

          await acp.stop();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          fullLog += `\nError: ${msg}`;
          controller.enqueue(encoder.encode(`\nError: ${msg}`));
          try { await acp.stop(); } catch { /* ignore */ }
        }

        const durationMs = Date.now() - startTime;
        const status = detectPassFail(fullLog);
        saveTestResult(caseId, status, fullLog, durationMs);
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // SDK path: streamText
  let configuredModel;
  try {
    configuredModel = getStepModel("test", overrideProvider, overrideModel);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.update(testCases).set({ status: "failed" }).where(eq(testCases.id, caseId)).run();
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  const tools = createTestTools(repoPath);
  const stream = new ReadableStream({
    async start(controller) {
      let fullLog = "";
      try {
        const result = streamText({
          model: configuredModel,
          prompt,
          tools,
          stopWhen: stepCountIs(10),
        });

        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            fullLog += part.text;
            controller.enqueue(encoder.encode(part.text));
          } else if (part.type === "tool-call") {
            const input = "input" in part ? JSON.stringify(part.input).slice(0, 200) : "";
            const msg = `\n> **Tool: ${part.toolName}**(${input})\n`;
            fullLog += msg;
            controller.enqueue(encoder.encode(msg));
          } else if (part.type === "tool-result") {
            const raw = "output" in part ? part.output : "result" in part ? (part as Record<string, unknown>).result : "";
            const output = typeof raw === "string" ? raw : JSON.stringify(raw);
            const truncated = output.length > 500 ? output.slice(0, 500) + "..." : output;
            const msg = `\`\`\`\n${truncated}\n\`\`\`\n`;
            fullLog += msg;
            controller.enqueue(encoder.encode(msg));
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fullLog += `\nError: ${msg}`;
        controller.enqueue(encoder.encode(`\nError: ${msg}`));
      }

      const durationMs = Date.now() - startTime;
      const status = detectPassFail(fullLog);
      saveTestResult(caseId, status, fullLog, durationMs);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
