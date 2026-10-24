import assert from "node:assert/strict";
import { test } from "node:test";
import { contrast, luminance, parseColor, planReflow, quarterTurned, REFLOW_BELOW, seenSize, shouldReflow } from "./reflow.ts";
import type { OSObject, Style, Theme } from "./types.ts";

const theme = {
  schemaVersion: "0.2.0", id: "t", name: "T",
  colors: { background: "#ffffff", surface: "#f4f5f7", text: "#1a1a1a", muted: "#4a4f57", accent: "#2b6cb0", accentStrong: "#0b3fb3", onAccentStrong: "#ffffff", dark: "#12263f", onDark: "#ffffff", good: "#176b3a", bad: "#a12622", line: "#8c8c8c" },
  fonts: { heading: "serif", body: "sans-serif" },
  backgrounds: { default: { type: "solid", color: "background" }, dark: { type: "solid", color: "dark" }, accent: { type: "solid", color: "accent" } },
} as unknown as Theme;

let n = 0;
function obj(type: OSObject["type"], x: number, y: number, width: number, height: number, extra: { z?: number; decorative?: boolean; style?: Style; rotation?: number } = {}): OSObject {
  return {
    id: `o${++n}`, type, name: type,
    geometry: { x, y, width, height, rotation: extra.rotation ?? 0, z: extra.z ?? 0 },
    content: {}, style: extra.style ?? {},
    accessibility: { altText: "", role: "", tabOrder: null, decorative: extra.decorative ?? false },
    states: {}, triggers: [], timing: { appear: "time", start: 0, visibleFor: null },
    animation: { enter: { effect: "none", duration: 500 }, exit: { effect: "none", duration: 500 } },
    narration: null, provenance: null, simulation: null,
  };
}

test("a slide is shown in one column once the room is under seven tenths of the stage", () => {
  assert.equal(REFLOW_BELOW, 0.7);
  assert.equal(shouldReflow(1280, 1280), false, "a full-size window keeps the stage");
  assert.equal(shouldReflow(900, 1280), false, "900 of 1280 is still above seven tenths");
  assert.equal(shouldReflow(895, 1280), true);
  assert.equal(shouldReflow(320, 1280), true, "320 pixels is what 400 percent zoom of a 1280 window gives");
  assert.equal(shouldReflow(0, 1280), false, "no room measured yet is not a reason to switch");
});

test("colours: reading hex and rgb, and the contrast of black on white", () => {
  assert.deepEqual(parseColor("#fff"), [255, 255, 255]);
  assert.deepEqual(parseColor("#12263f"), [18, 38, 63]);
  assert.deepEqual(parseColor("rgb(10, 20, 30)"), [10, 20, 30]);
  assert.equal(parseColor("navy"), null, "a colour name cannot be read here");
  assert.equal(parseColor(undefined), null);
  assert.ok(Math.abs(luminance([255, 255, 255]) - 1) < 1e-9);
  assert.ok(Math.abs(contrast([0, 0, 0], [255, 255, 255]) - 21) < 1e-9);
});

test("text on a decorative panel takes the panel's fill, and the panel is left out", () => {
  const panel = obj("shape", 100, 100, 600, 300, { decorative: true, style: { fill: "#12263f" } });
  const text = obj("text", 120, 120, 400, 80, { z: 1, style: { color: "#ffffff" } });
  const plan = planReflow([panel, text], theme);
  assert.equal(plan.get(panel.id)?.hide, true);
  assert.equal(plan.get(text.id)?.backdrop, "#12263f");
  assert.equal(plan.get(text.id)?.hide, false);
});

test("a panel with nothing on it stays, and so does a panel that is not decorative", () => {
  const empty = obj("shape", 0, 0, 100, 10, { decorative: true, style: { fill: "#000000" } });
  assert.equal(planReflow([empty], theme).has(empty.id), false);
  const meaningful = obj("shape", 100, 100, 600, 300, { decorative: false, style: { fill: "#12263f" } });
  const text = obj("text", 120, 120, 400, 80, { z: 1, style: { color: "#ffffff" } });
  const plan = planReflow([meaningful, text], theme);
  assert.equal(plan.get(meaningful.id)?.hide ?? false, false, "something that says what it is must stay for a reader to find");
  assert.equal(plan.get(text.id)?.backdrop, "#12263f");
});

test("objects that only partly overlap, or sit on top of nothing, are left alone", () => {
  const panel = obj("shape", 100, 100, 300, 200, { decorative: true, style: { fill: "#12263f" } });
  const sticks = obj("text", 350, 150, 300, 80, { z: 1, style: { color: "#fff" } });
  assert.equal(planReflow([panel, sticks], theme).size, 0, "text that hangs out of the panel is not on it");
  const below = obj("text", 120, 120, 100, 40, { z: -1, style: { color: "#fff" } });
  const above = obj("shape", 100, 100, 300, 200, { z: 5, decorative: true, style: { fill: "#12263f" } });
  assert.equal(planReflow([above, below], theme).size, 0, "a panel drawn above the text is not behind it");
});

