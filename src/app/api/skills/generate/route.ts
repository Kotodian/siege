import { NextRequest, NextResponse } from "next/server";
import { getConfiguredModel } from "@/lib/ai/config";
import { streamText } from "ai";
import { AcpClient } from "@/lib/acp/client";
import { parseJsonBody } from "@/lib/utils";
import { getDb } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
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

function saveSkillFile(rawText: string): { name: string; fileName: string; filePath: string; text: string } {
  let text = rawText.trim();

  // Strip markdown code fences if AI wrapped the output
  const fenceMatch = text.match(/```(?:markdown|md)?\n([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();

  // Extract the actual skill content: find the frontmatter block and everything after it
  // This handles cases where AI outputs chat text before the actual skill
  const frontmatterStart = text.indexOf("---\n");
  if (frontmatterStart > 0) {
    // There's text before the frontmatter — strip it
    text = text.slice(frontmatterStart);
  }

  const nameMatch = text.match(/^---\n[\s\S]*?name:\s*(.+)\n[\s\S]*?---/);
  const skillName = nameMatch?.[1]?.trim().replace(/['"]/g, "") || `skill-${Date.now()}`;
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

  const db = getDb();
  const providerSetting = db.select().from(appSettings).where(eq(appSettings.key, "default_provider")).get();
  const provider = providerSetting?.value || "anthropic";

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
        if (provider === "acp") {
          let writtenSkill: { path: string; content: string } | null = null;
          const acpClient = new AcpClient(process.cwd());
          await acpClient.start();
          const session = await acpClient.createSession();
          await acpClient.prompt(session.sessionId, acpPrompt, (type, text) => {
            if (type === "text") {
              fullText += text;
              controller.enqueue(encoder.encode(text));
            }
          }, (filePath, content) => {
            // Claude Code wrote a file — capture it if it looks like a skill
            if (content.includes("---") && (filePath.endsWith(".md") || filePath.includes("skills"))) {
              writtenSkill = { path: filePath, content };
            }
          });
          await acpClient.stop();
          // If Claude Code wrote the skill file directly, use that content instead
          if (writtenSkill !== null) {
            fullText = (writtenSkill as { path: string; content: string }).content;
          }
        } else {
          const model = getConfiguredModel();
          const result = streamText({ model, system: SYSTEM_PROMPT, prompt });
          for await (const chunk of result.textStream) {
            fullText += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
        }

        // Save file and send result marker
        if (fullText.trim()) {
          const { name } = saveSkillFile(fullText);
          controller.enqueue(encoder.encode(`\n__SKILL_INSTALLED__:${name}`));
        } else {
          controller.enqueue(encoder.encode("\n__SKILL_ERROR__:Empty response"));
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
