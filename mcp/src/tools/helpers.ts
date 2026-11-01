// What the tools share: short ways to describe arguments, how to run the program's other tools (the problem check, the publisher, the speech
// tool), and where those are, whether the server runs from the repository or from the installed program.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { ToolError, type Schema, type Tool, type ToolOutput } from "../protocol.ts";

type Props = Record<string, Schema>;

export const text = (description: string, more: Partial<Schema> = {}): Schema => ({ type: "string", description, ...more });
export const whole = (description: string, more: Partial<Schema> = {}): Schema => ({ type: "integer", description, ...more });
export const number = (description: string, more: Partial<Schema> = {}): Schema => ({ type: "number", description, ...more });
export const flag = (description: string): Schema => ({ type: "boolean", description });
export const list = (description: string, items: Schema, more: Partial<Schema> = {}): Schema => ({ type: "array", description, items, ...more });
export const record = (description: string, properties: Props, required: readonly string[] = []): Schema => ({ type: "object", description, properties, required });

/** A tool, with its arguments described as properties and a list of those that are needed. */
export function tool(name: string, description: string, properties: Props, required: readonly string[], changes: boolean, run: Tool["run"]): Tool {
  return { name, description, inputSchema: { type: "object", properties, required }, changes, run };
}

/** What the model said about a change: a sentence when it was made, null when nothing happened. A null becomes an answer that says nothing changed. */
export function said(sentence: string | null, nothing = "Nothing was changed. It may already be that way, or what was asked for is not allowed here."): ToolOutput {
  if (sentence === null) throw new ToolError(nothing);
  return { text: sentence };
}

/** The same for the model's operations that answer with { ok, message }. */
export function okMessage(result: { ok: boolean; message: string }): ToolOutput {
  if (!result.ok) throw new ToolError(result.message || "That was not allowed.");
  return { text: result.message || "Done." };
}

/** The tools the program is made of, and the programs they run. */
export interface Environment {
  /** The folder that holds tools/ and player/: the repository, or the installed program. */
  root: string;
  env: NodeJS.ProcessEnv;
}

/** The folder above this one that holds the program's tools, looking upward from where the server's script is. Null if none is found. */
export function findRoot(from: string): string | null {
  let at = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(at, "tools", "validate.py")) && existsSync(path.join(at, "player", "publish.ts"))) return at;
    const up = path.dirname(at);
    if (up === at) return null;
    at = up;
  }
}

/** The Python to run the tools with: the one named by OPENSTAGE_PYTHON, the one that comes with the program, or the one on the path. */
export function pythonOf(e: Environment): string {
  const named = e.env["OPENSTAGE_PYTHON"];
  if (named) return named;
  const bundled = path.join(e.root, "python", process.platform === "win32" ? "python.exe" : "bin/python3");
  return existsSync(bundled) ? bundled : "python";
}

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Run a program to its end and keep what it said. A program that cannot be started is a sentence, not a crash. */
export function run(program: string, args: string[], e: Environment, cwd?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, env: e.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.once("error", (error) => reject(new ToolError(`${path.basename(program)} could not be started: ${error.message}`)));
    child.once("close", (status) => resolve({ status, stdout: Buffer.concat(out).toString("utf-8"), stderr: Buffer.concat(err).toString("utf-8") }));
  });
}

/** The last line of what a program printed that is a JSON object, parsed; null if there is none. */
export function lastJson<T>(stdout: string): T | null {
  const line = stdout.split(/\r?\n/).reverse().find((l) => l.trim().startsWith("{") || l.trim().startsWith("["));
  if (!line) return null;
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

/** The whole of what a program printed as one JSON value, or null. */
export function wholeJson<T>(stdout: string): T | null {
  try {
    return JSON.parse(stdout) as T;
  } catch {
    return null;
  }
}
