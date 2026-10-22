// A way to make small PowerPoint files for tests, so the reader and the importer are tested on files whose contents are known exactly.
// Not part of the editor. Real decks are used only by a test that skips itself when they are not on the computer.

import { zipSync } from "../../../player/src/unzip.ts";

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const enc = new TextEncoder();

export const inch = (n: number): number => Math.round(n * 914400);

export interface Run { t: string; b?: boolean; i?: boolean; sz?: number; color?: string; font?: string; link?: string; baseline?: number }
export interface Para {
  runs: (Run | "br")[];
  lvl?: number;
  bullet?: "none" | "char" | "num";
  algn?: string;
  /** Line spacing as a percentage of single (90 is 90%). */
  lnPct?: number;
  /** Space before and after, in points. */
  before?: number;
  after?: number;
  /** For a paragraph with no words: the size of the text it would have had, in points. */
  endSz?: number;
}

const run = (r: Run, linkId?: string) =>
  `<a:r><a:rPr lang="en-US"${r.sz ? ` sz="${r.sz * 100}"` : ""}${r.b !== undefined ? ` b="${r.b ? 1 : 0}"` : ""}${r.i ? ' i="1"' : ""}${r.baseline ? ` baseline="${r.baseline}"` : ""}>` +
  `${r.color ? `<a:solidFill><a:srgbClr val="${r.color}"/></a:solidFill>` : ""}${r.font ? `<a:latin typeface="${r.font}"/>` : ""}${linkId ? `<a:hlinkClick r:id="${linkId}"/>` : ""}</a:rPr><a:t>${r.t}</a:t></a:r>`;

export function paras(list: Para[], links: Map<string, string> = new Map()): string {
  return list.map((p) => {
    const spacing = `${p.lnPct !== undefined ? `<a:lnSpc><a:spcPct val="${p.lnPct * 1000}"/></a:lnSpc>` : ""}${p.before !== undefined ? `<a:spcBef><a:spcPts val="${p.before * 100}"/></a:spcBef>` : ""}${p.after !== undefined ? `<a:spcAft><a:spcPts val="${p.after * 100}"/></a:spcAft>` : ""}`;
    const ppr = `<a:pPr${p.lvl ? ` lvl="${p.lvl}"` : ""}${p.algn ? ` algn="${p.algn}"` : ""}>${spacing}${p.bullet === "none" ? "<a:buNone/>" : p.bullet === "char" ? '<a:buChar char="•"/>' : p.bullet === "num" ? '<a:buAutoNum type="arabicPeriod"/>' : ""}</a:pPr>`;
    const body = p.runs.map((r) => (r === "br" ? "<a:br/>" : run(r, r.link ? links.get(r.link) : undefined))).join("");
    return `<a:p>${ppr}${body}${p.runs.length === 0 ? `<a:endParaRPr lang="en-US"${p.endSz ? ` sz="${p.endSz * 100}"` : ""}/>` : ""}</a:p>`;
  }).join("");
}

export interface Spec {
  id: number;
  name: string;
  /** A placeholder: "title", "body" and the like, with its number. */
  ph?: { type?: string; idx?: number };
  box?: { x: number; y: number; w: number; h: number; rot?: number };
  paras?: Para[];
  geom?: string;
  fill?: string;
  noFill?: boolean;
  line?: { color: string; w?: number };
  alt?: string;
  decorative?: boolean;
  hidden?: boolean;
  fit?: number;
  /** How the words sit: where they start (t, ctr, b), the room round them in inches, the way the box deals with too many words, and no wrapping. */
  body?: { anchor?: string; ins?: { l?: number; t?: number; r?: number; b?: number }; autofit?: "norm" | "sp" | "none"; noWrap?: boolean };
  txBox?: boolean;
  styleRef?: { fill?: string; font?: string; line?: string };
}

