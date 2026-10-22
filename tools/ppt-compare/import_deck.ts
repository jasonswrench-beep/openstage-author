// Brings a whole .pptx into a new project with the editor's own import code, the way the PowerPoint dialog does, and writes the project to a folder.
// Usage: node import_deck.ts DECK.pptx OUT_DIR [--notes]   (--notes brings the speaker notes in as narration)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Model } from "../../editor/src/model.ts";
import { newProjectFiles } from "../../editor/src/template.ts";
import { readDeck } from "../../editor/src/pptx/deck.ts";
import { openDeck } from "../../editor/src/pptx/package.ts";

const [deckPath, out] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const notes = process.argv.includes("--notes");
if (!deckPath || !out) throw new Error("usage: node import_deck.ts DECK.pptx OUT_DIR");
const bytes = new Uint8Array(readFileSync(deckPath));
const pkg = openDeck(bytes);
const deck = readDeck(pkg);
const files = newProjectFiles({ title: "Imported deck", author: "", language: "en-US", today: "2026-10-21" });
const m = new Model({ dir: out, project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
const prepared = m.prepareDeckImport(deck, pkg, path.basename(deckPath), deck.slides.map((_, i) => i), "2026-10-21T00:00:00Z", undefined, { notesAsNarration: notes });
rmSync(out, { recursive: true, force: true });
for (const a of prepared.assets) {
  const p = path.join(out, a.path);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, a.bytes);
}
const message = m.commitDeckImport(prepared);
for (const f of m.allFiles()) {
  const p = path.join(out, f.path);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, f.text);
}
console.log(message);
console.log(prepared.report.join("\n"));
