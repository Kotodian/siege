import { NextRequest, NextResponse } from "next/server";
import { generateTextAuto } from "@/lib/ai/generate";
import { getProjectSessionId, saveProjectSessionId } from "@/lib/ai/session";
import { parseJsonBody } from "@/lib/utils";

// In-memory store for pending title results
const pendingTitles = new Map<string, { status: "pending" | "done" | "error"; title?: string }>();

export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;
  const { description, projectId } = body;

  if (!description || description.trim().length < 5) {
    return NextResponse.json(
      { error: "description must be at least 5 characters" },
      { status: 400 }
    );
  }

  const id = crypto.randomUUID();
  pendingTitles.set(id, { status: "pending" });

  const sessionId = projectId ? getProjectSessionId(projectId) : undefined;

  generateTextAuto({
    system:
      "Generate a concise plan title (under 50 characters) from the given description. Output ONLY the title, nothing else. No quotes, no punctuation at the end.",
    prompt: description,
    sessionId,
  })
    .then((result) => {
      pendingTitles.set(id, { status: "done", title: result.text });
      if (result.sessionId && projectId) {
        saveProjectSessionId(projectId, result.sessionId);
      }
      setTimeout(() => pendingTitles.delete(id), 300000);
    })
    .catch(() => {
      pendingTitles.set(id, { status: "error" });
      setTimeout(() => pendingTitles.delete(id), 60000);
    });

  return NextResponse.json({ requestId: id, status: "pending" }, { status: 202 });
}

export async function GET(req: NextRequest) {
  const requestId = req.nextUrl.searchParams.get("requestId");
  if (!requestId) {
    return NextResponse.json({ error: "requestId required" }, { status: 400 });
  }

  const result = pendingTitles.get(requestId);
  if (!result) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  return NextResponse.json(result);
}
