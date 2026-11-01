import assert from "node:assert/strict";
import { test } from "node:test";
import { McpServer, PROTOCOL_VERSIONS, ToolError, problemWith, serve, toJsonSchema, type Schema, type Tool } from "../src/protocol.ts";

const echo: Tool = {
  name: "echo",
  description: "Say it back.",
  inputSchema: { type: "object", properties: { words: { type: "string", minLength: 1, maxLength: 20 }, times: { type: "integer", minimum: 1, maximum: 3 }, loud: { type: "boolean" }, slide: { type: "string", orNumber: true }, limit: { type: "number", nullable: true } }, required: ["words"] },
  changes: false,
  run: (a) => ({ text: String(a["words"]).repeat(typeof a["times"] === "number" ? a["times"] : 1), ...(a["loud"] === true ? { data: { loud: true } } : {}) }),
};
const refuses: Tool = { name: "refuses", description: "Cannot.", inputSchema: { type: "object", properties: {} }, changes: true, run: () => { throw new ToolError("No, because of the rules."); } };
const breaks: Tool = { name: "breaks", description: "Fails.", inputSchema: { type: "object", properties: {} }, changes: true, run: () => { throw new Error("disk full"); } };

function make(over: { gate?: () => string | null; log?: (e: { tool: string; ok: boolean; first: string; changes: boolean }) => void; tools?: Tool[] } = {}) {
  return new McpServer({ name: "test", title: "Test", version: "1.2.3", instructions: "Be kind.", tools: over.tools ?? [echo, refuses, breaks], gate: over.gate ?? (() => null), ...(over.log ? { log: over.log } : {}) });
}

const send = async (s: McpServer, message: unknown) => {
  const line = await s.handleLine(JSON.stringify(message));
  return line === null ? null : (JSON.parse(line) as { id: number | null; result?: any; error?: { code: number; message: string } });
};
const call = (s: McpServer, name: string, args?: unknown) => send(s, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, ...(args === undefined ? {} : { arguments: args }) } });

