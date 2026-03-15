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

/**
 * Run claude/codex CLI with optional session resume.
 * Resuming a session is much faster — context is already loaded.
 * Returns { text, sessionId } so caller can store session for future use.
 */
export async function generateTextViaCli(
  prompt: string,
  sessionId?: string
): Promise<{ text: string; sessionId?: string }> {
  const engine = detectAvailableCli();

  return new Promise((resolve, reject) => {
    let textOutput = "";
    let detectedSessionId: string | undefined;

    let args: string[];
    if (engine === "claude") {
      args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
      if (sessionId) {
        args.push("--resume", sessionId);
      }
    } else {
      args = ["--prompt", prompt];
      if (sessionId) {
        args.push("--session", sessionId);
      }
    }

    const proc = spawn(engine, args, { stdio: ["pipe", "pipe", "pipe"] });

    let buffer = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.session_id && !detectedSessionId) {
            detectedSessionId = event.session_id;
          }
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text) {
                textOutput += block.text;
              }
            }
          }
        } catch {
          if (engine !== "claude") {
            textOutput += line + "\n";
          }
        }
      }
    });

    proc.stderr?.on("data", () => {});

    proc.on("close", (code) => {
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer);
          if (event.session_id && !detectedSessionId) {
            detectedSessionId = event.session_id;
          }
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text) {
                textOutput += block.text;
              }
            }
          }
        } catch {
          if (engine !== "claude") {
            textOutput += buffer;
          }
        }
      }

      if (code === 0 || textOutput) {
        resolve({ text: textOutput.trim(), sessionId: detectedSessionId });
      } else {
        reject(new Error(`${engine} CLI exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run ${engine} CLI: ${err.message}`));
    });
  });
}
