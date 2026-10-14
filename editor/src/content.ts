// Small pure helpers for the content of objects: simple text, colours, and the simple
// "when activated" action on a button. No DOM here, so it is all tested directly.

import type { Condition, OSObject, Primitive, Trigger } from "../../player/src/types.ts";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unescapeHtml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

export const TEXT_BLOCKS = ["p", "h1", "h2", "h3", "h4", "h5", "h6"] as const;
export type TextBlock = (typeof TEXT_BLOCKS)[number];

/**
 * Choosing a heading level also sets a font size for it, so the levels look different as well as
 * meaning different things to a screen reader. The size is stored on the object like any other,
 * and the author can change it afterwards.
 */
export const BLOCK_SIZES: Record<TextBlock, number> = { p: 22, h1: 44, h2: 36, h3: 30, h4: 26, h5: 22, h6: 20 };

/**
 * Fonts that are on most Windows, Mac and Linux machines, each with a fallback, because the course
 * runs on the learner's computer and not the author's. Fonts that would have to travel with the
 * course (such as dyslexia-friendly ones) are a later feature.
 */
export const FONT_CHOICES: { label: string; value: string }[] = [
  { label: "System default", value: "system-ui" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', Helvetica, sans-serif" },
  { label: "Georgia (serif)", value: "Georgia, 'Times New Roman', serif" },
  { label: "Times New Roman (serif)", value: "'Times New Roman', Times, serif" },
  { label: "Courier New (monospace)", value: "'Courier New', Courier, monospace" },
];

const FONT_VALUE = /^[\w\s,"'.-]+$/;
export const isFontValue = (v: string): boolean => FONT_VALUE.test(v.trim());

export interface SimpleText {
  block: TextBlock;
  text: string;
}

/**
 * If the HTML is one paragraph or heading holding only plain text (and line breaks), return
 * it in a form the author can edit. Anything with more structure returns null, and the editor
 * says it cannot edit that yet instead of flattening it.
 */
export function parseSimpleText(html: string): SimpleText | null {
  const m = /^<(p|h[1-6])>([\s\S]*)<\/\1>$/.exec(html.trim());
  if (!m) return null;
  const inner = m[2]!;
  const withoutBreaks = inner.replace(/<br\s*\/?>/gi, "");
  if (/[<>]/.test(withoutBreaks)) return null;
  return { block: m[1] as TextBlock, text: unescapeHtml(inner.replace(/<br\s*\/?>/gi, "\n")) };
}

export function buildSimpleText(t: SimpleText): string {
  return `<${t.block}>${escapeHtml(t.text).replace(/\r?\n/g, "<br>")}</${t.block}>`;
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(v: string): boolean {
  return HEX.test(v.trim());
}

// ---- the button's "when activated" action

export type Activation =
  | { kind: "none" }
  | { kind: "next" }
  | { kind: "previous" }
  | { kind: "replay" }
  | { kind: "jump"; slideId: string }
  | { kind: "show"; layerId: string }
  | { kind: "hide"; layerId: string }
  /** Triggers the editor cannot show yet. They are left exactly as they are. */
  | { kind: "custom" };

const ACTION_OF = { jump: "jumpToSlide", show: "showLayer", hide: "hideLayer", next: "nextSlide", previous: "previousSlide", replay: "replaySlide" } as const;

/** Read a button's triggers back as one simple action, or "custom" if they are anything else. */
export function readActivation(triggers: Trigger[]): Activation {
  if (triggers.length === 0) return { kind: "none" };
  if (triggers.length !== 2) return { kind: "custom" };
  const click = triggers.find((t) => t.event === "click");
  const key = triggers.find((t) => t.event === "keyActivate");
  if (!click || !key) return { kind: "custom" };
  if (click.action !== key.action || click.target !== key.target) return { kind: "custom" };
  if (click.conditions.length > 0 || key.conditions.length > 0) return { kind: "custom" };
  if (click.value !== undefined || key.value !== undefined) return { kind: "custom" };
  if (click.action === "nextSlide") return { kind: "next" };
  if (click.action === "previousSlide") return { kind: "previous" };
  if (click.action === "replaySlide") return { kind: "replay" };
  if (click.action === "jumpToSlide") return { kind: "jump", slideId: click.target };
  if (click.action === "showLayer") return { kind: "show", layerId: click.target };
  if (click.action === "hideLayer") return { kind: "hide", layerId: click.target };
  return { kind: "custom" };
}

/**
 * Build the triggers for a simple action. A click always comes with a keyActivate that does
 * the same thing, so a button made here is never mouse-only.
 */
export function buildActivation(a: Exclude<Activation, { kind: "custom" }>): Trigger[] {
  if (a.kind === "none") return [];
  const target = a.kind === "jump" ? a.slideId : a.kind === "show" || a.kind === "hide" ? a.layerId : "";
  const action = ACTION_OF[a.kind];
  return [
    { id: "trg-0001", event: "click", action, target, conditions: [] },
    { id: "trg-0002", event: "keyActivate", action, target, conditions: [] },
  ];
}

export function isActivatable(obj: Pick<OSObject, "type">): boolean {
  return obj.type === "button";
}

// ---- colours

/** A starter palette: named colours so nobody needs to know a hex code. */
export const PALETTE: { name: string; hex: string }[] = [
  { name: "Black", hex: "#141414" }, { name: "Dark grey", hex: "#333333" }, { name: "Grey", hex: "#6b6b6b" },
  { name: "Light grey", hex: "#cccccc" }, { name: "Pale grey", hex: "#f0f0f0" }, { name: "White", hex: "#ffffff" },
  { name: "Navy", hex: "#0b2a6f" }, { name: "Blue", hex: "#0b3fb3" }, { name: "Bright blue", hex: "#0b5fff" },
  { name: "Sky blue", hex: "#8ec5ff" }, { name: "Teal", hex: "#006d77" }, { name: "Aqua", hex: "#7fd6d0" },
  { name: "Dark green", hex: "#1b5e20" }, { name: "Green", hex: "#2e7d32" }, { name: "Light green", hex: "#a5d6a7" },
  { name: "Yellow", hex: "#ffd400" }, { name: "Gold", hex: "#b8860b" }, { name: "Cream", hex: "#fff3c4" },
  { name: "Dark red", hex: "#8c1d18" }, { name: "Red", hex: "#c62828" }, { name: "Orange", hex: "#e65100" },
  { name: "Pink", hex: "#f48fb1" }, { name: "Purple", hex: "#5e35b1" }, { name: "Light purple", hex: "#d1c4e9" },
];

/** Lower-case six-digit form of a hex colour, or null if it is not one. */
export function normalizeHex(v: string): string | null {
  const t = v.trim();
  if (!isHexColor(t)) return null;
  const h = t.slice(1).toLowerCase();
  return "#" + (h.length === 3 ? h.split("").map((c) => c + c).join("") : h);
}

/** "Theme: Accent (#0b5fff)" for a theme colour, with the theme's own colour in brackets. */
export function themeColorLabel(value: string, hex: string, roleNames: Record<string, string>): string {
  const role = value.slice("theme:color.".length);
  return `Theme: ${roleNames[role] ?? role} (${hex})`;
}

/** "Dark blue" for a palette colour, otherwise the hex code itself. */
export function colorName(v: string): string {
  const hex = normalizeHex(v);
  if (!hex) return v;
  const hit = PALETTE.find((p) => p.hex === hex);
  return hit ? `${hit.name} (${hex})` : hex;
}

function luminance(hex: string): number {
  const h = normalizeHex(hex) ?? "#000000";
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** WCAG contrast ratio between two hex colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** A sentence for the author about how readable a text colour is on a background. */
export function contrastNote(text: string, background: string, backgroundName: string, size: number): string {
  const ratio = contrastRatio(text, background);
  const large = size >= 24;
  const need = large ? 3 : 4.5;
  const verdict = ratio >= need ? `passes WCAG AA for ${large ? "large" : "normal"} text` : `is too low: WCAG AA needs ${need}:1 for ${large ? "large" : "normal"} text`;
  return `Contrast with ${backgroundName}: ${ratio.toFixed(1)}:1, which ${verdict}.`;
}

/**
 * The text of an interaction item is a few plain paragraphs. A blank line starts a new paragraph.
 * Returns the HTML the format stores.
 */
export function buildBody(text: string): string {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((p) => `<p>${escapeHtml(p).replace(/\r?\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * The reverse of buildBody, for an item whose HTML is only plain paragraphs. HTML with other
 * structure returns null, so the editor can say it cannot edit that yet instead of flattening it.
 */
export function parseBody(html: string): string | null {
  const t = html.trim();
  if (t === "") return "";
  const parts = t.match(/^(?:<p>[\s\S]*?<\/p>)+$/) ? t.split(/<\/p>\s*<p>/) : null;
  if (!parts) return null;
  const paragraphs: string[] = [];
  for (const raw of parts) {
    const inner = raw.replace(/^<p>/, "").replace(/<\/p>$/, "");
    if (/[<>]/.test(inner.replace(/<br\s*\/?>/gi, ""))) return null;
    paragraphs.push(unescapeHtml(inner.replace(/<br\s*\/?>/gi, "\n")));
  }
  return paragraphs.join("\n\n");
}

export interface VideoAddress {
  provider: "youtube" | "vimeo";
  id: string;
  /** Vimeo's key for an unlisted video, or empty. */
  hash: string;
}

/**
 * Read a pasted YouTube or Vimeo address (or, if the provider is known, a bare id) and say which
 * video it is. Anything else returns null, so only a well-formed id ever reaches a page.
 */
export function parseVideoAddress(input: string, provider?: "youtube" | "vimeo"): VideoAddress | null {
  const raw = input.trim();
  if (raw === "") return null;
  const yt = /^[A-Za-z0-9_-]{11}$/;
  if (provider === "youtube" && yt.test(raw)) return { provider: "youtube", id: raw, hash: "" };
  if (provider === "vimeo" && /^[0-9]{1,12}$/.test(raw)) return { provider: "vimeo", id: raw, hash: "" };
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/")[1] ?? "";
    return yt.test(id) ? { provider: "youtube", id, hash: "" } : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (v && yt.test(v)) return { provider: "youtube", id: v, hash: "" };
    const m = /^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})(?:[/?]|$)/.exec(url.pathname);
    return m ? { provider: "youtube", id: m[1]!, hash: "" } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const at = parts.findIndex((p) => /^[0-9]{1,12}$/.test(p));
    if (at === -1) return null;
    const hash = url.searchParams.get("h") ?? (/^[A-Za-z0-9]{6,32}$/.test(parts[at + 1] ?? "") ? parts[at + 1]! : "");
    return { provider: "vimeo", id: parts[at]!, hash: /^[A-Za-z0-9]{0,32}$/.test(hash) ? hash : "" };
  }
  return null;
}

// ---- rules
//
// The format stores triggers: one event, one action, some conditions. The editor shows them as rules a
// person can read: "When the learner presses the button, go to slide 3, if the answer is B". The one
// difference is that a click always comes with a keyboard trigger that does the same thing, so the pair is
// shown, and written, as a single rule that happens "when the learner presses the button".

export type RuleEvent = "activate" | "slideStart" | "slideEnd" | "mediaComplete" | "variableChange";
// "addToVariable" is the editor's name for setVariable with the operation "add": to an author, adding to a count is a different thing
// from setting a variable, and it works on different variables (numbers).
export type RuleAction = "jumpToSlide" | "nextSlide" | "previousSlide" | "replaySlide" | "showLayer" | "hideLayer" | "setVariable" | "addToVariable" | "playMedia" | "pauseMedia" | "changeState";

export const RULE_ACTIONS: RuleAction[] = ["jumpToSlide", "nextSlide", "previousSlide", "replaySlide", "showLayer", "hideLayer", "setVariable", "addToVariable", "playMedia", "pauseMedia", "changeState"];

/** The actions that act on the course itself, so they have no target. */
export const COURSE_ACTIONS: RuleAction[] = ["nextSlide", "previousSlide", "replaySlide"];
export const isCourseAction = (a: RuleAction): boolean => COURSE_ACTIONS.includes(a);

export interface Rule {
  event: RuleEvent;
  action: RuleAction;
  target: string;
  value?: Primitive;
  /** Every condition must hold. */
  conditions: Condition[];
  /** The trigger ids it was read from, so saving a rule that did not change keeps its ids. */
  ids?: string[];
}

export type RuleItem =
  | { kind: "rule"; rule: Rule }
  /** Triggers the editor cannot show as a rule. They are left exactly as they are. */
  | { kind: "raw"; triggers: Trigger[]; why: string };

const body = (t: Trigger) => JSON.stringify([t.action, t.operation ?? null, t.target, t.value ?? null, t.conditions]);
const isRuleAction = (a: string): a is RuleAction => (RULE_ACTIONS as string[]).includes(a);

/** What the editor calls a trigger's action, or null if it cannot show it as a rule. */
function ruleActionOf(t: Trigger): RuleAction | null {
  if (t.action === "setVariable" && t.operation === "add") return "addToVariable";
  return t.action !== ("addToVariable" as string) && isRuleAction(t.action) ? t.action : null;
}

/** Read an object's triggers as rules, in order. Anything that is not a plain rule is kept aside as it is. */
export function readRules(triggers: Trigger[]): RuleItem[] {
  const items: RuleItem[] = [];
  for (let i = 0; i < triggers.length; i++) {
    const t = triggers[i]!;
    const next = triggers[i + 1];
    if (t.event === "click") {
      if (next && next.event === "keyActivate" && body(next) === body(t)) {
        const action = ruleActionOf(t);
        items.push(action
          ? { kind: "rule", rule: { event: "activate", action, target: t.target, ...(t.value === undefined ? {} : { value: t.value }), conditions: t.conditions, ids: [t.id, next.id] } }
          : { kind: "raw", triggers: [t, next], why: `It uses "${t.action}", which this editor cannot edit yet.` });
        i++;
      } else {
        items.push({ kind: "raw", triggers: [t], why: "It responds to a mouse click with no matching keyboard trigger." });
      }
      continue;
    }
    if (t.event === "keyActivate") {
      items.push({ kind: "raw", triggers: [t], why: "It responds to a key press with no matching mouse click." });
      continue;
    }
    const action = ruleActionOf(t);
    if (action) {
      items.push({ kind: "rule", rule: { event: t.event as RuleEvent, action, target: t.target, ...(t.value === undefined ? {} : { value: t.value }), conditions: t.conditions, ids: [t.id] } });
    } else {
      items.push({ kind: "raw", triggers: [t], why: `It uses "${t.action}", which this editor cannot edit yet.` });
    }
  }
  return items;
}

/** Write rules back as triggers. A rule that happens when the learner presses something becomes a click and a key press. */
export function writeRules(items: RuleItem[], nextId: () => string): Trigger[] {
  const out: Trigger[] = [];
  for (const item of items) {
    if (item.kind === "raw") { out.push(...item.triggers); continue; }
    const r = item.rule;
    const adding = r.action === "addToVariable";
    const make = (id: string | undefined, event: Trigger["event"]): Trigger => ({
      id: id ?? nextId(), event, action: adding ? "setVariable" : (r.action as Trigger["action"]), target: r.target,
      ...(r.value === undefined ? {} : { value: r.value }), ...(adding ? { operation: "add" as const } : {}), conditions: r.conditions,
    });
    if (r.event === "activate") out.push(make(r.ids?.[0], "click"), make(r.ids?.[1], "keyActivate"));
    else out.push(make(r.ids?.[0], r.event));
  }
  return out;
}

/** What a new value of this kind of variable starts as. */
export function defaultValueFor(type: "boolean" | "number" | "string"): Primitive {
  return type === "boolean" ? true : type === "number" ? 0 : "";
}

/** The comparisons that make sense for each kind of variable. */
export function operatorsFor(type: "boolean" | "number" | "string"): Condition["operator"][] {
  return type === "number" ? ["equals", "notEquals", "lessThan", "lessThanOrEqual", "greaterThan", "greaterThanOrEqual"] : ["equals", "notEquals"];
}

export const OPERATOR_LABELS: Record<Condition["operator"], string> = {
  equals: "is", notEquals: "is not", lessThan: "is less than", lessThanOrEqual: "is at most", greaterThan: "is more than", greaterThanOrEqual: "is at least",
};

/** The events an object can really cause. A text box has no "pressed", and only media has "finishes". */
export function eventsFor(type: string): RuleEvent[] {
  const events: RuleEvent[] = [];
  if (type === "button" || type === "hotspot" || type === "quizQuestion") events.push("activate");
  if (type === "video" || type === "audio") events.push("mediaComplete");
  events.push("slideStart", "slideEnd", "variableChange");
  return events;
}
