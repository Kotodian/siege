import { spawn, type ChildProcess } from "child_process";
import fs from "fs";

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

interface SessionUpdate {
  sessionId: string;
  update: {
    sessionUpdate: string;
    content?: { type: string; text: string };
    plan?: { entries: Array<{ content: string; status: string }> };
    [key: string]: unknown;
  };
}

export interface AcpSessionInfo {
  sessionId: string;
  models?: {
    availableModels: Array<{ modelId: string; name: string; description: string }>;
    currentModelId: string;
  };
}

export interface AcpPromptResult {
  stopReason: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export type UpdateCallback = (type: string, text: string) => void;
export type WriteCallback = (filePath: string, content: string) => void;

export class AcpClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = "";
  private onUpdate: UpdateCallback | null = null;
  private onWrite: WriteCallback | null = null;
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  async start(): Promise<void> {
    this.proc = spawn("npx", ["-y", "@zed-industries/claude-agent-acp@latest"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.proc.stdout!.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.proc.stderr!.on("data", (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) console.error("[acp-agent]", msg);
    });

    this.proc.on("exit", () => {
      this.proc = null;
      for (const [, req] of this.pending) {
        req.reject(new Error("ACP agent exited"));
      }
      this.pending.clear();
    });

    // Wait for process to be ready
    await new Promise(r => setTimeout(r, 2000));

    // Initialize
    await this.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "siege", version: "0.1.0" },
      capabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });
  }

  async createSession(model?: string): Promise<AcpSessionInfo> {
    const result = await this.request("session/new", {
      cwd: this.repoPath,
      mcpServers: [],
    }) as AcpSessionInfo;

    if (model && result.sessionId) {
      try {
        await this.request("session/set_config_option", {
          sessionId: result.sessionId,
          key: "model",
          value: model,
        });
      } catch {
        // model setting might not be supported
      }
    }

    return result;
  }

  async resumeSession(sessionId: string): Promise<AcpSessionInfo> {
    try {
      const result = await this.request("session/load", {
        sessionId,
        cwd: this.repoPath,
      }) as AcpSessionInfo;
      return result;
    } catch {
      // Resume failed, create new session
      return this.createSession();
    }
  }

  async prompt(sessionId: string, text: string, callback: UpdateCallback, onWrite?: WriteCallback): Promise<AcpPromptResult> {
    this.onUpdate = callback;
    this.onWrite = onWrite || null;
    const result = await this.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    }) as AcpPromptResult;
    this.onUpdate = null;
    this.onWrite = null;
    return result;
  }

  async cancel(sessionId: string): Promise<void> {
    // Send as notification (no response expected)
    this.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    this.proc.kill();
    this.proc = null;
  }

  private request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin) {
        reject(new Error("ACP agent not started"));
        return;
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });

      // Timeout: 10min for prompts (large tasks), 60s for session ops, 30s for others
      const timeout = method === "session/prompt" ? 600000
        : method.startsWith("session/") ? 60000
        : 30000;
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`ACP request "${method}" timed out`));
        }
      }, timeout);
    });
  }

  private send(msg: Record<string, unknown>): void {
    if (!this.proc?.stdin) return;
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
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

        // Response to our request
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else p.resolve(msg.result);
          continue;
        }

        // Notification from agent
        if (msg.method === "session/update") {
          this.handleUpdate(msg.params as SessionUpdate);
          continue;
        }

        // Request from agent (needs response)
        if (msg.id !== undefined && msg.method) {
          this.handleAgentRequest(msg.id, msg.method, msg.params);
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  private handleUpdate(params: SessionUpdate): void {
    if (!this.onUpdate) return;
    const u = params.update;

    if (u.sessionUpdate === "agent_message_chunk" && u.content?.text) {
      this.onUpdate("text", u.content.text);
    } else if (u.sessionUpdate === "agent_thought_chunk" && u.content?.text) {
      this.onUpdate("thought", u.content.text);
    } else if (u.sessionUpdate === "tool_call_update") {
      const name = (u as Record<string, unknown>).toolName || (u as Record<string, unknown>).name || "tool";
      this.onUpdate("tool", `> **Tool: ${name}**\n`);
    } else if (u.sessionUpdate === "plan_update" && u.plan) {
      const planText = u.plan.entries.map(e => `- [${e.status}] ${e.content}`).join("\n");
      this.onUpdate("plan", planText);
    }
  }

  private handleAgentRequest(id: number, method: string, params: Record<string, unknown>): void {
    let result: unknown = {};

    if (method === "session/request_permission") {
      // Auto-approve all permissions
      const options = (params?.permission as Record<string, unknown>)?.options as Array<{ optionId: string }> | undefined;
      const allowOption = options?.find(o => o.optionId.includes("allow")) || options?.[0];
      result = { outcome: { type: "selected", optionId: allowOption?.optionId || "allow_once" } };
    } else if (method === "fs/read_text_file") {
      const uri = (params?.uri as string) || "";
      const filePath = uri.replace("file://", "");
      try {
        result = { text: fs.readFileSync(filePath, "utf-8") };
      } catch {
        result = { text: "" };
      }
    } else if (method === "fs/write_text_file") {
      const uri = (params?.uri as string) || "";
      const filePath = uri.replace("file://", "");
      const text = (params?.text as string) || "";
      try {
        fs.writeFileSync(filePath, text, "utf-8");
        if (this.onWrite) this.onWrite(filePath, text);
        result = {};
      } catch (e) {
        result = { error: String(e) };
      }
    }

    this.send({ jsonrpc: "2.0", id, result });
  }
}
