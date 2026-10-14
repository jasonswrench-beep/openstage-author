// Reads a PowerPoint deck into a plain description of its slides and what is on them, in the deck's own units (English Metric Units, 914,400 to
// the inch). Nothing here knows about OpenStage: convert.ts turns this into slides and objects.
//
// A shape on a slide often says almost nothing about itself: a title or a bulleted list is a *placeholder*, and its position, text size,
// bullets and colour come from the slide's layout and the deck's master. So the layout and the master are read too, and each slide is
// given what it inherits. Things that cannot be brought over (charts, SmartArt, movies, animations) are noted, never silently dropped.

import { colorOf, DEFAULT_CLRMAP, paintOf, readScheme, type Palette } from "./color.ts";
import { fingerprint, hashBytes } from "./hash.ts";
import { Pkg, type Rel } from "./package.ts";
import { child, descendants, kids, num, path, type XmlNode } from "./xml.ts";

export const EMU_PER_INCH = 914400;

export interface Box { x: number; y: number; cx: number; cy: number }

export interface DeckRun {
  text: string;
  /** A line break instead of text. */
  br?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  sup?: boolean;
  sub?: boolean;
  /** Points. */
  size?: number;
  color?: string;
  font?: string;
  href?: string;
}

export interface DeckPara {
  level: number;
  bullet: "none" | "dot" | "number";
  align?: "l" | "ctr" | "r" | "j";
  runs: DeckRun[];
}

interface Common {
  /** The shape's own number on its slide (the id in the deck). */
  id: string;
  name: string;
  /** The alt text written in PowerPoint, or "". */
  alt: string;
  /** PowerPoint's "mark as decorative". */
  decorative: boolean;
  box: Box;
  /** Degrees. */
  rot: number;
  /** "title", "body" and the like for a placeholder, or "". */
  placeholder: string;
  /** A fingerprint of the shape as the deck has it. */
  hash: string;
}

export type DeckShape = Common & (
  | { kind: "text"; paras: DeckPara[]; geom: string; fill: string | null; line: { color: string; width: number } | null; note?: string; fitScale?: number }
  | { kind: "shape"; geom: string; fill: string | null; line: { color: string; width: number } | null; note?: string }
  | { kind: "line"; color: string; width: number }
  | { kind: "picture"; media: string | null; mediaHash: string; ext: string; cropped: boolean }
  | { kind: "table"; rows: string[][]; headerRow: boolean; headerColumn: boolean; merged: boolean }
  | { kind: "unsupported"; what: string }
);

export interface DeckSlide {
  /** The deck's own number for the slide, which stays the same when slides move. */
  slideId: string;
  index: number;
  part: string;
  name: string;
  hidden: boolean;
  background: string | null;
  /** A picture that fills the background, as the part name of the picture inside the deck. */
  backgroundPicture: { media: string; mediaHash: string; ext: string } | null;
  /** Said when the background is something other than one plain colour or one picture. */
  backgroundNote?: string;
  shapes: DeckShape[];
  /** Things on the slide that were left out, with the reason. */
  skipped: { name: string; why: string }[];
  /** How many shapes of each left-out kind: dates, footers and slide numbers; hidden shapes; empty placeholders. */
  left: { footers: number; hidden: number; empty: number };
  hasNotes: boolean;
  /** The slide has animations or a transition, which are not brought over. */
  animated: boolean;
  /** A fingerprint of the slide's own settings (its name and background). */
  hash: string;
}

export interface Deck {
  slideWidth: number;
  slideHeight: number;
  slides: DeckSlide[];
}

// ---- helpers

const attr = (n: XmlNode | undefined, a: string): string => n?.attrs[a] ?? "";

interface Transform { sx: number; sy: number; dx: number; dy: number }
const IDENTITY: Transform = { sx: 1, sy: 1, dx: 0, dy: 0 };

interface Placeholder { type: string; idx: string; sp: XmlNode }

