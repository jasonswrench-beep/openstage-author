import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { LOG_NAME, logger } from "../src/log.ts";
import { checkAccess, defaultSettingsFile, readMcpSettings } from "../src/settings.ts";

function scratch(): { root: string; folder: string; file: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "openstage-mcp-settings-"));
  const folder = path.join(root, "work");
  mkdirSync(folder);
  return { root, folder, file: path.join(root, "settings.json") };
}

test("MCP is off when the settings file is missing, damaged or silent about it", () => {
  const { root, file } = scratch();
  try {
    assert.deepEqual(readMcpSettings(file), { enabled: false, folder: "" });
    writeFileSync(file, "{ not json");
    assert.deepEqual(readMcpSettings(file), { enabled: false, folder: "" });
    writeFileSync(file, JSON.stringify({ keys: {} }));
    assert.deepEqual(readMcpSettings(file), { enabled: false, folder: "" });
    writeFileSync(file, JSON.stringify({ mcp: { enabled: "yes", folder: 5 } }));
    assert.deepEqual(readMcpSettings(file), { enabled: false, folder: "" }, "only a real true turns it on");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the choices are read, with a byte order mark at the start of the file skipped", () => {
  const { root, folder, file } = scratch();
  try {
    writeFileSync(file, `\uFEFF${JSON.stringify({ mcp: { enabled: true, folder: ` ${folder} ` } })}`);
    assert.deepEqual(readMcpSettings(file), { enabled: true, folder });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("access is refused in words that say what to do, until it is on and the folder is there", () => {
  const { root, folder, file } = scratch();
  try {
    const write = (mcp: object) => writeFileSync(file, JSON.stringify({ mcp }));
    assert.match(checkAccess(file).refusal!, /MCP access is off.*press MCP access/);
    write({ enabled: true, folder: "" });
    assert.match(checkAccess(file).refusal!, /no folder has been chosen/);
    write({ enabled: true, folder: path.join(root, "gone") });
    assert.match(checkAccess(file).refusal!, /does not exist/);
    write({ enabled: true, folder: file });
    assert.match(checkAccess(file).refusal!, /does not exist/, "a file is not a folder");
    write({ enabled: false, folder });
    assert.match(checkAccess(file).refusal!, /is off/);
    write({ enabled: true, folder });
    assert.deepEqual(checkAccess(file), { refusal: null, folder });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the settings file is where the desktop program keeps it", () => {
  const found = defaultSettingsFile({ APPDATA: "C:\\Users\\Jo\\AppData\\Roaming" });
  assert.ok(found.endsWith(path.join("com.openstageauthor.editor", "settings.json")));
  if (process.platform === "win32") assert.equal(found, path.join("C:\\Users\\Jo\\AppData\\Roaming", "com.openstageauthor.editor", "settings.json"));
});

test("the log has a line for each call: when, which tool, done or refused, and the first line of the reply", () => {
  const { root, folder } = scratch();
  try {
    const log = logger(() => folder, () => new Date("2026-11-01T09:30:12Z"));
    log({ tool: "create_project", ok: true, first: "Made and opened   the project Intro.", changes: true });
    log({ tool: "get_course", ok: true, first: "Intro: 3 slides.", changes: false });
    log({ tool: "delete_slide", ok: false, first: "Nothing was deleted.", changes: true });
    assert.equal(readFileSync(path.join(folder, LOG_NAME), "utf-8"), [
      "2026-11-01 09:30:12  create_project  OK  Made and opened the project Intro.",
      "2026-11-01 09:30:12  get_course  OK  (read only)  Intro: 3 slides.",
      "2026-11-01 09:30:12  delete_slide  REFUSED  Nothing was deleted.",
      "",
    ].join("\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a log that cannot be written never stops anything, and with no folder nothing is written", () => {
  const log = logger(() => path.join(os.tmpdir(), "openstage-no-such-folder-xyz", "deeper"));
  assert.doesNotThrow(() => log({ tool: "x", ok: true, first: "y", changes: false }));
  const none = logger(() => null);
  assert.doesNotThrow(() => none({ tool: "x", ok: true, first: "y", changes: false }));
});
