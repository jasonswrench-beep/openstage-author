// The avatar maker's drawing: a simple picture of a person from a few choices. No screen in here, so all of it can be tested directly. The
// dialog that uses it is avatardialog.ts.
//
// The picture is original artwork made by this program, from plain shapes, so it needs no credit and no licence beyond this project's own.
// It is an SVG built only from the choices below, and every colour comes from a fixed list, so whatever is saved in a project can never carry
// a script or a link (the program that saves it checks that again).

export interface Choice {
  id: string;
  label: string;
}
export interface ColourChoice extends Choice {
  hex: string;
}

export const SKIN: ColourChoice[] = [
  { id: "light", label: "light", hex: "#f5d3b8" }, { id: "fair", label: "fair", hex: "#f0c8a0" }, { id: "tan", label: "tan", hex: "#d9a273" },
  { id: "brown", label: "brown", hex: "#a8714a" }, { id: "dark-brown", label: "dark brown", hex: "#8d5a3b" }, { id: "deep", label: "deep brown", hex: "#5b3a29" },
];
export const HAIR_COLOUR: ColourChoice[] = [
  { id: "black", label: "black", hex: "#161616" }, { id: "dark-brown", label: "dark brown", hex: "#3a2618" }, { id: "brown", label: "brown", hex: "#6b4423" },
  { id: "auburn", label: "auburn", hex: "#8a3b1e" }, { id: "blonde", label: "blonde", hex: "#d6b25e" }, { id: "grey", label: "grey", hex: "#a6a6a6" }, { id: "white", label: "white", hex: "#e8e8e8" },
];
export const SHIRT_COLOUR: ColourChoice[] = [
  { id: "green", label: "green", hex: "#2f7d4f" }, { id: "blue", label: "blue", hex: "#3a56c7" }, { id: "yellow", label: "yellow", hex: "#c78a00" },
  { id: "red", label: "red", hex: "#b03a3a" }, { id: "purple", label: "purple", hex: "#6a4fb0" }, { id: "teal", label: "teal", hex: "#1f7f86" },
  { id: "grey", label: "grey", hex: "#55606e" }, { id: "black", label: "black", hex: "#22262b" },
];
export const BACKGROUND: ColourChoice[] = [
  { id: "pale-green", label: "pale green", hex: "#cfe8d6" }, { id: "pale-blue", label: "pale blue", hex: "#d6dffb" }, { id: "pale-yellow", label: "pale yellow", hex: "#fbe7b5" },
  { id: "pale-pink", label: "pale pink", hex: "#f6d5de" }, { id: "pale-grey", label: "pale grey", hex: "#e4e7eb" }, { id: "white", label: "white", hex: "#ffffff" },
];
export const HAIR_STYLE: Choice[] = [
  { id: "short", label: "short" }, { id: "long", label: "long" }, { id: "bun", label: "in a bun" }, { id: "curly", label: "curly" }, { id: "bald", label: "none" },
];
export const EXPRESSION: Choice[] = [
  { id: "smile", label: "smiling" }, { id: "neutral", label: "calm" }, { id: "concerned", label: "concerned" },
];
export const SHIRT_STYLE: Choice[] = [
  { id: "crew", label: "round neck" }, { id: "vneck", label: "V neck" }, { id: "hoodie", label: "hoodie" },
];

export interface AvatarSpec {
  skin: string;
  hairStyle: string;
  hairColour: string;
  expression: string;
  shirtStyle: string;
  shirtColour: string;
  glasses: boolean;
  background: string;
}

export const DEFAULT_AVATAR: AvatarSpec = { skin: "tan", hairStyle: "short", hairColour: "dark-brown", expression: "smile", shirtStyle: "crew", shirtColour: "green", glasses: false, background: "pale-green" };

const pick = <T extends Choice>(list: T[], id: unknown, fallback: string): T => list.find((c) => c.id === id) ?? list.find((c) => c.id === fallback)!;

/** A spec made of known choices only: anything else is replaced by the starting one. */
export function cleanSpec(input: unknown): AvatarSpec {
  const r = (input ?? {}) as Record<string, unknown>;
  return {
    skin: pick(SKIN, r["skin"], DEFAULT_AVATAR.skin).id,
    hairStyle: pick(HAIR_STYLE, r["hairStyle"], DEFAULT_AVATAR.hairStyle).id,
    hairColour: pick(HAIR_COLOUR, r["hairColour"], DEFAULT_AVATAR.hairColour).id,
    expression: pick(EXPRESSION, r["expression"], DEFAULT_AVATAR.expression).id,
    shirtStyle: pick(SHIRT_STYLE, r["shirtStyle"], DEFAULT_AVATAR.shirtStyle).id,
    shirtColour: pick(SHIRT_COLOUR, r["shirtColour"], DEFAULT_AVATAR.shirtColour).id,
    glasses: r["glasses"] === true,
    background: pick(BACKGROUND, r["background"], DEFAULT_AVATAR.background).id,
  };
}

