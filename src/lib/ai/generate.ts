import { generateText } from "ai";
import { hasApiKey, getConfiguredModel } from "./config";
import { generateTextViaCli } from "./cli-fallback";
import type { Provider } from "./provider";
import fs from "fs";
import path from "path";

const LOCK_FILE = path.join(process.cwd(), "data", ".ai-lock");

function waitForLock(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      try {
        if (!fs.existsSync(LOCK_FILE)) { resolve(); return; }
        const pid = fs.readFileSync(LOCK_FILE, "utf-8").trim();
        try { process.kill(Number(pid), 0); } catch { fs.unlinkSync(LOCK_FILE); resolve(); return; }
      } catch { resolve(); return; }
      setTimeout(check, 1000);
    };
    check();
  });
}

function acquireLock() { fs.writeFileSync(LOCK_FILE, String(process.pid)); }
function releaseLock() { try { fs.unlinkSync(LOCK_FILE); } catch {} }

/**
 * Generate text using SDK if API key available, otherwise fall back to claude CLI.
 * CLI calls use file lock to prevent process pile-up (survives hot reload).
 */
export async function generateTextAuto(options: {
  provider?: Provider;
  model?: string;
  system: string;
  prompt: string;
  sessionId?: string;
}): Promise<{ text: string; sessionId?: string }> {
  const provider = options.provider || "anthropic";

  if (hasApiKey(provider)) {
    const model = getConfiguredModel(provider, options.model);
    const result = await generateText({
      model,
      system: options.system,
      prompt: options.prompt,
    });
    return { text: result.text.trim() };
  }

  // Fallback to claude CLI — wait for file lock
  const fullPrompt = options.system
    ? `${options.system}\n\n---\n\n${options.prompt}`
    : options.prompt;

  await waitForLock();
  acquireLock();
  try {
    const result = await generateTextViaCli(fullPrompt, options.sessionId);
    return result;
  } finally {
    releaseLock();
  }
}
