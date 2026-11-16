// Draws the illustrated (Lite) presenter: a head and shoulders from a few colours, with a mouth shape, blinks and a gentle sway. Everything is
// drawn from numbers (the picture is a square of `size` pixels), so a new presenter is only new colours and a hair style, and the same drawing
// is the same on every computer. The clip is made by drawing this frame by frame (clip.ts).

import type { Look, MouthShape } from "./look.ts";

/** Just the parts of a canvas the drawing uses, so a test can record what is drawn. */
export type Ctx = Pick<
  CanvasRenderingContext2D,
  | "save" | "restore" | "translate" | "rotate" | "scale" | "beginPath" | "closePath" | "moveTo" | "lineTo" | "quadraticCurveTo" | "bezierCurveTo"
  | "arc" | "ellipse" | "rect" | "roundRect" | "fill" | "stroke" | "fillRect" | "fillText" | "clip"
> & { fillStyle: CanvasRenderingContext2D["fillStyle"]; strokeStyle: CanvasRenderingContext2D["strokeStyle"]; lineWidth: number; lineCap: CanvasLineCap; font: string; textAlign: CanvasTextAlign; textBaseline: CanvasTextBaseline };

/** How closed the eyes are at a moment, from 0 (open) to 1 (shut). A blink every few seconds, quick, and never at the very start. */
export function blinkAt(ms: number): number {
  const period = 3900;
  const start = 3740;
  const length = 160;
  const phase = ms % period;
  if (phase < start) return 0;
  const x = (phase - start) / length;
  return 1 - Math.abs(x * 2 - 1);
}

/** How far the presenter has moved from rest at a moment, as parts of the picture (sideways, up and down, tilt in radians, and breathing). */
export function swayAt(ms: number): { dx: number; dy: number; angle: number; breath: number } {
  const s = ms / 1000;
  return { dx: Math.sin(s * 0.9) * 0.006, dy: Math.sin(s * 1.3) * 0.004, angle: Math.sin(s * 0.7) * 0.02, breath: Math.sin(s * 1.1) * 0.004 };
}

