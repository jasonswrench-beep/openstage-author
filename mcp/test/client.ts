// A stand-in for an AI assistant: it starts the real server as a separate program, sends it MCP messages one line at a time, and reads the
// answers, the way Claude Desktop or Claude Code does. Used by the tests, and by hand to try the server.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER = path.resolve(here, "..", "server.ts");
export const REPO = path.resolve(here, "..", "..");

export interface Reply {
  jsonrpc: "2.0";
  id: number | null;
  result?: { content?: { type: string; text: string }[]; isError?: boolean; tools?: { name: string; description: string; inputSchema: unknown }[]; protocolVersion?: string; serverInfo?: { name: string }; instructions?: string };
  error?: { code: number; message: string };
}

export class Assistant {
  readonly child: ChildProcess;
  readonly stdout: string[] = [];
  stderr = "";
  private serial = 0;
  private waiting = new Map<number, (r: Reply) => void>();
  private partial = "";
  exited: Promise<number | null>;

  constructor(settingsFile: string, env: NodeJS.ProcessEnv = {}) {
    this.child = spawn(process.execPath, [SERVER, "--settings", settingsFile], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env }, windowsHide: true });
    this.child.stdout!.on("data", (b: Buffer) => {
      this.partial += b.toString("utf-8");
      const lines = this.partial.split("\n");
      this.partial = lines.pop() ?? "";
      for (const line of lines) {
        this.stdout.push(line);
        const reply = JSON.parse(line) as Reply;
        if (reply.id !== null) this.waiting.get(reply.id)?.(reply);
      }
    });
    this.child.stderr!.on("data", (b: Buffer) => (this.stderr += b.toString("utf-8")));
    this.exited = new Promise((resolve) => this.child.once("exit", (code) => resolve(code)));
  }

  /** Send a request and wait for its answer. */
  request(method: string, params: Record<string, unknown> = {}): Promise<Reply> {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No answer to ${method} in 60 seconds.\n${this.stderr}`)), 60_000);
      this.waiting.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async initialize(): Promise<Reply> {
    const r = await this.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-assistant", version: "1" } });
    if (!r.error) this.notify("notifications/initialized");
    return r;
  }

  /** Call a tool; give back what it said, whether it worked, and the JSON it carried (if it carried any). */
  async call(name: string, args: Record<string, unknown> = {}): Promise<{ ok: boolean; text: string; data: unknown; error?: string }> {
    const r = await this.request("tools/call", { name, arguments: args });
    if (r.error) return { ok: false, text: r.error.message, data: undefined, error: r.error.message };
    const text = r.result?.content?.[0]?.text ?? "";
    const split = text.indexOf("\n\n");
    let data: unknown;
    if (split !== -1) {
      try {
        data = JSON.parse(text.slice(split + 2));
      } catch {
        data = undefined;
      }
    }
    return { ok: r.result?.isError !== true, text: split !== -1 && data !== undefined ? text.slice(0, split) : text, data };
  }

  async close(): Promise<number | null> {
    this.child.stdin!.end();
    return this.exited;
  }

  kill(): void {
    this.child.kill();
  }
}

/** A folder for an assistant to use, and a settings file that lets it. */
export function workplace(opts: { enabled?: boolean; folder?: boolean } = {}): { root: string; folder: string; settings: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "openstage-mcp-test-"));
  const folder = path.join(root, "work");
  mkdirSync(folder);
  const settings = path.join(root, "settings.json");
  setSettings(settings, { enabled: opts.enabled ?? true, folder: opts.folder === false ? "" : folder });
  return { root, folder, settings };
}

export function setSettings(file: string, mcp: { enabled: boolean; folder: string }): void {
  writeFileSync(file, `${JSON.stringify({ keys: {}, mcp }, null, 2)}\n`, "utf-8");
}
