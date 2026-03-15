import { generateText } from "ai";
import { getModelId, type Provider } from "./provider";

interface TestGenerationInput {
  planName: string;
  schemes: Array<{ title: string; content: string }>;
  targetRepoPath: string;
  provider: Provider;
  model?: string;
}

interface GeneratedTestCase {
  name: string;
  description: string;
  type: "unit" | "integration" | "e2e";
  generatedCode: string;
  filePath: string;
}

export async function generateTests(
  input: TestGenerationInput
): Promise<GeneratedTestCase[]> {
  const modelId = getModelId(input.provider, input.model);

  const schemeSummary = input.schemes
    .map((s, i) => `### Scheme ${i + 1}: ${s.title}\n${s.content}`)
    .join("\n\n");

  const result = await generateText({
    model: modelId,
    system: `You are a senior test engineer. Generate test cases for completed development work.

Output a JSON array of test case objects with these fields:
- name: test function name (string)
- description: what this test validates (string)
- type: "unit", "integration", or "e2e" (string)
- generatedCode: the full test code as a string (string)
- filePath: suggested file path relative to project root (string)

Generate comprehensive tests covering:
- Happy path scenarios
- Edge cases and boundary conditions
- Error handling
- Integration between components

Output ONLY the JSON array, no other text.`,
    prompt: `Project repository: ${input.targetRepoPath}
Plan: ${input.planName}

${schemeSummary}

Generate test cases for the implementation described in these schemes.`,
  });

  try {
    const text = result.text.trim();
    const jsonStr = text.startsWith("[")
      ? text
      : text.match(/\[[\s\S]*\]/)?.[0];
    if (!jsonStr) throw new Error("No JSON array found in response");
    return JSON.parse(jsonStr);
  } catch {
    throw new Error("Failed to parse test cases from AI response");
  }
}
