import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { memories } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { parseJsonBody } from "@/lib/utils";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ memoryId: string }> }
) {
  const { memoryId } = await params;
  const [body, errRes] = await parseJsonBody(req);
  if (errRes) return errRes;

  const { title, content, type } = body as { title?: string; content?: string; type?: string };
  const db = getDb();

  db.update(memories).set({
    ...(title !== undefined && { title }),
    ...(content !== undefined && { content }),
    ...(type !== undefined && { type: type as "project" | "user" | "feedback" }),
    updatedAt: new Date().toISOString(),
  }).where(eq(memories.id, memoryId)).run();

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ memoryId: string }> }
) {
  const { memoryId } = await params;
  const db = getDb();
  db.delete(memories).where(eq(memories.id, memoryId)).run();
  return NextResponse.json({ ok: true });
}
