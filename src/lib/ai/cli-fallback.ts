import { spawn } from "child_process";

type CliEngine = "claude" | "codex";

function detectAvailableCli(): CliEngine {
  try {
    const { execSync } = require("child_process");
    execSync("which claude", { stdio: "pipe" });
    return "claude";
  } catch {
    try {
      const { execSync } = require("child_process");
      execSync("which codex", { stdio: "pipe" });
      return "codex";
    } catch {
      return "claude"; // default, will fail with clear error
    }
  }
}

/**
 * Use claude or codex CLI with streaming output.
 * Claude: stream-json mode, parse JSON Lines for assistant text
 * Codex: streams text directly
 */
export function generateViaCli(prompt: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const engine = detectAvailableCli();

  return new ReadableStream({
    start(controller) {
      let proc;

      if (engine === "claude") {
        proc = spawn(
          "claude",
          ["-p", prompt, "--output-format", "stream-json", "--verbose"],
          { stdio: ["pipe", "pipe", "pipe"] }
        );

        let buffer = "";
        proc.stdout?.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              if (event.type === "assistant" && event.subtype === "text" && event.content) {
                controller.enqueue(encoder.encode(event.content));
              }
              if (event.type === "content_block_delta" && event.delta?.text) {
                controller.enqueue(encoder.encode(event.delta.text));
              }
            } catch {
              // skip
            }
          }
        });
      } else {
        // Codex: text output streams directly
        proc = spawn("codex", ["--prompt", prompt], {
          stdio: ["pipe", "pipe", "pipe"],
        });

        proc.stdout?.on("data", (chunk: Buffer) => {
          controller.enqueue(encoder.encode(chunk.toString()));
        });
      }

      proc.stderr?.on("data", () => {});

      proc.on("close", () => {
        controller.close();
      });

      proc.on("error", (err: Error) => {
        console.error(`[cli-fallback] ${engine} spawn error:`, err.message);
        controller.enqueue(
          encoder.encode(`\n\nError: Failed to run ${engine} CLI - ${err.message}`)
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