export function sp(s: Spec, links: Map<string, string> = new Map()): string {
  const xfrm = s.box ? `<a:xfrm${s.box.rot ? ` rot="${s.box.rot * 60000}"` : ""}><a:off x="${inch(s.box.x)}" y="${inch(s.box.y)}"/><a:ext cx="${inch(s.box.w)}" cy="${inch(s.box.h)}"/></a:xfrm>` : "";
  const geom = s.geom ? `<a:prstGeom prst="${s.geom}"><a:avLst/></a:prstGeom>` : "";
  const fill = s.noFill ? "<a:noFill/>" : s.fill ? `<a:solidFill><a:srgbClr val="${s.fill}"/></a:solidFill>` : "";
  const ln = s.line ? `<a:ln w="${s.line.w ?? 12700}"><a:solidFill><a:srgbClr val="${s.line.color}"/></a:solidFill></a:ln>` : "";
  const ext = s.decorative ? '<a:extLst><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext></a:extLst>' : "";
  const style = s.styleRef
    ? `<p:style><a:lnRef idx="${s.styleRef.line ? 2 : 0}">${s.styleRef.line ? `<a:srgbClr val="${s.styleRef.line}"/>` : ""}</a:lnRef><a:fillRef idx="${s.styleRef.fill ? 1 : 0}">${s.styleRef.fill ? `<a:srgbClr val="${s.styleRef.fill}"/>` : ""}</a:fillRef><a:effectRef idx="0"/><a:fontRef idx="minor">${s.styleRef.font ? `<a:srgbClr val="${s.styleRef.font}"/>` : ""}</a:fontRef></p:style>`
    : "";
  const b = s.body;
  const bodyAttrs = b
    ? `${b.anchor ? ` anchor="${b.anchor}"` : ""}${b.ins?.l !== undefined ? ` lIns="${inch(b.ins.l)}"` : ""}${b.ins?.t !== undefined ? ` tIns="${inch(b.ins.t)}"` : ""}${b.ins?.r !== undefined ? ` rIns="${inch(b.ins.r)}"` : ""}${b.ins?.b !== undefined ? ` bIns="${inch(b.ins.b)}"` : ""}${b.noWrap ? ' wrap="none"' : ""}`
    : "";
  const fit = s.fit ? `<a:normAutofit fontScale="${s.fit * 1000}"/>` : b?.autofit === "norm" ? "<a:normAutofit/>" : b?.autofit === "sp" ? "<a:spAutoFit/>" : b?.autofit === "none" ? "<a:noAutofit/>" : "";
  const body = s.paras
    ? `<p:txBody><a:bodyPr${bodyAttrs}>${fit}</a:bodyPr><a:lstStyle/>${paras(s.paras, links)}</p:txBody>`
    : "";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${s.id}" name="${s.name}"${s.alt ? ` descr="${s.alt}"` : ""}${s.hidden ? ' hidden="1"' : ""}>${ext}</p:cNvPr><p:cNvSpPr${s.txBox ? ' txBox="1"' : ""}/>` +
    `<p:nvPr>${s.ph ? `<p:ph${s.ph.type ? ` type="${s.ph.type}"` : ""}${s.ph.idx !== undefined ? ` idx="${s.ph.idx}"` : ""}/>` : ""}</p:nvPr></p:nvSpPr><p:spPr>${xfrm}${geom}${fill}${ln}</p:spPr>${style}${body}</p:sp>`;
}

