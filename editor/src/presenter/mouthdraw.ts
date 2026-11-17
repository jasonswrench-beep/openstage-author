// Draws the mouth of the illustrated (Lite) presenter. Each of the eleven shapes is a handful of numbers (how wide, how high above and below the line of the
// lips, how much of the teeth and the tongue show, how thick the lips are), and the mouth drawn between two shapes is the numbers between them, so the mouth can
// be on its way from one shape to the next (look.ts, `poseAt`) with no shape of its own for each step.

import type { Ctx } from "./draw.ts";
import type { MouthPose, MouthShape } from "./look.ts";

/** What a mouth shape is made of. Every length is a fraction of the picture's side; the mouth is drawn about the line of the lips, which is the line from corner to corner. */
export interface MouthLook {
  /** Half the width of the opening. */
  w: number;
  /** How far the opening reaches above the line of the lips, and below it (the jaw drops, so below is more). */
  up: number;
  down: number;
  /** How round the opening is: 0 comes to a point at each corner, 1 is an oval, a little more is a squarer opening (lips spread). */
  oval: number;
  /** The height of the upper teeth showing at the top of the opening, and of the lower teeth at the bottom. */
  teethTop: number;
  teethBottom: number;
  /** The tongue: its half height (0 for none), and how high in the mouth it is (0 low, 1 up against the teeth). */
  tongue: number;
  tongueUp: number;
  /** How much thicker the lips are when they are pushed forward into a ring. */
  ring: number;
  /** The lower lip drawn over the bottom of the opening, as thick as this (the upper teeth rest on it for an "f"). */
  lowerLip: number;
  /** How far the middle of the mouth sags below its corners (a shut mouth is a line with a slight smile). */
  sag: number;
}

const L = (o: Partial<MouthLook>): MouthLook => ({ w: 0.04, up: 0, down: 0, oval: 1, teethTop: 0, teethBottom: 0, tongue: 0, tongueUp: 0, ring: 0, lowerLip: 0, sag: 0, ...o });

export const MOUTH_LOOK: Readonly<Record<MouthShape, MouthLook>> = {
  closed: L({ w: 0.045, oval: 0.6, sag: 0.007 }),
  small: L({ w: 0.03, up: 0.006, down: 0.014 }),
  mid: L({ w: 0.04, up: 0.01, down: 0.028, oval: 0.85, teethTop: 0.008, tongue: 0.008 }),
  open: L({ w: 0.044, up: 0.016, down: 0.052, oval: 0.9, teethTop: 0.012, tongue: 0.015 }),
  wide: L({ w: 0.052, up: 0.004, down: 0.02, oval: 1.15, teethTop: 0.01 }),
  round: L({ w: 0.027, up: 0.024, down: 0.031, ring: 0.004 }),
  pucker: L({ w: 0.022, up: 0.02, down: 0.023, ring: 0.007 }),
  sh: L({ w: 0.032, up: 0.012, down: 0.021, oval: 0.85, teethTop: 0.012, ring: 0.007 }),
  teeth: L({ w: 0.047, up: 0.007, down: 0.009, oval: 1.15, teethTop: 0.016 }),
  fv: L({ w: 0.04, up: 0.004, down: 0.017, oval: 0.9, teethTop: 0.011, lowerLip: 0.007 }),
  tongue: L({ w: 0.034, up: 0.008, down: 0.021, oval: 0.9, teethTop: 0.007, tongue: 0.011, tongueUp: 0.85 }),
};

const MOUTH_DARK = "#5b1f26";
const TONGUE = "#c4646d";
const LOWER_LIP = "#b95b64";

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** The numbers of a mouth that is `t` of the way from one shape to another. */
export function mixLook(a: MouthLook, b: MouthLook, t: number): MouthLook {
  const out = { ...a };
  for (const k of Object.keys(a) as (keyof MouthLook)[]) out[k] = mix(a[k], b[k], t);
  return out;
}

export function lookOf(mouth: MouthShape | MouthPose): MouthLook {
  if (typeof mouth === "string") return MOUTH_LOOK[mouth];
  return mouth.mix <= 0 || mouth.from === mouth.to ? MOUTH_LOOK[mouth.from] : mixLook(MOUTH_LOOK[mouth.from], MOUTH_LOOK[mouth.to], mouth.mix);
}

/** The mouth, with the middle of the line of the lips at the origin and one unit the size of the picture. `lip` is the colour of the lips (the skin's, darker). */
export function drawMouth(ctx: Ctx, mouth: MouthShape | MouthPose, u: number, lip: string): void {
  const m = lookOf(mouth);
  const w = m.w * u;
  // The opening is two curves from corner to corner, the upper rising `up` and the lower falling `down`; a sag lowers the middle of both. A cubic curve
  // reaches its middle at 3/4 of its control points' height, so the controls are 4/3 as far out. Handles at the corners make an oval, handles nearer the middle
  // make the corners come to a point.
  const reach = (1 / 3 + (2 / 3) * m.oval) * w;
  const upper = ((m.up - m.sag) * 4 * u) / 3;
  const lower = ((m.down + m.sag) * 4 * u) / 3;
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.bezierCurveTo(-reach, -upper, reach, -upper, w, 0);
    ctx.bezierCurveTo(reach, lower, -reach, lower, -w, 0);
    ctx.closePath();
  };
  const top = (m.sag - m.up) * u;
  const bottom = (m.down + m.sag) * u;

  if (m.up + m.down > 0.0005) {
    ctx.save();
    path();
    ctx.clip();
    ctx.fillStyle = MOUTH_DARK;
    ctx.fillRect(-w - u * 0.01, top - u * 0.01, 2 * w + u * 0.02, bottom - top + u * 0.02);
    if (m.tongue > 0.0005) {
      const low = bottom - m.tongue * 0.6 * u;
      const high = top + (m.teethTop + m.tongue * 0.55) * u;
      ctx.beginPath();
      ctx.ellipse(0, mix(low, high, m.tongueUp), Math.max(0.0001, Math.min(w * 0.6, m.tongue * 3 * u)), m.tongue * u, 0, 0, Math.PI * 2);
      ctx.fillStyle = TONGUE;
      ctx.fill();
    }
    if (m.teethTop > 0.0005) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(-w - u * 0.01, top - u * 0.01, 2 * w + u * 0.02, m.teethTop * u + u * 0.01);
    }
    if (m.teethBottom > 0.0005) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(-w - u * 0.01, bottom - m.teethBottom * u, 2 * w + u * 0.02, m.teethBottom * u + u * 0.01);
    }
    if (m.lowerLip > 0.0005) {
      ctx.fillStyle = LOWER_LIP;
      ctx.fillRect(-w - u * 0.01, bottom - m.lowerLip * u, 2 * w + u * 0.02, m.lowerLip * u + u * 0.01);
    }
    ctx.restore();
  }

  // the lips round it: the line a shut mouth is, and a ring when they are pushed forward
  // (a round join: a mouth nearly shut is a very thin shape, and a pointed join would put a long spike at each corner)
  path();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = lip;
  ctx.lineWidth = (0.0075 + m.ring) * u;
  ctx.stroke();
}
