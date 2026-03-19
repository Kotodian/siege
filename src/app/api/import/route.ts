import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { plans, projects, schemes, importConfigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { getImportSource } from "@/lib/import";

interface ParsedPlan {
  name: string;
  description: string;
  schemes: Array<{ title: string; content: string }>;
}

function parseMarkdown(content: string, fileName: string): ParsedPlan {
  const lines = content.split("\n");
  const planName = path.basename(fileName, ".md");

  const parsedSchemes: Array<{ title: string; content: string }> = [];
  let description = "";
  let currentScheme: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)/);
    if (h2Match) {
      // Save previous scheme
      if (currentScheme) {
        parsedSchemes.push({
          title: currentScheme.title,
          content: currentScheme.lines.join("\n").trim(),
        });
      }
      currentScheme = { title: h2Match[1], lines: [] };
    } else if (currentScheme) {
      currentScheme.lines.push(line);
    } else {
      // Before first ## heading = plan description
      description += line + "\n";
    }
  }

  // Save last scheme
  if (currentScheme) {
    parsedSchemes.push({
      title: currentScheme.title,
      content: currentScheme.lines.join("\n").trim(),
    });
  }

  return {
    name: planName,
    description: description.trim(),
    schemes: parsedSchemes,
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { projectId, filePath, source, sourceId, itemId } = body;

  if (!projectId) {
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400 }
    );
  }

  // Source-based import (Notion, Jira, Confluence, MCP)
  if (source && sourceId && itemId) {
    return handleSourceImport(projectId, source, sourceId, itemId);
  }

  // Markdown file import (original behavior)
  if (!filePath) {
    return NextResponse.json(
      { error: "filePath is required for markdown import" },
      { status: 400 }
    );
  }

  // Resolve and validate the file path
  const resolvedPath = path.resolve(filePath);

  if (!resolvedPath.endsWith(".md")) {
    return NextResponse.json(
      { error: "Only .md files are supported" },
      { status: 400 }
    );
  }

  // Log project context for auditing
  const db0 = getDb();
  const project = db0
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  console.log(
    `[import] Importing file "${resolvedPath}" for project "${project?.name}" (targetRepoPath: ${project?.targetRepoPath})`
  );

  let content: string;
  try {
    content = fs.readFileSync(resolvedPath, "utf-8");
  } catch {
    return NextResponse.json(
      { error: "File not found or unreadable" },
      { status: 404 }
    );
  }

  const parsed = parseMarkdown(content, path.basename(resolvedPath));

  return createPlanFromImport(projectId, parsed.name, parsed.description, "feature", parsed.schemes, "manual");
}

async function handleSourceImport(
  projectId: string,
  source: string,
  sourceId: string,
  itemId: string
) {
  const importSource = getImportSource(source);
  if (!importSource) {
    return NextResponse.json(
      { error: `Unknown import source: ${source}` },
      { status: 400 }
    );
  }

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

  const configObj = JSON.parse(config.config) as Record<string, string>;
  const result = await importSource.fetchItem(configObj, itemId);

  return createPlanFromImport(
    projectId,
    result.planName,
    result.planDescription,
    result.planTag,
    result.schemes,
    source as "notion" | "jira" | "confluence" | "mcp"
  );
}

function createPlanFromImport(
  projectId: string,
  name: string,
  description: string,
  tag: string,
  importedSchemes: Array<{ title: string; content: string }>,
  sourceType: "manual" | "notion" | "jira" | "confluence" | "mcp" | "feishu" | "github" | "gitlab"
) {
  const db = getDb();

  const planId = crypto.randomUUID();
  db.insert(plans)
    .values({
      id: planId,
      projectId,
      name,
      description,
      tag,
      status: importedSchemes.length > 0 ? "reviewing" : "draft",
    })
    .run();

  for (const scheme of importedSchemes) {
    db.insert(schemes)
      .values({
        id: crypto.randomUUID(),
        planId,
        title: scheme.title,
        content: scheme.content,
        sourceType,
      })
      .run();
  }

  const plan = db.select().from(plans).where(eq(plans.id, planId)).get();
  const planSchemes = db
    .select()
    .from(schemes)
    .where(eq(schemes.planId, planId))
    .all();

  return NextResponse.json(
    { plan, schemes: planSchemes },
    { status: 201 }
  );
}
