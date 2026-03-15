import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { plans, schemes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";

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
  const { projectId, filePath } = body;

  if (!projectId || !filePath) {
    return NextResponse.json(
      { error: "projectId and filePath are required" },
      { status: 400 }
    );
  }

  // Validate file exists and is markdown
  if (!filePath.endsWith(".md")) {
    return NextResponse.json(
      { error: "Only .md files are supported" },
      { status: 400 }
    );
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return NextResponse.json(
      { error: "File not found or unreadable" },
      { status: 404 }
    );
  }

  const parsed = parseMarkdown(content, path.basename(filePath));

  const db = getDb();

  // Create plan
  const planId = crypto.randomUUID();
  db.insert(plans)
    .values({
      id: planId,
      projectId,
      name: parsed.name,
      description: parsed.description,
      status: parsed.schemes.length > 0 ? "reviewing" : "draft",
    })
    .run();

  // Create schemes
  for (const scheme of parsed.schemes) {
    db.insert(schemes)
      .values({
        id: crypto.randomUUID(),
        planId,
        title: scheme.title,
        content: scheme.content,
        sourceType: "manual",
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
