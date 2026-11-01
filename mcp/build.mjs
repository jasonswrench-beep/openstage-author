// Bundles the server and the editor code it uses into one file, dist/openstage-mcp.mjs, which runs with just Node. The installer puts it beside
// the player. It uses the player's copy of esbuild, so nothing more has to be installed to build it.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { build } = createRequire(path.join(here, "..", "player", "package.json"))("esbuild");

await build({
  entryPoints: [path.join(here, "server.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: path.join(here, "dist", "openstage-mcp.mjs"),
  logLevel: "warning",
  // Some code that gets bundled in may ask for require, which an ES module does not have.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
console.log("Built dist/openstage-mcp.mjs");
