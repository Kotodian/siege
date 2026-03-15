import { generateTextAuto } from "./generate";
import type { Provider } from "./provider";

interface ReviewInput {
  type: "scheme" | "implementation";
  planName: string;
  items: Array<{ id: string; title: string; content: string }>;
  provider: Provider;
  model?: string;
}

interface GeneratedReviewItem {
  targetId: string;
  title: string;
  content: string;
  severity: "info" | "warning" | "critical";
}

interface GeneratedReview {
  summary: string;
  items: GeneratedReviewItem[];
  approved: boolean;
}

export async function generateReview(
  input: ReviewInput
): Promise<GeneratedReview> {
  const contextLabel =
    input.type === "scheme"
      ? "technical schemes/proposals"
      : "implemented code changes";

  const itemsSummary = input.items
    .map((item) => `### ${item.title} (id: ${item.id})\n${item.content}`)
    .join("\n\n");

  const text = await generateTextAuto({
    provider: input.provider,
    model: input.model,
    system: `You are a senior software engineer conducting a thorough review of ${contextLabel}.

Review for:
- Completeness: are all aspects covered?
- Correctness: are there technical errors or flaws?
- Quality: is the approach well-designed and maintainable?
- Risks: are there potential issues or edge cases?
- Security: are there security concerns?

Output a JSON object with:
- summary: overall review summary as markdown (string)
- items: array of findings, each with:
  - targetId: the id of the item this finding relates to (string)
  - title: short finding title (string)
  - content: detailed explanation as markdown (string)
  - severity: "info", "warning", or "critical" (string)
- approved: whether the review passes (boolean) — false if any critical items exist

Output ONLY the JSON object, no other text.`,
    prompt: `Plan: ${input.planName}\n\n${itemsSummary}`,
  });

  try {
    const jsonStr = text.startsWith("{")
      ? text
      : text.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonStr) throw new Error("No JSON object found");
    return JSON.parse(jsonStr);
  } catch {
    throw new Error("Failed to parse review from AI response");
  }
}
