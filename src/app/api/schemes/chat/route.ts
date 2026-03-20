import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { schemes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getStepModel } from "@/lib/ai/config";
import { streamText } from "ai";
import { parseJsonBody } from "@/lib/utils";
import { saveSchemeVersion } from "@/lib/scheme-version";

export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;

  const { schemeId, message } = body as {
    schemeId: string;
    message: string;
  };

  if (!schemeId || !message) {
    return NextResponse.json(
      { error: "schemeId and message are required" },
      { status: 400 }
    );
  }

  const db = getDb();
  const scheme = db
    .select()
    .from(schemes)
    .where(eq(schemes.id, schemeId))
    .get();

  if (!scheme) {
    return NextResponse.json({ error: "Scheme not found" }, { status: 404 });
  }

  let model;
  try {
    model = getStepModel("scheme");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 503 });
  }
  const result = streamText({
    model,
    system: `You are a scheme editor. Output Markdown only. No conversation.

CRITICAL: Do NOT ask questions, request access, or use tools. Just modify the scheme as requested.

Apply the requested changes and return the COMPLETE updated scheme in Markdown.
Do NOT add explanations or comments about what you changed — just output the full updated scheme.`,
    prompt: `## Current Scheme\n\n${scheme.content}\n\n## Modification Request\n\n${message}`,
  });

  // Save after stream completes
  const textStream = result.textStream;
  const encoder = new TextEncoder();
  let fullText = "";

  const responseStream = new ReadableStream({
    async start(controller) {
      for await (const chunk of textStream) {
        fullText += chunk;
        controller.enqueue(encoder.encode(chunk));
      }
      if (fullText.trim()) {
        saveSchemeVersion(schemeId);
        const db = getDb();
        db.update(schemes)
          .set({ content: fullText.trim(), updatedAt: new Date().toISOString() })
          .where(eq(schemes.id, schemeId))
          .run();
      }
      controller.close();
    },
  });

  return new Response(responseStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
