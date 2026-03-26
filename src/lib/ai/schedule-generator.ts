import { generateTextAuto } from "./generate";
import type { Provider } from "./provider";

interface ScheduleGenerationInput {
  planName: string;
  schemes: Array<{ id: string; title: string; content: string }>;
  provider: Provider;
  model?: string;
  sessionId?: string;
}

interface GeneratedSubtask {
  title: string;
  description: string;
  estimatedHours: number;
}

interface GeneratedScheduleItem {
  schemeId: string | null;
  title: string;
  description: string;
  durationDays: number;
  order: number;
  subtasks?: GeneratedSubtask[];
}

export async function generateSchedule(
  input: ScheduleGenerationInput
): Promise<{ items: GeneratedScheduleItem[]; sessionId?: string }> {
  const schemeSummary = input.schemes
    .map((s, i) => `### Scheme ${i + 1}: ${s.title} (id: ${s.id})\n${s.content}`)
    .join("\n\n");

  const result = await generateTextAuto({
    provider: input.provider,
    model: input.model,
    sessionId: input.sessionId,
    system: `You are a project manager. Break down confirmed schemes into executable schedule items with subtasks.

IMPORTANT task granularity rules:
- Each PARENT task = ONE COMPLETE FEATURE or functional module
- Each parent MUST have 2-5 subtasks breaking it into concrete steps
- Aim for 3-8 parent tasks total
- Each subtask should be a specific, actionable coding step (0.5-2 hours)

Output a JSON array of objects with these fields:
- schemeId: the scheme ID this task relates to (string or null)
- title: short parent task title (string)
- description: overall description of this task group (string)
- order: execution order starting from 1 (number)
- subtasks: array of subtask objects (REQUIRED, 2-5 items):
  - title: concise subtask title (string)
  - description: specific implementation details (string)
  - estimatedHours: number (0.5-2)

Output ONLY the JSON array, no other text.`,
    prompt: `Plan: ${input.planName}\n\n${schemeSummary}\n\nBreak these schemes into executable parent tasks with subtasks. Group by feature/module.`,
  });

  try {
    const jsonStr = result.text.startsWith("[")
      ? result.text
      : result.text.match(/\[[\s\S]*\]/)?.[0];
    if (!jsonStr) throw new Error("No JSON array found in response");
    return { items: JSON.parse(jsonStr), sessionId: result.sessionId };
  } catch {
    throw new Error("Failed to parse schedule from AI response");
  }
}
