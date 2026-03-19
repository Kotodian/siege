import { spawn, type ChildProcess } from "child_process";
import path from "path";

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

export class LspClient {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = "";
  private initialized = false;
  private rootUri: string;
  private command: string;
  private args: string[];

  constructor(command: string, args: string[], rootPath: string) {
    this.command = command;
    this.args = args;
    this.rootUri = `file://${rootPath}`;
  }

  async start(): Promise<void> {
    if (this.process) return;

    this.process = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: path.dirname(this.rootUri.replace("file://", "")),
    });

    this.process.stdout!.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.process.on("error", (err) => {
      console.error(`[lsp] Process error: ${err.message}`);
    });

    this.process.on("exit", () => {
      this.process = null;
      this.initialized = false;
      // Reject all pending
      for (const [, req] of this.pending) {
        req.reject(new Error("LSP server exited"));
      }
      this.pending.clear();
    });

    // Initialize
    const initResult = await this.request("initialize", {
      processId: process.pid,
      rootUri: this.rootUri,
      capabilities: {
        textDocument: {
          hover: { contentFormat: ["plaintext"] },
          definition: {},
          references: {},
          publishDiagnostics: {},
        },
      },
    });

    this.notify("initialized", {});
    this.initialized = true;
    return initResult as void;
  }

  async stop(): Promise<void> {
    if (!this.process) return;
    try {
      await this.request("shutdown", null);
      this.notify("exit", null);
    } catch {
      // ignore
    }
    this.process?.kill();
    this.process = null;
    this.initialized = false;
  }

  async openFile(filePath: string, content: string, languageId: string): Promise<void> {
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri: `file://${filePath}`,
        languageId,
        version: 1,
        text: content,
      },
    });
  }

  async hover(filePath: string, line: number, character: number): Promise<string> {
    const result = await this.request("textDocument/hover", {
      textDocument: { uri: `file://${filePath}` },
      position: { line: line - 1, character },
    }) as { contents?: { value?: string; kind?: string } | string } | null;

    if (!result || !result.contents) return "";
    if (typeof result.contents === "string") return result.contents;
    return result.contents.value || "";
  }

  async definition(filePath: string, line: number, character: number): Promise<Array<{ file: string; line: number; character: number }>> {
    const result = await this.request("textDocument/definition", {
      textDocument: { uri: `file://${filePath}` },
      position: { line: line - 1, character },
    }) as Array<{ uri: string; range: { start: { line: number; character: number } } }> | { uri: string; range: { start: { line: number; character: number } } } | null;

    if (!result) return [];
    const locations = Array.isArray(result) ? result : [result];
    return locations.map((loc) => ({
      file: loc.uri.replace("file://", ""),
      line: loc.range.start.line + 1,
      character: loc.range.start.character,
    }));
  }

  async references(filePath: string, line: number, character: number): Promise<Array<{ file: string; line: number; character: number }>> {
    const result = await this.request("textDocument/references", {
      textDocument: { uri: `file://${filePath}` },
      position: { line: line - 1, character },
      context: { includeDeclaration: true },
    }) as Array<{ uri: string; range: { start: { line: number; character: number } } }> | null;

    if (!result) return [];
    return result.map((loc) => ({
      file: loc.uri.replace("file://", ""),
      line: loc.range.start.line + 1,
      character: loc.range.start.character,
    }));
  }

  async diagnostics(filePath: string): Promise<Array<{ line: number; severity: string; message: string }>> {
    // Diagnostics come via notifications; we collect them from didOpen
    // For servers that support pull diagnostics:
    try {
      const result = await this.request("textDocument/diagnostic", {
        textDocument: { uri: `file://${filePath}` },
      }) as { items?: Array<{ range: { start: { line: number } }; severity?: number; message: string }> } | null;

      if (!result?.items) return [];
      const severityMap = ["", "error", "warning", "info", "hint"];
      return result.items.map((d) => ({
        line: d.range.start.line + 1,
        severity: severityMap[d.severity || 3] || "info",
        message: d.message,
      }));
    } catch {
      return [];
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error("LSP not started"));
        return;
      }

      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });

      const msg: JsonRpcMessage = { jsonrpc: "2.0", id, method, params };
      this.send(msg);

      // Timeout after 10s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`LSP request "${method}" timed out`));
        }
      }, 10000);
    });
  }

  private notify(method: string, params: unknown): void {
    if (!this.process?.stdin) return;
    const msg: JsonRpcMessage = { jsonrpc: "2.0", method, params };
    this.send(msg);
  }

  private send(msg: JsonRpcMessage): void {
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    this.process!.stdin!.write(header + body);
  }

  private processBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) break;

      const header = this.buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) break;

      const body = this.buffer.slice(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.slice(bodyStart + contentLength);

      try {
        const msg = JSON.parse(body) as JsonRpcMessage;
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const req = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) {
            req.reject(new Error(msg.error.message));
          } else {
            req.resolve(msg.result);
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
  }
}
