import { NextRequest, NextResponse } from "next/server";
import { generateTextViaCli } from "@/lib/ai/cli-fallback";
import { hasApiKey, getConfiguredModel } from "@/lib/ai/config";
import { getProjectSessionId, saveProjectSessionId } from "@/lib/ai/session";
import { createAiTask, getAiTaskStatus } from "@/lib/ai/queue";
import { parseJsonBody } from "@/lib/utils";
import { generateText } from "ai";

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

  const taskId = crypto.randomUUID();
  const sessionId = projectId ? getProjectSessionId(projectId) : undefined;

  if (hasApiKey()) {
    try {
      const model = getConfiguredModel();
      const result = await generateText({
        model,
        system: "Generate a concise plan title (under 50 characters). Output ONLY the title.",
        prompt: description,
      });
      return NextResponse.json({ requestId: taskId, status: "done", title: result.text.trim() });
    } catch {
      return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
  }

  // CLI mode — async via DB-backed queue
  createAiTask(taskId, "suggest-title", async () => {
    const prompt = "Generate a concise plan title (under 50 characters) from the given description. Output ONLY the title, nothing else.\n\n---\n\n" + description;
    const result = await generateTextViaCli(prompt, sessionId);
    if (result.sessionId && projectId) {
      saveProjectSessionId(projectId, result.sessionId);
    }
    return result.text.trim();
  });

  return NextResponse.json({ requestId: taskId, status: "pending" }, { status: 202 });
}

export async function GET(req: NextRequest) {
  const requestId = req.nextUrl.searchParams.get("requestId");
  if (!requestId) {
    return NextResponse.json({ error: "requestId required" }, { status: 400 });
  }

  const task = getAiTaskStatus(requestId);
  if (!task) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  if (task.status === "done") {
    return NextResponse.json({ status: "done", title: task.result });
  }
  if (task.status === "error") {
    return NextResponse.json({ status: "error" });
  }
  return NextResponse.json({ status: task.status });
}
