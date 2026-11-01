// The choices that let an AI assistant use OpenStage Author through MCP (the Model Context Protocol), and the lines that connect one. They live in
// the editor's settings file, beside the stock-library keys, never in a project. The server (mcp/) reads the same file each time an assistant
// connects, so a change here takes effect for the next connection and a running one is stopped by turning it off. Nothing here needs a page or a
// program, so all of it is tested directly.

export interface McpSettings {
  /** Off until the author turns it on. */
  enabled: boolean;
  /** The one folder an assistant may use. It can open, make, save and publish only inside it. */
  folder: string;
}

export const emptyMcp = (): McpSettings => ({ enabled: false, folder: "" });

/** Read the part of the settings that is about MCP. Anything that is not understood is "off". */
export function parseMcpSettings(raw: unknown): McpSettings {
  const o = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { enabled: o["enabled"] === true, folder: typeof o["folder"] === "string" ? o["folder"].trim() : "" };
}

/** Why an assistant may not use the program right now, in words that say what to do, or null when it may. */
export function mcpRefusal(m: McpSettings, folderExists: boolean): string | null {
  if (!m.enabled) return "MCP access is off. In OpenStage Author, press MCP access, turn on \"Let an AI assistant use OpenStage Author\", and choose the folder it may use. Then connect again.";
  if (m.folder === "") return "MCP access is on, but no folder has been chosen for an assistant to use. In OpenStage Author, press MCP access and choose one. Then connect again.";
  if (!folderExists) return `The folder chosen for an assistant to use (${m.folder}) does not exist. In OpenStage Author, press MCP access and choose another. Then connect again.`;
  return null;
}

/** Why a choice cannot be saved, or null. Turning access on needs a folder. */
export function mcpProblem(m: McpSettings): string | null {
  if (m.enabled && m.folder === "") return "Choose the folder an assistant may use first. It can open, make and publish courses only inside that folder.";
  return null;
}

/** What starts the server: the Node that comes with the program, the server's script, the settings file it reads, and what the narration voice needs to run. */
export interface McpLaunch {
  node: string;
  script: string;
  settings: string;
  env?: Record<string, string>;
}

/** What the program says about starting the server (the `mcp_info` command in lib.rs). `found` is false when the server's script cannot be found, and `note` says what to do. */
export interface McpInfo extends McpLaunch {
  env: Record<string, string>;
  found: boolean;
  note: string;
}

export const UNKNOWN_MCP: McpInfo = { node: "", script: "", settings: "", env: {}, found: false, note: "The program that lets an assistant use OpenStage Author is not available here." };

/** The shell's JSON as the facts; anything missing or of the wrong kind is left as "not available". */
export function parseMcpInfo(raw: string): McpInfo {
  let o: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) o = parsed as Record<string, unknown>;
  } catch {
    return UNKNOWN_MCP;
  }
  const text = (v: unknown): string => (typeof v === "string" ? v : "");
  const env: Record<string, string> = {};
  if (o["env"] && typeof o["env"] === "object" && !Array.isArray(o["env"])) {
    for (const [k, v] of Object.entries(o["env"] as Record<string, unknown>)) if (typeof v === "string" && k !== "") env[k] = v;
  }
  const info: McpInfo = { node: text(o["node"]), script: text(o["script"]), settings: text(o["settings"]), env, found: o["found"] === true, note: text(o["note"]) };
  return info.found && (info.node === "" || info.script === "" || info.settings === "") ? { ...info, found: false, note: info.note || UNKNOWN_MCP.note } : info;
}

/** The name an assistant lists this server under. */
export const MCP_SERVER_NAME = "openstage-author";

/** The block to add to Claude Desktop's `claude_desktop_config.json`. */
export function claudeDesktopConfig(l: McpLaunch): string {
  const env = l.env && Object.keys(l.env).length > 0 ? { env: l.env } : {};
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { command: l.node, args: [l.script, "--settings", l.settings], ...env } } }, null, 2);
}

const quoted = (s: string): string => `"${s.replace(/"/g, '\\"')}"`;

/** The command that adds the server to Claude Code. Options come before the name, then `--` and the command. */
export function claudeCodeCommand(l: McpLaunch): string {
  const env = Object.entries(l.env ?? {}).map(([k, v]) => `--env ${quoted(`${k}=${v}`)} `).join("");
  return `claude mcp add ${env}${MCP_SERVER_NAME} -- ${quoted(l.node)} ${quoted(l.script)} --settings ${quoted(l.settings)}`;
}
