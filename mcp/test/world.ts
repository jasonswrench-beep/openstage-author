// What the tests of the tools share: a folder of their own, the tools run through the real protocol layer, and ways to look at what is on the disk.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Jail } from "../src/files.ts";
import { McpServer } from "../src/protocol.ts";
import { Session } from "../src/session.ts";
import { allTools } from "../src/tools/index.ts";
import { REPO } from "./client.ts";

export type Out = { ok: boolean; text: string; data: any };

export function world() {
  const root = mkdtempSync(path.join(os.tmpdir(), "openstage-mcp-tools-"));
  const folder = path.join(root, "work");
  mkdirSync(folder);
  const make = () => {
    const session = new Session(new Jail(folder));
    const server = new McpServer({ name: "t", title: "T", version: "1", instructions: "", tools: allTools(session, { root: REPO, env: process.env }), gate: () => null });
    const call = async (name: string, args: Record<string, unknown> = {}): Promise<Out> => {
      const line = await server.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }));
      const reply = JSON.parse(line!) as { result?: { content: { text: string }[]; isError?: boolean }; error?: { message: string } };
      if (reply.error) return { ok: false, text: reply.error.message, data: undefined };
      const text = reply.result!.content[0]!.text;
      const split = text.indexOf("\n\n");
      let data: any;
      if (split !== -1) {
        try {
          data = JSON.parse(text.slice(split + 2));
        } catch {
          data = undefined;
        }
      }
      return { ok: reply.result!.isError !== true, text: data !== undefined ? text.slice(0, split) : text, data };
    };
    return { session, server, call };
  };
  return { root, folder, ...make(), another: make, done: () => rmSync(root, { recursive: true, force: true }) };
}

export const read = (folder: string, project: string, file: string): string => readFileSync(path.join(folder, `${project}.osproj`, ...file.split("/")), "utf-8");
export const readSlide = (folder: string, project: string, n: number): any => JSON.parse(read(folder, project, `slides/slide-${String(n).padStart(3, "0")}.json`));

/** The 1 by 1 PNG, with a header that says it is as big as is wanted. */
export function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

export async function started(): Promise<ReturnType<typeof world>> {
  const w = world();
  const r = await w.call("create_project", { name: "Course", title: "Learning to listen", author: "Jo", language: "en-GB" });
  assert.ok(r.ok, r.text);
  return w;
}

export const objectNamed = (data: any, name: string) => data.layers.flatMap((l: any) => l.objects).find((o: any) => o.name === name);
