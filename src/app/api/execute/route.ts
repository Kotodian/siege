import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  scheduleItems,
  schedules,
  schemes,
  plans,
  projects,
  fileSnapshots,
  reviewItems,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { execSync } from "child_process";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { getStepModel, resolveStepConfig } from "@/lib/ai/config";
import { scanAllSkills, getSkillContent } from "@/lib/skills/registry";
import { loadMemoryContext } from "@/lib/ai/memory";
import { parseJsonBody } from "@/lib/utils";
import fs from "fs";
import path from "path";

/** When a [fix] task completes, mark its related review findings as resolved */
function resolveRelatedFindings(itemId: string) {
  try {
    const db = getDb();
    const item = db.select().from(scheduleItems).where(eq(scheduleItems.id, itemId)).get();
    if (!item) return;
    // Find review items that target this schedule item
    const findings = db.select().from(reviewItems)
      .where(eq(reviewItems.targetId, itemId))
      .all()
      .filter(f => !f.resolved);
    for (const f of findings) {
      db.update(reviewItems).set({ resolved: true }).where(eq(reviewItems.id, f.id)).run();
    }
    // Also resolve findings that match the fix task title pattern
    if (item.title.startsWith("[fix] ")) {
      const findingTitle = item.title.replace("[fix] ", "");
      const allFindings = db.select().from(reviewItems).all()
        .filter(f => !f.resolved && f.title === findingTitle);
      for (const f of allFindings) {
        db.update(reviewItems).set({ resolved: true }).where(eq(reviewItems.id, f.id)).run();
      }
    }
  } catch { /* ignore */ }
}

function getHeadHash(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    return "";
  }
}

function captureFileSnapshots(itemId: string, cwd: string, beforeHash: string) {
  try {
    const afterHash = getHeadHash(cwd);

    // Committed changes between beforeHash..afterHash (this task's commits only)
    let committedFiles: string[] = [];
    if (beforeHash && afterHash && beforeHash !== afterHash) {
      committedFiles = execSync(`git diff --name-only ${beforeHash}..${afterHash}`, {
        cwd, encoding: "utf-8", timeout: 5000,
      }).trim().split("\n").filter(Boolean);
    }

    // Uncommitted changes (staged + unstaged, relative to current HEAD)
    const uncommittedFiles = execSync("git diff HEAD --name-only", {
      cwd, encoding: "utf-8", timeout: 5000,
    }).trim().split("\n").filter(Boolean);

    // Only include untracked files that were created during this task
    // (i.e., after beforeHash). Skip pre-existing untracked files.
    let untrackedFiles: string[] = [];
    if (beforeHash && beforeHash !== afterHash) {
      // New files added in commits between beforeHash..afterHash
      try {
        untrackedFiles = execSync(`git diff --name-only --diff-filter=A ${beforeHash}..${afterHash}`, {
          cwd, encoding: "utf-8", timeout: 5000,
        }).trim().split("\n").filter(Boolean);
      } catch { /* ignore */ }
    }

    const allFiles = [...new Set([...committedFiles, ...uncommittedFiles, ...untrackedFiles])];
    if (allFiles.length === 0) return;

    const db = getDb();
    for (const filePath of allFiles) {
      // contentBefore: file at beforeHash (pre-task state)
      let contentBefore = "";
      try {
        contentBefore = execSync(`git show ${beforeHash}:${filePath}`, {
          cwd, encoding: "utf-8", timeout: 5000,
        });
      } catch { /* new file */ }

      // contentAfter: file at afterHash for committed files, or working tree for uncommitted
      let contentAfter = "";
      if (committedFiles.includes(filePath)) {
        // Use the committed version at afterHash (not working tree which may have later tasks' changes)
        try {
          contentAfter = execSync(`git show ${afterHash}:${filePath}`, {
            cwd, encoding: "utf-8", timeout: 5000,
          });
        } catch { /* deleted in commit */ }
      } else {
        // Uncommitted/untracked: read from working tree
        const fullPath = path.join(cwd, filePath);
        try {
          contentAfter = fs.readFileSync(fullPath, "utf-8");
        } catch { /* deleted */ }
      }

      if (contentBefore === contentAfter) continue;

      db.insert(fileSnapshots).values({
        id: crypto.randomUUID(),
        scheduleItemId: itemId,
        filePath,
        contentBefore,
        contentAfter,
      }).run();
    }
  } catch (err) {
    console.error("[execute] Failed to capture snapshots:", err);
  }
}
import { LspClient } from "@/lib/lsp/client";
import { getLanguageFromPath, getServerConfig, isServerAvailable } from "@/lib/lsp/servers";
import { AcpClient } from "@/lib/acp/client";

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
    writeFile: tool({
      description: "Write content to a file within the project (creates or overwrites)",
      inputSchema: z.object({
        relativePath: z.string().describe("Relative path to the file from project root"),
        content: z.string().describe("File content to write"),
      }),
      execute: async ({ relativePath, content }) => {
        const targetPath = path.resolve(repoPath, relativePath);
        if (!targetPath.startsWith(repoPath)) return "Access denied: path outside project";
        try {
          const dir = path.dirname(targetPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(targetPath, content, "utf-8");
          return `Written ${content.length} bytes to ${relativePath}`;
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : e}`;
        }
      },
    }),
    editFile: tool({
      description: "Replace a specific string in a file (for surgical edits)",
      inputSchema: z.object({
        relativePath: z.string().describe("Relative path to the file from project root"),
        oldString: z.string().describe("The exact string to find and replace"),
        newString: z.string().describe("The replacement string"),
      }),
      execute: async ({ relativePath, oldString, newString }) => {
        const targetPath = path.resolve(repoPath, relativePath);
        if (!targetPath.startsWith(repoPath)) return "Access denied: path outside project";
        try {
          const content = fs.readFileSync(targetPath, "utf-8");
          if (!content.includes(oldString)) return `Error: old string not found in ${relativePath}`;
          const updated = content.replace(oldString, newString);
          fs.writeFileSync(targetPath, updated, "utf-8");
          return `Edited ${relativePath} successfully`;
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : e}`;
        }
      },
    }),
    bash: tool({
      description: "Run a shell command within the project directory (build, test, grep, etc.)",
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
          const out = (err.stdout || "") + (err.stderr || "");
          return out.slice(0, 8000) || `Error: ${err.message || e}`;
        }
      },
    }),
  };
}

