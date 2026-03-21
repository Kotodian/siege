import { generateTextAuto } from "./generate";
import type { Provider } from "./provider";

interface ScheduleGenerationInput {
  planName: string;
  schemes: Array<{ id: string; title: string; content: string }>;
  provider: Provider;
  model?: string;
  sessionId?: string;
}

interface GeneratedScheduleItem {
  schemeId: string | null;
  title: string;
  description: string;
  durationDays: number;
  order: number;
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
    system: `You are a project manager. Break down confirmed schemes into executable schedule items.

IMPORTANT task granularity rules:
- Each task should represent a COMPLETE FEATURE or functional module, NOT a single definition/struct/type.
- Do NOT create tasks for individual definitions, types, constants, or data structures alone.
- Group related work together: defining types + implementing logic + wiring it up = ONE task.
- Aim for 3-8 tasks total. Fewer, bigger tasks are better than many tiny ones.
- Each task should produce a working, testable piece of functionality when completed.

Output a JSON array of objects with these fields:
- schemeId: the scheme ID this task relates to (string or null)
- title: short task title (string)
- description: markdown description of what to do — include ALL sub-steps (define types, implement logic, wire up, etc.) in the description (string)
- durationDays: estimated days to complete (number)
- order: execution order starting from 1 (number)

Output ONLY the JSON array, no other text.`,
    prompt: `Plan: ${input.planName}\n\n${schemeSummary}\n\nBreak these schemes into executable tasks. Group by feature/module — do NOT split definitions, types, or data structures into separate tasks. Each task should be a complete, independently testable unit of work.`,
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
