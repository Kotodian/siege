import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const db = getDb();
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json(project);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await req.json();
  const { name, icon, description, guidelines, targetRepoPath } = body;
  const db = getDb();

  db.update(projects)
    .set({
      ...(name !== undefined && { name }),
      ...(icon !== undefined && { icon }),
      ...(description !== undefined && { description }),
      ...(guidelines !== undefined && { guidelines }),
      ...(targetRepoPath !== undefined && { targetRepoPath }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(projects.id, projectId))
    .run();

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  return NextResponse.json(project);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const db = getDb();
  db.delete(projects).where(eq(projects.id, projectId)).run();
  return NextResponse.json({ ok: true });
}
