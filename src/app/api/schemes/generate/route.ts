import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { plans, projects, schemes, schemeVersions, reviews, reviewItems } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { execSync } from "child_process";
import { streamText, tool, stepCountIs, generateText } from "ai";
import { z } from "zod";
import { resolveStepConfig, getStepModel } from "@/lib/ai/config";
import { AcpClient } from "@/lib/acp/client";
import { parseJsonBody } from "@/lib/utils";
import { sseEncode } from "@/lib/ai/sse";
import { createSession, removeSession, waitForAnswer, pushQAHistory, getSession } from "@/lib/ai/interactive-session";
import { buildAnalysisPrompt, buildSynthesisPrompt, parseQuestionsFromAIOutput } from "@/lib/ai/interactive-prompt";
import { loadMemoryContext } from "@/lib/ai/memory";
import fs from "fs";
import path from "path";

function cleanSchemeContent(raw: string): string {
  const lines = raw.split("\n");
  const cleaned: string[] = [];
  let foundSchemeStart = false;

  for (const line of lines) {
    // Always skip tool call markers (anywhere in the output)
    if (/^>\s*\*?\*?Tool[:\s]/.test(line)) continue;
    if (/^>\s*\*\*Tool:/.test(line)) continue;
    // Skip empty blockquote lines that follow tool markers
    if (/^>\s*$/.test(line) && !foundSchemeStart) continue;

    if (!foundSchemeStart) {
      if (/^#{1,3}\s/.test(line)) {
        foundSchemeStart = true;
      } else {
        // Skip AI reasoning before scheme starts
        continue;
      }
    }
    cleaned.push(line);
  }

  if (cleaned.length === 0) {
    return "";
  }

  return cleaned.join("\n").trim();
}

