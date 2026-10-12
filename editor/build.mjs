// Bundles the editor's web side into web/. The stage styles come from the player, so the
// editor draws slides exactly as the published course does.
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: "web/main.js",
  logLevel: "warning",
});

const player = readFileSync("../player/src/player.css", "utf-8");
const editor = readFileSync("src/editor.css", "utf-8");
writeFileSync("web/style.css", `${player}\n\n/* ---- editor ---- */\n${editor}`);
console.log("Built web/main.js and web/style.css");