/** A hex colour a little darker (a negative amount) or lighter, for the neck and the nose. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const part = (shift: number) => Math.min(255, Math.max(0, Math.round(((n >> shift) & 255) * (1 + amount))));
  return `#${[16, 8, 0].map((s) => part(s).toString(16).padStart(2, "0")).join("")}`;
}

/** The picture, as the text of an SVG file, 200 by 200. */
export function avatarSvg(input: unknown): string {
  const spec = cleanSpec(input);
  const skin = pick(SKIN, spec.skin, "tan").hex;
  const hair = pick(HAIR_COLOUR, spec.hairColour, "dark-brown").hex;
  const shirt = pick(SHIRT_COLOUR, spec.shirtColour, "green").hex;
  const bg = pick(BACKGROUND, spec.background, "pale-green").hex;
  const dark = shade(skin, -0.14);
  const out: string[] = [];
  out.push(`<rect width="200" height="200" fill="${bg}"/>`);

  // Hair that sits behind the head.
  if (spec.hairStyle === "long") out.push(`<path d="M56 92c-6-42 12-62 44-62s50 20 44 62l4 54c0 8-10 10-14 4l-6-22H72l-6 22c-4 6-14 4-14-4z" fill="${hair}"/>`);
  if (spec.hairStyle === "bun") out.push(`<circle cx="100" cy="30" r="15" fill="${hair}"/>`);

  // Shoulders, the neck and the head.
  out.push(`<path d="M28 200c0-44 30-60 72-60s72 16 72 60z" fill="${shirt}"/>`);
  if (spec.shirtStyle === "vneck") out.push(`<path d="M84 142l16 24 16-24z" fill="${skin}"/>`);
  if (spec.shirtStyle === "hoodie") out.push(`<path d="M66 148c10 16 58 16 68 0" fill="none" stroke="${shade(shirt, -0.25)}" stroke-width="7" stroke-linecap="round"/>`);
  out.push(`<rect x="88" y="116" width="24" height="32" fill="${dark}"/>`);
  if (spec.shirtStyle === "crew") out.push(`<path d="M82 144c6 8 30 8 36 0" fill="none" stroke="${shade(shirt, -0.25)}" stroke-width="5" stroke-linecap="round"/>`);
  out.push(`<circle cx="62" cy="90" r="7" fill="${skin}"/><circle cx="138" cy="90" r="7" fill="${skin}"/>`);
  out.push(`<ellipse cx="100" cy="86" rx="38" ry="42" fill="${skin}"/>`);

  // Hair on top of the head.
  if (spec.hairStyle === "short" || spec.hairStyle === "bun" || spec.hairStyle === "long") out.push(`<path d="M60 84c-3-34 16-50 40-50s43 16 40 50c-9-17-22-26-40-26s-31 9-40 26z" fill="${hair}"/>`);
  if (spec.hairStyle === "curly") {
    out.push([[64, 66, 14], [80, 50, 16], [102, 44, 17], [124, 50, 16], [140, 66, 14], [58, 84, 10], [142, 84, 10]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${hair}"/>`).join(""));
  }

  // The face.
  const brow = spec.expression === "concerned" ? ["M76 74l16-4", "M108 70l16 4"] : ["M78 74q8-5 16 0", "M106 74q8-5 16 0"];
  out.push(`<path d="${brow[0]}" fill="none" stroke="${hair === "#e8e8e8" || hair === "#a6a6a6" ? "#6b6b6b" : hair}" stroke-width="3" stroke-linecap="round"/>`);
  out.push(`<path d="${brow[1]}" fill="none" stroke="${hair === "#e8e8e8" || hair === "#a6a6a6" ? "#6b6b6b" : hair}" stroke-width="3" stroke-linecap="round"/>`);
  out.push(`<circle cx="86" cy="88" r="4" fill="#1a1a1a"/><circle cx="114" cy="88" r="4" fill="#1a1a1a"/>`);
  out.push(`<path d="M100 92v10q-4 3-7 0" fill="none" stroke="${dark}" stroke-width="2.5" stroke-linecap="round"/>`);
  const mouth = spec.expression === "smile" ? "M88 108q12 14 24 0" : spec.expression === "concerned" ? "M90 116q10-8 20 0" : "M90 111h20";
  out.push(`<path d="${mouth}" fill="none" stroke="#7a2e2e" stroke-width="3" stroke-linecap="round"/>`);
  if (spec.glasses) out.push(`<g fill="none" stroke="#1a1a1a" stroke-width="3"><circle cx="86" cy="88" r="11"/><circle cx="114" cy="88" r="11"/><path d="M97 88h6"/></g>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">${out.join("")}</svg>\n`;
}

/**
 * The picture in words, in the form alt text takes: "Short dark brown hair, tan skin, smiling, glasses, a green round-neck shirt".
 * It is offered to the author as a start. It is never put in as alt text for them.
 */
export function describeAvatar(input: unknown): string {
  const spec = cleanSpec(input);
  const label = (list: Choice[], id: string) => list.find((c) => c.id === id)!.label;
  const hair = spec.hairStyle === "bald" ? "no hair" : spec.hairStyle === "bun" ? `${label(HAIR_COLOUR, spec.hairColour)} hair in a bun` : `${spec.hairStyle} ${label(HAIR_COLOUR, spec.hairColour)} hair`;
  const parts = [hair, `${label(SKIN, spec.skin)} skin`, label(EXPRESSION, spec.expression), ...(spec.glasses ? ["glasses"] : []), `a ${label(SHIRT_COLOUR, spec.shirtColour)} ${label(SHIRT_STYLE, spec.shirtStyle)} shirt`];
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A person made from chance, for "Surprise me". `random` gives numbers from 0 up to but not including 1. */
export function randomSpec(random: () => number = Math.random): AvatarSpec {
  const any = <T extends Choice>(list: T[]): string => list[Math.min(list.length - 1, Math.floor(random() * list.length))]!.id;
  return {
    skin: any(SKIN), hairStyle: any(HAIR_STYLE), hairColour: any(HAIR_COLOUR), expression: any(EXPRESSION),
    shirtStyle: any(SHIRT_STYLE), shirtColour: any(SHIRT_COLOUR), glasses: random() < 0.3, background: any(BACKGROUND),
  };
}
