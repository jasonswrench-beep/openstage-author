// The server as a separate program, spoken to on standard input and output the way an assistant speaks to it: refused until it is turned on, only
// ever protocol on the output, a log of what was done, one folder and no other, and ended by closing its input. Also the single file the installer
// ships, which has to do all of this with nothing but Node.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { Assistant, REPO, setSettings, workplace } from "./client.ts";

test("while MCP is off the assistant is refused at the start, with words that say how to turn it on", async () => {
  const w = workplace({ enabled: false });
  const a = new Assistant(w.settings);
  try {
    const r = await a.initialize();
    assert.equal(r.error?.code, -32001);
    assert.match(r.error!.message, /MCP access is off.*press MCP access.*choose the folder/);
    assert.match((await a.request("tools/list")).error!.message, /MCP access is off/);
    assert.match((await a.call("list_projects")).text, /MCP access is off/);
  } finally {
    await a.close();
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("it is refused when no folder has been chosen, or the folder is gone", async () => {
  const none = workplace({ folder: false });
  const a = new Assistant(none.settings);
  try {
    assert.match((await a.initialize()).error!.message, /no folder has been chosen/);
    setSettings(none.settings, { enabled: true, folder: path.join(none.root, "gone") });
    assert.match((await a.initialize()).error!.message, /does not exist/);
    setSettings(none.settings, { enabled: true, folder: none.folder });
    assert.ok(!(await a.initialize()).error, "turned on later, the same connection works");
  } finally {
    await a.close();
    rmSync(none.root, { recursive: true, force: true });
  }
});

test("a missing settings file means off", async () => {
  const w = workplace();
  rmSync(w.settings);
  const a = new Assistant(w.settings);
  try {
    assert.match((await a.initialize()).error!.message, /MCP access is off/);
  } finally {
    await a.close();
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("a working session: it starts, lists its tools, builds a course, and ends when the input is closed", async () => {
  const w = workplace();
  const a = new Assistant(w.settings);
  try {
    const init = await a.initialize();
    assert.equal(init.result?.serverInfo?.name, "openstage-author");
    assert.match(init.result!.instructions!, /check_course/);
    const tools = (await a.request("tools/list")).result!.tools!;
    assert.ok(tools.length >= 30);
    assert.ok(tools.every((t) => t.description.length > 20 && (t.inputSchema as { type: string }).type === "object"), "every tool is described");
    assert.ok((await a.call("create_project", { name: "Built", title: "Built by an assistant" })).ok);
    assert.ok((await a.call("add_slide", { layout: "content", name: "Body" })).ok);
    const body = ((await a.call("get_slide", { slide: 2 })).data as any).layers[0].objects.find((o: any) => o.name === "Content");
    assert.ok((await a.call("set_text", { object: body.id, text: "Written over the wire" })).ok);
    assert.match(readFileSync(path.join(w.folder, "Built.osproj", "slides", "slide-002.json"), "utf-8"), /Written over the wire/);
  } finally {
    const code = await a.close();
    assert.equal(code, 0, `the program ended cleanly: ${a.stderr}`);
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("nothing but protocol is ever on the output, and nothing is on the error output either", async () => {
  const w = workplace();
  const a = new Assistant(w.settings);
  try {
    await a.initialize();
    await a.call("create_project", { name: "Quiet", title: "Quiet" });
    await a.call("get_course");
    await a.call("delete_slide", { slide: 1, confirm: true });
    await a.call("not_a_tool");
    a.child.stdin!.write("this is not json\n");
    await a.request("ping");
  } finally {
    await a.close();
    for (const line of a.stdout) assert.doesNotThrow(() => JSON.parse(line), line.slice(0, 80));
    assert.ok(a.stdout.every((l) => JSON.parse(l).jsonrpc === "2.0"));
    assert.equal(a.stderr, "");
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("turning MCP access off stops a connection that is already running, and turning it on again lets it go on", async () => {
  const w = workplace();
  const a = new Assistant(w.settings);
  try {
    await a.initialize();
    assert.ok((await a.call("list_projects")).ok);
    setSettings(w.settings, { enabled: false, folder: w.folder });
    const stopped = await a.call("list_projects");
    assert.equal(stopped.ok, false);
    assert.match(stopped.text, /MCP access is off/);
    setSettings(w.settings, { enabled: true, folder: w.folder });
    assert.ok((await a.call("list_projects")).ok);
  } finally {
    await a.close();
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("changing the folder lets go of the project that was open, and the new folder is the only one used", async () => {
  const w = workplace();
  const second = path.join(w.root, "other");
  mkdirSync(second);
  const a = new Assistant(w.settings);
  try {
    await a.initialize();
    await a.call("create_project", { name: "In first", title: "First" });
    setSettings(w.settings, { enabled: true, folder: second });
    assert.match((await a.call("get_course")).text, /No project is open/);
    assert.deepEqual((await a.call("list_projects")).data ?? [], []);
    await a.call("create_project", { name: "In second", title: "Second" });
    assert.ok(existsSync(path.join(second, "In second.osproj")));
    assert.ok(!existsSync(path.join(w.folder, "In second.osproj")));
  } finally {
    await a.close();
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("every call is in the log, with what it was and whether it was done, and no words that were written on a slide", async () => {
  const w = workplace();
  const a = new Assistant(w.settings);
  try {
    await a.initialize();
    await a.call("create_project", { name: "Logged", title: "Logged" });
    await a.call("add_slide", { layout: "content", name: "Secret plans" });
    const body = ((await a.call("get_slide", { slide: 2 })).data as any).layers[0].objects.find((o: any) => o.name === "Content");
    await a.call("set_text", { object: body.id, text: "Words nobody should find in the log" });
    await a.call("delete_slide", { slide: 2, confirm: false });
    const log = readFileSync(path.join(w.folder, "OpenStage MCP log.txt"), "utf-8").trimEnd().split("\n");
    assert.equal(log.length, 5);
    assert.match(log[0]!, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d {2}create_project {2}OK {2}Made and opened/);
    assert.match(log[2]!, /get_slide {2}OK {2}\(read only\)/);
    assert.match(log[4]!, /delete_slide {2}REFUSED {2}Nothing was deleted/);
    assert.ok(!log.join("\n").includes("Words nobody should find"));
  } finally {
    await a.close();
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("an assistant cannot reach anything outside its folder, by any tool, and nothing outside changes", async () => {
  const w = workplace();
  const outside = path.join(w.root, "private");
  mkdirSync(outside);
  writeFileSync(path.join(outside, "secret.png"), "not really a picture");
  writeFileSync(path.join(outside, "secret.xlf"), "x");
  const before = readdirSync(w.root).sort();
  const a = new Assistant(w.settings);
  try {
    await a.initialize();
    await a.call("create_project", { name: "Fenced", title: "Fenced" });
    const refused = [
      await a.call("create_project", { name: "../private/escaped", title: "x" }),
      await a.call("create_project", { name: "..\\private\\escaped", title: "x" }),
      await a.call("create_project", { name: path.join(outside, "escaped"), title: "x" }),
      await a.call("open_project", { name: "../private/x" }),
      await a.call("add_picture", { slide: 1, file: path.join(outside, "secret.png"), altText: "x" }),
      await a.call("add_picture", { slide: 1, file: "../private/secret.png", altText: "x" }),
      await a.call("import_translation", { file: "../private/secret.xlf" }),
      await a.call("import_translation", { file: path.join(outside, "secret.xlf") }),
    ];
    for (const r of refused) assert.equal(r.ok, false, r.text);
    assert.deepEqual(readdirSync(outside).sort(), ["secret.png", "secret.xlf"], "nothing was written outside");
    assert.deepEqual(readdirSync(w.root).sort(), before, "no new folder appeared outside");
    // A junction inside the folder that leads out does not help either.
    symlinkSync(outside, path.join(w.folder, "Evil.osproj"), "junction");
    assert.equal((await a.call("open_project", { name: "Evil" })).ok, false);
    symlinkSync(outside, path.join(w.folder, "pictures"), "junction");
    assert.equal((await a.call("add_picture", { slide: 1, file: "pictures/secret.png", altText: "x" })).ok, false);
  } finally {
    await a.close();
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("a call with the wrong arguments is refused in words, and the server goes on", async () => {
  const w = workplace();
  const a = new Assistant(w.settings);
  try {
    await a.initialize();
    const r = await a.call("create_project", { name: "x" });
    assert.match(r.text, /The argument "title" is required/);
    assert.match((await a.call("get_slide", { slide: { number: 1 } })).text, /slide must be text/);
    assert.match((await a.call("nope")).text, /There is no tool called nope/);
    assert.ok((await a.call("list_projects")).ok);
  } finally {
    await a.close();
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("the bundled single file, which is what the installer ships, does the same with nothing but Node", async () => {
  const build = spawnSync(process.execPath, ["build.mjs"], { cwd: path.join(REPO, "mcp"), encoding: "utf-8" });
  assert.equal(build.status, 0, build.stderr);
  const bundle = path.join(REPO, "mcp", "dist", "openstage-mcp.mjs");
  assert.ok(existsSync(bundle));
  const w = workplace();
  const a = new Assistant(w.settings);
  // The assistant helper starts server.ts; start the bundle by hand in the same way instead.
  a.kill();
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [bundle, "--settings", w.settings], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, OPENSTAGE_ROOT: REPO }, windowsHide: true });
  const lines: string[] = [];
  let partial = "";
  child.stdout.on("data", (b: Buffer) => {
    partial += b.toString("utf-8");
    const parts = partial.split("\n");
    partial = parts.pop() ?? "";
    lines.push(...parts);
  });
  let errors = "";
  child.stderr.on("data", (b: Buffer) => (errors += b.toString("utf-8")));
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
  const send = (o: object) => child.stdin.write(`${JSON.stringify(o)}\n`);
  const until = async (n: number) => {
    for (let i = 0; i < 600 && lines.length < n; i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(lines.length >= n, `waiting for answer ${n}: ${errors}`);
  };
  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_project", arguments: { name: "Bundled", title: "Bundled" } } });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_course", arguments: {} } });
    await until(3);
    assert.equal(JSON.parse(lines[0]!).result.serverInfo.name, "openstage-author");
    assert.match(JSON.parse(lines[1]!).result.content[0].text, /Made and opened the project Bundled/);
    assert.match(JSON.parse(lines[2]!).result.content[0].text, /Bundled \(Bundled\): 1 slide/);
    assert.ok(existsSync(path.join(w.folder, "Bundled.osproj", "project.json")));
  } finally {
    child.stdin.end();
    assert.equal(await exited, 0, errors);
    assert.equal(errors, "");
    rmSync(w.root, { recursive: true, force: true });
  }
});