test("it answers initialize with the client's protocol version when it knows it, and the newest otherwise", async () => {
  const s = make();
  const old = await send(s, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
  assert.equal(old!.result.protocolVersion, "2024-11-05");
  assert.deepEqual(old!.result.serverInfo, { name: "test", title: "Test", version: "1.2.3" });
  assert.deepEqual(old!.result.capabilities, { tools: { listChanged: false } });
  assert.equal(old!.result.instructions, "Be kind.");
  const odd = await send(s, { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(odd!.result.protocolVersion, PROTOCOL_VERSIONS[0]);
});

test("notifications are answered with nothing, and ping with an empty answer", async () => {
  const s = make();
  assert.equal(await send(s, { jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.equal(await send(s, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 3 } }), null);
  assert.deepEqual((await send(s, { jsonrpc: "2.0", id: 4, method: "ping" }))!.result, {});
});

test("tools are listed with their arguments described in standard JSON Schema", async () => {
  const listed = (await send(make(), { jsonrpc: "2.0", id: 1, method: "tools/list" }))!.result.tools as { name: string; inputSchema: any }[];
  assert.deepEqual(listed.map((t) => t.name), ["echo", "refuses", "breaks"]);
  const props = listed[0]!.inputSchema.properties;
  assert.deepEqual(props.limit.type, ["number", "null"], "a value that may be null says so the standard way");
  assert.deepEqual(props.slide.type, ["string", "number"], "a slide may be named by its number");
  assert.equal(props.words.type, "string");
  assert.deepEqual(listed[0]!.inputSchema.required, ["words"]);
  assert.ok(!JSON.stringify(listed).includes("nullable") && !JSON.stringify(listed).includes("orNumber"), "no private words reach the client");
});

test("a call that works gives its words, and the facts after a blank line", async () => {
  const s = make();
  assert.deepEqual((await call(s, "echo", { words: "ha", times: 2 }))!.result, { content: [{ type: "text", text: "haha" }] });
  const loud = await call(s, "echo", { words: "hey", loud: true });
  assert.equal(loud!.result.content[0].text, 'hey\n\n{\n  "loud": true\n}');
});

test("a call is checked before it runs, and each mistake is said in plain words", async () => {
  const s = make();
  const said = async (args: unknown) => (await call(s, "echo", args))!.result.content[0].text as string;
  assert.equal(await said({}), 'The argument "words" is required.');
  assert.equal(await said({ words: 5 }), "words must be text.");
  assert.equal(await said({ words: "" }), "words cannot be empty.");
  assert.equal(await said({ words: "x".repeat(21) }), "words must be at most 20 characters.");
  assert.equal(await said({ words: "a", times: 4 }), "times must be at most 3.");
  assert.equal(await said({ words: "a", times: 1.5 }), "times must be a whole number.");
  assert.equal(await said({ words: "a", loud: "yes" }), "loud must be true or false.");
  assert.equal(await said([]), "The arguments must be an object.");
  const r = await call(s, "echo", {});
  assert.equal(r!.result.isError, true);
});

test("a null is allowed where the argument says it may be, and a number where text may be a number", () => {
  const schema = echo.inputSchema;
  assert.equal(problemWith(schema, { words: "a", limit: null }, "The arguments"), null);
  assert.equal(problemWith(schema, { words: "a", slide: 2 }, "The arguments"), null);
  assert.equal(problemWith(schema, { words: "a", slide: true }, "The arguments"), "slide must be text.");
  assert.equal(problemWith(schema, { words: "a", limit: "x" }, "The arguments"), "limit must be a number.");
});

test("lists and the things in them are checked, naming the one that is wrong", () => {
  const list: Schema = { type: "array", maxItems: 2, minItems: 1, items: { type: "object", required: ["q"], properties: { q: { type: "string", enum: ["a", "b"] }, n: { type: "integer", minimum: 1 } } } };
  assert.equal(problemWith(list, [{ q: "a" }], "items"), null);
  assert.equal(problemWith(list, [], "items"), "items needs at least 1 item.");
  assert.equal(problemWith(list, [{ q: "a" }, { q: "a" }, { q: "a" }], "items"), "items can have at most 2 items.");
  assert.equal(problemWith(list, [{ q: "a" }, { q: "c" }], "items"), "items item 2 q must be one of: a, b.");
  assert.equal(problemWith(list, [{}], "items"), 'items item 1, the field "q" is required.');
  assert.equal(problemWith(list, [{ q: "a", n: 0 }], "items"), "items item 1 n must be at least 1.");
  assert.equal(problemWith(list, "nope", "items"), "items must be a list.");
});

test("a tool that cannot do it says why as an error the assistant can read, and anything unexpected is said without a crash", async () => {
  const s = make();
  const no = await call(s, "refuses", {});
  assert.deepEqual(no!.result, { content: [{ type: "text", text: "No, because of the rules." }], isError: true });
  const boom = await call(s, "breaks", {});
  assert.equal(boom!.result.isError, true);
  assert.match(boom!.result.content[0].text, /did not work.*disk full/);
});

test("an unknown tool and an unknown method are protocol errors that say what to do", async () => {
  const s = make();
  const tool = await call(s, "nothing", {});
  assert.equal(tool!.error!.code, -32602);
  assert.match(tool!.error!.message, /no tool called nothing.*tools\/list/);
  assert.equal((await call(s, undefined as unknown as string))!.error!.code, -32602);
  const method = await send(s, { jsonrpc: "2.0", id: 9, method: "resources/list" });
  assert.equal(method!.error!.code, -32601);
  assert.equal(await send(s, { jsonrpc: "2.0", method: "resources/list" }), null, "no answer to a notification, even an unknown one");
});

test("a line that is not JSON, or not a message, is answered without stopping the server", async () => {
  const s = make();
  assert.equal(JSON.parse((await s.handleLine("not json"))!).error.code, -32700);
  assert.equal(JSON.parse((await s.handleLine("42"))!).error.code, -32600);
  assert.equal(JSON.parse((await s.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 3 })))!).error.code, -32600);
});

test("a batch is answered with a batch", async () => {
  const s = make();
  const line = await s.handleLine(JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "ping" }]));
  assert.deepEqual((JSON.parse(line!) as { id: number }[]).map((r) => r.id), [1, 2]);
});

