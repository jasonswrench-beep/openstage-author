// Makes two small PowerPoint files for trying the import: a deck, and the same deck after somebody edited it. Made from nothing (no Office),
// so they hold no one's work and need no credit.
// Run from the OpenStage folder:  node examples/powerpoint/make-example-decks.ts examples/powerpoint
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { zlibSync } from "../../player/node_modules/fflate/esm/index.mjs";
import { buildDeck, group, inch, paras, pic, sp, table, type DeckSpec } from "../../editor/src/pptx/testdeck.ts";

const out = process.argv[2]!;
mkdirSync(out, { recursive: true });

// ---- a real PNG, drawn as a soft colour gradient
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const chunk = (type: string, data: Uint8Array) => {
  const body = new Uint8Array(4 + data.length);
  body.set(new TextEncoder().encode(type));
  body.set(data, 4);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
};
function png(w: number, h: number, from: [number, number, number], to: [number, number, number]): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2;
      for (let c = 0; c < 3; c++) raw[y * (w * 3 + 1) + 1 + x * 3 + c] = Math.round(from[c]! + (to[c]! - from[c]!) * t);
    }
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(w), 0); ihdr.set(u32(h), 4); ihdr[8] = 8; ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlibSync(raw)), chunk("IEND", new Uint8Array())]));
}
const blue = png(320, 200, [31, 73, 125], [155, 187, 89]);
const warm = png(320, 200, [192, 80, 77], [247, 150, 70]);
const dark = png(320, 180, [20, 45, 80], [10, 25, 50]);

const title = (id: number, text: string) => sp({ id, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: text }] }] });
const bullets = (id: number, lines: string[]) => sp({ id, name: "Content Placeholder 2", ph: { type: "body", idx: 1 }, paras: lines.map((t) => ({ runs: [{ t }] })) });

interface V { cover: string; lines: string[]; picture: "blue" | "warm"; cell: string; idea: string; extraSlide: boolean }

function deck(v: V): DeckSpec {
  const slides: DeckSpec["slides"] = [
    // 1. A title slide
    { id: 256, backgroundPicture: "dark.png", shapes: sp({ id: 2, name: "Title 1", ph: { type: "ctrTitle" }, box: { x: 0.9, y: 2.2, w: 11.5, h: 1.4 }, paras: [{ runs: [{ t: v.cover, sz: 48, color: "FFFFFF" }] }] }) +
      sp({ id: 3, name: "Subtitle 2", ph: { type: "subTitle", idx: 1 }, box: { x: 0.9, y: 3.8, w: 11.5, h: 0.8 }, paras: [{ bullet: "none", runs: [{ t: "A short example presentation", sz: 24, color: "DDE6F2" }] }] }) },
    // 2. A bulleted list, with a second level
    { id: 257, shapes: title(2, "What we will cover") + sp({ id: 3, name: "Content Placeholder 2", ph: { type: "body", idx: 1 }, paras: v.lines.map((t, i) => ({ lvl: t.startsWith("-") ? 1 : 0, runs: [{ t: t.replace(/^-\s*/, "") }] })) }) },
    // 3. A picture with alt text, and some words with a link
    { id: 258, media: { rIdP: v.picture === "blue" ? "blue.png" : "warm.png" }, links: { rIdL: "https://example.org/reading" },
      shapes: title(2, "A picture and a link") +
      pic(4, "Picture 3", "rIdP", { x: 0.9, y: 1.8, w: 5.6, h: 3.5 }, v.picture === "blue" ? "A soft blue to green gradient" : "A warm red to orange gradient") +
      sp({ id: 5, name: "TextBox 4", txBox: true, box: { x: 7, y: 2, w: 5.4, h: 2 }, paras: [{ bullet: "none", runs: [{ t: "Read more at ", sz: 24 }, { t: "the reading page", sz: 24, link: "rIdL" }, { t: ".", sz: 24 }] }] }, new Map([["rIdL", "rIdL"]])) },
    // 4. A table
    { id: 259, shapes: title(2, "A table") + table(4, "Table 3", { x: 0.9, y: 1.8, w: 11, h: 2.2 }, [["Channel", "Speed", "Richness"], ["Face to face", "Fast", "High"], ["Email", "Slow", v.cell]], { firstRow: true, alt: "Three channels compared by speed and richness" }) },
    // 5. Shapes: a filled box with words, a decorative line, a group
    { id: 260, shapes: title(2, "Shapes") +
      sp({ id: 4, name: "Rounded Rectangle 3", box: { x: 1, y: 2, w: 5, h: 1.6 }, geom: "roundRect", fill: "1F497D", paras: [{ bullet: "none", algn: "ctr", runs: [{ t: v.idea, sz: 28, color: "FFFFFF", b: true }] }] }) +
      sp({ id: 5, name: "Divider", box: { x: 1, y: 4.2, w: 11, h: 0.05 }, geom: "rect", fill: "9BBB59" }) +
      group(6, "Group 5", { x: 7, y: 2, w: 4, h: 1.6 }, { x: 0, y: 0, w: 2, h: 0.8 },
        sp({ id: 7, name: "Left box", box: { x: 0, y: 0, w: 0.9, h: 0.8 }, geom: "rect", fill: "C0504D", alt: "Left half of a pair" }) + sp({ id: 8, name: "Right box", box: { x: 1.1, y: 0, w: 0.9, h: 0.8 }, geom: "rect", fill: "8064A2", alt: "Right half of a pair" })) },
  ];
  if (v.extraSlide) slides.push({ id: 261, shapes: title(2, "Questions?") + bullets(3, ["Ask now, or write to the instructor"]) });
  return { media: { "blue.png": blue, "warm.png": warm, "dark.png": dark }, slides };
}

const v1: V = { cover: "Introduction to Communication", lines: ["Why channels matter", "- Speed and richness", "How to choose", "Common mistakes"], picture: "blue", cell: "Low", idea: "Match the channel to the message", extraSlide: false };
const v2: V = { cover: "Introduction to Communication", lines: ["Why channels matter", "- Speed and richness", "- Who is listening", "How to choose a channel", "Common mistakes"], picture: "warm", cell: "Medium", idea: "Match the channel to the message and the person", extraSlide: true };

writeFileSync(path.join(out, "Introduction to Communication.pptx"), buildDeck(deck(v1)));
writeFileSync(path.join(out, "Introduction to Communication (edited).pptx"), buildDeck(deck(v2)));
console.log("wrote two decks to", out);
void paras;
void inch;
