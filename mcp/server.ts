// OpenStage Author as an MCP server: an AI assistant (Claude Desktop, Claude Code or another) can build, check and publish accessible courses
// with nobody at the keyboard. It speaks the Model Context Protocol on standard input and output, one JSON line at a time, with no window,
// and changes courses with the editor's own code, so every change means what it means in the editor.
//
//   node server.ts [--settings SETTINGS_FILE]
//
// It is off until the author turns it on (MCP access in the editor, which writes the settings file): the assistant is refused with words that say
// how, and may use one folder only. See docs/mcp.md.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer, serve } from "./src/protocol.ts";
import { Session } from "./src/session.ts";
import { checkAccess, defaultSettingsFile } from "./src/settings.ts";
import { logger } from "./src/log.ts";
import { allTools, INSTRUCTIONS } from "./src/tools/index.ts";
import { findRoot } from "./src/tools/helpers.ts";

const VERSION = "0.1.0";

const args = process.argv.slice(2);
const at = args.indexOf("--settings");
const settingsFile = at !== -1 && args[at + 1] ? path.resolve(args[at + 1]!) : (process.env["OPENSTAGE_SETTINGS"] ?? defaultSettingsFile());
const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env["OPENSTAGE_ROOT"] && existsSync(process.env["OPENSTAGE_ROOT"]) ? process.env["OPENSTAGE_ROOT"] : findRoot(here);
if (!root) {
  process.stderr.write("OpenStage's tools (the tools and player folders) were not found beside this program. Set OPENSTAGE_ROOT to the folder that holds them.\n");
  process.exit(1);
}

const session = new Session();
let folder: string | null = null;

const server = new McpServer({
  name: "openstage-author",
  title: "OpenStage Author",
  version: VERSION,
  instructions: INSTRUCTIONS,
  tools: allTools(session, { root, env: process.env }),
  gate: () => {
    const access = checkAccess(settingsFile);
    if (access.refusal !== null) return access.refusal;
    try {
      session.useFolder(access.folder);
      folder = session.jail.root;
    } catch (e) {
      return (e as Error).message;
    }
    return null;
  },
  log: logger(() => folder),
});

process.stdout.on("error", () => process.exit(0));
await serve(server, process.stdin, process.stdout);