function saveScheme(planId: string, rawContent: string, planStatus: string, planName?: string): boolean {
  // Try to parse as structured JSON first
  let structuredJson: string | null = null;
  let markdownContent: string;
  let title: string;

  const trimmed = rawContent.trim();
  let parsed: Record<string, unknown> | null = null;

  // Try parsing JSON directly or extract from fenced block
  try { parsed = JSON.parse(trimmed); } catch { /* not pure JSON */ }
  if (!parsed) {
    const fenced = trimmed.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
    try { parsed = JSON.parse(fenced); } catch { /* not fenced JSON */ }
  }
  if (!parsed) {
    const start = trimmed.indexOf("{");
    if (start >= 0) {
      let depth = 0, end = start;
      for (let i = start; i < trimmed.length; i++) {
        if (trimmed[i] === "{") depth++;
        else if (trimmed[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      try { parsed = JSON.parse(trimmed.slice(start, end)); } catch { /* no valid JSON */ }
    }
  }

  if (parsed && parsed.overview && parsed.architecture) {
    // Valid structured scheme
    structuredJson = JSON.stringify(parsed);
    title = (typeof parsed.overview === "string" ? parsed.overview.slice(0, 80) : null) || planName || "Generated Scheme";
    // Generate markdown fallback from structured content
    markdownContent = structuredToMarkdown(parsed);
  } else {
    // Fallback: treat as markdown
    const cleaned = cleanSchemeContent(rawContent);
    if (!cleaned) return false;
    markdownContent = cleaned;
    const h1Match = cleaned.match(/^#\s+(.+)/m);
    const firstLine = cleaned.split("\n")[0]?.trim();
    title = h1Match?.[1]?.replace(/[*_`~]/g, "").trim()
      || (firstLine && !firstLine.startsWith("##") ? firstLine.slice(0, 80) : null)
      || planName || "Generated Scheme";
  }

  const db = getDb();

  // Delete old scheme reviews + findings
  const oldReviews = db.select().from(reviews)
    .where(and(eq(reviews.planId, planId), eq(reviews.type, "scheme")))
    .all();
  for (const r of oldReviews) {
    db.delete(reviewItems).where(eq(reviewItems.reviewId, r.id)).run();
    db.delete(reviews).where(eq(reviews.id, r.id)).run();
  }

  // Update existing scheme or create new
  const existing = db.select().from(schemes).where(eq(schemes.planId, planId)).all();
  if (existing.length > 0) {
    const old = existing[0];
    const maxVer = db.select().from(schemeVersions)
      .where(eq(schemeVersions.schemeId, old.id))
      .all()
      .reduce((max, v) => Math.max(max, v.version), 0);
    db.insert(schemeVersions).values({
      id: crypto.randomUUID(), schemeId: old.id,
      version: maxVer + 1, title: old.title, content: old.content || "",
    }).run();
    db.update(schemes).set({
      title, content: markdownContent, structuredContent: structuredJson,
      updatedAt: new Date().toISOString(),
    }).where(eq(schemes.id, old.id)).run();
    for (const s of existing.slice(1)) db.delete(schemes).where(eq(schemes.id, s.id)).run();
  } else {
    db.insert(schemes).values({
      id: crypto.randomUUID(), planId, title,
      content: markdownContent, structuredContent: structuredJson,
      sourceType: "local_analysis",
    }).run();
  }

  if (planStatus === "draft") {
    db.update(plans)
      .set({ status: "reviewing", updatedAt: new Date().toISOString() })
      .where(eq(plans.id, planId)).run();
  }
  return true;
}

/** Convert structured JSON to markdown fallback */
function structuredToMarkdown(s: Record<string, unknown>): string {
  const lines: string[] = [];
  const data = s as { overview?: string; architecture?: { components?: Array<{name: string; responsibility: string; dependencies: string[]}>; dataFlow?: string[]; diagram?: string }; interfaces?: Array<{name: string; language?: string; definition: string; description: string}>; decisions?: Array<{question: string; options: string[]; chosen: string; rationale: string}>; risks?: Array<{risk: string; severity: string; mitigation: string}>; effort?: Array<{phase: string; tasks: string[]; hours: number}> };

  lines.push(`## Overview\n\n${data.overview || ""}\n`);

  if (data.architecture) {
    lines.push(`## Architecture\n`);
    if (data.architecture.components?.length) {
      lines.push(`| Component | Responsibility | Dependencies |`);
      lines.push(`|-----------|---------------|--------------|`);
      for (const c of data.architecture.components) {
        lines.push(`| ${c.name} | ${c.responsibility} | ${c.dependencies.join(", ") || "-"} |`);
      }
      lines.push("");
    }
    if (data.architecture.dataFlow?.length) {
      lines.push(`### Data Flow\n`);
      for (const [i, step] of data.architecture.dataFlow.entries()) {
        lines.push(`${i + 1}. ${step}`);
      }
      lines.push("");
    }
    if (data.architecture.diagram) {
      lines.push("```\n" + data.architecture.diagram + "\n```\n");
    }
  }

  if (data.interfaces?.length) {
    lines.push(`## Interfaces\n`);
    for (const iface of data.interfaces) {
      lines.push(`### ${iface.name}\n\n${iface.description}\n`);
      lines.push("```" + (iface.language || "") + "\n" + iface.definition + "\n```\n");
    }
  }

  if (data.decisions?.length) {
    lines.push(`## Decisions\n`);
    lines.push(`| Decision | Options | Chosen | Rationale |`);
    lines.push(`|----------|---------|--------|-----------|`);
    for (const d of data.decisions) {
      lines.push(`| ${d.question} | ${d.options.join("; ")} | **${d.chosen}** | ${d.rationale} |`);
    }
    lines.push("");
  }

  if (data.risks?.length) {
    lines.push(`## Risks\n`);
    for (const r of data.risks) {
      const badge = r.severity === "high" ? "🔴" : r.severity === "medium" ? "🟡" : "🟢";
      lines.push(`- ${badge} **${r.severity.toUpperCase()}**: ${r.risk} → ${r.mitigation}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildPrompt(project: { name: string; targetRepoPath: string; description?: string | null; guidelines?: string | null }, plan: { name: string; description: string | null }, forAcp: boolean, idea?: string, isZh?: boolean) {
  const projectContext = [
    project.description ? `Project description: ${project.description}` : "",
    project.guidelines ? `Project guidelines:\n${project.guidelines}` : "",
  ].filter(Boolean).join("\n\n");

  const hasChinese = isZh ?? /[\u4e00-\u9fff]/.test(plan.description || plan.name);
  const lang = hasChinese ? "用中文输出所有内容。" : "Output all content in English.";

  return `You are a senior software architect. Generate a structured technical scheme as a JSON object.

${lang}

Project: ${project.name}
Plan: ${plan.name}

Description:
${plan.description || "No description provided."}
${idea ? `\nUser's approach / initial ideas:\n${idea}\n` : ""}
${projectContext}

${forAcp
  ? "Steps:\n1. List the project root directory to understand the structure\n2. Read ONLY the 2-3 most relevant files to the plan (not every file)\n3. Generate the scheme JSON based on what you found\n\nIMPORTANT: Do NOT read more than 5 files total."
  : "Steps:\n1. Use the provided tools to briefly explore the project structure\n2. Read only the most relevant source files (max 5 files)\n3. Generate the scheme JSON"}

Output a JSON object with EXACTLY this structure:
{
  "overview": "2-3 sentence summary of what this scheme achieves and why",
  "architecture": {
    "components": [
      {"name": "ComponentName", "responsibility": "What it does", "dependencies": ["OtherComponent"]}
    ],
    "dataFlow": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
    "diagram": "mermaid diagram source code showing component relationships and data flow (REQUIRED, use graph TD or flowchart TD syntax)"
  },
  "interfaces": [
    {"name": "TypeName", "language": "c|typescript|go|etc", "definition": "actual code definition", "description": "what this type represents"}
  ],
  "decisions": [
    {"question": "What design choice was made?", "options": ["Option A", "Option B"], "chosen": "Option A", "rationale": "Why this was chosen"}
  ],
  "risks": [
    {"risk": "Description of risk", "severity": "low|medium|high", "mitigation": "How to mitigate"}
  ]
}

RULES:
- Output ONLY the JSON object, no other text before or after
- "architecture.diagram" is REQUIRED — write a mermaid.js diagram (flowchart TD or graph TD) showing how components connect and data flows between them. Example: "graph TD\\n  A[Client] -->|request| B[Server]\\n  B --> C[Database]"
- "interfaces" should contain REAL code definitions (structs, types, function signatures) — not prose
- "decisions" should have 2-4 concrete options each
- "risks" severity must be "low", "medium", or "high"
- Keep "overview" to 2-3 sentences max
- "architecture.components" should list 3-8 key components
- "architecture.dataFlow" should be 3-8 ordered steps
- Do NOT include "effort" or time estimates`;
}

function createProjectTools(repoPath: string) {
  return {
    listDir: tool({
      description: "List files and directories at a given path within the project",
      inputSchema: z.object({
        relativePath: z.string().describe("Relative path from project root, use '.' for root"),
      }),
      execute: async ({ relativePath }) => {
        const targetPath = path.resolve(repoPath, relativePath);
        if (!targetPath.startsWith(repoPath)) return "Access denied: path outside project";
        try {
          const entries = fs.readdirSync(targetPath, { withFileTypes: true });
          return entries.map(e => `${e.isDirectory() ? "[dir]" : "[file]"} ${e.name}`).join("\n");
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : e}`;
        }
      },
    }),
    readFile: tool({
      description: "Read the contents of a file within the project (max 500 lines)",
      inputSchema: z.object({
        relativePath: z.string().describe("Relative path to the file from project root"),
      }),
      execute: async ({ relativePath }) => {
        const targetPath = path.resolve(repoPath, relativePath);
        if (!targetPath.startsWith(repoPath)) return "Access denied: path outside project";
        try {
          const content = fs.readFileSync(targetPath, "utf-8");
          const lines = content.split("\n");
          if (lines.length > 500) {
            return lines.slice(0, 500).join("\n") + `\n\n... (truncated, ${lines.length} total lines)`;
          }
          return content;
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : e}`;
        }
      },
    }),
    bash: tool({
      description: "Run a shell command within the project directory (for find, grep, wc, etc.)",
      inputSchema: z.object({
        command: z.string().describe("Shell command to execute"),
      }),
      execute: async ({ command }) => {
        try {
          const output = execSync(command, {
            cwd: repoPath,
            encoding: "utf-8",
            timeout: 10000,
            maxBuffer: 1024 * 256,
          });
          return output.slice(0, 5000) || "(no output)";
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : e}`;
        }
      },
    }),
    webSearch: tool({
      description: "Search the web for technical information, libraries, best practices, etc.",
      inputSchema: z.object({
        query: z.string().describe("Search query"),
      }),
      execute: async ({ query }) => {
        try {
          const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; Siege/1.0)" },
          });
          const html = await res.text();
          const results: string[] = [];
          const resultBlocks = html.match(/<div class="result results_links[\s\S]*?<\/div>\s*<\/div>/g) || [];
          for (const block of resultBlocks.slice(0, 5)) {
            const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)<\/a>/);
            const urlMatch = block.match(/uddg=([^&"]+)/);
            const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/[a-z]/);
            const title = titleMatch?.[1]?.trim() || "";
            const link = urlMatch ? decodeURIComponent(urlMatch[1]) : "";
            const snippet = snippetMatch?.[1]?.replace(/<[^>]+>/g, "").trim() || "";
            if (title) results.push(`**${title}**\n${link}\n${snippet}`);
          }
          return results.length > 0 ? results.join("\n\n") : "No results found";
        } catch (e) {
          return `Search error: ${e instanceof Error ? e.message : e}`;
        }
      },
    }),
  };
}

export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;
  const { planId, provider, model, interactive, idea, locale } = body as {
    planId: string; provider?: string; model?: string; interactive?: boolean; idea?: string; locale?: string;
  };

  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 });

  const db = getDb();
  const plan = db.select().from(plans).where(eq(plans.id, planId)).get();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const project = db.select().from(projects).where(eq(projects.id, plan.projectId)).get();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const cwd = fs.existsSync(project.targetRepoPath) ? project.targetRepoPath : process.cwd();
  const encoder = new TextEncoder();
  let fullText = "";

  // Resolve step-specific provider/model for "scheme" step
  const resolved = resolveStepConfig("scheme", provider as string, model);

  // --- Interactive mode: two-phase generation with user Q&A ---
  const isZh = locale ? locale === "zh" : undefined;

  if (interactive) {
    const generationId = crypto.randomUUID();
    const session = createSession(generationId, planId);
    const hasChinese = isZh ?? /[\u4e00-\u9fff]/.test(plan.description || plan.name);

    const isAcpInteractive = resolved.provider === "acp" || resolved.provider === "codex-acp" || resolved.provider === "copilot-acp";
    let sharedAcpClient: AcpClient | null = null;

    const responseStream = new ReadableStream({
      async start(controller) {
        try {
          // Phase 1: Generate questions
          controller.enqueue(sseEncode("text", hasChinese ? "AI 正在分析项目，准备设计决策问题...\n" : "AI analyzing project for design decisions...\n"));

          const analysisPrompt = buildAnalysisPrompt(
            plan.name,
            plan.description || "",
            project.description || "",
            hasChinese,
            idea,
          );

          let analysisText = "";
          let sharedSessionId = "";

          if (isAcpInteractive) {
            sharedAcpClient = new AcpClient(cwd, resolved.provider === "codex-acp" ? "codex" : resolved.provider === "copilot-acp" ? "copilot" : "claude");
            await sharedAcpClient.start();
            const acpSession = await sharedAcpClient.createSession(resolved.model);
            sharedSessionId = acpSession.sessionId;
            await sharedAcpClient.prompt(sharedSessionId, analysisPrompt, (t, text) => {
              if (t === "text") {
                analysisText += text;
                controller.enqueue(sseEncode("text", "."));
              } else if (t === "tool") {
                controller.enqueue(sseEncode("text", text));
              }
            });
          } else {
            // SDK: stream analysis
            let configuredModel;
            try {
              configuredModel = getStepModel("scheme", provider as string, model);
            } catch (err) {
              controller.enqueue(sseEncode("fallback", { reason: err instanceof Error ? err.message : String(err) }));
              controller.enqueue(sseEncode("done", {}));
              controller.close();
              removeSession(generationId);
              return;
            }
            const analysisStream = streamText({ model: configuredModel, prompt: analysisPrompt });
            for await (const part of analysisStream.fullStream) {
              if (part.type === "text-delta") {
                analysisText += part.text;
                if (analysisText.length % 200 < 10) {
                  controller.enqueue(sseEncode("text", "."));
                }
              }
            }
          }
          controller.enqueue(sseEncode("text", "\n"));

          const questions = parseQuestionsFromAIOutput(analysisText);

          if (questions.length === 0) {
            // No questions — fall back to standard generation
            controller.enqueue(sseEncode("fallback", { reason: "no_questions" }));
            controller.enqueue(sseEncode("done", {}));
            controller.close();
            removeSession(generationId);
            return;
          }

          // Send init event with generationId
          controller.enqueue(sseEncode("init", { generationId, questionCount: questions.length }));

          // Phase 2: Ask questions one by one
          for (const q of questions) {
            controller.enqueue(sseEncode("question", {
              id: q.id,
              text: q.text,
              options: q.options,
              default: q.default,
            }));

            // Wait for user answer (polls SQLite)
            let answer: string;
            try {
              answer = await waitForAnswer(generationId, q.id);
            } catch {
              answer = q.default || q.options[0] || "";
            }

            pushQAHistory(generationId, {
              id: q.id,
              question: q.text,
              options: q.options,
              answer,
            });

            controller.enqueue(sseEncode("answer_received", { id: q.id, answer }));
            controller.enqueue(sseEncode("text", hasChinese
              ? `\n> **决策: ${q.text}**\n> 选择: ${answer}\n\n`
              : `\n> **Decision: ${q.text}**\n> Choice: ${answer}\n\n`
            ));
          }

          // Phase 3: Generate scheme with answers
          controller.enqueue(sseEncode("text", hasChinese
            ? "\n---\n\nAI 正在根据你的决策生成方案...\n\n"
            : "\n---\n\nGenerating scheme based on your decisions...\n\n"
          ));

          // Get existing schemes for context
          const existingSchemes = db.select().from(schemes).where(eq(schemes.planId, planId)).all();
          const schemeSummary = existingSchemes.map(s => `### ${s.title}\n${s.content || ""}`).join("\n\n");

          const synthesisPrompt = buildSynthesisPrompt(
            plan.name,
            plan.description || "",
            project.description || "",
            schemeSummary,
            getSession(generationId)?.qaHistory || [],
            hasChinese,
            idea,
          );

          let schemeText = "";

          if (isAcpInteractive && sharedAcpClient) {
            await sharedAcpClient.prompt(sharedSessionId, synthesisPrompt, (t, text) => {
              if (t === "text") {
                schemeText += text;
                controller.enqueue(sseEncode("text", text));
              } else if (t === "tool") {
                controller.enqueue(sseEncode("text", text));
              }
            });
          } else {
            const configuredModel = getStepModel("scheme", provider as string, model);
            const synthResult = streamText({ model: configuredModel, prompt: synthesisPrompt });
            for await (const part of synthResult.fullStream) {
              if (part.type === "text-delta") {
                schemeText += part.text;
                controller.enqueue(sseEncode("text", part.text));
              }
            }
          }

          // Save scheme
          if (schemeText.trim()) {
            saveScheme(planId, schemeText.trim(), plan.status, plan.name);
          }

          controller.enqueue(sseEncode("done", {}));
          controller.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          controller.enqueue(sseEncode("text", `\nError: ${msg}`));
          controller.enqueue(sseEncode("done", {}));
          controller.close();
        } finally {
          removeSession(generationId);
          if (sharedAcpClient) {
            try { await sharedAcpClient.stop(); } catch {}
          }
        }
      },
    });

    return new Response(responseStream, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" },
    });
  }

  // --- Standard (non-interactive) mode ---
  const memCtx = loadMemoryContext(project.id);
  const isAcp = resolved.provider === "acp" || resolved.provider === "codex-acp" || resolved.provider === "copilot-acp";

  const prompt = buildPrompt(project, plan, isAcp, idea, isZh) + (memCtx ? `\n\n${memCtx}` : "");

  // ACP engine: use Claude Code / Codex via Agent Client Protocol
  if (resolved.provider === "acp" || resolved.provider === "codex-acp" || resolved.provider === "copilot-acp") {
    const responseStream = new ReadableStream({
      async start(controller) {
        const acpClient = new AcpClient(cwd, resolved.provider === "codex-acp" ? "codex" : resolved.provider === "copilot-acp" ? "copilot" : "claude");
        try {
          await acpClient.start();

          // Resume or create session
          let session;
          if (project.sessionId) {
            session = await acpClient.resumeSession(project.sessionId);
          } else {
            session = await acpClient.createSession(resolved.model);
          }
          if (resolved.model) {
            await acpClient.setModel(session.sessionId, resolved.model);
          }

          // Save session for reuse
          if (session.sessionId !== project.sessionId) {
            db.update(projects)
              .set({ sessionId: session.sessionId })
              .where(eq(projects.id, project.id))
              .run();
          }

          // Run prompt, and if truncated (max_tokens), continue generating
          let attempts = 0;
          const maxContinuations = 3;
          while (attempts <= maxContinuations) {
            const currentPrompt = attempts === 0
              ? prompt
              : "Your previous response was truncated. Continue EXACTLY where you left off — do not repeat what was already written. Complete the remaining sections.";
            const result = await acpClient.prompt(session.sessionId, currentPrompt, (type, text) => {
              if (type === "text") {
                fullText += text;
                controller.enqueue(encoder.encode(text));
              } else if (type === "tool") {
                controller.enqueue(encoder.encode(text));
              }
            });
            attempts++;
            // Check if output was truncated
            if (result?.stopReason === "max_tokens" || result?.stopReason === "length") {
              controller.enqueue(encoder.encode("\n\n<!-- continuing... -->\n\n"));
              continue;
            }
            break;
          }

          if (fullText.trim()) {
            const saved = saveScheme(planId, fullText.trim(), plan.status, plan.name);
            if (!saved) {
              controller.enqueue(encoder.encode("\n\n---\n\n**Error: AI only explored the codebase but did not generate a scheme. Please try again.**\n"));
            }
          } else {
            // No text output — check stderr for clues
            const errors = acpClient.getRecentErrors();
            const hint = errors.includes("tls handshake") || errors.includes("stream disconnected")
              ? " (network/auth error — check your API credentials)"
              : "";
            controller.enqueue(encoder.encode(`\nError: ACP agent returned no output${hint}\n`));
          }
          controller.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          controller.enqueue(encoder.encode(`\nError: ${msg}`));
          controller.close();
        } finally {
          await acpClient.stop();
        }
      },
    });

    return new Response(responseStream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Default: Vercel AI SDK
  let configuredModel;
  try {
    configuredModel = getStepModel("scheme", provider as string, model);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 503 });
  }
  const tools = createProjectTools(cwd);

  const responseStream = new ReadableStream({
    async start(controller) {
      try {
        const result = streamText({
          model: configuredModel,
          prompt,
          tools,
          stopWhen: stepCountIs(20),
        });

        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            fullText += part.text;
            controller.enqueue(encoder.encode(part.text));
          } else if (part.type === "tool-call") {
            const input = "input" in part ? JSON.stringify(part.input).slice(0, 200) : "";
            controller.enqueue(encoder.encode(`\n> **Tool: ${part.toolName}**(${input})\n`));
          } else if (part.type === "tool-result") {
            const raw = "output" in part ? part.output : "result" in part ? (part as Record<string, unknown>).result : "";
            const output = typeof raw === "string" ? raw : JSON.stringify(raw);
            controller.enqueue(encoder.encode(`\`\`\`\n${output.length > 500 ? output.slice(0, 500) + "..." : output}\n\`\`\`\n`));
          }
        }

        if (fullText.trim()) {
          const saved = saveScheme(planId, fullText.trim(), plan.status, plan.name);
          if (!saved) {
            controller.enqueue(encoder.encode("\n\n---\n\n**Error: AI only explored the codebase but did not generate a scheme. Please try again.**\n"));
          }
        }
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`\nError: ${msg}`));
        controller.close();
      }
    },
  });

  return new Response(responseStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
