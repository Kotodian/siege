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

function getDefaultProvider(): string {
  const db = getDb();
  const s = db.select().from(appSettings).where(eq(appSettings.key, "default_provider")).get();
  return s?.value || "anthropic";
}

function saveSkillFile(rawText: string): { name: string; fileName: string; filePath: string; text: string } {
  // Strip markdown code fences if AI wrapped the output
  let text = rawText.trim();
  const fenceMatch = text.match(/^```(?:markdown|md)?\n([\s\S]*?)```\s*$/);
  if (fenceMatch) text = fenceMatch[1].trim();

  const nameMatch = text.match(/---\n[\s\S]*?name:\s*(.+)\n[\s\S]*?---/);
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

  const provider = getDefaultProvider();
  const encoder = new TextEncoder();
  let fullText = "";

  const responseStream = new ReadableStream({
    async start(controller) {
      try {
        if (provider === "acp") {
          const acpClient = new AcpClient(process.cwd());
          await acpClient.start();
          const session = await acpClient.createSession();
          await acpClient.prompt(session.sessionId, `${SYSTEM_PROMPT}\n\n${prompt}`, (type, text) => {
            if (type === "text") {
              fullText += text;
              controller.enqueue(encoder.encode(text));
            }
          });
          await acpClient.stop();
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
