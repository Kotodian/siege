import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  const db = getDb();
  const result = db
    .select()
    .from(projects)
    .orderBy(desc(projects.createdAt))
    .all();
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, icon, description, guidelines, targetRepoPath } = body;

  if (!name || !targetRepoPath) {
    return NextResponse.json(
      { error: "name and targetRepoPath are required" },
      { status: 400 }
    );
  }

  const db = getDb();
  const id = crypto.randomUUID();
  db.insert(projects).values({ id, name, icon: icon || "📁", description, guidelines, targetRepoPath }).run();

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .get();
  return NextResponse.json(project, { status: 201 });
}