test("with panels inside panels, the nearest one with a fill is used, and an outline-only panel is skipped", () => {
  const big = obj("shape", 0, 0, 1280, 720, { decorative: true, style: { fill: "#eeeeee" } });
  const card = obj("shape", 100, 100, 500, 300, { z: 1, decorative: true, style: { fill: "#12263f" } });
  const frame = obj("shape", 110, 110, 480, 280, { z: 2, decorative: true, style: { stroke: "#ffffff", fill: "none" } });
  const text = obj("text", 130, 130, 300, 60, { z: 3, style: { color: "#ffffff" } });
  const plan = planReflow([big, card, frame, text], theme);
  assert.equal(plan.get(text.id)?.backdrop, "#12263f", "the frame has no fill, so the card behind it is used");
  assert.equal(plan.get(big.id)?.hide, true);
  assert.equal(plan.get(card.id)?.hide, true);
  assert.equal(plan.get(frame.id)?.hide, true);
});

test("text on a picture gets whichever theme background reads best against its colour", () => {
  const picture = obj("image", 0, 0, 1280, 720, { decorative: true });
  const light = obj("text", 100, 100, 400, 80, { z: 1, style: { color: "#ffffff" } });
  const dark = obj("text", 100, 300, 400, 80, { z: 1, style: { color: "#111111" } });
  const plan = planReflow([picture, light, dark], theme);
  assert.equal(plan.get(light.id)?.backdrop, "#12263f", "white text goes on the theme's dark colour");
  assert.equal(plan.get(dark.id)?.backdrop, "#ffffff", "dark text goes on the theme's light background");
  assert.equal(plan.get(picture.id)?.hide, true, "a decorative picture used as a backdrop is left out");
});

test("a picture that is not decorative stays, and things on it still get a backdrop", () => {
  const photo = obj("image", 0, 0, 800, 400, { decorative: false });
  const caption = obj("text", 20, 330, 400, 50, { z: 1, style: { color: "#ffffff" } });
  const plan = planReflow([photo, caption], theme);
  assert.equal(plan.get(photo.id)?.hide ?? false, false);
  assert.equal(plan.get(caption.id)?.backdrop, "#12263f");
});

test("only text is given a backdrop, because buttons and interactions paint themselves", () => {
  const panel = obj("shape", 0, 0, 800, 400, { decorative: true, style: { fill: "#12263f" } });
  const button = obj("button", 20, 20, 200, 50, { z: 1 });
  const interaction = obj("interaction", 20, 100, 600, 200, { z: 1 });
  const plan = planReflow([panel, button, interaction], theme);
  assert.equal(plan.get(button.id)?.backdrop ?? null, null);
  assert.equal(plan.get(interaction.id)?.backdrop ?? null, null);
  assert.equal(plan.get(panel.id)?.hide, true, "the panel is still only a backdrop");
});

test("rotated objects are not guessed at, and matching panels do not hide each other", () => {
  const panel = obj("shape", 100, 100, 600, 300, { decorative: true, style: { fill: "#12263f" }, rotation: 5 });
  const text = obj("text", 120, 120, 400, 80, { z: 1, style: { color: "#fff" } });
  assert.equal(planReflow([panel, text], theme).size, 0);
  const a = obj("shape", 100, 100, 600, 300, { decorative: true, style: { fill: "#111111" } });
  const b = obj("shape", 100, 100, 600, 300, { decorative: true, style: { fill: "#222222" } });
  assert.equal(planReflow([a, b], theme).size, 0, "two panels of one size are not on each other");
});

test("a theme colour in a fill is read through the theme", () => {
  const panel = obj("shape", 100, 100, 600, 300, { decorative: true, style: { fill: "theme:color.dark" } });
  const text = obj("text", 120, 120, 400, 80, { z: 1, style: { color: "theme:color.onDark" } });
  assert.equal(planReflow([panel, text], theme).get(text.id)?.backdrop, "#12263f");
});

test("a shape turned a quarter turn keeps the shape it has on the stage in one column", () => {
  assert.deepEqual([0, 90, 270, -90, 450, 85, 100, 180, 45, 135, 360].map(quarterTurned), [false, true, true, true, true, true, true, false, false, false, false]);
  assert.deepEqual(seenSize(obj("shape", 0, 0, 6, 206, { rotation: 90 })), { width: 206, height: 6 });
  assert.deepEqual(seenSize(obj("shape", 0, 0, 6, 206, { rotation: 0 })), { width: 6, height: 206 });
  assert.deepEqual(seenSize(obj("image", 0, 0, 300, 100, { rotation: 270 })), { width: 100, height: 300 });
  assert.deepEqual(seenSize(obj("image", 0, 0, 300, 100, { rotation: 30 })), { width: 300, height: 100 }, "a slight turn is not a swap");
});
