import { NextRequest, NextResponse } from "next/server";
import { resolveStepConfig, getStepModel } from "@/lib/ai/config";
import { parseJsonBody } from "@/lib/utils";
import { generateText } from "ai";
import { AcpClient } from "@/lib/acp/client";

function cleanTitle(raw: string): string {
  let text = raw;
  // Strip relay markers (--- USER MESSAGE BEGIN/END ---)
  text = text.replace(/---\s*USER MESSAGE BEGIN\s*---[\s\S]*?---\s*USER MESSAGE END\s*---/g, "");
  // Take only the first non-empty line (ignore explanations)
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  text = lines[0] || raw.trim();
  // Strip markdown bold/italic
  text = text.replace(/\*\*/g, "").replace(/\*/g, "");
  // Strip leading/trailing quotes and punctuation
  text = text.replace(/^["'"「『]+|["'"」』]+$/g, "").trim();
  // Remove trailing period/colon
  text = text.replace(/[.。:：]+$/, "").trim();
  return text.slice(0, 50);
}

const TITLE_PROMPT = (description: string) =>
  `I need you to act as a title generator. Read the following plan description and output ONLY a short title (under 50 characters). No quotes, no markdown, no explanation, no code. Just the title. Match the language of the description.

Plan description:
"""
${description}
"""

Title:`;

export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;
  const { description } = body;

  if (!description || !description.trim()) {
    return NextResponse.json(
      { error: "description is required" },
      { status: 400 }
    );
  }

  const resolved = resolveStepConfig("scheme");
  const prompt = TITLE_PROMPT(description);

  // ACP path
  if (resolved.provider === "acp" || resolved.provider === "codex-acp" || resolved.provider === "copilot-acp") {
    try {
      const cwd = process.cwd();
      const acpClient = new AcpClient(cwd, resolved.provider === "codex-acp" ? "codex" : resolved.provider === "copilot-acp" ? "copilot" : "claude");
      await acpClient.start();
      const session = await acpClient.createSession(resolved.model);
      if (resolved.model) {
        await acpClient.setModel(session.sessionId, resolved.model);
      }

      let result = "";
      await acpClient.prompt(session.sessionId, prompt, (type, text) => {
        if (type === "text") result += text;
      });
      await acpClient.stop();

      const title = cleanTitle(result);
      return new Response(title, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // SDK path
  let model;
  try {
    model = getStepModel("scheme");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  try {
    const result = await generateText({
      model,
      messages: [{ role: "user", content: prompt }],
    });

    const title = cleanTitle(result.text);
    return new Response(title, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
