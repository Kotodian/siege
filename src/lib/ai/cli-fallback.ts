import { spawn } from "child_process";

/**
 * Use `claude -p` CLI as a fallback when no API key is configured.
 * Returns a ReadableStream for streaming the response.
 */
export function generateViaCli(prompt: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      const proc = spawn("claude", ["-p", prompt, "--output-format", "text"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      proc.stdout?.on("data", (chunk: Buffer) => {
        controller.enqueue(encoder.encode(chunk.toString()));
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        // Log but don't send to stream
        console.error("[cli-fallback] stderr:", chunk.toString());
      });

      proc.on("close", () => {
        controller.close();
      });

      proc.on("error", (err) => {
        console.error("[cli-fallback] spawn error:", err.message);
        controller.enqueue(
          encoder.encode(`\n\nError: Failed to run claude CLI - ${err.message}`)
        );
        controller.close();
      });
    },
  });
}

/**
 * Use `claude -p` CLI and wait for full output (non-streaming).
 */
export async function generateTextViaCli(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const proc = spawn("claude", ["-p", prompt, "--output-format", "text"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 || output) {
        resolve(output.trim());
      } else {
        reject(new Error(`claude CLI exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run claude CLI: ${err.message}`));
    });
  });
}
