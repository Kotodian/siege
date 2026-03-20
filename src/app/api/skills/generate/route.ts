import { NextRequest, NextResponse } from "next/server";
import { resolveStepConfig, getStepModel } from "@/lib/ai/config";
import { streamText } from "ai";
import { AcpClient } from "@/lib/acp/client";
import { parseJsonBody } from "@/lib/utils";
import fs from "fs";
import path from "path";

const SYSTEM_PROMPT = `You are a skill file generator for an AI coding assistant.
Given a user's description, generate a SKILL.md file in markdown format with YAML frontmatter.

The file MUST start with:
---
name: <short-kebab-case-name>
description: <one-line description>
---

Then provide the skill content as markdown. The content should be instructions, rules, patterns, or knowledge that an AI coding assistant can use when working on tasks.

Output ONLY the file content. No explanation, no code fences wrapping the whole thing.`;

function saveSkillFile(rawText: string): { name: string; fileName: string; filePath: string; text: string } | null {
  let text = rawText.trim();

  // Strip markdown code fences if AI wrapped the output
  const fenceMatch = text.match(/```(?:markdown|md)?\n([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();

  // Extract the actual skill content: find the frontmatter block and everything after it
  const frontmatterStart = text.indexOf("---\n");
  if (frontmatterStart < 0) return null; // No frontmatter = no valid skill
  if (frontmatterStart > 0) text = text.slice(frontmatterStart);

  const nameMatch = text.match(/^---\n[\s\S]*?name:\s*(.+)\n[\s\S]*?---/);
  if (!nameMatch) return null; // frontmatter exists but no name field
  const skillName = nameMatch[1].trim().replace(/['"]/g, "");
  const fileName = `${skillName.replace(/[^a-zA-Z0-9-_]/g, "-")}.md`;

  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const skillsDir = path.join(homeDir, ".claude", "skills");
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }

  const filePath = path.join(skillsDir, fileName);
  fs.writeFileSync(filePath, text, "utf-8");

  return { name: skillName, fileName, filePath, text };
}

export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;

  const { prompt } = body as { prompt: string };
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  let fullText = "";

  const acpPrompt = `Generate a skill file (SKILL.md) about: ${prompt}

The file must start with YAML frontmatter:
---
name: <short-kebab-case-name>
description: <one-line description>
---

Then write the skill content as markdown with headings, rules, best practices, and code examples.

Output the complete file content starting with the --- frontmatter block.`;

  const responseStream = new ReadableStream({
    async start(controller) {
      try {
        const resolved = resolveStepConfig("skills");
        if (resolved.provider === "acp") {
          // Snapshot existing skill files before ACP runs
          const skillsDir = path.join(process.env.HOME || "", ".claude", "skills");
          const beforeFiles = new Set<string>();
          if (fs.existsSync(skillsDir)) {
            for (const f of fs.readdirSync(skillsDir, { recursive: true })) {
              const fp = path.join(skillsDir, f.toString());
              try { if (fs.statSync(fp).isFile()) beforeFiles.add(fp); } catch {}
            }
          }

          const acpClient = new AcpClient(process.cwd());
          await acpClient.start();
          const session = await acpClient.createSession();
          await acpClient.prompt(session.sessionId, acpPrompt, (type, text) => {
            if (type === "text") {
              fullText += text;
              controller.enqueue(encoder.encode(text));
            }
          });
          await acpClient.stop();

          // Check what new files appeared in ~/.claude/skills/
          const newSkills: string[] = [];
          if (fs.existsSync(skillsDir)) {
            for (const f of fs.readdirSync(skillsDir, { recursive: true })) {
              const fp = path.join(skillsDir, f.toString());
              try { if (fs.statSync(fp).isFile() && !beforeFiles.has(fp)) newSkills.push(fp); } catch {}
            }
          }

          if (newSkills.length > 0) {
            // Claude Code installed skill files directly — report them
            const names = newSkills.map(fp => path.basename(fp, ".md")).join(", ");
            controller.enqueue(encoder.encode(`\n__SKILL_INSTALLED__:${names}`));
          } else {
            // No new files from Claude Code — try to extract from text output
            const saved = saveSkillFile(fullText);
            if (saved) {
              controller.enqueue(encoder.encode(`\n__SKILL_INSTALLED__:${saved.name}`));
            } else {
              controller.enqueue(encoder.encode("\n__SKILL_ERROR__:AI could not install the skill"));
            }
          }
        } else {
          let model;
          try {
            model = getStepModel("skills");
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            controller.enqueue(encoder.encode(`\n__SKILL_ERROR__:${msg}`));
            controller.close();
            return;
          }
          const result = streamText({ model, system: SYSTEM_PROMPT, prompt });
          for await (const chunk of result.textStream) {
            fullText += chunk;
            controller.enqueue(encoder.encode(chunk));
          }

          if (fullText.trim()) {
            const saved = saveSkillFile(fullText);
            if (saved) {
              controller.enqueue(encoder.encode(`\n__SKILL_INSTALLED__:${saved.name}`));
            } else {
              controller.enqueue(encoder.encode("\n__SKILL_ERROR__:Invalid skill content"));
            }
          } else {
            controller.enqueue(encoder.encode("\n__SKILL_ERROR__:Empty response"));
          }
        }
      } catch (err) {
        controller.enqueue(encoder.encode(`\n__SKILL_ERROR__:${err instanceof Error ? err.message : "Generation failed"}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(responseStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