function placeholdersOf(tree: XmlNode | undefined): Placeholder[] {
  const out: Placeholder[] = [];
  for (const sp of kids(path(tree, "p:cSld", "p:spTree"), "p:sp")) {
    const ph = path(sp, "p:nvSpPr", "p:nvPr", "p:ph");
    if (ph) out.push({ type: ph.attrs["type"] ?? "", idx: ph.attrs["idx"] ?? "", sp });
  }
  return out;
}

/** The kinds of placeholder that are the same thing for matching: a title is a title whether it is a centred title or not. */
const family = (type: string): string => (type === "ctrTitle" ? "title" : type === "" || type === "obj" || type === "subTitle" ? "body" : type);

/** The placeholder on a layout or master that a slide's placeholder takes its place and text style from: the same number, else the same kind. */
function matchPlaceholder(list: Placeholder[], type: string, idx: string): Placeholder | undefined {
  if (idx !== "") {
    const same = list.find((p) => p.idx === idx);
    if (same) return same;
  }
  return list.find((p) => family(p.type) === family(type));
}

/** Copy the values that are there, so a style that says nothing about a property does not wipe out what an earlier one said. */
function assignDefined<T extends object>(target: T, source: Partial<T>): T {
  for (const [k, v] of Object.entries(source)) if (v !== undefined) (target as Record<string, unknown>)[k] = v;
  return target;
}

function xfrmOf(spPr: XmlNode | undefined): { box: Box; rot: number; chOff?: { x: number; y: number }; chExt?: { cx: number; cy: number } } | undefined {
  const x = child(spPr, "a:xfrm") ?? child(spPr, "p:xfrm");
  const off = child(x, "a:off");
  const ext = child(x, "a:ext");
  if (!x || !off || !ext) return undefined;
  const chOff = child(x, "a:chOff");
  const chExt = child(x, "a:chExt");
  return {
    box: { x: num(off, "x") ?? 0, y: num(off, "y") ?? 0, cx: num(ext, "cx") ?? 0, cy: num(ext, "cy") ?? 0 },
    rot: (num(x, "rot") ?? 0) / 60000,
    ...(chOff ? { chOff: { x: num(chOff, "x") ?? 0, y: num(chOff, "y") ?? 0 } } : {}),
    ...(chExt ? { chExt: { cx: num(chExt, "cx") ?? 0, cy: num(chExt, "cy") ?? 0 } } : {}),
  };
}

function place(box: Box, t: Transform): Box {
  return { x: Math.round(t.dx + box.x * t.sx), y: Math.round(t.dy + box.y * t.sy), cx: Math.round(box.cx * t.sx), cy: Math.round(box.cy * t.sy) };
}

function groupTransform(parent: Transform, x: ReturnType<typeof xfrmOf>): Transform {
  if (!x) return parent;
  const sx = x.chExt && x.chExt.cx > 0 ? x.box.cx / x.chExt.cx : 1;
  const sy = x.chExt && x.chExt.cy > 0 ? x.box.cy / x.chExt.cy : 1;
  const ox = x.chOff?.x ?? 0;
  const oy = x.chOff?.y ?? 0;
  // A point in the group's own space goes to the group's place, then through whatever the group sits in.
  const dx = x.box.x - ox * sx;
  const dy = x.box.y - oy * sy;
  return { sx: sx * parent.sx, sy: sy * parent.sy, dx: parent.dx + dx * parent.sx, dy: parent.dy + dy * parent.sy };
}

// ---- text styles

interface LevelProps {
  algn?: "l" | "ctr" | "r" | "j";
  bullet?: "none" | "dot" | "number";
  sz?: number;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  color?: string;
  font?: string;
}

const ALIGN: Record<string, "l" | "ctr" | "r" | "j"> = { l: "l", ctr: "ctr", r: "r", just: "j", dist: "j", justLow: "j", thaiDist: "j" };

