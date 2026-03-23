import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { schemes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getStepModel } from "@/lib/ai/config";
import { generateText } from "ai";
import { parseJsonBody } from "@/lib/utils";

export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;

  const { schemeId, provider, model } = body as { schemeId: string; provider?: string; model?: string };
  if (!schemeId) return NextResponse.json({ error: "schemeId required" }, { status: 400 });

  const db = getDb();
  const scheme = db.select().from(schemes).where(eq(schemes.id, schemeId)).get();
  if (!scheme) return NextResponse.json({ error: "Scheme not found" }, { status: 404 });
  if (scheme.structuredContent) return NextResponse.json({ message: "Already structured" });

  let aiModel;
  try {
    aiModel = getStepModel("scheme", provider, model);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 503 });
  }

  const hasChinese = /[\u4e00-\u9fff]/.test(scheme.content || "");

  const result = await generateText({
    model: aiModel,
    system: `Convert the given markdown scheme into a structured JSON object. Output ONLY the JSON.${hasChinese ? " 保持中文内容。" : ""}`,
    prompt: `Convert this scheme to JSON with this structure:
{
  "overview": "2-3 sentence summary",
  "architecture": {
    "components": [{"name": "...", "responsibility": "...", "dependencies": ["..."]}],
    "dataFlow": ["Step 1", "Step 2"],
    "diagram": "optional"
  },
  "interfaces": [{"name": "TypeName", "language": "c|ts|go", "definition": "code", "description": "what it is"}],
  "decisions": [{"question": "...", "options": ["A","B"], "chosen": "A", "rationale": "why"}],
  "risks": [{"risk": "...", "severity": "low|medium|high", "mitigation": "..."}],
  "effort": [{"phase": "...", "tasks": ["..."], "hours": 4}]
}

Markdown scheme:
${scheme.content}`,
  });

  let parsed;
  try {
    const text = result.text.trim();
    parsed = JSON.parse(text.startsWith("{") ? text : text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, ""));
  } catch {
    return NextResponse.json({ error: "Failed to parse AI response as JSON" }, { status: 500 });
  }

  if (!parsed.overview || !parsed.architecture) {
    return NextResponse.json({ error: "Invalid structured scheme format" }, { status: 500 });
  }

  db.update(schemes)
    .set({ structuredContent: JSON.stringify(parsed), updatedAt: new Date().toISOString() })
    .where(eq(schemes.id, schemeId))
    .run();

  return NextResponse.json({ success: true });
}