// Lazily managed LSP clients per language
const lspClients = new Map<string, LspClient>();

async function getLspClient(repoPath: string, filePath: string): Promise<LspClient | null> {
  const lang = getLanguageFromPath(filePath);
  if (!lang) return null;

  const key = `${repoPath}:${lang}`;
  if (lspClients.has(key)) return lspClients.get(key)!;

  if (!isServerAvailable(lang)) return null;
  const config = getServerConfig(lang);
  if (!config) return null;

  const client = new LspClient(config.command, config.args, repoPath);
  try {
    await client.start();
    lspClients.set(key, client);
    return client;
  } catch (err) {
    console.error(`[lsp] Failed to start ${lang} server:`, err);
    return null;
  }
}

function createLspTools(repoPath: string) {
  return {
    lspHover: tool({
      description: "Get type information and documentation for a symbol at a specific position in a file using LSP. Use this to understand types, function signatures, and API docs precisely.",
      inputSchema: z.object({
        relativePath: z.string().describe("Relative path to the file"),
        line: z.number().describe("Line number (1-based)"),
        column: z.number().describe("Column number (0-based)"),
      }),
      execute: async ({ relativePath, line, column }) => {
        const absPath = path.resolve(repoPath, relativePath);
        const client = await getLspClient(repoPath, absPath);
        if (!client) return "LSP not available for this file type";
        try {
          const lang = getLanguageFromPath(absPath) || "text";
          const content = fs.readFileSync(absPath, "utf-8");
          await client.openFile(absPath, content, lang);
          const result = await client.hover(absPath, line, column);
          return result || "No type information available";
        } catch (e) {
          return `LSP error: ${e instanceof Error ? e.message : e}`;
        }
      },
    }),
    lspDefinition: tool({
      description: "Go to definition of a symbol. Returns the file path and line where the symbol is defined. Use this to navigate to function/type/variable definitions across files.",
      inputSchema: z.object({
        relativePath: z.string().describe("Relative path to the file"),
        line: z.number().describe("Line number (1-based)"),
        column: z.number().describe("Column number (0-based)"),
      }),
      execute: async ({ relativePath, line, column }) => {
        const absPath = path.resolve(repoPath, relativePath);
        const client = await getLspClient(repoPath, absPath);
        if (!client) return "LSP not available for this file type";
        try {
          const lang = getLanguageFromPath(absPath) || "text";
          const content = fs.readFileSync(absPath, "utf-8");
          await client.openFile(absPath, content, lang);
          const locations = await client.definition(absPath, line, column);
          if (locations.length === 0) return "No definition found";
          return locations.map((l) => {
            const rel = path.relative(repoPath, l.file);
            return `${rel}:${l.line}:${l.character}`;
          }).join("\n");
        } catch (e) {
          return `LSP error: ${e instanceof Error ? e.message : e}`;
        }
      },
    }),
    lspReferences: tool({
      description: "Find all references to a symbol across the project. Returns file paths and line numbers where the symbol is used. Useful before refactoring to understand impact.",
      inputSchema: z.object({
        relativePath: z.string().describe("Relative path to the file"),
        line: z.number().describe("Line number (1-based)"),
        column: z.number().describe("Column number (0-based)"),
      }),
      execute: async ({ relativePath, line, column }) => {
        const absPath = path.resolve(repoPath, relativePath);
        const client = await getLspClient(repoPath, absPath);
        if (!client) return "LSP not available for this file type";
        try {
          const lang = getLanguageFromPath(absPath) || "text";
          const content = fs.readFileSync(absPath, "utf-8");
          await client.openFile(absPath, content, lang);
          const locations = await client.references(absPath, line, column);
          if (locations.length === 0) return "No references found";
          return locations.slice(0, 50).map((l) => {
            const rel = path.relative(repoPath, l.file);
            return `${rel}:${l.line}`;
          }).join("\n") + (locations.length > 50 ? `\n... and ${locations.length - 50} more` : "");
        } catch (e) {
          return `LSP error: ${e instanceof Error ? e.message : e}`;
        }
      },
    }),
    lspDiagnostics: tool({
      description: "Get compiler diagnostics (errors, warnings) for a file using LSP. Use this to check for type errors, unused imports, and other issues after editing.",
      inputSchema: z.object({
        relativePath: z.string().describe("Relative path to the file"),
      }),
      execute: async ({ relativePath }) => {
        const absPath = path.resolve(repoPath, relativePath);
        const client = await getLspClient(repoPath, absPath);
        if (!client) return "LSP not available for this file type";
        try {
          const lang = getLanguageFromPath(absPath) || "text";
          const content = fs.readFileSync(absPath, "utf-8");
          await client.openFile(absPath, content, lang);
          const diags = await client.diagnostics(absPath);
          if (diags.length === 0) return "No diagnostics (clean)";
          return diags.map((d) => `Line ${d.line} [${d.severity}]: ${d.message}`).join("\n");
        } catch (e) {
          return `LSP error: ${e instanceof Error ? e.message : e}`;
        }
      },
    }),
  };
}