test("while access is refused, nothing can start or be called, and the reason is given each time", async () => {
  let reason: string | null = "MCP access is off.";
  const s = make({ gate: () => reason });
  assert.equal((await send(s, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }))!.error!.message, "MCP access is off.");
  assert.equal((await send(s, { jsonrpc: "2.0", id: 2, method: "tools/list" }))!.error!.message, "MCP access is off.");
  assert.equal((await call(s, "echo", { words: "a" }))!.error!.message, "MCP access is off.");
  reason = null;
  assert.equal((await call(s, "echo", { words: "a" }))!.result.content[0].text, "a");
  // Turned off again while the assistant is connected: the next call is stopped.
  reason = "MCP access is off.";
  assert.equal((await call(s, "echo", { words: "a" }))!.error!.code, -32001);
});

test("every call is logged once it has ended, with whether it was done, its first line and whether it changes anything", async () => {
  const seen: { tool: string; ok: boolean; first: string; changes: boolean }[] = [];
  const s = make({ log: (e) => seen.push(e) });
  await call(s, "echo", { words: "hello" });
  await call(s, "refuses", {});
  await call(s, "echo", {});
  assert.deepEqual(seen, [
    { tool: "echo", ok: true, first: "hello", changes: false },
    { tool: "refuses", ok: false, first: "No, because of the rules.", changes: true },
    { tool: "echo", ok: false, first: 'The argument "words" is required.', changes: false },
  ]);
});

test("two tools of the same name are refused when the server is made", () => {
  assert.throws(() => make({ tools: [echo, echo] }), /Two tools are called echo/);
});

test("serving reads lines, answers one call at a time in the order they came, and ends with the input", async () => {
  const order: string[] = [];
  const slow: Tool = { name: "slow", description: "Takes a while.", inputSchema: { type: "object", properties: {} }, changes: false, run: async () => { order.push("slow start"); await new Promise((r) => setTimeout(r, 40)); order.push("slow end"); return { text: "slow" }; } };
  const fast: Tool = { name: "fast", description: "Quick.", inputSchema: { type: "object", properties: {} }, changes: false, run: () => { order.push("fast"); return { text: "fast" }; } };
  const s = make({ tools: [slow, fast] });
  const written: string[] = [];
  // The input arrives in awkward pieces: two requests in one chunk, a request split in two, and a last line with no new line.
  const chunks = ['{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"slow"}}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fast"}}\n{"jsonrpc":"2.0","id":3,', '"method":"ping"}\r\n', '{"jsonrpc":"2.0","id":4,"method":"ping"}'];
  async function* input() {
    for (const c of chunks) yield c;
  }
  await serve(s, input(), { write: (t) => written.push(t) });
  assert.deepEqual(order, ["slow start", "slow end", "fast"]);
  assert.deepEqual(written.map((w) => JSON.parse(w).id), [1, 2, 3, 4]);
  assert.ok(written.every((w) => w.endsWith("\n") && w.indexOf("\n") === w.length - 1), "each answer is exactly one line");
});

test("a value that may be text, a number or true or false is checked, and described to clients as those three", () => {
  const scalar: Schema = { type: "scalar" };
  for (const ok of ["text", "", 0, 3.5, -1, true, false]) assert.equal(problemWith(scalar, ok, "value"), null, String(ok));
  for (const bad of [null, [], {}, Number.NaN, undefined]) assert.equal(problemWith(scalar, bad, "value"), "value must be text, a number, or true or false.", String(bad));
  assert.deepEqual(toJsonSchema({ type: "scalar", description: "d" }), { description: "d", type: ["string", "number", "boolean"] });
});

test("toJsonSchema leaves ordinary schemas as they are", () => {
  const s: Schema = { type: "object", required: ["a"], properties: { a: { type: "array", items: { type: "string" }, maxItems: 3 } } };
  assert.deepEqual(toJsonSchema(s), { required: ["a"], type: "object", properties: { a: { type: "array", items: { type: "string" }, maxItems: 3 } } });
});
