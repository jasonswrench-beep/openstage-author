import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { findRoot, lastJson, pythonOf, run, wholeJson } from "../src/tools/helpers.ts";

function fakeProgram(withPython: boolean): { root: string; python: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "openstage-mcp-root-"));
  mkdirSync(path.join(root, "tools"), { recursive: true });
  mkdirSync(path.join(root, "player"), { recursive: true });
  writeFileSync(path.join(root, "tools", "validate.py"), "");
  writeFileSync(path.join(root, "player", "publish.ts"), "");
  const python = path.join(root, "python", process.platform === "win32" ? "python.exe" : "bin/python3");
  if (withPython) {
    mkdirSync(path.dirname(python), { recursive: true });
    writeFileSync(python, "");
  }
  return { root, python };
}

test("the program's folder is found by looking upward for its tools and player, from the server's file or from the bundled file", () => {
  const { root } = fakeProgram(false);
  try {
    mkdirSync(path.join(root, "mcp", "dist"), { recursive: true });
    assert.equal(findRoot(path.join(root, "mcp")), root);
    assert.equal(findRoot(path.join(root, "mcp", "dist")), root);
    assert.equal(findRoot(root), root);
    assert.equal(findRoot(os.tmpdir()), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Python is the one named, or the one that comes with the program, or the one on the path", () => {
  const withIt = fakeProgram(true);
  const without = fakeProgram(false);
  try {
    assert.equal(pythonOf({ root: withIt.root, env: { OPENSTAGE_PYTHON: "C:\\mine\\python.exe" } }), "C:\\mine\\python.exe", "a named one wins");
    assert.equal(pythonOf({ root: withIt.root, env: {} }), withIt.python);
    assert.equal(pythonOf({ root: without.root, env: {} }), "python");
  } finally {
    rmSync(withIt.root, { recursive: true, force: true });
    rmSync(without.root, { recursive: true, force: true });
  }
});

test("a program the server starts is told which Python to use, so the publisher works where no Python is on the path", async () => {
  const { root, python } = fakeProgram(true);
  try {
    const r = await run(process.execPath, ["-e", "console.log(JSON.stringify({ python: process.env.OPENSTAGE_PYTHON, kept: process.env.KEPT }))"], { root, env: { ...process.env, KEPT: "yes", OPENSTAGE_PYTHON: undefined } });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(lastJson(r.stdout), { python, kept: "yes" });
    const named = await run(process.execPath, ["-e", "console.log(JSON.stringify({ python: process.env.OPENSTAGE_PYTHON }))"], { root, env: { ...process.env, OPENSTAGE_PYTHON: "mine" } });
    assert.deepEqual(lastJson(named.stdout), { python: "mine" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a program that cannot be started is a sentence for the assistant, not a crash", async () => {
  await assert.rejects(run(path.join(os.tmpdir(), "no-such-program-xyz.exe"), [], { root: os.tmpdir(), env: process.env }), /could not be started/);
});

test("what a program printed is read as JSON from its last line or from the whole of it, and anything else is nothing", () => {
  assert.deepEqual(lastJson('progress...\n{"ok":true}\n'), { ok: true });
  assert.deepEqual(lastJson('{"a":1}\nplain words after it\n'), { a: 1 }, "the last line that looks like JSON, whatever comes after");
  assert.equal(lastJson('{"a":1}\n{broken\n'), null, "and if that line is broken it is nothing, not an earlier one");
  assert.equal(lastJson("nothing here"), null);
  assert.deepEqual(wholeJson('[{"a":1}]'), [{ a: 1 }]);
  assert.equal(wholeJson("[{"), null);
});