export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;
  const { itemId, skills: requestSkills } = body as { itemId: string; skills?: string[] };

  if (!itemId) {
    return NextResponse.json({ error: "itemId is required" }, { status: 400 });
  }

  const db = getDb();
  const item = db.select().from(scheduleItems).where(eq(scheduleItems.id, itemId)).get();
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  const schedule = db.select().from(schedules).where(eq(schedules.id, item.scheduleId)).get();
  if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  const plan = db.select().from(plans).where(eq(plans.id, schedule.planId)).get();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const project = db.select().from(projects).where(eq(projects.id, plan.projectId)).get();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Skills
  const itemSkills: string[] = JSON.parse(item.skills || "[]");
  const allSkillNames = [...new Set([...itemSkills, ...(requestSkills || [])])];
  let skillsContent = "";
  if (allSkillNames.length > 0) {
    const allSkills = scanAllSkills();
    skillsContent = getSkillContent(allSkills, allSkillNames);
    console.log(`[execute] Skills requested: ${JSON.stringify(allSkillNames)}, matched: ${skillsContent.length > 0}`);
  } else {
    console.log(`[execute] No skills selected`);
  }

  // Update status
  db.update(scheduleItems)
    .set({ status: "in_progress", progress: 0 })
    .where(eq(scheduleItems.id, itemId))
    .run();

  if (plan.status === "scheduled") {
    db.update(plans)
      .set({ status: "executing", updatedAt: new Date().toISOString() })
      .where(eq(plans.id, plan.id))
      .run();
  }

  // Previous tasks context
  const allItems = db.select().from(scheduleItems)
    .where(eq(scheduleItems.scheduleId, item.scheduleId))
    .all()
    .sort((a, b) => a.order - b.order);

  // Build lightweight context: just task titles + status, no full logs
  const previousTasks = allItems
    .filter(prev => prev.id !== item.id && (prev.status === "completed" || prev.status === "failed"))
    .filter(prev => prev.order < item.order)
    .map(prev => `- #${prev.order} ${prev.title} [${prev.status}]`)
    .join("\n");

  const memoryContext = loadMemoryContext(project.id);

  // Load linked scheme summary (truncated) for cross-provider context
  let schemeContext = "";
  if (item.schemeId) {
    const scheme = db.select().from(schemes).where(eq(schemes.id, item.schemeId)).get();
    if (scheme?.content) {
      const truncated = scheme.content.length > 1500 ? scheme.content.slice(0, 1500) + "\n...(truncated)" : scheme.content;
      schemeContext = `Technical scheme context:\n${truncated}`;
    }
  }

  const prompt = `${memoryContext ? `${memoryContext}\n\n---\n` : ""}${schemeContext ? `${schemeContext}\n\n---\n` : ""}${previousTasks ? `Other tasks in this plan:\n${previousTasks}\n\n---\n` : ""}Implement task #${item.order}: ${item.title}

${item.description || ""}

${skillsContent ? `Skills context:\n${skillsContent}` : ""}

Implement the changes directly. Only read files you need to modify. Do NOT scan the entire codebase — focus on the specific files relevant to this task.`;

  const cwd = fs.existsSync(project.targetRepoPath) ? project.targetRepoPath : process.cwd();
  const engine = item.engine || "claude-code";
  const encoder = new TextEncoder();
  let fullLog = "";
  const beforeHash = getHeadHash(cwd);

  // ACP engine: use Agent Client Protocol with session reuse per project
  if (engine === "acp" || engine === "codex-acp") {
    const existingSessionId = project.sessionId; // Reuse project-level session
    const resolved = resolveStepConfig("execute");

    const responseStream = new ReadableStream({
      async start(controller) {
        const acpClient = new AcpClient(cwd, engine === "codex-acp" ? "codex" : "claude");
        try {
          controller.enqueue(encoder.encode("Connecting to ACP agent...\n"));
          await acpClient.start();

          // Try to resume existing session, or create new one
          let session;
          if (existingSessionId) {
            controller.enqueue(encoder.encode(`Resuming session ${existingSessionId.slice(0, 8)}...\n`));
            session = await acpClient.resumeSession(existingSessionId);
          } else {
            session = await acpClient.createSession(resolved.model);
          }

          // Save session ID to project for future reuse
          if (session.sessionId !== existingSessionId) {
            db.update(projects)
              .set({ sessionId: session.sessionId })
              .where(eq(projects.id, project.id))
              .run();
          }

          controller.enqueue(encoder.encode(`Session: ${session.sessionId}\n\n`));
          fullLog += `[ACP] Session: ${session.sessionId}\n`;

          const result = await acpClient.prompt(session.sessionId, prompt, (type, text) => {
            if (type === "text") {
              fullLog += text;
              controller.enqueue(encoder.encode(text));
            } else if (type === "tool") {
              fullLog += text;
              controller.enqueue(encoder.encode(text));
            } else if (type === "thought") {
              fullLog += `[thought] ${text}`;
            } else if (type === "plan") {
              const msg = `\nPlan:\n${text}\n\n`;
              fullLog += msg;
              controller.enqueue(encoder.encode(msg));
            }
          });

          const stopReason = result?.stopReason || "unknown";
          fullLog += `\n[ACP] Stop: ${stopReason}, tokens: ${result?.usage?.totalTokens || "?"}`;
          controller.enqueue(encoder.encode(`\n\n---\nStop: ${stopReason}`));

          db.update(scheduleItems)
            .set({ status: "completed", progress: 100, executionLog: fullLog || "No output" })
            .where(eq(scheduleItems.id, itemId))
            .run();

          captureFileSnapshots(itemId, cwd, beforeHash);
          resolveRelatedFindings(itemId);

          controller.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          fullLog += `\nError: ${msg}`;
          controller.enqueue(encoder.encode(`\nError: ${msg}`));
          db.update(scheduleItems)
            .set({ status: "failed", progress: 0, executionLog: fullLog || "Error" })
            .where(eq(scheduleItems.id, itemId))
            .run();
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

  // Default engine: Vercel AI SDK with tools
  let configuredModel;
  try {
    configuredModel = getStepModel("execute");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.update(scheduleItems)
      .set({ status: "failed", progress: 0, executionLog: `Error: ${msg}` })
      .where(eq(scheduleItems.id, itemId))
      .run();
    return NextResponse.json({ error: msg }, { status: 503 });
  }
  const tools = { ...createProjectTools(cwd), ...createLspTools(cwd) };

  const responseStream = new ReadableStream({
    async start(controller) {
      try {
        const result = streamText({
          model: configuredModel,
          prompt,
          tools,
          stopWhen: stepCountIs(15),
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

        db.update(scheduleItems)
          .set({
            status: "completed",
            progress: 100,
            executionLog: fullLog || "No output",
          })
          .where(eq(scheduleItems.id, itemId))
          .run();

        captureFileSnapshots(itemId, cwd, beforeHash);
        resolveRelatedFindings(itemId);
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fullLog += `\nError: ${msg}`;
        controller.enqueue(encoder.encode(`\nError: ${msg}`));

        db.update(scheduleItems)
          .set({
            status: "failed",
            progress: 0,
            executionLog: fullLog || "Error",
          })
          .where(eq(scheduleItems.id, itemId))
          .run();

        controller.close();
      }
    },
  });

  return new Response(responseStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
