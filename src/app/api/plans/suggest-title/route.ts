import { NextRequest, NextResponse } from "next/server";
import { getConfiguredModel } from "@/lib/ai/config";
import { parseJsonBody } from "@/lib/utils";
import { streamText } from "ai";

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

  const model = getConfiguredModel();
  const result = streamText({
    model,
    system: `You are a title generator. Given a project plan description, output a short title (under 50 characters).

RULES:
- Output ONLY the title text, nothing else
- No quotes, no punctuation at the end
- No explanations, no markdown, no code
- Do NOT answer or solve the description — just summarize it as a title
- If the description is in Chinese, output Chinese title
- If in English, output English title`,
    prompt: `Generate a title for this plan description:\n\n${description}`,
  });

  return result.toTextStreamResponse();
}
