import { spawn, type ChildProcess } from "child_process";
import type { ImportSource } from "./types";

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

class McpClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = "";

  async start(
    command: string,
    args: string[],
    env: Record<string, string>
  ): Promise<void> {
    this.proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });

    this.proc.stdout!.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.proc.stderr!.on("data", (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) console.error("[mcp-import]", msg);
    });

    this.proc.on("exit", () => {
      this.proc = null;
      for (const [, req] of this.pending) {
        req.reject(new Error("MCP server exited"));
      }
      this.pending.clear();
    });

    // Wait for process to be ready
    await new Promise((r) => setTimeout(r, 1000));

    // Initialize
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      clientInfo: { name: "siege-import", version: "0.1.0" },
      capabilities: {},
    });
  }

  async request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin) {
        reject(new Error("MCP server not started"));
        return;
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      this.proc.stdin.write(msg + "\n");

      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request "${method}" timed out`));
        }
      }, 30000);
    });
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    this.proc.kill();
    this.proc = null;
  }

  private processBuffer(): void {
    while (true) {
      const idx = this.buffer.indexOf("\n");
      if (idx < 0) break;
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;

      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error)
            p.reject(
              new Error(msg.error.message || JSON.stringify(msg.error))
            );
          else p.resolve(msg.result);
        }
      } catch {
        // ignore parse errors
      }
    }
  }
}

function parseConfig(config: Record<string, string>): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  const command = config.server_command || "";
  let args: string[] = [];
  let env: Record<string, string> = {};
  try {
    args = JSON.parse(config.server_args || "[]");
  } catch {
    args = [];
  }
  try {
    env = JSON.parse(config.server_env || "{}");
  } catch {
    env = {};
  }
  return { command, args, env };
}

function parseMarkdownToSchemes(
  markdown: string,
  fallbackTitle: string
): { description: string; schemes: Array<{ title: string; content: string }> } {
  const lines = markdown.split("\n");
  const schemes: Array<{ title: string; content: string }> = [];
  let description = "";
  let current: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const h2 = line.match(/^## (.+)/);
    if (h2) {
      if (current) {
        schemes.push({
          title: current.title,
          content: current.lines.join("\n").trim(),
        });
      }
      current = { title: h2[1], lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      description += line + "\n";
    }
  }
  if (current) {
    schemes.push({
      title: current.title,
      content: current.lines.join("\n").trim(),
    });
  }

  if (schemes.length === 0) {
    schemes.push({ title: fallbackTitle, content: markdown.trim() });
  }

  return { description: description.trim(), schemes };
}

export const mcpSource: ImportSource = {
  name: "mcp",

  async validate(config) {
    const { command } = parseConfig(config);
    if (!command) return false;
    const client = new McpClient();
    try {
      const { args, env } = parseConfig(config);
      await client.start(command, args, env);
      await client.stop();
      return true;
    } catch {
      await client.stop();
      return false;
    }
  },

  async listItems(config) {
    const { command, args, env } = parseConfig(config);
    if (!command) return [];

    const client = new McpClient();
    try {
      await client.start(command, args, env);
      const result = (await client.request("resources/list", {})) as {
        resources?: Array<{
          uri: string;
          name?: string;
          description?: string;
        }>;
      };
      await client.stop();

      return (result.resources || []).map((r) => ({
        id: r.uri,
        title: r.name || r.uri,
        description: r.description || "",
        source: "mcp",
      }));
    } catch {
      await client.stop();
      return [];
    }
  },

  async fetchItem(config, itemId) {
    const { command, args, env } = parseConfig(config);
    const client = new McpClient();
    try {
      await client.start(command, args, env);
      const result = (await client.request("resources/read", {
        uri: itemId,
      })) as {
        contents?: Array<{ text?: string; uri?: string }>;
      };
      await client.stop();

      const text = result.contents?.[0]?.text || "";
      const resourceName =
        result.contents?.[0]?.uri?.split("/").pop() || "MCP Resource";
      const { description, schemes } = parseMarkdownToSchemes(
        text,
        resourceName
      );

      return {
        planName: resourceName,
        planDescription: description,
        planTag: "feature",
        schemes,
      };
    } catch (err) {
      await client.stop();
      throw err;
    }
  },
};
