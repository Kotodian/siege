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
  fileSnapshots,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { resolveStepConfig, getStepModel } from "@/lib/ai/config";
import { streamText } from "ai";
import { AcpClient } from "@/lib/acp/client";
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
      ? `- items: array of findings, each with targetId (string), title (string), content (string describing the issue), severity ("info"|"warning"|"critical"), filePath (string), lineNumber (number), options (array of 1-3 short solution suggestions, e.g. ["Use environment variables for credentials", "Move to .env file with gitignore", "Use a secrets manager"])`
      : `- items: array of findings, each with targetId (string — MUST be the exact "id" from the section header, e.g. "abc123:section-2"), title (string), content (string), severity ("info"|"warning"|"critical"), options (array of 1-3 short solution suggestions)

IMPORTANT: Each finding's targetId MUST exactly match the "(id: ...)" from the section it refers to. This is how findings are linked to scheme sections.`;

  // Detect language from content
  const hasChinese = /[\u4e00-\u9fff]/.test(itemsSummary);
  const langInstruction = hasChinese
    ? "\n\nIMPORTANT: Write all summary and finding content in Chinese (中文), matching the language of the input."
    : "";

  return {
    system: `You are a code review engine. Output JSON only. No conversation.

CRITICAL: Do NOT ask questions, request access, or use tools. Review based solely on the content provided.

Review for: correctness, security vulnerabilities, logic bugs, runtime errors.

Severity guidelines:
- "critical": ONLY for real bugs that will cause crashes, data loss, or security vulnerabilities
- "warning": potential issues, missing error handling, performance concerns
- "info": style suggestions, naming improvements, minor refactoring opportunities
- Do NOT mark as critical: missing tests (testing is a separate phase), code style, naming conventions, missing docs

Be practical — approve if the code works correctly even if it could be cleaner.

Output a JSON object with:
- summary: overall review summary as markdown (string)
${itemsSchema}
- approved: boolean (true if no critical bugs or security issues)

Output ONLY the JSON object. No other text before or after.${langInstruction}`,
    prompt: `Plan: ${planName}\n\n${itemsSummary}`,
  };
}

