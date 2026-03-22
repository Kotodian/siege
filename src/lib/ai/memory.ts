import { getDb } from "@/lib/db";
import { memories } from "@/lib/db/schema";
import { eq, isNull, or } from "drizzle-orm";

/** Load project + global memories as context string for AI prompts */
export function loadMemoryContext(projectId: string): string {
  const db = getDb();
  const items = db.select().from(memories)
    .where(or(eq(memories.projectId, projectId), isNull(memories.projectId)))
    .all();

  if (items.length === 0) return "";

  const projectItems = items.filter(m => m.projectId === projectId);
  const globalItems = items.filter(m => !m.projectId);

  const lines: string[] = [];
  if (projectItems.length > 0) {
    lines.push("Project context:");
    for (const m of projectItems) {
      lines.push(`- ${m.title}: ${m.content}`);
    }
  }
  if (globalItems.length > 0) {
    lines.push("User preferences:");
    for (const m of globalItems) {
      lines.push(`- ${m.title}: ${m.content}`);
    }
  }

  return lines.join("\n");
}

/** Auto-extract memories from execution result (call AI to summarize) */
export function buildMemoryExtractionPrompt(taskTitle: string, executionLog: string): string {
  return `Based on the following task execution, extract 1-3 key learnings about this project that would be useful for future tasks. Focus on: tech stack details, architecture patterns, gotchas/pitfalls encountered, important conventions.

Task: ${taskTitle}
Execution log (last 2000 chars):
${executionLog.slice(-2000)}

Output ONLY a JSON array of objects: [{"title": "short title", "content": "detail"}]
Maximum 3 items. If nothing notable, output empty array [].`;
}