function levelProps(lst: XmlNode | undefined, level: number, pal: Palette, fonts: ThemeFonts, base?: string): LevelProps {
  const pPr = child(lst, `a:lvl${level + 1}pPr`);
  if (!pPr) return {};
  const out: LevelProps = {};
  const a = ALIGN[attr(pPr, "algn")];
  if (a) out.algn = a;
  if (child(pPr, "a:buNone")) out.bullet = "none";
  else if (child(pPr, "a:buChar")) out.bullet = "dot";
  else if (child(pPr, "a:buAutoNum")) out.bullet = "number";
  const d = child(pPr, "a:defRPr");
  if (d) assignDefined(out, runProps(d, pal, fonts, base));
  return out;
}

function runProps(r: XmlNode, pal: Palette, fonts: ThemeFonts, placeholder?: string): LevelProps {
  const out: LevelProps = {};
  const sz = num(r, "sz");
  if (sz !== undefined) out.sz = sz / 100;
  if (r.attrs["b"] !== undefined) out.b = r.attrs["b"] === "1" || r.attrs["b"] === "true";
  if (r.attrs["i"] !== undefined) out.i = r.attrs["i"] === "1" || r.attrs["i"] === "true";
  if (r.attrs["u"] !== undefined) out.u = r.attrs["u"] !== "none";
  const color = paintOf(r, pal, placeholder);
  if (color?.kind === "solid") out.color = color.color;
  const latin = attr(child(r, "a:latin"), "typeface");
  if (latin) out.font = latin === "+mj-lt" ? fonts.major : latin === "+mn-lt" ? fonts.minor : latin.startsWith("+") ? undefined : latin;
  return out;
}

interface ThemeFonts { major?: string; minor?: string }

function themeFonts(theme: XmlNode | undefined): ThemeFonts {
  const fs = path(theme, "a:themeElements", "a:fontScheme");
  const major = attr(path(fs, "a:majorFont", "a:latin"), "typeface");
  const minor = attr(path(fs, "a:minorFont", "a:latin"), "typeface");
  return { ...(major ? { major } : {}), ...(minor ? { minor } : {}) };
}

// ---- reading one slide

interface Context {
  pkg: Pkg;
  part: string;
  pal: Palette;
  fonts: ThemeFonts;
  layout: XmlNode | undefined;
  master: XmlNode | undefined;
  layoutPh: Placeholder[];
  masterPh: Placeholder[];
  left: DeckSlide["left"];
  skipped: DeckSlide["skipped"];
}

const FOOTERS = new Set(["dt", "ftr", "sldNum"]);

/** The picture formats a web page can show. A deck can also hold formats only Office draws (EMF, WMF, TIFF). */
export const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

function isHidden(cNvPr: XmlNode | undefined): boolean {
  return cNvPr?.attrs["hidden"] === "1" || cNvPr?.attrs["hidden"] === "true";
}

function isDecorative(cNvPr: XmlNode | undefined): boolean {
  return descendants(cNvPr ?? { name: "", attrs: {}, children: [], text: "" }, "adec:decorative").some((d) => d.attrs["val"] === "1" || d.attrs["val"] === "true");
}

function textOfParas(paras: DeckPara[]): string {
  return paras.map((p) => p.runs.map((r) => (r.br ? " " : r.text)).join("")).join(" ").replace(/\s+/g, " ").trim();
}

