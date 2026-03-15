import { generateTextAuto } from "./generate";
import type { Provider } from "./provider";

interface ScheduleGenerationInput {
  planName: string;
  schemes: Array<{ id: string; title: string; content: string }>;
  provider: Provider;
  model?: string;
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
): Promise<GeneratedScheduleItem[]> {
  const schemeSummary = input.schemes
    .map((s, i) => `### Scheme ${i + 1}: ${s.title} (id: ${s.id})\n${s.content}`)
    .join("\n\n");

  const text = await generateTextAuto({
    provider: input.provider,
    model: input.model,
    system: `You are a project manager. Break down confirmed schemes into executable schedule items.

Output a JSON array of objects with these fields:
- schemeId: the scheme ID this task relates to (string or null)
- title: short task title (string)
- description: markdown description of what to do (string)
- durationDays: estimated days to complete (number)
- order: execution order starting from 1 (number)

Output ONLY the JSON array, no other text.`,
    prompt: `Plan: ${input.planName}\n\n${schemeSummary}\n\nBreak these schemes into executable tasks. Each task should be small enough to complete in 1-3 days.`,
  });

  try {
    const jsonStr = text.startsWith("[") ? text : text.match(/\[[\s\S]*\]/)?.[0];
    if (!jsonStr) throw new Error("No JSON array found in response");
    return JSON.parse(jsonStr);
  } catch {
    throw new Error("Failed to parse schedule from AI response");
  }
}
