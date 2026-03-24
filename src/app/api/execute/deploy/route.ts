import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { resolveStepConfig, getStepModel, withLocale } from "@/lib/ai/config";
import { AcpClient } from "@/lib/acp/client";
import { parseJsonBody } from "@/lib/utils";
import fs from "fs";
import path from "path";

/**
 * POST /api/execute/deploy
 * Execute a deploy instruction via AI agent.
 * Streams output back for progress display.
 */
export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;
  const { repoPath, instruction, provider, model, locale } = body as {
    repoPath: string;
    instruction: string;
    provider?: string;
    model?: string;
    locale?: string;
  };

  if (!repoPath || !instruction) {
    return NextResponse.json({ error: "repoPath and instruction required" }, { status: 400 });
  }

  if (!fs.existsSync(repoPath)) {
    return NextResponse.json({ error: "Repo not found" }, { status: 400 });
  }

  const resolved = resolveStepConfig("execute", provider, model);
  const encoder = new TextEncoder();

  const prompt = `You are a deployment assistant working in: ${repoPath}

Execute the following deployment task:
${instruction}

Use the available tools to run commands, read/write files as needed. Report progress as you go.`;

  // ACP engine
  if (resolved.provider === "acp" || resolved.provider === "codex-acp" || resolved.provider === "copilot-acp") {
    const responseStream = new ReadableStream({
      async start(controller) {
        const acpClient = new AcpClient(repoPath, resolved.provider === "codex-acp" ? "codex" : resolved.provider === "copilot-acp" ? "copilot" : "claude");
        try {
          await acpClient.start();
          const session = await acpClient.createSession(resolved.model);
          controller.enqueue(encoder.encode(`Session: ${session.sessionId}\n\n`));

          await acpClient.prompt(session.sessionId, withLocale(prompt, locale), (type, text) => {
            if (type === "text" || type === "tool") {
              controller.enqueue(encoder.encode(text));
            } else if (type === "plan") {
              controller.enqueue(encoder.encode(`\nPlan:\n${text}\n\n`));
            }
          });

          controller.enqueue(encoder.encode("\n\n---\nDeploy complete."));
          controller.close();
        } catch (err) {
          controller.enqueue(encoder.encode(`\nError: ${err instanceof Error ? err.message : err}`));
          controller.close();
        } finally {
          try { await acpClient.stop(); } catch {}
        }
      },
    });

    return new Response(responseStream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // SDK fallback
  let configuredModel;
  try {
    configuredModel = getStepModel("execute", provider, model);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 503 });
  }

  const tools = {
    bash: tool({
      description: "Run a shell command",
      inputSchema: z.object({ command: z.string() }),
      execute: async ({ command }) => {
        try {
          return execSync(command, { cwd: repoPath, encoding: "utf-8", timeout: 120000, maxBuffer: 1024 * 512 }).slice(0, 8000) || "(no output)";
        } catch (e: unknown) {
          const err = e as { stdout?: string; stderr?: string; message?: string };
          return ((err.stdout || "") + (err.stderr || "")).slice(0, 8000) || `Error: ${err.message}`;
        }
      },
    }),
    readFile: tool({
      description: "Read a file",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path: p }) => {
        const abs = path.resolve(repoPath, p);
        if (!abs.startsWith(repoPath)) return "Access denied: path outside project";
        try { return fs.readFileSync(abs, "utf-8").slice(0, 10000); } catch (e) { return `Error: ${e}`; }
      },
    }),
    writeFile: tool({
      description: "Write a file",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path: p, content }) => {
        const abs = path.resolve(repoPath, p);
        if (!abs.startsWith(repoPath)) return "Access denied: path outside project";
        try {
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, content); return "OK";
        } catch (e) { return `Error: ${e}`; }
      },
    }),
  };

  const responseStream = new ReadableStream({
    async start(controller) {
      try {
        const result = streamText({ model: configuredModel, prompt, tools, stopWhen: stepCountIs(20) });
        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            controller.enqueue(encoder.encode(part.text));
          } else if (part.type === "tool-call") {
            controller.enqueue(encoder.encode(`\n> **${part.toolName}**(${JSON.stringify(part.input).slice(0, 200)})\n`));
          } else if (part.type === "tool-result") {
            const out = typeof part.output === "string" ? part.output : JSON.stringify(part.output);
            controller.enqueue(encoder.encode(`\`\`\`\n${out.slice(0, 500)}\n\`\`\`\n`));
          }
        }
        controller.enqueue(encoder.encode("\n\n---\nDeploy complete."));
        controller.close();
      } catch (err) {
        controller.enqueue(encoder.encode(`\nError: ${err instanceof Error ? err.message : err}`));
        controller.close();
      }
    },
  });

  return new Response(responseStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
