import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { schemes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateTextAuto } from "@/lib/ai/generate";
import { parseJsonBody } from "@/lib/utils";

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

  try {
    const newContent = await generateTextAuto({
      system: `You are a senior software architect helping to revise a technical scheme.
You will receive the current scheme content and a modification request.
Apply the requested changes and return the COMPLETE updated scheme in Markdown.
Do NOT add explanations or comments about what you changed — just output the full updated scheme.`,
      prompt: `## Current Scheme

${scheme.content}

## Modification Request

${message}`,
    });

    // Update scheme
    db.update(schemes)
      .set({
        content: newContent,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schemes.id, schemeId))
      .run();

    const updated = db
      .select()
      .from(schemes)
      .where(eq(schemes.id, schemeId))
      .get();

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[scheme-chat] failed:", err);
    return NextResponse.json(
      { error: "Failed to modify scheme" },
      { status: 500 }
    );
  }
}
