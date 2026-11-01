import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeCodeCommand, claudeDesktopConfig, emptyMcp, mcpProblem, mcpRefusal, parseMcpInfo, parseMcpSettings, UNKNOWN_MCP } from "./mcpsettings.ts";
import { parseSettings, serializeSettings } from "./stock.ts";

test("MCP is off unless the settings say true, and a folder is only ever text", () => {
  assert.deepEqual(parseMcpSettings(undefined), emptyMcp());
  assert.deepEqual(parseMcpSettings(null), emptyMcp());
  assert.deepEqual(parseMcpSettings([]), emptyMcp());
  assert.deepEqual(parseMcpSettings({ enabled: "true", folder: 7 }), { enabled: false, folder: "" });
  assert.deepEqual(parseMcpSettings({ enabled: true, folder: "  D:\\Assistant  " }), { enabled: true, folder: "D:\\Assistant" });
});

test("access is refused in words that say what to do, and allowed only when it is on with a folder that is there", () => {
  assert.match(mcpRefusal({ enabled: false, folder: "D:\\A" }, true)!, /MCP access is off.*press MCP access/);
  assert.match(mcpRefusal({ enabled: true, folder: "" }, false)!, /no folder has been chosen/);
  assert.match(mcpRefusal({ enabled: true, folder: "D:\\Gone" }, false)!, /D:\\Gone\) does not exist/);
  assert.equal(mcpRefusal({ enabled: true, folder: "D:\\A" }, true), null);
});

test("turning it on needs a folder, and turning it off needs nothing", () => {
  assert.match(mcpProblem({ enabled: true, folder: "" })!, /Choose the folder an assistant may use first/);
  assert.equal(mcpProblem({ enabled: true, folder: "D:\\A" }), null);
  assert.equal(mcpProblem({ enabled: false, folder: "" }), null);
});

test("the choices are kept with the other settings and come back, and settings from before them still read", () => {
  const before = parseSettings(JSON.stringify({ keys: { pexels: "abc" }, publishFolder: "D:\\Out" }));
  assert.equal(before.mcp, undefined);
  const saved = serializeSettings({ ...before, mcp: { enabled: true, folder: "D:\\Assistant" } });
  const back = parseSettings(saved);
  assert.deepEqual(back.mcp, { enabled: true, folder: "D:\\Assistant" });
  assert.equal(back.keys.pexels, "abc");
  assert.equal(back.publishFolder, "D:\\Out");
  assert.ok(!serializeSettings(before).includes("mcp"), "settings that never had it do not gain it");
});

const LAUNCH = { node: "C:\\Program Files\\OpenStage\\node\\node.exe", script: "C:\\Program Files\\OpenStage\\mcp\\openstage-mcp.mjs", settings: "C:\\Users\\Jo\\AppData\\Roaming\\com.openstageauthor.editor\\settings.json" };

test("the block for Claude Desktop is JSON that names the program, its script and the settings file", () => {
  const block = JSON.parse(claudeDesktopConfig(LAUNCH)) as { mcpServers: Record<string, { command: string; args: string[]; env?: unknown }> };
  assert.deepEqual(block.mcpServers["openstage-author"], { command: LAUNCH.node, args: [LAUNCH.script, "--settings", LAUNCH.settings] });
  const voiced = JSON.parse(claudeDesktopConfig({ ...LAUNCH, env: { OPENSTAGE_KOKORO_PYTHON: "C:\\p\\python.exe", PYTHONUTF8: "1" } })) as typeof block;
  assert.deepEqual(voiced.mcpServers["openstage-author"]!.env, { OPENSTAGE_KOKORO_PYTHON: "C:\\p\\python.exe", PYTHONUTF8: "1" });
});

test("the command for Claude Code puts its options before the name, quotes every path, and ends with the program", () => {
  assert.equal(claudeCodeCommand(LAUNCH), `claude mcp add openstage-author -- "${LAUNCH.node}" "${LAUNCH.script}" --settings "${LAUNCH.settings}"`);
  const voiced = claudeCodeCommand({ ...LAUNCH, env: { PYTHONUTF8: "1", HF_HOME: "C:\\a b\\home" } });
  assert.match(voiced, /^claude mcp add --env "PYTHONUTF8=1" --env "HF_HOME=C:\\a b\\home" openstage-author -- "/);
});

test("the shell's answer is read, and anything missing makes it plain that the program cannot be found", () => {
  const good = parseMcpInfo(JSON.stringify({ ...LAUNCH, env: { A: "1", B: 2 }, found: true, note: "" }));
  assert.deepEqual([good.found, good.env, good.node], [true, { A: "1" }, LAUNCH.node]);
  assert.equal(parseMcpInfo("not json"), UNKNOWN_MCP);
  assert.equal(parseMcpInfo("[]").found, false);
  const noScript = parseMcpInfo(JSON.stringify({ node: "node", script: "", settings: "s.json", found: true }));
  assert.equal(noScript.found, false);
  assert.ok(noScript.note.length > 10);
  const told = parseMcpInfo(JSON.stringify({ node: "node", script: "", settings: "s.json", found: false, note: "Not beside the editor." }));
  assert.equal(told.note, "Not beside the editor.");
});
