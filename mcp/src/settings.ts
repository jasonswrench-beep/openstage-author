// Whether an assistant may use the program, and where. The editor writes these choices into its settings file (MCP access); the server reads
// that file each time it is asked, so turning access off stops a connection that is already running.

import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mcpRefusal, parseMcpSettings, type McpSettings } from "../../editor/src/mcpsettings.ts";

/** The identifier the desktop program keeps its settings under (src-tauri/tauri.conf.json). */
const APP = "com.openstageauthor.editor";

/** Where the editor keeps its settings file, which is the app's config folder: the same place the program itself looks. */
export function defaultSettingsFile(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === "win32") return path.join(env["APPDATA"] ?? path.join(os.homedir(), "AppData", "Roaming"), APP, "settings.json");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", APP, "settings.json");
  return path.join(env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config"), APP, "settings.json");
}

/** The MCP part of the settings file. A file that is missing, damaged or silent about MCP means MCP is off. A byte order mark at its start is skipped. */
export function readMcpSettings(file: string): McpSettings {
  let raw: unknown;
  try {
    raw = (JSON.parse(readFileSync(file, "utf-8").replace(/^﻿/, "")) as { mcp?: unknown }).mcp;
  } catch {
    raw = undefined;
  }
  return parseMcpSettings(raw);
}

const isFolder = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Why nobody may use the program now, or null; with the folder when they may. */
export function checkAccess(file: string): { refusal: string; folder?: undefined } | { refusal: null; folder: string } {
  const settings = readMcpSettings(file);
  const refusal = mcpRefusal(settings, settings.folder !== "" && isFolder(settings.folder));
  return refusal === null ? { refusal: null, folder: settings.folder } : { refusal };
}

export const settingsExist = (file: string): boolean => existsSync(file);
