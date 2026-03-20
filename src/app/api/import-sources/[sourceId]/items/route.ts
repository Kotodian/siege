import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { importConfigs, projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getImportSource } from "@/lib/import";
import { execSync } from "child_process";
import fs from "fs";

function getGitHubRepo(repoPath: string): string | null {
  if (!fs.existsSync(repoPath)) return null;
  try {
    const remote = execSync("git remote get-url origin", {
      cwd: repoPath, encoding: "utf-8", timeout: 5000,
    }).trim();
    // Parse GitHub URL: https://github.com/owner/repo.git or git@github.com:owner/repo.git
    const httpsMatch = remote.match(/github\.com\/([^/]+\/[^/.]+)/);
    if (httpsMatch) return httpsMatch[1];
    const sshMatch = remote.match(/github\.com:([^/]+\/[^/.]+)/);
    if (sshMatch) return sshMatch[1];
    return null;
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> }
) {
  const { sourceId } = await params;
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q") || undefined;
  const projectId = searchParams.get("projectId") || undefined;

  const db = getDb();
  const config = db
    .select()
    .from(importConfigs)
    .where(eq(importConfigs.id, sourceId))
    .get();

  if (!config) {
    return NextResponse.json(
      { error: "Import config not found" },
      { status: 404 }
    );
  }

  const source = getImportSource(config.source);
  if (!source) {
    return NextResponse.json(
      { error: `Unknown source: ${config.source}` },
      { status: 400 }
    );
  }

  const configObj = JSON.parse(config.config) as Record<string, string>;

  // For GitHub/GitLab: auto-detect repo from project if not configured
  if ((config.source === "github" || config.source === "gitlab") && !configObj.repo && !configObj.project_id && projectId) {
    const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (project) {
      const detectedRepo = getGitHubRepo(project.targetRepoPath);
      if (detectedRepo) {
        configObj.repo = detectedRepo;
      }
    }
  }

  const items = await source.listItems(configObj, query);

  return NextResponse.json(items);
}
