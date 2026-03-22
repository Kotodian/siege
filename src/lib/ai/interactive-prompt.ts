/**
 * Prompt builders for interactive scheme generation.
 * Phase 1 (Analysis): AI explores code, generates decision questions.
 * Phase 2 (Synthesis): AI generates scheme using user's answers.
 */

import type { QAEntry } from "./interactive-session";

export interface GeneratedQuestion {
  id: string;
  text: string;
  options: string[];
  default?: string;
}

export function buildAnalysisPrompt(
  planName: string,
  planDescription: string,
  projectDescription: string,
  hasChinese: boolean,
): string {
  const lang = hasChinese
    ? "用中文输出所有内容。"
    : "Output all content in English.";

  return `You are a senior software architect helping design a technical scheme.

${lang}

Project: ${projectDescription || "(no description)"}
Plan: ${planName}
Requirements: ${planDescription}

Your task: Identify 2-4 KEY DESIGN DECISIONS that the user should make before you generate the full technical scheme.

Rules for good questions:
- Each question should be about a MEANINGFUL architectural or design choice
- Provide 2-4 concrete options with brief pros/cons
- Include a recommended default option
- Do NOT ask about: variable naming, code style, obvious choices, things already specified

Good examples:
- "Which state management approach?" → Options: Redux, Zustand, Context API
- "Database migration strategy?" → Options: Incremental with rollback, Big-bang, Shadow table
- "API authentication method?" → Options: JWT, Session cookies, OAuth2

Bad examples (DO NOT ask these):
- "Should we use TypeScript?" (obvious)
- "What should we name the component?" (trivial)
- "Should we write tests?" (always yes)

Output ONLY a JSON array of question objects. No other text.
Each object has: id (string), text (string), options (string array), default (string - one of the options).

Example output:
[
  {"id":"q1","text":"Which database should we use for session storage?","options":["Redis (fast, volatile)","PostgreSQL (durable, ACID)","SQLite (simple, embedded)"],"default":"PostgreSQL (durable, ACID)"},
  {"id":"q2","text":"How should we handle real-time updates?","options":["WebSocket (bidirectional)","SSE (server push)","Polling (simple)"],"default":"SSE (server push)"}
]`;
}

export function buildSynthesisPrompt(
  planName: string,
  planDescription: string,
  projectDescription: string,
  schemeSummary: string,
  qaHistory: QAEntry[],
  hasChinese: boolean,
): string {
  const lang = hasChinese
    ? "用中文输出完整的技术方案。"
    : "Output the full technical scheme in English.";

  const decisions = qaHistory.length > 0
    ? "The user has made the following design decisions:\n" +
      qaHistory.map((qa) => `- **${qa.question}** → ${qa.answer}`).join("\n") +
      "\n\nYou MUST follow these decisions in the scheme."
    : "";

  return `You are a senior software architect generating a detailed technical scheme.

${lang}

Project: ${projectDescription || "(no description)"}
Plan: ${planName}
Requirements: ${planDescription}

${decisions}

${schemeSummary ? `Existing schemes for context:\n${schemeSummary}` : ""}

You MUST use EXACTLY these section headings:

## Overview
Brief summary of what this scheme achieves and why.

## Architecture & Definitions
Define key types, interfaces, data structures, modules, and their relationships. This is the MOST IMPORTANT section — describe data flow, component boundaries, and how pieces connect. ${qaHistory.length > 0 ? "Reference the user's decisions above." : ""}

## Key Decisions
Trade-offs, alternatives considered, and rationale.

## Risks & Mitigations
Potential issues and how to handle them.

## Estimated Effort
Rough time estimate.

RULES:
- Focus on WHAT and WHY, not HOW
- Do NOT write code blocks or step-by-step implementation procedures
- The "Architecture & Definitions" section must be the longest and most detailed
- Output the COMPLETE scheme — do not truncate or summarize`;
}

export function parseQuestionsFromAIOutput(text: string): GeneratedQuestion[] {
  try {
    const jsonStr = text.startsWith("[") ? text : text.match(/\[[\s\S]*\]/)?.[0];
    if (!jsonStr) return [];
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (q: unknown): q is GeneratedQuestion =>
          typeof q === "object" && q !== null &&
          typeof (q as GeneratedQuestion).id === "string" &&
          typeof (q as GeneratedQuestion).text === "string" &&
          Array.isArray((q as GeneratedQuestion).options)
      )
      .slice(0, 4); // Max 4 questions
  } catch {
    return [];
  }
}
