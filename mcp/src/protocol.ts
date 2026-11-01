// The Model Context Protocol, the small part of it a tool server needs: JSON-RPC 2.0 messages, one to a line, on standard input and output.
// It answers `initialize`, `ping`, `tools/list` and `tools/call` and ignores notifications. It knows nothing about OpenStage: the tools are given to it.
//
// Rules this keeps, because an assistant may be using the program with nobody watching:
//   - Nothing but protocol is ever written to the output.
//   - Tool calls run one at a time, in the order they came.
//   - A call is checked against the tool's description of its arguments before it runs, so a call that cannot be made says why in plain words
//     and changes nothing.
//   - A tool that cannot do what was asked answers with an error the assistant can read (isError), not a protocol failure.
//   - The gate is asked at `initialize` and before every call, so turning MCP access off stops a running connection.

/** The protocol versions this server can speak, newest first. It answers with the client's own if it is among them. */
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** A description of a tool's arguments: the part of JSON Schema that is used here. */
export interface Schema {
  type: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  enum?: readonly (string | number)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  maxItems?: number;
  minItems?: number;
  properties?: Record<string, Schema>;
  required?: readonly string[];
  items?: Schema;
  /** For an argument that may also be null (to clear something). */
  nullable?: boolean;
  /** For text that may also be given as a number (a slide's number): the number is accepted and read as it is. */
  orNumber?: boolean;
}

/** The schema as a client expects to read it: standard JSON Schema, with "or null" and "or a number" written as lists of types. */
export function toJsonSchema(s: Schema): Record<string, unknown> {
  const { nullable, orNumber, properties, items, type, ...rest } = s;
  const types = [type, ...(orNumber ? ["number"] : []), ...(nullable ? ["null"] : [])];
  return {
    ...rest,
    type: types.length === 1 ? type : types,
    ...(properties ? { properties: Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, toJsonSchema(v)])) } : {}),
    ...(items ? { items: toJsonSchema(items) } : {}),
  };
}

/** What a tool gives back: a sentence for the assistant, and the facts it asked for. */
export interface ToolOutput {
  text: string;
  data?: unknown;
}

/** A tool that cannot do what was asked. The words are for the assistant, who passes them on. */
export class ToolError extends Error {}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Schema & { type: "object" };
  /** Whether it changes anything on disk, for the log. */
  changes: boolean;
  run(args: Record<string, unknown>): Promise<ToolOutput> | ToolOutput;
}

export interface ServerOptions {
  name: string;
  title: string;
  version: string;
  /** What an assistant is told about this server when it connects. */
  instructions: string;
  tools: readonly Tool[];
  /** Why nobody may use the program right now, or null. Asked at `initialize` and before every call. */
  gate(): string | null;
  /** Told about every tool call once it has ended. */
  log?(entry: { tool: string; ok: boolean; first: string; changes: boolean }): void;
}

type Id = string | number | null;
interface Message {
  jsonrpc?: unknown;
  id?: Id;
  method?: unknown;
  params?: unknown;
}

const reply = (id: Id, result: unknown) => ({ jsonrpc: "2.0", id, result });
const failure = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Say what is wrong with an argument, or null if it is fine. `where` names it for the message. */
export function problemWith(schema: Schema, value: unknown, where: string): string | null {
  if (value === null && schema.nullable) return null;
  switch (schema.type) {
    case "string": {
      if (schema.orNumber && typeof value === "number" && Number.isFinite(value)) return null;
      if (typeof value !== "string") return `${where} must be text.`;
      if (schema.minLength !== undefined && value.length < schema.minLength) return schema.minLength === 1 ? `${where} cannot be empty.` : `${where} must be at least ${schema.minLength} characters.`;
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${where} must be at most ${schema.maxLength} characters.`;
      if (schema.enum && !schema.enum.includes(value)) return `${where} must be one of: ${schema.enum.join(", ")}.`;
      return null;
    }
    case "number":
    case "integer": {
      if (typeof value !== "number" || !Number.isFinite(value)) return `${where} must be a number.`;
      if (schema.type === "integer" && !Number.isInteger(value)) return `${where} must be a whole number.`;
      if (schema.minimum !== undefined && value < schema.minimum) return `${where} must be at least ${schema.minimum}.`;
      if (schema.maximum !== undefined && value > schema.maximum) return `${where} must be at most ${schema.maximum}.`;
      if (schema.enum && !schema.enum.includes(value)) return `${where} must be one of: ${schema.enum.join(", ")}.`;
      return null;
    }
    case "boolean":
      return typeof value === "boolean" ? null : `${where} must be true or false.`;
    case "array": {
      if (!Array.isArray(value)) return `${where} must be a list.`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${where} can have at most ${schema.maxItems} items.`;
      if (schema.minItems !== undefined && value.length < schema.minItems) return `${where} needs at least ${schema.minItems} ${schema.minItems === 1 ? "item" : "items"}.`;
      if (schema.items) {
        for (const [i, item] of value.entries()) {
          const bad = problemWith(schema.items, item, `${where} item ${i + 1}`);
          if (bad) return bad;
        }
      }
      return null;
    }
    case "object": {
      if (!isObject(value)) return `${where} must be an object.`;
      for (const key of schema.required ?? []) if (value[key] === undefined) return `${where === "The arguments" ? "The argument" : `${where}, the field`} "${key}" is required.`;
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (value[key] === undefined) continue;
        const bad = problemWith(sub, value[key], where === "The arguments" ? key : `${where} ${key}`);
        if (bad) return bad;
      }
      return null;
    }
  }
}