function readParas(txBody: XmlNode | undefined, ctx: Context, chain: (XmlNode | undefined)[], defaultColor: string | undefined, fitScale: number, inPlaceholder: boolean): DeckPara[] {
  const paras: DeckPara[] = [];
  for (const p of kids(txBody, "a:p")) {
    const pPr = child(p, "a:pPr");
    const level = Math.max(0, Math.min(8, num(pPr, "lvl") ?? 0));
    // What the levels of the master, the layout and the shape itself say, the later ones winning.
    const inherited: LevelProps = {};
    for (const lst of chain) assignDefined(inherited, levelProps(lst, level, ctx.pal, ctx.fonts, defaultColor));
    // A shape that is not a placeholder takes its text colour from the style it was drawn with (white on an accent fill), above the deck's plain
    // default, but below any colour the shape's own text style or a run chooses.
    if (!inPlaceholder && defaultColor) inherited.color = levelProps(chain[chain.length - 1], level, ctx.pal, ctx.fonts, defaultColor).color ?? defaultColor;
    const own: LevelProps = {};
    const a = ALIGN[attr(pPr, "algn")];
    if (a) own.algn = a;
    if (child(pPr, "a:buNone")) own.bullet = "none";
    else if (child(pPr, "a:buChar")) own.bullet = "dot";
    else if (child(pPr, "a:buAutoNum")) own.bullet = "number";
    const para: LevelProps = { ...inherited, ...own };

    const runs: DeckRun[] = [];
    const nodes = p.children.filter((c) => c.name === "a:r" || c.name === "a:br" || c.name === "a:fld");
    for (const c of nodes) {
      if (c.name === "a:br") { runs.push({ text: "", br: true }); continue; }
      const text = c.children.find((x) => x.name === "a:t")?.text ?? "";
      if (text === "") continue;
      const rPr = child(c, "a:rPr");
      const mine = rPr ? runProps(rPr, ctx.pal, ctx.fonts, defaultColor) : {};
      const merged: LevelProps = assignDefined({ ...para }, mine);
      const baseline = num(rPr, "baseline") ?? 0;
      const link = rPr ? child(rPr, "a:hlinkClick") : undefined;
      const rel = link ? ctx.pkg.rel(ctx.part, link.attrs["r:id"]) : undefined;
      const run: DeckRun = { text };
      if (merged.b) run.bold = true;
      if (merged.i) run.italic = true;
      if (merged.u) run.underline = true;
      if (baseline > 0) run.sup = true;
      if (baseline < 0) run.sub = true;
      if (merged.sz !== undefined) run.size = Math.round(merged.sz * fitScale * 10) / 10;
      if (merged.color) run.color = merged.color;
      if (merged.font) run.font = merged.font;
      if (rel?.external && rel.kind === "hyperlink") run.href = rel.target;
      runs.push(run);
    }
    // A paragraph with no words is only spacing, so it is left out.
    if (!runs.some((r) => !r.br && r.text.trim() !== "")) continue;
    // Line breaks at the very end say nothing.
    while (runs.length > 0 && runs[runs.length - 1]!.br) runs.pop();
    const out: DeckPara = { level, bullet: para.bullet ?? "none", runs };
    if (para.algn) out.align = para.algn;
    paras.push(out);
  }
  return paras;
}

function lineOf(ln: XmlNode | undefined, ctx: Context, style: XmlNode | undefined): { color: string; width: number } | null | undefined {
  // undefined: nothing said here, so the next place decides.
  if (ln) {
    const paint = paintOf(ln, ctx.pal);
    if (paint?.kind === "none") return null;
    if (paint?.kind === "solid") return { color: paint.color, width: num(ln, "w") ?? 12700 };
    if (paint?.kind === "other" && paint.color) return { color: paint.color, width: num(ln, "w") ?? 12700 };
  }
  const ref = child(style, "a:lnRef");
  if (ref && (num(ref, "idx") ?? 0) > 0) {
    const color = colorOf(ref.children[0], ctx.pal);
    if (color) return { color, width: num(ln, "w") ?? 12700 };
  }
  return ln ? null : undefined;
}

