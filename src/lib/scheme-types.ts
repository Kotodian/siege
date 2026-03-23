/** Structured scheme format for review-friendly rendering */
export interface StructuredScheme {
  overview: string;
  architecture: {
    components: Array<{
      name: string;
      responsibility: string;
      dependencies: string[];
    }>;
    dataFlow: string[];
    diagram?: string;
  };
  interfaces: Array<{
    name: string;
    language: string;
    definition: string;
    description: string;
  }>;
  decisions: Array<{
    question: string;
    options: string[];
    chosen: string;
    rationale: string;
  }>;
  risks: Array<{
    risk: string;
    severity: "low" | "medium" | "high";
    mitigation: string;
  }>;
}

export function parseStructuredScheme(json: string): StructuredScheme | null {
  try {
    const parsed = JSON.parse(json);
    if (parsed && parsed.overview && parsed.architecture) return parsed;
    return null;
  } catch {
    return null;
  }
}