function saveReviewResult(
  fullText: string,
  reviewId: string,
  planId: string,
  type: "scheme" | "implementation",
  dbInstance: ReturnType<typeof getDb>,
): boolean {
  try {
    const trimmed = fullText.trim();
    let parsed: any = null;
    try { parsed = JSON.parse(trimmed); } catch {}
    if (!parsed) {
      const fenced = trimmed.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
      try { parsed = JSON.parse(fenced); } catch {}
    }
    if (!parsed) {
      const start = trimmed.indexOf("{");
      if (start >= 0) {
        let depth = 0, end = start;
        for (let i = start; i < trimmed.length; i++) {
          if (trimmed[i] === "{") depth++;
          else if (trimmed[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
        }
        try { parsed = JSON.parse(trimmed.slice(start, end)); } catch {}
      }
    }

    if (parsed && parsed.summary) {
      const finalStatus = parsed.approved ? "approved" : "changes_requested";
      dbInstance.update(reviews)
        .set({ status: finalStatus, content: parsed.summary, updatedAt: new Date().toISOString() })
        .where(eq(reviews.id, reviewId))
        .run();

      const fileToItemId = new Map<string, string>();
      if (type === "implementation") {
        const schedule = dbInstance.select().from(schedules).where(eq(schedules.planId, planId)).get();
        if (schedule) {
          const items = dbInstance.select().from(scheduleItems).where(eq(scheduleItems.scheduleId, schedule.id)).all();
          for (const si of items) {
            const snaps = dbInstance.select().from(fileSnapshots).where(eq(fileSnapshots.scheduleItemId, si.id)).all();
            for (const snap of snaps) { fileToItemId.set(snap.filePath, si.id); }
          }
        }
      }

      for (const item of parsed.items || []) {
        let resolvedTargetId = item.targetId || "";
        if (type === "implementation" && item.filePath && fileToItemId.has(item.filePath)) {
          resolvedTargetId = fileToItemId.get(item.filePath)!;
        }
        const opts = Array.isArray(item.options) ? item.options.filter((o: unknown) => typeof o === "string") : [];
        dbInstance.insert(reviewItems).values({
          id: crypto.randomUUID(), reviewId,
          targetType: type === "scheme" ? "scheme" : "schedule_item",
          targetId: resolvedTargetId,
          title: item.title || "Finding",
          content: item.content || "",
          severity: item.severity || "info",
          resolved: false,
          filePath: item.filePath || null,
          lineNumber: item.lineNumber || null,
          options: opts.length > 0 ? JSON.stringify(opts) : null,
        }).run();
      }

      if (type === "implementation" && parsed.approved) {
        dbInstance.update(plans)
          .set({ status: "testing", updatedAt: new Date().toISOString() })
          .where(eq(plans.id, planId))
          .run();
      }
      return true;
    } else {
      const fallbackContent = (trimmed.startsWith("{") || trimmed.startsWith("["))
        ? "AI 返回了无法解析的结果，请重试。/ AI returned unparseable result, please retry."
        : trimmed || "AI 未返回有效的审查结果，请重试。/ AI returned no valid review output, please retry.";
      dbInstance.update(reviews)
        .set({ status: "changes_requested", content: fallbackContent, updatedAt: new Date().toISOString() })
        .where(eq(reviews.id, reviewId))
        .run();
      return false;
    }
  } catch (err) {
    console.error("[review-generate] save failed:", err);
    dbInstance.update(reviews)
      .set({ status: "changes_requested", content: `Save error: ${err instanceof Error ? err.message : err}`, updatedAt: new Date().toISOString() })
      .where(eq(reviews.id, reviewId))
      .run();
    return false;
  }
}

export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;
  const { planId, type, provider: rawProvider, model, scheduleItemId } = body as {
    planId: string;
    type: "scheme" | "implementation";
    scheduleItemId?: string;
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

  let itemsToReview: Array<{ id: string; title: string; content: string }> = [];

  if (type === "scheme") {
    // Split scheme into sections so AI can reference specific sections by ID
    const allSchemes = db.select().from(schemes).where(eq(schemes.planId, planId)).all();
    for (const s of allSchemes) {
      const content = s.content || "";
      const sectionRegex = /^(#{1,3})\s+(.+)/gm;
      const sectionStarts: Array<{ level: number; title: string; start: number }> = [];
      let match;
      while ((match = sectionRegex.exec(content)) !== null) {
        sectionStarts.push({ level: match[1].length, title: match[2].trim(), start: match.index });
      }
      if (sectionStarts.length <= 1) {
        // No sections or just one — use whole scheme
        itemsToReview.push({ id: `${s.id}:full`, title: s.title, content });
      } else {
        for (let idx = 0; idx < sectionStarts.length; idx++) {
          const sec = sectionStarts[idx];
          const nextStart = idx + 1 < sectionStarts.length ? sectionStarts[idx + 1].start : content.length;
          const sectionContent = content.slice(sec.start, nextStart).trim();
          itemsToReview.push({
            id: `${s.id}:section-${idx}`,
            title: sec.title,
            content: sectionContent,
          });
        }
      }
    }
  } else {
    const schedule = db.select().from(schedules).where(eq(schedules.planId, planId)).get();
    if (!schedule) {
      return NextResponse.json({ error: "No schedule found" }, { status: 400 });
    }

    const project = db.select().from(projects).where(eq(projects.id, plan.projectId)).get();
    const repoPath = project?.targetRepoPath;

    let allScheduleItems = db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.scheduleId, schedule.id))
      .all()
      .sort((a, b) => a.order - b.order);

    // Filter to single task if scheduleItemId provided
    if (scheduleItemId) {
      allScheduleItems = allScheduleItems.filter(i => i.id === scheduleItemId);
    }

    // Build per-task diffs from file snapshots
    let hasSnapshotDiffs = false;
    for (const item of allScheduleItems) {
      const snaps = db.select().from(fileSnapshots)
        .where(eq(fileSnapshots.scheduleItemId, item.id))
        .all();
      if (snaps.length === 0) continue;
      hasSnapshotDiffs = true;
      const diffParts = snaps.map((s) => {
        const beforeLines = (s.contentBefore || "").split("\n").length;
        const afterLines = (s.contentAfter || "").split("\n").length;
        if (!s.contentBefore) {
          return `+++ b/${s.filePath} (new file, ${afterLines} lines)`;
        }
        return `--- a/${s.filePath}\n+++ b/${s.filePath}\n(${beforeLines} → ${afterLines} lines)`;
      }).join("\n");
      itemsToReview.push({
        id: item.id,
        title: `#${item.order} ${item.title}`,
        content: `Task: ${item.description || item.title}\n\nFiles changed:\n${diffParts}`,
      });
    }

    if (!hasSnapshotDiffs) {
      // Fallback: use overall git diff or execution logs
      let gitDiff = "";
      if (repoPath && fs.existsSync(repoPath)) {
        gitDiff = getGitUnifiedDiff(repoPath);
      }
      if (gitDiff) {
        const firstItemId = allScheduleItems[0]?.id || "";
        itemsToReview = [{
          id: firstItemId,
          title: "Code Changes (git diff)",
          content: `### Git Diff\n\`\`\`diff\n${gitDiff}\n\`\`\``,
        }];
      } else {
        itemsToReview = allScheduleItems.map((i) => ({
          id: i.id,
          title: i.title,
          content: `${i.description || ""}\n\n### Execution Log\n\`\`\`\n${i.executionLog || "No output"}\n\`\`\``,
        }));
      }
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
  const resolved = resolveStepConfig("review", rawProvider, model);

  const project = type === "implementation"
    ? db.select().from(projects).where(eq(projects.id, plan.projectId)).get()
    : null;
  const cwd = project?.targetRepoPath && fs.existsSync(project.targetRepoPath)
    ? project.targetRepoPath
    : process.cwd();

  const encoder = new TextEncoder();
  let fullText = "";

  // ACP engine: provide the diff content directly in the prompt
  if (resolved.provider === "acp" || resolved.provider === "codex-acp" || resolved.provider === "copilot-acp") {
    const zh = /[\u4e00-\u9fff]/.test(plan.name || "");

    // Build full content with diffs already included
    const itemsContent = itemsToReview
      .map((item) => `### ${item.title} (id: ${item.id})\n${item.content}`)
      .join("\n\n");

    // Also grab git diff if not already in items
    let extraDiff = "";
    if (type === "implementation" && !itemsContent.includes("```diff")) {
      const project2 = db.select().from(projects).where(eq(projects.id, plan.projectId)).get();
      if (project2?.targetRepoPath && fs.existsSync(project2.targetRepoPath)) {
        extraDiff = getGitUnifiedDiff(project2.targetRepoPath);
      }
    }

    const acpPrompt = `${system}

Plan: ${plan.name}

${itemsContent}

${extraDiff ? `## Git Diff\n\`\`\`diff\n${extraDiff}\n\`\`\`` : ""}

${zh ? "用中文输出所有内容。" : ""}`;

    const responseStream = new ReadableStream({
      async start(controller) {
        const acpClient = new AcpClient(cwd, resolved.provider === "codex-acp" ? "codex" : resolved.provider === "copilot-acp" ? "copilot" : "claude");
        try {
          await acpClient.start();
          const session = await acpClient.createSession(resolved.model);
          if (resolved.model) {
            await acpClient.setModel(session.sessionId, resolved.model);
          }

          controller.enqueue(encoder.encode(zh ? "AI 正在检查 git 提交...\n" : "AI inspecting git commits...\n"));

          await acpClient.prompt(session.sessionId, acpPrompt, (t, text) => {
            if (t === "text") {
              fullText += text;
              controller.enqueue(encoder.encode(text));
            } else if (t === "tool") {
              controller.enqueue(encoder.encode(text));
            } else if (t === "thought") {
              controller.enqueue(encoder.encode(`[thinking] ${text.slice(0, 100)}\n`));
            }
          });
          controller.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          controller.enqueue(encoder.encode(`\nError: ${msg}`));
          controller.close();
        } finally {
          try { await acpClient.stop(); } catch {}
        }

        saveReviewResult(fullText, reviewId, planId, type, db);
      },
    });

    return new Response(responseStream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // SDK path
  let aiModel;
  try {
    aiModel = getStepModel("review", rawProvider, model);
  } catch (err) {
    db.update(reviews)
      .set({ status: "changes_requested", content: err instanceof Error ? err.message : String(err) })
      .where(eq(reviews.id, reviewId))
      .run();
    return NextResponse.json({ error: String(err) }, { status: 503 });
  }

  const zh = /[\u4e00-\u9fff]/.test(plan.name || "");
  const result = streamText({ model: aiModel, system, prompt });

  const responseStream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(zh
        ? `AI 正在审查 ${itemsToReview.length} 个段落...\n`
        : `AI reviewing ${itemsToReview.length} sections...\n`));

      let lastProgressAt = Date.now();
      try {
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          fullText += part.text;
          // Show progress dots every 2 seconds (JSON output isn't useful to display)
          const now = Date.now();
          if (now - lastProgressAt > 2000) {
            controller.enqueue(encoder.encode("."));
            lastProgressAt = now;
          }
        } else if (part.type === "error") {
          console.error("[review] stream error part:", part);
        }
      }
      controller.enqueue(encoder.encode(zh ? "\n解析结果中...\n" : "\nParsing results...\n"));
      } catch (streamErr) {
        const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
        controller.enqueue(encoder.encode(`\nError: ${msg}`));
        const db2 = getDb();
        db2.update(reviews)
          .set({ status: "changes_requested", content: `AI error: ${msg}`, updatedAt: new Date().toISOString() })
          .where(eq(reviews.id, reviewId))
          .run();
        controller.close();
        return;
      }

      const saved = saveReviewResult(fullText, reviewId, planId, type, getDb());
      controller.enqueue(encoder.encode(saved
        ? (zh ? "审查完成\n" : "Review complete\n")
        : (zh ? "审查结果解析失败，请重试\n" : "Failed to parse review result, please retry\n")));
      controller.close();
    },
  });

  return new Response(responseStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
