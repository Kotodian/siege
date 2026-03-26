import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { schemes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { saveSchemeVersion } from "@/lib/scheme-version";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ schemeId: string }> }
) {
  const { schemeId } = await params;
  const db = getDb();
  const scheme = db
    .select()
    .from(schemes)
    .where(eq(schemes.id, schemeId))
    .get();

  if (!scheme) {
    return NextResponse.json({ error: "Scheme not found" }, { status: 404 });
  }

  return NextResponse.json(scheme);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ schemeId: string }> }
) {
  const { schemeId } = await params;
  const body = await req.json();
  const { title, content, structuredContent } = body;
  const db = getDb();

  // Save current version before update
  if (title !== undefined || content !== undefined || structuredContent !== undefined) {
    saveSchemeVersion(schemeId);
  }

  db.update(schemes)
    .set({
      ...(title !== undefined && { title }),
      ...(content !== undefined && { content }),
      ...(structuredContent !== undefined && { structuredContent }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schemes.id, schemeId))
    .run();

  const scheme = db
    .select()
    .from(schemes)
    .where(eq(schemes.id, schemeId))
    .get();
  return NextResponse.json(scheme);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ schemeId: string }> }
) {
  const { schemeId } = await params;
  const db = getDb();
  db.delete(schemes).where(eq(schemes.id, schemeId)).run();
  return NextResponse.json({ ok: true });
}