function readSp(sp: XmlNode, ctx: Context, t: Transform): DeckShape | null {
  const nv = child(sp, "p:nvSpPr");
  const cNvPr = child(nv, "p:cNvPr");
  const ph = path(nv, "p:nvPr", "p:ph");
  const name = attr(cNvPr, "name") || "Shape";
  if (isHidden(cNvPr)) { ctx.left.hidden += 1; return null; }
  const type = attr(ph, "type");
  if (ph && FOOTERS.has(type)) { ctx.left.footers += 1; return null; }

  const spPr = child(sp, "p:spPr");
  const layoutPh = ph ? matchPlaceholder(ctx.layoutPh, type, attr(ph, "idx")) : undefined;
  const masterPh = ph ? matchPlaceholder(ctx.masterPh, type, attr(ph, "idx")) : undefined;
  // Own position, else the layout's, else the master's.
  const x = xfrmOf(spPr) ?? xfrmOf(child(layoutPh?.sp, "p:spPr")) ?? xfrmOf(child(masterPh?.sp, "p:spPr"));
  if (!x) { ctx.skipped.push({ name, why: "it has no position" }); return null; }
  const own = xfrmOf(spPr);
  // A shape's own position is in the space of the group it is in; one inherited from a layout is in the slide's own space.
  const box = place(x.box, own ? t : IDENTITY);

  const style = child(sp, "p:style");
  const fontRefColor = colorOf(child(style, "a:fontRef")?.children[0], ctx.pal);
  const geom = attr(child(spPr, "a:prstGeom"), "prst") || (child(spPr, "a:custGeom") ? "custom" : "rect");

  // Fill: its own, else the layout's or master's for a placeholder, else the style's.
  let fill: string | null | undefined;
  let note: string | undefined;
  const paintSources = [spPr, child(layoutPh?.sp, "p:spPr"), child(masterPh?.sp, "p:spPr")];
  for (const src of paintSources) {
    const paint = paintOf(src, ctx.pal);
    if (!paint) continue;
    if (paint.kind === "none") fill = null;
    else if (paint.kind === "solid") fill = paint.color;
    else { fill = paint.color ?? null; note = `its fill is ${paint.what}${paint.color ? ", so the first colour is used" : ", which is left out"}`; }
    break;
  }
  if (fill === undefined) {
    const ref = child(style, "a:fillRef");
    fill = ref && (num(ref, "idx") ?? 0) > 0 ? colorOf(ref.children[0], ctx.pal) ?? null : null;
  }
  const line = lineOf(child(spPr, "a:ln") ?? child(child(layoutPh?.sp, "p:spPr"), "a:ln") ?? child(child(masterPh?.sp, "p:spPr"), "a:ln"), ctx, style) ?? null;

  const common = {
    id: attr(cNvPr, "id"),
    name,
    alt: attr(cNvPr, "descr").trim(),
    decorative: isDecorative(cNvPr),
    box,
    rot: x.rot,
    placeholder: ph ? type || "body" : "",
  };

  const txBody = child(sp, "p:txBody");
  if (txBody) {
    const kind = family(type);
    const styles = child(ctx.master, "p:txStyles");
    const base = ph ? (kind === "title" ? child(styles, "p:titleStyle") : child(styles, "p:bodyStyle")) : child(styles, "p:otherStyle");
    const chain = [base, child(masterPh?.sp, "p:txBody") ? child(child(masterPh!.sp, "p:txBody"), "a:lstStyle") : undefined, child(child(layoutPh?.sp, "p:txBody"), "a:lstStyle"), child(txBody, "a:lstStyle")];
    // "Shrink text on overflow" is stored as a percentage the text was shrunk by.
    const fit = child(child(txBody, "a:bodyPr"), "a:normAutofit");
    const fitScale = (num(fit, "fontScale") ?? 100000) / 100000;
    const paras = readParas(txBody, ctx, chain, fontRefColor, fitScale, !!ph);
    if (paras.length > 0) {
      const shape: DeckShape = { ...common, kind: "text", paras, geom, fill, line, ...(note ? { note } : {}), ...(fitScale < 1 ? { fitScale } : {}), hash: "" };
      shape.hash = fingerprint({ ...shape, hash: undefined });
      return shape;
    }
  }
  // No words: it is a shape only if it can be seen.
  if (fill === null && line === null) { ctx.left.empty += 1; return null; }
  const shape: DeckShape = { ...common, kind: "shape", geom, fill, line, ...(note ? { note } : {}), hash: "" };
  shape.hash = fingerprint({ ...shape, hash: undefined });
  return shape;
}

