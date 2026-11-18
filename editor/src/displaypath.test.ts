// Tests for how a path is shown: one kind of slash, and the Windows user name left out.
import assert from "node:assert/strict";
import { test } from "node:test";
import { backslashed, withoutUserName } from "./displaypath.ts";
import { aboutLines, aboutText, parseAbout } from "./about.ts";
import { parseMcpInfo } from "./mcpsettings.ts";

test("a Windows path gets one kind of slash; anything else is left alone", () => {
  assert.equal(backslashed("C:\\Program Files\\OpenStage\\mcp/openstage-mcp.mjs"), "C:\\Program Files\\OpenStage\\mcp\\openstage-mcp.mjs");
  assert.equal(backslashed("C:/Users/Jo/speech/whisper-cli.exe"), "C:\\Users\\Jo\\speech\\whisper-cli.exe");
  assert.equal(backslashed("\\\\server\\share/folder"), "\\\\server\\share\\folder");
  assert.equal(backslashed("node"), "node");
  assert.equal(backslashed("/home/jo/openstage"), "/home/jo/openstage", "a path that is not a Windows path keeps its slashes");
  assert.equal(backslashed("Installed by the editor"), "Installed by the editor");
});

test("the user's folders are shown by the names Windows gives them, and the user name is gone", () => {
  assert.equal(withoutUserName("C:\\Users\\Jo Smith\\AppData\\Local\\OpenStage Author\\python\\python.exe"), "%LOCALAPPDATA%\\OpenStage Author\\python\\python.exe");
  assert.equal(withoutUserName("C:/Users/Jo/AppData/Roaming/com.openstageauthor.editor/settings.json"), "%APPDATA%\\com.openstageauthor.editor\\settings.json");
  assert.equal(withoutUserName("c:\\users\\JO\\appdata\\local"), "%LOCALAPPDATA%");
  assert.equal(withoutUserName("C:\\Users\\Jo\\Documents\\Courses"), "%USERPROFILE%\\Documents\\Courses");
  assert.equal(withoutUserName("C:\\Users\\Jo"), "%USERPROFILE%");
  // A folder that only starts like AppData\Local is not it.
  assert.equal(withoutUserName("C:\\Users\\Jo\\AppData\\LocalLow\\x"), "%USERPROFILE%\\AppData\\LocalLow\\x");
});

test("paths that hold no user name, and words that are not paths, are not changed", () => {
  assert.equal(withoutUserName("C:\\Program Files\\OpenStage Author\\openstage-editor.exe"), "C:\\Program Files\\OpenStage Author\\openstage-editor.exe");
  assert.equal(withoutUserName("D:\\Tools\\OpenStage"), "D:\\Tools\\OpenStage");
  assert.equal(withoutUserName("C:\\Users\\Public\\Documents"), "C:\\Users\\Public\\Documents", "Public is no one's user name");
  assert.equal(withoutUserName("unknown"), "unknown");
  assert.equal(withoutUserName("Installed by the editor"), "Installed by the editor");
  assert.equal(withoutUserName(""), "");
});

const FULL = {
  version: "0.1.0", installed: true,
  program: "C:\\Users\\Jo Smith\\AppData\\Local\\OpenStage Author\\openstage-editor.exe", guidesFile: "C:\\Users\\Jo Smith\\AppData\\Local\\OpenStage Author\\docs\\START-HERE.md",
  python: "C:\\Users\\Jo Smith\\AppData\\Local\\OpenStage Author\\python\\python.exe", node: "C:\\Users\\Jo Smith\\AppData\\Local\\OpenStage Author\\node\\node.exe",
  recorder: "C:\\Users\\Jo Smith\\AppData\\Local\\OpenStage Author\\openstage-capture.exe", recogniser: "C:\\Users\\Jo Smith\\AppData\\Local\\OpenStage Author\\speech/whisper-cli.exe",
  data: "C:\\Users\\Jo Smith\\AppData\\Local\\com.openstageauthor.editor", settings: "C:\\Users\\Jo Smith\\AppData\\Roaming\\com.openstageauthor.editor\\settings.json",
  engine: "Installed by the editor", webview: "141.0.3537.57", windows: "Microsoft Windows [Version 10.0.26200.1]", arch: "x86_64",
};

test("the About window and the text copied from it do not carry the user name, and every path has one kind of slash", () => {
  const info = parseAbout(JSON.stringify(FULL));
  const text = aboutText(info);
  assert.doesNotMatch(text, /Jo Smith|Users/);
  assert.match(text, /Settings file: %APPDATA%\\com\.openstageauthor\.editor\\settings\.json/);
  assert.match(text, /Speech recogniser: %LOCALAPPDATA%\\OpenStage Author\\speech\\whisper-cli\.exe/, "the mixed slash is mended");
  for (const l of aboutLines(info)) assert.doesNotMatch(l.value, /Jo Smith/, l.label);
  // What a button opens is still the real folder: the facts themselves are not shortened.
  assert.equal(info.data, FULL.data);
});

test("the lines an assistant needs keep the real paths, with one kind of slash", () => {
  const info = parseMcpInfo(JSON.stringify({
    found: true, node: "C:\\Users\\Jo Smith\\AppData\\Local\\OpenStage Author\\node\\node.exe",
    script: "C:\\Users\\Jo Smith\\AppData\\Local\\OpenStage Author\\Program\\mcp/openstage-mcp.mjs",
    settings: "C:\\Users\\Jo Smith\\AppData\\Roaming\\com.openstageauthor.editor/mcp-settings.json", env: {},
  }));
  assert.equal(info.script, "C:\\Users\\Jo Smith\\AppData\\Local\\OpenStage Author\\Program\\mcp\\openstage-mcp.mjs");
  assert.equal(info.settings, "C:\\Users\\Jo Smith\\AppData\\Roaming\\com.openstageauthor.editor\\mcp-settings.json");
  assert.match(info.node, /^C:\\Users\\Jo Smith\\/, "an assistant's settings need the real path, so the user name stays here");
});