export class McpServer {
  private readonly o: ServerOptions;
  private readonly byName = new Map<string, Tool>();

  constructor(options: ServerOptions) {
    this.o = options;
    for (const t of options.tools) {
      if (this.byName.has(t.name)) throw new Error(`Two tools are called ${t.name}.`);
      this.byName.set(t.name, t);
    }
  }

  /** One line in, one line out, or null when nothing is to be said (a notification). */
  async handleLine(line: string): Promise<string | null> {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return JSON.stringify(failure(null, -32700, "That line is not JSON."));
    }
    if (Array.isArray(message)) {
      const answers: unknown[] = [];
      for (const m of message) {
        const a = await this.handle(m);
        if (a) answers.push(a);
      }
      return answers.length === 0 ? null : JSON.stringify(answers);
    }
    const answer = await this.handle(message);
    return answer ? JSON.stringify(answer) : null;
  }

  private async handle(raw: unknown): Promise<object | null> {
    if (!isObject(raw)) return failure(null, -32600, "A message must be a JSON object.");
    const m = raw as Message;
    const isNotification = m.id === undefined;
    const id = m.id ?? null;
    if (typeof m.method !== "string") return isNotification ? null : failure(id, -32600, "A message needs a method.");
    const params = isObject(m.params) ? m.params : {};
    try {
      switch (m.method) {
        case "initialize": {
          const refused = this.o.gate();
          if (refused) return failure(id, -32001, refused);
          const asked = typeof params["protocolVersion"] === "string" ? params["protocolVersion"] : "";
          const version = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0];
          return reply(id, {
            protocolVersion: version,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: this.o.name, title: this.o.title, version: this.o.version },
            instructions: this.o.instructions,
          });
        }
        case "ping":
          return isNotification ? null : reply(id, {});
        case "tools/list": {
          const refused = this.o.gate();
          if (refused) return failure(id, -32001, refused);
          return reply(id, { tools: this.o.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: toJsonSchema(t.inputSchema) })) });
        }
        case "tools/call":
          return isNotification ? null : await this.call(id, params);
        default:
          // notifications/initialized, notifications/cancelled and the like need no answer; anything else with an id is not known.
          return isNotification || m.method.startsWith("notifications/") ? null : failure(id, -32601, `The method ${m.method} is not known to this server.`);
      }
    } catch (e) {
      return failure(id, -32603, `The server failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async call(id: Id, params: Record<string, unknown>): Promise<object> {
    const refused = this.o.gate();
    if (refused) return failure(id, -32001, refused);
    const name = params["name"];
    const tool = typeof name === "string" ? this.byName.get(name) : undefined;
    if (!tool) return failure(id, -32602, `There is no tool called ${typeof name === "string" ? name : "(none)"}. Ask for tools/list to see them.`);
    const args = params["arguments"] === undefined ? {} : params["arguments"];
    const bad = problemWith(tool.inputSchema, args, "The arguments");
    const done = (ok: boolean, text: string) => {
      this.o.log?.({ tool: tool.name, ok, first: text.split("\n")[0]!.slice(0, 160), changes: tool.changes });
      return reply(id, { content: [{ type: "text", text }], ...(ok ? {} : { isError: true }) });
    };
    if (bad) return done(false, bad);
    try {
      const out = await tool.run(args as Record<string, unknown>);
      return done(true, out.data === undefined ? out.text : `${out.text}\n\n${JSON.stringify(out.data, null, 2)}`);
    } catch (e) {
      if (e instanceof ToolError) return done(false, e.message);
      return done(false, `That did not work, and nothing was changed that this tool could undo: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/**
 * Read lines from `input` and write the answers to `output`, one call at a time. Ends when the input ends, after the last answer is written.
 */
export async function serve(server: McpServer, input: AsyncIterable<string | Uint8Array>, output: { write(text: string): unknown }): Promise<void> {
  let pending = "";
  let chain: Promise<void> = Promise.resolve();
  const take = (line: string) => {
    if (line.trim() === "") return;
    chain = chain.then(async () => {
      const answer = await server.handleLine(line);
      if (answer !== null) output.write(`${answer}\n`);
    });
  };
  const decoder = new TextDecoder();
  for await (const chunk of input) {
    pending += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) take(line.replace(/\r$/, ""));
  }
  take(pending.replace(/\r$/, ""));
  await chain;
}