function readPic(pic: XmlNode, ctx: Context, t: Transform): DeckShape | null {
  const cNvPr = path(pic, "p:nvPicPr", "p:cNvPr");
  const name = attr(cNvPr, "name") || "Picture";
  if (isHidden(cNvPr)) { ctx.left.hidden += 1; return null; }
  const nvPr = path(pic, "p:nvPicPr", "p:nvPr");
  if (child(nvPr, "a:videoFile") || child(nvPr, "a:audioFile") || child(nvPr, "a:wavAudioFile")) {
    ctx.skipped.push({ name, why: "it is a video or a sound, which cannot be brought in yet" });
    return null;
  }
  const x = xfrmOf(child(pic, "p:spPr"));
  if (!x) { ctx.skipped.push({ name, why: "it has no position" }); return null; }
  const blip = path(pic, "p:blipFill", "a:blip");
  const rel: Rel | undefined = ctx.pkg.rel(ctx.part, blip?.attrs["r:embed"]);
  const mediaName = rel && !rel.external ? rel.target : null;
  const ext = mediaName ? (mediaName.split(".").pop() ?? "").toLowerCase() : "";
  const bytes = mediaName ? ctx.pkg.bytes(mediaName) : undefined;
  const src = child(path(pic, "p:blipFill"), "a:srcRect");
  const cropped = !!src && ["l", "t", "r", "b"].some((k) => (num(src, k) ?? 0) !== 0);
  const shape: DeckShape = {
    id: attr(cNvPr, "id"), name, alt: attr(cNvPr, "descr").trim(), decorative: isDecorative(cNvPr), box: place(x.box, t), rot: x.rot, placeholder: attr(path(nvPr, "p:ph"), "type"),
    kind: "picture", media: bytes && IMAGE_EXT.has(ext) ? mediaName : null, mediaHash: bytes ? hashBytes(bytes) : "", ext, cropped, hash: "",
  };
  if (!bytes) ctx.skipped.push({ name, why: "its picture is not in the file" });
  else if (!IMAGE_EXT.has(ext)) ctx.skipped.push({ name, why: `its picture is a .${ext || "unknown"} file, which a web page cannot show` });
  shape.hash = fingerprint({ ...shape, hash: undefined });
  return shape;
}

