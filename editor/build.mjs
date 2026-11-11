// Bundles the editor's web side into web/. The stage styles come from the player, so the
// editor draws slides exactly as the published course does.
import { build } from "esbuild";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: "web/main.js",
  logLevel: "warning",
});

// The suite's colours, sizes and type come first, so the editor's own styles can use them (design/DESIGN-GUIDE.md).
const suite = readFileSync("../design/openstage-ui.css", "utf-8");
const player = readFileSync("../player/src/player.css", "utf-8");
const editor = readFileSync("src/editor.css", "utf-8");
// The editing screens of OpenScreen (the clip list, the timeline and the preview) bring their own styles, in their own namespaced names.
const recording = ["clip-list", "timeline", "preview", "layout"].map((n) => readFileSync(`../capture-timeline/src/${n}.css`, "utf-8")).join("\n");
writeFileSync("web/style.css", `${suite}\n\n${player}\n\n/* ---- editor ---- */\n${editor}\n\n/* ---- editing a recording (capture-timeline) ---- */\n${recording}`);
// The logo in the top bar is the program's own icon (branding/OpenStage.svg), as it is.
copyFileSync("../branding/OpenStage.svg", "web/brand-author.svg");
console.log("Built web/main.js, web/style.css and web/brand-author.svg");
