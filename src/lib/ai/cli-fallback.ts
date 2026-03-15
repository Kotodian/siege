import { spawn, execSync } from "child_process";

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

// Strip ANSI escape codes and terminal control sequences
function stripAnsi(text: string): string {
  return text
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1B\][^\x07]*\x07/g, "")
    .replace(/\x1B\[[?][0-9;]*[a-zA-Z]/g, "")
    .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F]/g, "");
}

/**
 * Use claude or codex CLI with real-time output via pseudo-tty.
 * `script -qc` forces line-buffered output so we get data as it's produced.
 */
export function generateViaCli(prompt: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const engine = detectAvailableCli();

  return new ReadableStream({
    start(controller) {
      let proc;

      if (engine === "claude") {
        // Use script to force pseudo-tty for real-time output
        const escapedPrompt = prompt.replace(/'/g, "'\\''");
        proc = spawn(
          "script",
          ["-qc", `claude -p '${escapedPrompt}' --output-format text`, "/dev/null"],
          { stdio: ["pipe", "pipe", "pipe"] }
        );
      } else {
        proc = spawn("codex", ["--prompt", prompt], {
          stdio: ["pipe", "pipe", "pipe"],
        });
      }

      proc.stdout?.on("data", (chunk: Buffer) => {
        const text = engine === "claude"
          ? stripAnsi(chunk.toString())
          : chunk.toString();
        if (text.trim()) {
          controller.enqueue(encoder.encode(text));
        }
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