function cellText(tc: XmlNode): string {
  return kids(child(tc, "a:txBody"), "a:p")
    .map((p) => p.children.filter((c) => c.name === "a:r" || c.name === "a:fld").map((r) => r.children.find((x) => x.name === "a:t")?.text ?? "").join(""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function readFrame(frame: XmlNode, ctx: Context, t: Transform): DeckShape | null {
  const cNvPr = path(frame, "p:nvGraphicFramePr", "p:cNvPr");
  const name = attr(cNvPr, "name") || "Object";
  if (isHidden(cNvPr)) { ctx.left.hidden += 1; return null; }
  const xf = child(frame, "p:xfrm");
  const off = child(xf, "a:off");
  const ext = child(xf, "a:ext");
  const data = path(frame, "a:graphic", "a:graphicData");
  const uri = attr(data, "uri");
  const tbl = child(data, "a:tbl");
  if (!tbl || !off || !ext) {
    const what = uri.endsWith("/chart") ? "a chart" : uri.endsWith("/diagram") ? "SmartArt" : uri.endsWith("/ole") || child(data, "p:oleObj") ? "an embedded object" : "something this editor cannot read";
    ctx.skipped.push({ name, why: `it is ${what}, which cannot be brought in yet` });
    return null;
  }
  const box = place({ x: num(off, "x") ?? 0, y: num(off, "y") ?? 0, cx: num(ext, "cx") ?? 0, cy: num(ext, "cy") ?? 0 }, t);
  let merged = false;
  const rows = kids(tbl, "a:tr").map((tr) => kids(tr, "a:tc").map((tc) => {
    if ((num(tc, "gridSpan") ?? 1) > 1 || (num(tc, "rowSpan") ?? 1) > 1 || tc.attrs["hMerge"] || tc.attrs["vMerge"]) merged = true;
    return cellText(tc);
  }));
  const pr = child(tbl, "a:tblPr");
  const shape: DeckShape = {
    id: attr(cNvPr, "id"), name, alt: attr(cNvPr, "descr").trim(), decorative: isDecorative(cNvPr), box, rot: 0, placeholder: "",
    kind: "table", rows, headerRow: pr?.attrs["firstRow"] === "1", headerColumn: pr?.attrs["firstCol"] === "1", merged, hash: "",
  };
  shape.hash = fingerprint({ ...shape, hash: undefined });
  return shape;
}

function readConnector(cx: XmlNode, ctx: Context, t: Transform): DeckShape | null {
  const cNvPr = path(cx, "p:nvCxnSpPr", "p:cNvPr");
  const name = attr(cNvPr, "name") || "Line";
  if (isHidden(cNvPr)) { ctx.left.hidden += 1; return null; }
  const x = xfrmOf(child(cx, "p:spPr"));
  if (!x) return null;
  const style = child(cx, "p:style");
  const line = lineOf(child(child(cx, "p:spPr"), "a:ln"), ctx, style);
  if (!line) { ctx.left.empty += 1; return null; }
  const shape: DeckShape = {
    id: attr(cNvPr, "id"), name, alt: attr(cNvPr, "descr").trim(), decorative: isDecorative(cNvPr), box: place(x.box, t), rot: x.rot, placeholder: "",
    kind: "line", color: line.color, width: line.width, hash: "",
  };
  shape.hash = fingerprint({ ...shape, hash: undefined });
  return shape;
}

function walk(nodes: XmlNode[], ctx: Context, t: Transform, out: DeckShape[]): void {
  for (const n of nodes) {
    let made: DeckShape | null = null;
    switch (n.name) {
      case "p:sp": made = readSp(n, ctx, t); break;
      case "p:pic": made = readPic(n, ctx, t); break;
      case "p:graphicFrame": made = readFrame(n, ctx, t); break;
      case "p:cxnSp": made = readConnector(n, ctx, t); break;
      case "p:grpSp": {
        const x = xfrmOf(child(n, "p:grpSpPr"));
        walk(n.children.filter((c) => c.name !== "p:nvGrpSpPr" && c.name !== "p:grpSpPr"), ctx, groupTransform(t, x), out);
        break;
      }
      case "mc:AlternateContent": {
        const pick = child(n, "mc:Fallback") ?? child(n, "mc:Choice");
        if (pick) walk(pick.children, ctx, t, out);
        break;
      }
      default: break;
    }
    if (made) out.push(made);
  }
}

// ---- backgrounds

function backgroundOf(sources: { tree: XmlNode | undefined; part: string }[], pal: Palette, pkg: Pkg): { color: string | null; picture: DeckSlide["backgroundPicture"]; note?: string } {
  for (const { tree, part } of sources) {
    const bg = path(tree, "p:cSld", "p:bg");
    if (!bg) continue;
    const pr = child(bg, "p:bgPr");
    const fill = child(pr, "a:blipFill");
    if (fill) {
      if (child(fill, "a:tile")) return { color: null, picture: null, note: "the background is a tiled picture, which is left out" };
      const rel = pkg.rel(part, child(fill, "a:blip")?.attrs["r:embed"]);
      const bytes = rel && !rel.external ? pkg.bytes(rel.target) : undefined;
      const ext = rel ? (rel.target.split(".").pop() ?? "").toLowerCase() : "";
      if (rel && bytes && IMAGE_EXT.has(ext)) return { color: null, picture: { media: rel.target, mediaHash: hashBytes(bytes), ext } };
      return { color: null, picture: null, note: "the background is a picture a web page cannot show, so it is left out" };
    }
    if (pr) {
      const paint = paintOf(pr, pal);
      if (paint?.kind === "solid") return { color: paint.color, picture: null };
      if (paint?.kind === "other") return { color: paint.color ?? null, picture: null, note: `the background is ${paint.what}${paint.color ? ", so its first colour is used" : ", which is left out"}` };
    }
    const ref = child(bg, "p:bgRef");
    const color = colorOf(ref?.children[0], pal);
    if (color) return { color, picture: null };
  }
  return { color: null, picture: null };
}

// ---- the deck

/** Read a deck. Throws a plain sentence if its parts are damaged. */
export function readDeck(pkg: Pkg): Deck {
  const pres = pkg.xml("ppt/presentation.xml");
  const size = child(pres, "p:sldSz");
  const slideWidth = num(size, "cx") ?? 9144000;
  const slideHeight = num(size, "cy") ?? 6858000;
  const list = kids(child(pres, "p:sldIdLst"), "p:sldId");
  if (list.length === 0) throw new Error("That presentation has no slides.");

  const slides: DeckSlide[] = [];
  const themes = new Map<string, { pal: Palette; fonts: ThemeFonts }>();
  list.forEach((entry, index) => {
    const rel = pkg.rel("ppt/presentation.xml", entry.attrs["r:id"]);
    if (!rel || rel.external || !pkg.has(rel.target)) throw new Error(`Slide ${index + 1} is missing from the file.`);
    const part = rel.target;
    const slide = pkg.xml(part);
    const layoutRel = pkg.relOfKind(part, "slideLayout");
    const layout = layoutRel ? pkg.xml(layoutRel.target) : undefined;
    const masterRel = layoutRel ? pkg.relOfKind(layoutRel.target, "slideMaster") : undefined;
    const master = masterRel ? pkg.xml(masterRel.target) : undefined;
    const themeRel = masterRel ? pkg.relOfKind(masterRel.target, "theme") : undefined;
    let theme = themeRel ? themes.get(themeRel.target) : undefined;
    if (!theme) {
      const clr = child(master, "p:clrMap");
      const map = { ...DEFAULT_CLRMAP, ...(clr ? clr.attrs : {}) };
      const xml = themeRel ? pkg.xml(themeRel.target) : undefined;
      theme = { pal: { scheme: readScheme(xml), map }, fonts: themeFonts(xml) };
      if (themeRel) themes.set(themeRel.target, theme);
    }
    const ctx: Context = {
      pkg, part, pal: theme.pal, fonts: theme.fonts, layout, master, layoutPh: placeholdersOf(layout), masterPh: placeholdersOf(master),
      left: { footers: 0, hidden: 0, empty: 0 }, skipped: [],
    };
    const shapes: DeckShape[] = [];
    walk(path(slide, "p:cSld", "p:spTree")?.children ?? [], ctx, IDENTITY, shapes);

    const titleShape = shapes.find((s) => s.kind === "text" && (s.placeholder === "title" || s.placeholder === "ctrTitle"));
    const titleText = titleShape && titleShape.kind === "text" ? textOfParas(titleShape.paras) : "";
    const slideName = titleText || attr(child(slide, "p:cSld"), "name").trim() || `Slide ${index + 1}`;
    const bg = backgroundOf([{ tree: slide, part }, { tree: layout, part: layoutRel?.target ?? "" }, { tree: master, part: masterRel?.target ?? "" }], theme.pal, pkg);
    const notesRel = pkg.relOfKind(part, "notesSlide");
    const notes = notesRel ? pkg.xml(notesRel.target) : undefined;
    const hasNotes = !!notes && descendants(notes, "a:t").some((t) => t.text.trim() !== "") && !!notesRel;
    const base = { slideId: entry.attrs["id"] ?? String(index), index, part, name: slideName.length > 80 ? `${slideName.slice(0, 77)}...` : slideName, hidden: slide?.attrs["show"] === "0", background: bg.color, backgroundPicture: bg.picture };
    slides.push({
      ...base, ...(bg.note ? { backgroundNote: bg.note } : {}), shapes, skipped: ctx.skipped, left: ctx.left, hasNotes,
      animated: !!child(slide, "p:timing") || !!child(slide, "p:transition") || descendants(slide ?? { name: "", attrs: {}, children: [], text: "" }, "p:transition").length > 0,
      hash: fingerprint({ name: base.name, background: bg.color, picture: bg.picture?.mediaHash ?? null }),
    });
  });
  return { slideWidth, slideHeight, slides };
}
