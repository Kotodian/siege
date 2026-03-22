import { spawn, execSync, type ChildProcess } from "child_process";
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
  private agentType: "claude" | "codex";
  private terminals = new Map<string, { output: string; exitCode: number | null }>();
  private stderrBuffer: string[] = [];

  constructor(repoPath: string, agentType: "claude" | "codex" = "claude") {
    this.repoPath = repoPath;
    this.agentType = agentType;
  }

  async start(): Promise<void> {
    const agentPkg = this.agentType === "codex"
      ? "@zed-industries/codex-acp@latest"
      : "@zed-industries/claude-agent-acp@latest";
    this.proc = spawn("npx", ["-y", agentPkg], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let earlyExit = false;
    let earlyExitCode: number | null = null;

    this.proc.stdout!.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.proc.stderr!.on("data", (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) {
        console.error("[acp-agent]", msg);
        this.stderrBuffer.push(msg);
        // Keep only last 20 stderr lines
        if (this.stderrBuffer.length > 20) this.stderrBuffer.shift();
      }
    });

    this.proc.on("exit", (code) => {
      earlyExit = true;
      earlyExitCode = code;
      this.proc = null;
      for (const [, req] of this.pending) {
        req.reject(new Error(`ACP agent exited (code ${code})`));
      }
      this.pending.clear();
    });

    // Wait for process to be ready — poll instead of hardcoded delay
    const startTime = Date.now();
    const maxWait = 15000; // 15s max for npx to download + start
    while (Date.now() - startTime < maxWait) {
      if (earlyExit) {
        const stderr = this.stderrBuffer.join("\n");
        throw new Error(
          `ACP agent (${this.agentType}) failed to start (exit code ${earlyExitCode}).` +
          (stderr ? ` Stderr: ${stderr.slice(-500)}` : "")
        );
      }
      // Check if stdout has received any data (agent is alive)
      if (this.buffer.length > 0 || this.pending.size > 0) break;
      await new Promise(r => setTimeout(r, 300));
    }

    if (!this.proc) {
      const stderr = this.stderrBuffer.join("\n");
      throw new Error(
        `ACP agent (${this.agentType}) not running after ${maxWait / 1000}s.` +
        (stderr ? ` Stderr: ${stderr.slice(-500)}` : "")
      );
    }

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
        // Try both param formats: "configId" (newer ACP) and "key" (older ACP)
        await this.request("session/set_config_option", {
          sessionId: result.sessionId,
          configId: "model",
          value: model,
        });
      } catch (e1) {
        try {
          await this.request("session/set_config_option", {
            sessionId: result.sessionId,
            key: "model",
            value: model,
          });
        } catch {
          console.warn(`[acp] Could not set model to ${model}:`, e1 instanceof Error ? e1.message : e1);
        }
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

  /** Get recent stderr output for error reporting */
  getRecentErrors(): string {
    return this.stderrBuffer.join("\n");
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

      // Timeout: 30min for prompts (large tasks), 60s for session ops, 30s for others
      const timeout = method === "session/prompt" ? 1800000
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

    if (u.sessionUpdate === "agent_message_chunk") {
      if (u.content?.text) this.onUpdate("text", u.content.text);
      // Empty text chunks are normal heartbeats — ignore silently
    } else if (u.sessionUpdate === "agent_thought_chunk") {
      if (u.content?.text) this.onUpdate("thought", u.content.text);
    } else if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") {
      const raw = u as Record<string, unknown>;
      const meta = raw._meta as Record<string, unknown> | undefined;
      const claudeCode = meta?.claudeCode as Record<string, unknown> | undefined;
      const toolName = claudeCode?.toolName || raw.title || "unknown";
      const title = (raw.title as string) || "";
      const rawInput = raw.rawInput as Record<string, unknown> | undefined;

      if (u.sessionUpdate === "tool_call") {
        // Tool start — show immediately so user sees activity
        if (title) {
          this.onUpdate("tool", `> **${toolName}**: ${title}\n`);
        }
      } else if (rawInput && Object.keys(rawInput).length > 0) {
        // Tool update with input details
        const inputStr = JSON.stringify(rawInput).slice(0, 200);
        this.onUpdate("tool", `> **${toolName}**: ${title || inputStr}\n`);
      }
    } else if (u.sessionUpdate === "plan_update" && u.plan) {
      const planText = u.plan.entries.map(e => `- [${e.status}] ${e.content}`).join("\n");
      this.onUpdate("plan", planText);
    } else if (
      u.sessionUpdate === "agent_message_start" ||
      u.sessionUpdate === "agent_message_end" ||
      u.sessionUpdate === "usage_update" ||
      u.sessionUpdate === "available_commands_update"
    ) {
      // Known non-content events — ignore silently
    } else {
      // Truly unknown event
      console.log(`[acp] unhandled event: ${u.sessionUpdate}`);
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
        const dir = require("path").dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, text, "utf-8");
        if (this.onWrite) this.onWrite(filePath, text);
        result = {};
      } catch (e) {
        result = { error: String(e) };
      }
    } else if (method === "terminal/create") {
      const command = (params?.command as string) || "";
      const args = (params?.args as string[]) || [];
      const cwd = (params?.cwd as string) || this.repoPath;
      const termId = `term-${Date.now()}`;
      try {
        const fullCmd = args.length > 0 ? `${command} ${args.join(" ")}` : command;
        const output = execSync(fullCmd, {
          cwd,
          encoding: "utf-8",
          timeout: 60000,
          maxBuffer: 1024 * 1024,
        });
        this.terminals.set(termId, { output: output || "", exitCode: 0 });
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; status?: number };
        this.terminals.set(termId, {
          output: (err.stdout || "") + (err.stderr || ""),
          exitCode: err.status ?? 1,
        });
      }
      result = { terminalId: termId };
    } else if (method === "terminal/output") {
      const termId = (params?.terminalId as string) || "";
      const term = this.terminals.get(termId);
      result = {
        output: term?.output || "",
        truncated: false,
        exitStatus: term ? { exitCode: term.exitCode ?? 0 } : { exitCode: 0 },
      };
    } else if (method === "terminal/wait_for_exit") {
      const termId = (params?.terminalId as string) || "";
      const term = this.terminals.get(termId);
      result = { exitCode: term?.exitCode ?? 0 };
    } else if (method === "terminal/kill" || method === "terminal/release") {
      result = {};
    }

    this.send({ jsonrpc: "2.0", id, result });
  }
}
