import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { syncGuidelinesToFiles } from "@/lib/guidelines-sync";
import { execSync } from "child_process";
import fs from "fs";

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

  // Auto-init git if target repo has no .git
  if (fs.existsSync(targetRepoPath) && !fs.existsSync(`${targetRepoPath}/.git`)) {
    try {
      execSync("git init && git add -A && git commit -m \"initial commit\" --allow-empty", {
        cwd: targetRepoPath, encoding: "utf-8", timeout: 10000,
      });
    } catch { /* ignore — may fail if no files or git not installed */ }
  }

  const db = getDb();
  const id = crypto.randomUUID();
  db.insert(projects).values({ id, name, icon: icon || "📁", description, guidelines, targetRepoPath }).run();

  // Write guidelines to CLAUDE.md and AGENTS.md in target repo
  if (guidelines) {
    syncGuidelinesToFiles(targetRepoPath, name, guidelines);
  }

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .get();
  return NextResponse.json(project, { status: 201 });
}