/** A colour made lighter (positive) or darker (negative) by a fraction. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const move = (c: number): number => Math.max(0, Math.min(255, Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))));
  const r = move((n >> 16) & 255);
  const g = move((n >> 8) & 255);
  const b = move(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const MOUTH_DARK = "#5b1f26";
const TONGUE = "#c4646d";

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(rx, 0.0001), Math.max(ry, 0.0001), 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** The mouth, with its middle at the origin and one unit the size of the picture. */
function drawMouth(ctx: Ctx, shape: MouthShape, u: number, skin: string): void {
  ctx.lineCap = "round";
  ctx.strokeStyle = shade(skin, -0.45);
  ctx.lineWidth = 0.008 * u;
  if (shape === "closed") {
    ctx.beginPath();
    ctx.moveTo(-0.045 * u, 0);
    ctx.quadraticCurveTo(0, 0.014 * u, 0.045 * u, 0);
    ctx.stroke();
    return;
  }
  if (shape === "small") {
    ellipse(ctx, 0, 0.004 * u, 0.03 * u, 0.012 * u, MOUTH_DARK);
    return;
  }
  if (shape === "open") {
    ellipse(ctx, 0, 0.012 * u, 0.045 * u, 0.04 * u, MOUTH_DARK);
    ellipse(ctx, 0, 0.03 * u, 0.028 * u, 0.014 * u, TONGUE);
    ctx.beginPath();
    ctx.roundRect(-0.032 * u, -0.022 * u, 0.064 * u, 0.012 * u, 0.004 * u);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    return;
  }
  if (shape === "wide") {
    ctx.beginPath();
    ctx.roundRect(-0.05 * u, -0.008 * u, 0.1 * u, 0.034 * u, 0.016 * u);
    ctx.fillStyle = MOUTH_DARK;
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(-0.04 * u, -0.006 * u, 0.08 * u, 0.01 * u, 0.003 * u);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    return;
  }
  if (shape === "round") {
    ellipse(ctx, 0, 0.01 * u, 0.026 * u, 0.03 * u, MOUTH_DARK);
    ctx.beginPath();
    ctx.ellipse(0, 0.01 * u, 0.03 * u, 0.034 * u, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "#b35a62";
    ctx.lineWidth = 0.007 * u;
    ctx.stroke();
    return;
  }
  // teeth: the lips drawn back, a band of teeth
  ctx.beginPath();
  ctx.roundRect(-0.046 * u, -0.004 * u, 0.092 * u, 0.026 * u, 0.012 * u);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = MOUTH_DARK;
  ctx.lineWidth = 0.006 * u;
  ctx.stroke();
}

/** The hair that is behind the head. */
function drawHairBehind(ctx: Ctx, look: Look, u: number): void {
  const c = look.hair.color;
  if (look.hair.style === "long") {
    ctx.beginPath();
    ctx.ellipse(0, 0.07 * u, 0.25 * u, 0.33 * u, 0, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  } else if (look.hair.style === "curly") {
    for (let a = 190; a <= 350; a += 20) {
      const r = (a * Math.PI) / 180;
      ellipse(ctx, Math.cos(r) * 0.2 * u, Math.sin(r) * 0.22 * u - 0.02 * u, 0.075 * u, 0.075 * u, c);
    }
  }
}

/** The hair that is in front of the forehead. */
function drawHairFront(ctx: Ctx, look: Look, u: number): void {
  const c = look.hair.color;
  if (look.hair.style === "curly") {
    for (let i = -3; i <= 3; i++) ellipse(ctx, i * 0.055 * u, -0.155 * u + Math.abs(i) * 0.012 * u, 0.05 * u, 0.045 * u, c);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(-0.21 * u, -0.02 * u);
  ctx.bezierCurveTo(-0.23 * u, -0.31 * u, 0.23 * u, -0.31 * u, 0.21 * u, -0.02 * u);
  ctx.quadraticCurveTo(0.14 * u, -0.15 * u, 0, -0.12 * u);
  ctx.quadraticCurveTo(-0.14 * u, -0.15 * u, -0.21 * u, -0.02 * u);
  ctx.closePath();
  ctx.fillStyle = c;
  ctx.fill();
}

/** One picture of the presenter: where the clip is at `ms`, with the mouth in `shape`. `size` is the side of the square canvas. */
export function drawFrame(ctx: Ctx, look: Look, shape: MouthShape, ms: number, size: number, label: boolean): void {
  const u = size;
  ctx.save();
  ctx.fillStyle = look.background;
  ctx.fillRect(0, 0, u, u);

  const sway = swayAt(ms);
  const blink = blinkAt(ms);
  const skinShade = shade(look.skin, -0.1);

  // shoulders, breathing a little
  ctx.save();
  ctx.translate(0.5 * u, 0.98 * u);
  ctx.scale(1 + sway.breath, 1 + sway.breath * 1.5);
  ellipse(ctx, 0, 0, 0.36 * u, 0.27 * u, look.shirt);
  ctx.restore();

  // head and neck, tilting and moving a little about the neck
  ctx.save();
  ctx.translate((0.5 + sway.dx) * u, (0.62 + sway.dy) * u);
  ctx.rotate(sway.angle);
  ctx.translate(0, -0.2 * u);

  drawHairBehind(ctx, look, u);
  // the neck, widening into the open collar of the shirt
  ctx.beginPath();
  ctx.moveTo(-0.06 * u, 0.15 * u);
  ctx.lineTo(0.06 * u, 0.15 * u);
  ctx.lineTo(0.062 * u, 0.27 * u);
  ctx.quadraticCurveTo(0.075 * u, 0.3 * u, 0.1 * u, 0.312 * u);
  ctx.lineTo(0, 0.41 * u);
  ctx.lineTo(-0.1 * u, 0.312 * u);
  ctx.quadraticCurveTo(-0.075 * u, 0.3 * u, -0.062 * u, 0.27 * u);
  ctx.closePath();
  ctx.fillStyle = skinShade;
  ctx.fill();
  ellipse(ctx, -0.2 * u, 0.02 * u, 0.03 * u, 0.05 * u, skinShade);
  ellipse(ctx, 0.2 * u, 0.02 * u, 0.03 * u, 0.05 * u, skinShade);
  ellipse(ctx, 0, 0, 0.2 * u, 0.24 * u, look.skin);
  drawHairFront(ctx, look, u);

  // cheeks, eyebrows, eyes
  ellipse(ctx, -0.12 * u, 0.07 * u, 0.032 * u, 0.022 * u, "rgba(220,90,90,0.16)");
  ellipse(ctx, 0.12 * u, 0.07 * u, 0.032 * u, 0.022 * u, "rgba(220,90,90,0.16)");
  ctx.lineCap = "round";
  ctx.strokeStyle = shade(look.hair.color, -0.15);
  ctx.lineWidth = 0.011 * u;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 0.045 * u, -0.07 * u);
    ctx.quadraticCurveTo(side * 0.078 * u, -0.095 * u, side * 0.108 * u, -0.07 * u);
    ctx.stroke();
  }
  for (const side of [-1, 1]) {
    const x = side * 0.077 * u;
    const open = 1 - blink;
    if (open < 0.2) {
      ctx.beginPath();
      ctx.moveTo(x - 0.028 * u, -0.02 * u);
      ctx.quadraticCurveTo(x, -0.012 * u, x + 0.028 * u, -0.02 * u);
      ctx.strokeStyle = look.eyes;
      ctx.lineWidth = 0.008 * u;
      ctx.stroke();
    } else {
      ellipse(ctx, x, -0.02 * u, 0.034 * u, 0.03 * u * open, "#ffffff");
      ellipse(ctx, x, -0.02 * u, 0.018 * u, 0.02 * u * open, look.eyes);
      ellipse(ctx, x + 0.006 * u, -0.028 * u * open - 0.002 * u, 0.005 * u, 0.005 * u * open, "#ffffff");
    }
  }
  if (look.glasses) {
    ctx.strokeStyle = "#2a2a2e";
    ctx.lineWidth = 0.007 * u;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * 0.077 * u, -0.02 * u, 0.05 * u, 0.044 * u, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-0.027 * u, -0.026 * u);
    ctx.quadraticCurveTo(0, -0.04 * u, 0.027 * u, -0.026 * u);
    ctx.stroke();
  }
  // nose
  ctx.strokeStyle = shade(look.skin, -0.25);
  ctx.lineWidth = 0.006 * u;
  ctx.beginPath();
  ctx.moveTo(0, 0.0 * u);
  ctx.quadraticCurveTo(0.016 * u, 0.04 * u, -0.004 * u, 0.05 * u);
  ctx.stroke();

  ctx.save();
  ctx.translate(0, 0.12 * u);
  drawMouth(ctx, shape, u, look.skin);
  ctx.restore();
  ctx.restore();

  if (label) drawLabel(ctx, u);
  ctx.restore();
}

/** The small "AI presenter" label in the corner, white on a dark panel so it can be read on any presenter. */
export function drawLabel(ctx: Ctx, u: number): void {
  const w = 0.33 * u;
  const h = 0.07 * u;
  const x = u - w - 0.025 * u;
  const y = u - h - 0.025 * u;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 0.016 * u);
  ctx.fillStyle = "rgba(20,20,24,0.78)";
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${Math.round(0.038 * u)}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("AI presenter", x + w / 2, y + h / 2 + 0.002 * u);
}