export function pic(id: number, name: string, rId: string, box: { x: number; y: number; w: number; h: number }, alt = "", extra = ""): string {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}"${alt ? ` descr="${alt}"` : ""}/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rId}"/>${extra}<a:stretch/></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${inch(box.x)}" y="${inch(box.y)}"/><a:ext cx="${inch(box.w)}" cy="${inch(box.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

export function table(id: number, name: string, box: { x: number; y: number; w: number; h: number }, rows: string[][], opts: { firstRow?: boolean; firstCol?: boolean; alt?: string; span?: boolean } = {}): string {
  const cell = (t: string, c: number) => `<a:tc${opts.span && c === 1 ? ' gridSpan="2"' : ""}><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${t}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`;
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"${opts.alt ? ` descr="${opts.alt}"` : ""}/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${inch(box.x)}" y="${inch(box.y)}"/><a:ext cx="${inch(box.w)}" cy="${inch(box.h)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">` +
    `<a:tbl><a:tblPr${opts.firstRow ? ' firstRow="1"' : ""}${opts.firstCol ? ' firstCol="1"' : ""}/><a:tblGrid/>${rows.map((r) => `<a:tr h="370840">${r.map(cell).join("")}</a:tr>`).join("")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

export function chart(id: number, name: string, box: { x: number; y: number; w: number; h: number }): string {
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${inch(box.x)}" y="${inch(box.y)}"/><a:ext cx="${inch(box.w)}" cy="${inch(box.h)}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic></p:graphicFrame>`;
}

export function group(id: number, name: string, off: { x: number; y: number; w: number; h: number }, chOff: { x: number; y: number; w: number; h: number }, children: string, turn: { rot?: number; flipH?: boolean; flipV?: boolean } = {}): string {
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm${turn.rot ? ` rot="${turn.rot * 60000}"` : ""}${turn.flipH ? ' flipH="1"' : ""}${turn.flipV ? ' flipV="1"' : ""}><a:off x="${inch(off.x)}" y="${inch(off.y)}"/><a:ext cx="${inch(off.w)}" cy="${inch(off.h)}"/>` +
    `<a:chOff x="${inch(chOff.x)}" y="${inch(chOff.y)}"/><a:chExt cx="${inch(chOff.w)}" cy="${inch(chOff.h)}"/></a:xfrm></p:grpSpPr>${children}</p:grpSp>`;
}

export function connector(id: number, name: string, box: { x: number; y: number; w: number; h: number }, color = "000000", w = 12700): string {
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="${inch(box.x)}" y="${inch(box.y)}"/><a:ext cx="${inch(box.w)}" cy="${inch(box.h)}"/></a:xfrm>` +
    `<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${w}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></p:spPr></p:cxnSp>`;
}

export interface SlideSpec {
  /** The deck's number for the slide (p:sldId id). */
  id: number;
  /** The shapes, as XML from the helpers above. */
  shapes: string;
  background?: string;
  backgroundPicture?: string;
  /** A picture that repeats across the background (the file name inside ppt/media). */
  backgroundTile?: string;
  /** The slide turns off what its layout and master draw ("hide background graphics"). */
  hideMaster?: boolean;
  /** Media for this slide's relationships: rId to the file name inside ppt/media. */
  media?: Record<string, string>;
  links?: Record<string, string>;
  notes?: string;
  show?: boolean;
  animated?: boolean;
  /** The slide's p:timing element, as XML (see `timing` below). */
  timing?: string;
}

export interface EffectSpec {
  /** The shape the effect is for: its number on the slide. */
  spid: number;
  cls?: "entr" | "exit" | "emph" | "path";
  /** PowerPoint's number for the effect: 1 is Appear, 10 is Fade, 2 is Fly In. */
  preset?: number;
  subtype?: number;
  /** How it starts. */
  node?: "clickEffect" | "withEffect" | "afterEffect";
  /** Milliseconds, after the press or the group's start. */
  delay?: number;
  /** Milliseconds the effect takes. */
  dur?: number;
  /** The effect is for one paragraph of the text, not the whole shape. */
  para?: boolean;
}

/**
 * A slide's animation: a list of steps; each step is started by a press of the mouse (or, with `auto`, by the slide opening) and holds groups, each group
 * a delay from the step's start and the effects that start then.
 */
export function timing(steps: { auto?: boolean; groups: { delay?: number; effects: EffectSpec[] }[] }[]): string {
  let id = 3;
  const effect = (e: EffectSpec) => {
    const dur = e.dur ?? 500;
    const behaviour = e.preset === 1 || e.preset === undefined
      ? `<p:set><p:cBhvr><p:cTn id="${id++}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${e.spid}">${e.para ? '<p:txEl><p:pRg st="0" end="0"/></p:txEl>' : ""}</p:spTgt></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`
      : `<p:set><p:cBhvr><p:cTn id="${id++}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${e.spid}">${e.para ? '<p:txEl><p:pRg st="0" end="0"/></p:txEl>' : ""}</p:spTgt></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>` +
        `<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${id++}" dur="${dur}"/><p:tgtEl><p:spTgt spid="${e.spid}"/></p:tgtEl></p:cBhvr></p:animEffect>`;
    return `<p:par><p:cTn id="${id++}" presetID="${e.preset ?? 1}" presetClass="${e.cls ?? "entr"}" presetSubtype="${e.subtype ?? 0}" fill="hold" nodeType="${e.node ?? "clickEffect"}"><p:stCondLst><p:cond delay="${e.delay ?? 0}"/></p:stCondLst><p:childTnLst>${behaviour}</p:childTnLst></p:cTn></p:par>`;
  };
  const group = (g: { delay?: number; effects: EffectSpec[] }) => `<p:par><p:cTn id="${id++}" fill="hold"><p:stCondLst><p:cond delay="${g.delay ?? 0}"/></p:stCondLst><p:childTnLst>${g.effects.map(effect).join("")}</p:childTnLst></p:cTn></p:par>`;
  const step = (s: { auto?: boolean; groups: { delay?: number; effects: EffectSpec[] }[] }) =>
    `<p:par><p:cTn id="${id++}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/>${s.auto ? '<p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>' : ""}</p:stCondLst><p:childTnLst>${s.groups.map(group).join("")}</p:childTnLst></p:cTn></p:par>`;
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${steps.map(step).join("")}</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
}

export interface DeckSpec {
  width?: number;
  height?: number;
  slides: SlideSpec[];
  /** Files inside ppt/media by name. */
  media?: Record<string, Uint8Array>;
  /** The layout's and master's own shapes (placeholders), as XML. */
  layoutShapes?: string;
  masterShapes?: string;
  /** The layout turns off the master's own shapes. */
  layoutHidesMaster?: boolean;
  titleStyle?: string;
  bodyStyle?: string;
  otherStyle?: string;
  masterBackground?: string;
}

const DEFAULT_MASTER_SHAPES = sp({ id: 2, name: "Title Placeholder 1", ph: { type: "title" }, box: { x: 0.5, y: 0.3, w: 9, h: 1.2 }, geom: "rect" }) +
  sp({ id: 3, name: "Text Placeholder 2", ph: { type: "body", idx: 1 }, box: { x: 0.9, y: 1.75, w: 8, h: 4.4 }, geom: "rect" });

const DEFAULT_TITLE_STYLE = '<a:lvl1pPr algn="ctr"><a:buNone/><a:defRPr sz="4400" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr>';
const DEFAULT_BODY_STYLE = '<a:lvl1pPr algn="l"><a:buChar char="•"/><a:defRPr sz="3200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>' +
  '<a:lvl2pPr algn="l"><a:buChar char="–"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl2pPr>';
const DEFAULT_OTHER_STYLE = '<a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr>';

/** Make a whole .pptx file. */
export function buildDeck(spec: DeckSpec): Uint8Array {
  const w = spec.width ?? inch(13.333);
  const h = spec.height ?? inch(7.5);
  const files: Record<string, Uint8Array> = {};
  const put = (name: string, text: string) => { files[name] = enc.encode(head + text); };

  put("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  put("_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  put("ppt/presentation.xml", `<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdM"/></p:sldMasterIdLst><p:sldIdLst>${spec.slides.map((s, i) => `<p:sldId id="${s.id}" r:id="rIdS${i + 1}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${w}" cy="${h}"/></p:presentation>`);
  put("ppt/_rels/presentation.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdM" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
    spec.slides.map((_, i) => `<Relationship Id="rIdS${i + 1}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join("") + "</Relationships>");
  put("ppt/theme/theme1.xml", `<a:theme ${NS} name="Test"><a:themeElements><a:clrScheme name="Test"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2>` +
    `<a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6>` +
    `<a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Test"><a:majorFont><a:latin typeface="Georgia"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`);
  put("ppt/slideMasters/slideMaster1.xml", `<p:sldMaster ${NS}><p:cSld>${spec.masterBackground ?? ""}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${spec.masterShapes ?? DEFAULT_MASTER_SHAPES}</p:spTree></p:cSld>` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
    `<p:txStyles><p:titleStyle>${spec.titleStyle ?? DEFAULT_TITLE_STYLE}</p:titleStyle><p:bodyStyle>${spec.bodyStyle ?? DEFAULT_BODY_STYLE}</p:bodyStyle><p:otherStyle>${spec.otherStyle ?? DEFAULT_OTHER_STYLE}</p:otherStyle></p:txStyles></p:sldMaster>`);
  put("ppt/slideMasters/_rels/slideMaster1.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/theme" Target="../theme/theme1.xml"/>` +
    Object.entries(spec.media ?? {}).map(([name], i) => `<Relationship Id="rIdMedia${i + 1}" Type="${REL}/image" Target="../media/${name}"/>`).join("") + "</Relationships>");
  put("ppt/slideLayouts/slideLayout1.xml", `<p:sldLayout ${NS}${spec.layoutHidesMaster ? ' showMasterSp="0"' : ""}><p:cSld name="Title and Content"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${spec.layoutShapes ?? ""}</p:spTree></p:cSld></p:sldLayout>`);
  put("ppt/slideLayouts/_rels/slideLayout1.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);

  spec.slides.forEach((s, i) => {
    const n = i + 1;
    const bg = s.background ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${s.background}"/></a:solidFill></p:bgPr></p:bg>` : s.backgroundTile ? '<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rIdBg"/><a:tile tx="0" ty="0" sx="100000" sy="100000" flip="none" algn="tl"/></a:blipFill></p:bgPr></p:bg>' : s.backgroundPicture ? '<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rIdBg"/><a:stretch/></a:blipFill></p:bgPr></p:bg>' : "";
    put(`ppt/slides/slide${n}.xml`, `<p:sld ${NS}${s.show === false ? ' show="0"' : ""}${s.hideMaster ? ' showMasterSp="0"' : ""}><p:cSld>${bg}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${s.shapes}</p:spTree></p:cSld>${s.timing ?? (s.animated ? '<p:timing><p:tnLst/></p:timing>' : "")}</p:sld>`);
    const rels = [`<Relationship Id="rIdLayout" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`];
    for (const [rId, file] of Object.entries(s.media ?? {})) rels.push(`<Relationship Id="${rId}" Type="${REL}/image" Target="../media/${file}"/>`);
    if (s.backgroundPicture) rels.push(`<Relationship Id="rIdBg" Type="${REL}/image" Target="../media/${s.backgroundPicture}"/>`);
    if (s.backgroundTile) rels.push(`<Relationship Id="rIdBg" Type="${REL}/image" Target="../media/${s.backgroundTile}"/>`);
    for (const [rId, url] of Object.entries(s.links ?? {})) rels.push(`<Relationship Id="${rId}" Type="${REL}/hyperlink" Target="${url}" TargetMode="External"/>`);
    if (s.notes) {
      rels.push(`<Relationship Id="rIdN" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/>`);
      // The slide's own number sits on a notes page too, and is not a note.
      put(`ppt/notesSlides/notesSlide${n}.xml`, `<p:notes ${NS}><p:cSld><p:spTree>` +
        `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
        `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${s.notes.split("\n").map((l) => `<a:p><a:r><a:t>${l}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp>` +
        `<p:sp><p:nvSpPr><p:cNvPr id="4" name="Number"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum" idx="5"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld type="slidenum"><a:t>7</a:t></a:fld></a:p></p:txBody></p:sp>` +
        `</p:spTree></p:cSld></p:notes>`);
    }
    put(`ppt/slides/_rels/slide${n}.xml.rels`, `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`);
  });
  for (const [name, bytes] of Object.entries(spec.media ?? {})) files[`ppt/media/${name}`] = bytes;
  return zipSync(files);
}

/** A few bytes that look like a PNG, enough for a test to tell two pictures apart. */
export const fakePng = (seed: number): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed & 255, (seed >> 8) & 255, 1, 2, 3]);
