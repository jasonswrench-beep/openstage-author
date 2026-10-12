import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { backgroundColors, backgroundCss, COLOR_ROLES, resolveStyle, resolveValue, themeRefKnown } from "./theme.ts";
import type { Theme } from "./types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const themesDir = path.join(here, "..", "..", "themes");
const themes = readdirSync(themesDir).filter((f) => f.endsWith(".theme.json")).map((f) => JSON.parse(readFileSync(path.join(themesDir, f), "utf-8")) as Theme);
const classic = themes.find((t) => t.id === "classic")!;

test("theme references become the colours and fonts they name", () => {
  assert.equal(resolveValue(classic, "theme:color.accent"), "#0b5fff");
  assert.equal(resolveValue(classic, "theme:font.heading"), "system-ui");
  assert.equal(resolveValue(classic, "#123456"), "#123456", "ordinary values pass through");
  assert.equal(resolveValue(classic, 22), 22);
  assert.equal(resolveValue(classic, "theme:color.nope"), "", "an unknown reference is nothing, not a guess");
});

test("only the style properties that can be themed are resolved", () => {
  const out = resolveStyle(classic, { color: "theme:color.text", fill: "theme:color.accentStrong", fontFamily: "theme:font.body", fontSize: 30, stroke: "none", label: "theme:color.accent" });
  assert.deepEqual(out, { color: "#141414", fill: "#0b3fb3", fontFamily: "system-ui", fontSize: 30, stroke: "none", label: "theme:color.accent" });
});

test("a style that names a missing theme value simply loses it", () => {
  const out = resolveStyle(classic, { color: "theme:color.nope", fontSize: 20 });
  assert.deepEqual(out, { fontSize: 20 });
});

test("resolving does not change the style it was given", () => {
  const style = { color: "theme:color.text" };
  resolveStyle(classic, style);
  assert.deepEqual(style, { color: "theme:color.text" });
});

test("slide backgrounds: the theme default, a named theme background, or a plain colour", () => {
  assert.equal(backgroundCss(classic, null), "#ffffff");
  assert.equal(backgroundCss(classic, "theme:bg.dark"), "#0b2a6f");
  assert.equal(backgroundCss(classic, "theme:bg.accent"), "#0b3fb3");
  assert.equal(backgroundCss(classic, "#101010"), "#101010");
  assert.equal(backgroundCss(classic, "theme:bg.nope"), "#ffffff", "an unknown one falls back to the default");
});

test("gradient backgrounds become CSS gradients, with colour names resolved", () => {
  const t: Theme = { ...classic, backgrounds: { ...classic.backgrounds, default: { type: "gradient", from: "background", to: "#222222", angle: 90 } } };
  assert.equal(backgroundCss(t, null), "linear-gradient(90deg, #ffffff, #222222)");
  assert.deepEqual(backgroundColors(t, null), ["#ffffff", "#222222"]);
  assert.deepEqual(backgroundColors(classic, "theme:bg.dark"), ["#0b2a6f"]);
});

test("a reference is known only if the theme defines it", () => {
  assert.ok(themeRefKnown(classic, "theme:color.onDark"));
  assert.ok(themeRefKnown(classic, "theme:font.body"));
  assert.ok(themeRefKnown(classic, "theme:bg.accent"));
  assert.ok(!themeRefKnown(classic, "theme:color.nope"));
  assert.ok(!themeRefKnown(classic, "theme:bg.nope"));
  assert.ok(!themeRefKnown(classic, "#ffffff"));
});

test("every built-in theme defines every colour, both fonts and all three backgrounds", () => {
  assert.ok(themes.length >= 8);
  assert.equal(new Set(themes.map((t) => t.id)).size, themes.length);
  for (const t of themes) {
    for (const role of COLOR_ROLES) assert.match(t.colors[role], /^#[0-9a-f]{6}$/i, `${t.id}.${role}`);
    assert.ok(t.fonts.heading && t.fonts.body, t.id);
    for (const bg of ["default", "dark", "accent"] as const) assert.ok(backgroundCss(t, `theme:bg.${bg}`), `${t.id} ${bg}`);
  }
});
