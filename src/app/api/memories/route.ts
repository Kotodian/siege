import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { memories } from "@/lib/db/schema";
import { eq, isNull, or } from "drizzle-orm";
import { parseJsonBody } from "@/lib/utils";

/** GET /api/memories?projectId=xxx — list project + global memories */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const db = getDb();

  const items = projectId
    ? db.select().from(memories)
        .where(or(eq(memories.projectId, projectId), isNull(memories.projectId)))
        .all()
    : db.select().from(memories).where(isNull(memories.projectId)).all();

  return NextResponse.json(items);
}

/** POST /api/memories — create a memory */
export async function POST(req: NextRequest) {
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;

  const { projectId, type, title, content, source } = body as {
    projectId?: string;
    type?: string;
    title: string;
    content: string;
    source?: string;
  };

  if (!title || !content) {
    return NextResponse.json({ error: "title and content required" }, { status: 400 });
  }

  const db = getDb();
  const id = crypto.randomUUID();
  db.insert(memories).values({
    id,
    projectId: projectId || null,
    type: (type as "project" | "user" | "feedback") || "project",
    title,
    content,
    source: (source as "auto" | "manual") || "manual",
  }).run();

  return NextResponse.json({ id }, { status: 201 });
}
