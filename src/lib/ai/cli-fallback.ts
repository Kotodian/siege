import { spawn } from "child_process";
import { execSync } from "child_process";

type CliEngine = "claude" | "codex";

function detectAvailableCli(): CliEngine {
  try {
    execSync("which claude", { stdio: "pipe" });
    return "claude";
  } catch {
    try {
      execSync("which codex", { stdio: "pipe" });
      return "codex";
    } catch {
      return "claude";
    }
  }
}

/**
 * Use claude or codex CLI with streaming.
 *
 * claude -p outputs all at once (not token-by-token streaming).
 * We send a "thinking" message first, then the full result.
 */
export function generateViaCli(prompt: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const engine = detectAvailableCli();

  return new ReadableStream({
    start(controller) {
      const args =
        engine === "claude"
          ? ["-p", prompt, "--output-format", "text"]
          : ["--prompt", prompt];

      const proc = spawn(engine, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Send immediate feedback
      controller.enqueue(
        encoder.encode(
          engine === "claude"
            ? "**Claude is thinking...**\n\n"
            : "**Codex is thinking...**\n\n"
        )
      );

      proc.stdout?.on("data", (chunk: Buffer) => {
        controller.enqueue(encoder.encode(chunk.toString()));
      });

      proc.stderr?.on("data", () => {});

      proc.on("close", () => {
        controller.close();
      });

      proc.on("error", (err) => {
        console.error(`[cli-fallback] ${engine} error:`, err.message);
        controller.enqueue(
          encoder.encode(`\n\nError: ${engine} CLI failed - ${err.message}`)
        );
        controller.close();
      });
    },
  });
}

/**
 * Use claude or codex CLI and wait for full output (non-streaming).
 */
export async function generateTextViaCli(prompt: string): Promise<string> {
  const engine = detectAvailableCli();

  return new Promise((resolve, reject) => {
    let output = "";
    const args =
      engine === "claude"
        ? ["-p", prompt, "--output-format", "text"]
        : ["--prompt", prompt];

    const proc = spawn(engine, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 || output) {
        resolve(output.trim());
      } else {
        reject(new Error(`${engine} CLI exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run ${engine} CLI: ${err.message}`));
    });
  });
}
