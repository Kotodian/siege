import { NextRequest, NextResponse } from "next/server";
import { generateTextAuto } from "@/lib/ai/generate";
import { parseJsonBody } from "@/lib/utils";

export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;
  const { description } = body;

  if (!description || description.trim().length < 5) {
    return NextResponse.json(
      { error: "description must be at least 5 characters" },
      { status: 400 }
    );
  }

  try {
    const title = await generateTextAuto({
      system:
        "Generate a concise plan title (under 50 characters) from the given description. Output ONLY the title, nothing else. No quotes, no punctuation at the end.",
      prompt: description,
    });

    return NextResponse.json({ title });
  } catch (err) {
    console.error("[suggest-title] failed:", err);
    return NextResponse.json(
      { error: "Failed to generate title" },
      { status: 500 }
    );
  }
}
