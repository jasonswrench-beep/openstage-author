# SPDX-License-Identifier: Apache-2.0
"""Make the icons the programs' own buttons and menus use, from design/icons.json.

Usage:  python tools/make_ui_icons.py          write editor/src/uiicons.gen.ts and design/ICONS.md
        python tools/make_ui_icons.py --check  only say whether those two files are up to date (exit 1 if not)
        add  --recorder PATH  to write (or check) OpenStage Recorder's own icon file too, in its repository
                              (app/src/uiicons.gen.ts there): its icons as drawn shapes, with a small drawing function,
                              because the Recorder has no copy of Author's player.
        add  --explainer PATH the same for OpenExplainer (src/ui/uiicons.gen.ts in its repository).
        add  --express PATH   OpenStage Capture Express's icons, in its repository
                              (crates/openstage-express-app/src/ui/uiicons_gen.rs there): Express draws its own window in Rust
                              (egui), with no web page, so each icon is written as lines on the 24 by 24 grid, its curves and arcs
                              cut into short straight pieces that it draws with the words' colour.
        add  --assess PATH    OpenAssess's icons, in its repository (packages/app/ui/uiicons.gen.js there): plain JavaScript
                              with type comments, because its interface has no build step and is checked as JavaScript.

design/icons.json names, for each product, the Lucide icon of each command. Every name is checked against the Lucide set Author
already ships (editor/web/icons/lucide.json), so a misspelt or renamed icon stops the run instead of drawing nothing. Author's icons
are written, as their drawn shapes, into editor/src/uiicons.gen.ts, with the Lucide licence; design/ICONS.md is the same list as a
table for people (and for anyone asked to review the choices), with the colours from design/openstage-ui.css.
"""
import json
import math
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ICONS_JSON = ROOT / "design" / "icons.json"
STYLE_CSS = ROOT / "design" / "openstage-ui.css"
LUCIDE = ROOT / "editor" / "web" / "icons" / "lucide.json"
OUT_TS = ROOT / "editor" / "src" / "uiicons.gen.ts"
OUT_MD = ROOT / "design" / "ICONS.md"

PRODUCT_NAMES = {"author": "OpenStage Author", "recorder": "OpenStage Recorder", "explainer": "OpenExplainer",
                 "express": "OpenStage Capture Express", "assess": "OpenAssess"}

# The products whose icon file is written into their own repository, with the words their file's heading uses.
OWN_FILES = {
    "recorder": {"flag": "--recorder", "whose": "the Recorder's own buttons, tabs and menus", "why": "the Recorder has no copy of Author's player/src/icon.ts"},
    "explainer": {"flag": "--explainer", "whose": "OpenExplainer's own buttons, menus and panes", "why": "OpenExplainer has no copy of Author's player/src/icon.ts"},
}


# The products whose interface is plain JavaScript with no build step, and get their icons as a .js file (see make_own_js).
JS_FILES = {
    "assess": {"flag": "--assess", "whose": "OpenAssess's own buttons, menus and command search"},
}

# The products that draw their own window in Rust and get their icons as lines (see make_own_rs).
RUST_FILES = {
    "express": {"flag": "--express", "whose": "Capture Express's own buttons, menus and panes"},
}

# How far a straight piece may stray from the curve it stands for, on the 24 by 24 grid. Icons are drawn 14 to 24 pixels across, so
# 0.08 of a grid square is well under a pixel.
FLATNESS = 0.08


class IconError(Exception):
    pass


def load():
    plan = json.loads(ICONS_JSON.read_text(encoding="utf-8"))
    lucide = json.loads(LUCIDE.read_text(encoding="utf-8"))
    missing = []
    for product, rows in plan["products"].items():
        for row in rows:
            if row["icon"] not in lucide["icons"]:
                missing.append(f"{product}: {row['command']} uses {row['icon']}, which is not in Lucide {lucide['version']}")
    if missing:
        raise IconError("These icons are not in the Lucide set:\n" + "\n".join(missing))
    return plan, lucide


def colours():
    """The named colours of the style file, in its order: (name, value)."""
    text = STYLE_CSS.read_text(encoding="utf-8")
    return re.findall(r"(--os-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;", text)


def make_ts(plan, lucide):
    names = sorted({row["icon"] for row in plan["products"]["author"]})
    lines = [
        "// SPDX-License-Identifier: Apache-2.0 AND ISC",
        "// Made by tools/make_ui_icons.py from design/icons.json: do not edit by hand, run the tool again.",
        f"// The icons of the editor's own buttons and menus: Lucide {lucide['version']}, kept as their drawn shapes. Drawn with buildIcon",
        "// (player/src/icon.ts), so they take the colour of the words around them.",
        "//",
    ]
    lines += [("// " + l).rstrip() for l in lucide["licence"].strip().splitlines()]
    lines += ["", 'import type { IconShape } from "../../player/src/types.ts";', ""]
    lines.append("export const UI_ICONS = {")
    for name in names:
        shapes = json.dumps(lucide["icons"][name]["s"], separators=(",", ":"))
        lines.append(f"  {json.dumps(name)}: {shapes},")
    lines.append("} as const satisfies Record<string, readonly IconShape[]>;")
    lines.append("")
    lines.append("export type UiIconName = keyof typeof UI_ICONS;")
    lines.append("")
    return "\n".join(lines)


def make_recorder_ts(plan, lucide):
    """OpenStage Recorder's icons, with the function that draws them (the Recorder has no copy of Author's player/src/icon.ts)."""
    return make_own_ts(plan, lucide, "recorder")


def make_own_ts(plan, lucide, product):
    """A product's icons for its own repository, with the function that draws them (OWN_FILES says why it needs one)."""
    own = OWN_FILES[product]
    names = sorted({row["icon"] for row in plan["products"][product]})
    lines = [
        "// SPDX-License-Identifier: Apache-2.0 AND ISC",
        "// Made by tools/make_ui_icons.py in the OpenStage Author repository, from its design/icons.json (the suite's one list of icons):",
        f"// do not edit by hand. Change that list and run the tool there with {own['flag']} pointing at this file.",
        f"// The icons of {own['whose']}: Lucide {lucide['version']}, kept as their drawn shapes, drawn as lines in the",
        "// colour of the words around them, and hidden from screen readers (the words beside an icon, or a button's name, say what it is).",
        "//",
    ]
    lines += [("// " + l).rstrip() for l in lucide["licence"].strip().splitlines()]
    lines += ["", "type Shape = { readonly tag: string } & Readonly<Record<string, string | number>>;", ""]
    lines.append("export const UI_ICONS = {")
    for name in names:
        shapes = json.dumps(lucide["icons"][name]["s"], separators=(",", ":"))
        lines.append(f"  {json.dumps(name)}: {shapes},")
    lines.append("} as const satisfies Record<string, readonly Shape[]>;")
    lines.append("")
    lines.append("export type UiIconName = keyof typeof UI_ICONS;")
    lines.append("")
    lines.append('const SVG_NS = "http://www.w3.org/2000/svg";')
    lines.append("")
    lines.append("/** An icon, drawn in the colour of the words beside it and hidden from screen readers. */")
    lines.append("export function uiIcon(doc: Document, name: UiIconName): SVGSVGElement {")
    lines.append("  const svg = doc.createElementNS(SVG_NS, \"svg\");")
    lines.append("  for (const [k, v] of [[\"viewBox\", \"0 0 24 24\"], [\"fill\", \"none\"], [\"stroke\", \"currentColor\"], [\"stroke-width\", \"2\"], [\"stroke-linecap\", \"round\"], [\"stroke-linejoin\", \"round\"], [\"focusable\", \"false\"], [\"aria-hidden\", \"true\"], [\"class\", \"ui-icon\"]] as const) svg.setAttribute(k, v);")
    lines.append("  for (const shape of UI_ICONS[name] as readonly Shape[]) {")
    lines.append("    const part = doc.createElementNS(SVG_NS, shape.tag);")
    lines.append("    for (const [key, value] of Object.entries(shape)) if (key !== \"tag\") part.setAttribute(key, String(value));")
    lines.append("    svg.appendChild(part);")
    lines.append("  }")
    lines.append("  return svg;")
    lines.append("}")
    lines.append("")
    return "\n".join(lines)


# ---- Lucide's shapes as lines, for a program that draws them itself (Capture Express, in Rust) ----

_NUMBER = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")


class _PathReader:
    """Reads an SVG path's d attribute: letters, numbers, and the one-character flags of an arc (Lucide packs them, as in a1 1 0 01 2 2)."""

    def __init__(self, d):
        self.d, self.i = d, 0

    def _skip(self):
        while self.i < len(self.d) and self.d[self.i] in " ,\t\r\n":
            self.i += 1

    def done(self):
        self._skip()
        return self.i >= len(self.d)

    def letter(self):
        self._skip()
        if self.i < len(self.d) and self.d[self.i].isalpha():
            self.i += 1
            return self.d[self.i - 1]
        return None

    def number(self):
        self._skip()
        m = _NUMBER.match(self.d, self.i)
        if not m:
            raise IconError(f"cannot read the path {self.d!r} at {self.i}")
        self.i = m.end()
        return float(m.group())

    def flag(self):
        self._skip()
        c = self.d[self.i]
        if c not in "01":
            raise IconError(f"an arc flag in {self.d!r} at {self.i} is {c!r}")
        self.i += 1
        return c == "1"


def _pieces(length):
    return max(2, math.ceil(length / 0.6))


def _cubic(p0, p1, p2, p3):
    # Enough pieces that the lines stay within FLATNESS of the curve: the usual bound from the second differences.
    dd = max(math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]),
             math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]))
    n = max(2, math.ceil(math.sqrt(3 * dd / (4 * FLATNESS))))
    out = []
    for k in range(1, n + 1):
        t = k / n
        u = 1 - t
        out.append((u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
                    u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]))
    return out


def _quad(p0, p1, p2):
    return _cubic(p0, (p0[0] + 2 / 3 * (p1[0] - p0[0]), p0[1] + 2 / 3 * (p1[1] - p0[1])),
                  (p2[0] + 2 / 3 * (p1[0] - p2[0]), p2[1] + 2 / 3 * (p1[1] - p2[1])), p2)


def _arc_steps(radius, sweep):
    # The sagitta of a piece of angle a is r(1 - cos(a/2)); keep it under FLATNESS.
    if radius <= FLATNESS:
        return max(2, math.ceil(abs(sweep) / (math.pi / 2)))
    a = 2 * math.acos(max(-1.0, 1 - FLATNESS / radius))
    return max(2, math.ceil(abs(sweep) / a))


def _arc(p0, rx, ry, rotation, large, sweep, p1):
    """The points of an SVG arc after p0, as the SVG specification turns its end points into a centre (appendix F.6.5)."""
    if p0 == p1:
        return []
    rx, ry = abs(rx), abs(ry)
    if rx == 0 or ry == 0:
        return [p1]
    phi = math.radians(rotation)
    cos_p, sin_p = math.cos(phi), math.sin(phi)
    dx, dy = (p0[0] - p1[0]) / 2, (p0[1] - p1[1]) / 2
    x1 = cos_p * dx + sin_p * dy
    y1 = -sin_p * dx + cos_p * dy
    scale = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
    if scale > 1:
        rx, ry = rx * math.sqrt(scale), ry * math.sqrt(scale)
    num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
    den = rx * rx * y1 * y1 + ry * ry * x1 * x1
    co = math.sqrt(max(0.0, num / den)) if den else 0.0
    if large == sweep:
        co = -co
    cx1, cy1 = co * rx * y1 / ry, -co * ry * x1 / rx
    cx = cos_p * cx1 - sin_p * cy1 + (p0[0] + p1[0]) / 2
    cy = sin_p * cx1 + cos_p * cy1 + (p0[1] + p1[1]) / 2

    def angle(ux, uy, vx, vy):
        a = math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
        return a

    start = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
    delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
    if not sweep and delta > 0:
        delta -= 2 * math.pi
    elif sweep and delta < 0:
        delta += 2 * math.pi
    n = _arc_steps(max(rx, ry), delta)
    out = []
    for k in range(1, n + 1):
        t = start + delta * k / n
        x, y = rx * math.cos(t), ry * math.sin(t)
        out.append((cos_p * x - sin_p * y + cx, sin_p * x + cos_p * y + cy))
    out[-1] = p1
    return out


def _path_strokes(d):
    """An SVG path as strokes: (points, closed). Each move starts a stroke; Z closes it."""
    r = _PathReader(d)
    strokes, points = [], []
    cur = start = (0.0, 0.0)
    last_control = None
    last_kind = None
    command = None

    def finish(closed=False):
        nonlocal points
        if len(points) > 1:
            strokes.append((points, closed))
        points = []

    while not r.done():
        letter = r.letter()
        if letter is not None:
            command = letter
        elif command is None:
            raise IconError(f"the path {d!r} does not start with a letter")
        rel = command.islower()
        c = command.upper()
        base = cur if rel else (0.0, 0.0)
        control = None
        if c == "M":
            finish()
            cur = (base[0] + r.number(), base[1] + r.number())
            start = cur
            points = [cur]
            command = "l" if rel else "L"  # more pairs after a move are lines
        elif c == "Z":
            if points and points[-1] == start and len(points) > 2:
                points.pop()
            finish(True)
            cur = start
            points = [cur]
            command = None
        elif c == "L":
            cur = (base[0] + r.number(), base[1] + r.number())
            points.append(cur)
        elif c == "H":
            cur = ((cur[0] if rel else 0.0) + r.number(), cur[1])
            points.append(cur)
        elif c == "V":
            cur = (cur[0], (cur[1] if rel else 0.0) + r.number())
            points.append(cur)
        elif c in "CS":
            if c == "C":
                p1 = (base[0] + r.number(), base[1] + r.number())
            else:
                p1 = (2 * cur[0] - last_control[0], 2 * cur[1] - last_control[1]) if last_control and last_kind in "CS" else cur
            p2 = (base[0] + r.number(), base[1] + r.number())
            p3 = (base[0] + r.number(), base[1] + r.number())
            points += _cubic(cur, p1, p2, p3)
            cur, control = p3, p2
        elif c in "QT":
            if c == "Q":
                p1 = (base[0] + r.number(), base[1] + r.number())
            else:
                p1 = (2 * cur[0] - last_control[0], 2 * cur[1] - last_control[1]) if last_control and last_kind in "QT" else cur
            p2 = (base[0] + r.number(), base[1] + r.number())
            points += _quad(cur, p1, p2)
            cur, control = p2, p1
        elif c == "A":
            rx, ry, rotation = r.number(), r.number(), r.number()
            large, sweep = r.flag(), r.flag()
            end = (base[0] + r.number(), base[1] + r.number())
            points += _arc(cur, rx, ry, rotation, large, sweep, end)
            cur = end
        else:
            raise IconError(f"the path {d!r} uses {command!r}, which this tool does not read")
        # S reflects the last control point of a C or S before it, T that of a Q or T; anything else leaves none to reflect.
        last_control = control if c in "CSQT" else None
        last_kind = c
    finish()
    return strokes


def _ellipse(cx, cy, rx, ry):
    n = max(12, _arc_steps(max(rx, ry), 2 * math.pi))
    return [(cx + rx * math.cos(2 * math.pi * k / n), cy + ry * math.sin(2 * math.pi * k / n)) for k in range(n)]


def _rect(x, y, w, h, rx, ry):
    if not rx and not ry:
        return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
    rx = min(rx or ry, w / 2)
    ry = min(ry or rx, h / 2)
    pts = []
    for (cx, cy, a0) in ((x + w - rx, y + ry, -math.pi / 2), (x + w - rx, y + h - ry, 0.0),
                         (x + rx, y + h - ry, math.pi / 2), (x + rx, y + ry, math.pi)):
        n = _arc_steps(max(rx, ry), math.pi / 2)
        for k in range(n + 1):
            t = a0 + (math.pi / 2) * k / n
            pts.append((cx + rx * math.cos(t), cy + ry * math.sin(t)))
    return pts


def shape_strokes(shape):
    """One Lucide shape (path, circle, ellipse, rect, line, polyline, polygon) as strokes: (points on the 24 grid, closed)."""
    tag = shape["tag"]
    f = lambda key, default=0.0: float(shape.get(key, default))  # noqa: E731
    if tag == "path":
        return _path_strokes(shape["d"])
    if tag == "circle":
        return [(_ellipse(f("cx"), f("cy"), f("r"), f("r")), True)]
    if tag == "ellipse":
        return [(_ellipse(f("cx"), f("cy"), f("rx"), f("ry")), True)]
    if tag == "rect":
        return [(_rect(f("x"), f("y"), f("width"), f("height"), f("rx"), f("ry")), True)]
    if tag == "line":
        return [([(f("x1"), f("y1")), (f("x2"), f("y2"))], False)]
    if tag in ("polyline", "polygon"):
        nums = [float(n) for n in _NUMBER.findall(shape["points"])]
        return [(list(zip(nums[0::2], nums[1::2])), tag == "polygon")]
    raise IconError(f"Lucide shape {tag!r} is not one this tool can turn into lines")


def _tidy(points):
    """Points rounded to a hundredth of a grid square, with a point that repeats the one before it left out."""
    out = []
    for x, y in points:
        p = (round(x, 2) + 0.0, round(y, 2) + 0.0)
        if not out or out[-1] != p:
            out.append(p)
    return out


def _rust_number(v):
    text = f"{v:.2f}".rstrip("0")
    return text + "0" if text.endswith(".") else text


def rust_variant(name):
    """The Rust name of an icon: undo-2 is Undo2, arrow-down-a-z is ArrowDownAZ."""
    return "".join(part[:1].upper() + part[1:] for part in name.split("-"))


def make_own_rs(plan, lucide, product):
    """A product's icons for its own Rust program: each icon as lines on the 24 grid, and an enum to name them."""
    own = RUST_FILES[product]
    names = sorted({row["icon"] for row in plan["products"][product]})
    lines = [
        "// SPDX-License-Identifier: Apache-2.0 AND ISC",
        "// Made by tools/make_ui_icons.py in the OpenStage Author repository, from its design/icons.json (the suite's one list of icons):",
        f"// do not edit by hand. Change that list and run the tool there with {own['flag']} pointing at this file.",
        f"//! The icons of {own['whose']}: Lucide {lucide['version']}, each kept as the lines it is drawn with on its 24 by 24 grid",
        "//! (curves and arcs cut into short straight pieces, none more than 0.08 of a grid square off the curve). `icon.rs` draws them",
        "//! 2 grid squares thick in the colour of the words beside them. An icon says nothing to a screen reader: the words beside it, or",
        "//! the name of its button, say what it is.",
        "//",
    ]
    lines += [("// " + l).rstrip() for l in lucide["licence"].strip().splitlines()]
    lines += [
        "",
        "/// One line of an icon: points on the 24 by 24 grid, joined in order, and whether the last is joined back to the first.",
        "pub struct IconLine {",
        "    pub points: &'static [[f32; 2]],",
        "    pub closed: bool,",
        "}",
        "",
        "/// Every icon the program uses, by its Lucide name.",
        "#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]",
        "pub enum UiIcon {",
    ]
    lines += [f"    /// Lucide `{name}`." + "\n" + f"    {rust_variant(name)}," for name in names]
    lines += ["}", "", "impl UiIcon {", f"    pub const ALL: [UiIcon; {len(names)}] = ["]
    lines += [f"        UiIcon::{rust_variant(name)}," for name in names]
    lines += ["    ];", "", "    /// Its Lucide name, as on lucide.dev.", "    pub fn name(self) -> &'static str {", "        match self {"]
    lines += [f"            UiIcon::{rust_variant(name)} => {json.dumps(name)}," for name in names]
    lines += ["        }", "    }", "", "    /// The lines it is drawn with.", "    pub fn lines(self) -> &'static [IconLine] {", "        match self {"]
    lines += [f"            UiIcon::{rust_variant(name)} => &{rust_variant(name).upper()}_LINES," for name in names]
    lines += ["        }", "    }", "}", ""]
    for name in names:
        strokes = []
        for shape in lucide["icons"][name]["s"]:
            strokes += shape_strokes(shape)
        parts = []
        for points, closed in strokes:
            pts = _tidy(points)
            if len(pts) < 2:
                pts = pts * 2  # a dot (Lucide draws some as a path that goes nowhere): drawn as a round end
            coords = ", ".join(f"[{_rust_number(x)}, {_rust_number(y)}]" for x, y in pts)
            parts.append(f"    IconLine {{ points: &[{coords}], closed: {'true' if closed else 'false'} }},")
        lines.append(f"const {rust_variant(name).upper()}_LINES: [IconLine; {len(parts)}] = [")
        lines += parts
        lines.append("];")
    lines.append("")
    return "\n".join(lines)


def make_own_js(plan, lucide, product):
    """A product's icons as plain JavaScript (checked by TypeScript through its comments), with the function that draws them."""
    own = JS_FILES[product]
    names = sorted({row["icon"] for row in plan["products"][product]})
    lines = [
        "// @ts-check",
        "// SPDX-License-Identifier: Apache-2.0 AND ISC",
        "// Made by tools/make_ui_icons.py in the OpenStage Author repository, from its design/icons.json (the suite's one list of icons):",
        f"// do not edit by hand. Change that list and run the tool there with {own['flag']} pointing at this file.",
        f"// The icons of {own['whose']}: Lucide {lucide['version']}, kept as their drawn shapes, drawn as lines in the",
        "// colour of the words around them, and hidden from screen readers (the words beside an icon, or a button's name, say what it is).",
        "//",
    ]
    lines += [("// " + l).rstrip() for l in lucide["licence"].strip().splitlines()]
    lines += ["", "/** @typedef {{ tag: string } & Record<string, string | number>} Shape */", ""]
    lines.append("export const UI_ICONS = /** @type {const} */ ({")
    for name in names:
        shapes = json.dumps(lucide["icons"][name]["s"], separators=(",", ":"))
        lines.append(f"  {json.dumps(name)}: {shapes},")
    lines.append("});")
    lines.append("")
    lines.append("/** @typedef {keyof typeof UI_ICONS} UiIconName */")
    lines.append("")
    lines.append("// The name of the kind of element, which the browser needs to make one; it is never fetched.")
    lines.append('const SVG_NS = "http://www.w3.org/2000/svg";')
    lines.append("")
    lines.append("/**")
    lines.append(" * An icon, drawn in the colour of the words beside it and hidden from screen readers.")
    lines.append(" * @param {Document} doc")
    lines.append(" * @param {UiIconName} name")
    lines.append(" * @returns {SVGSVGElement}")
    lines.append(" */")
    lines.append("export function uiIcon(doc, name) {")
    lines.append("  const svg = doc.createElementNS(SVG_NS, \"svg\");")
    lines.append("  for (const [k, v] of [[\"viewBox\", \"0 0 24 24\"], [\"fill\", \"none\"], [\"stroke\", \"currentColor\"], [\"stroke-width\", \"2\"], [\"stroke-linecap\", \"round\"], [\"stroke-linejoin\", \"round\"], [\"focusable\", \"false\"], [\"aria-hidden\", \"true\"], [\"class\", \"ui-icon\"]]) svg.setAttribute(k, v);")
    lines.append("  for (const shape of /** @type {readonly Shape[]} */ (UI_ICONS[name])) {")
    lines.append("    const part = doc.createElementNS(SVG_NS, shape.tag);")
    lines.append("    for (const [key, value] of Object.entries(shape)) if (key !== \"tag\") part.setAttribute(key, String(value));")
    lines.append("    svg.appendChild(part);")
    lines.append("  }")
    lines.append("  return svg;")
    lines.append("}")
    lines.append("")
    return "\n".join(lines)


def make_md(plan, lucide):
    out = [
        "# Icons for each command",
        "",
        "Made by `tools/make_ui_icons.py` from `icons.json`: change that file and run the tool again, do not edit this one.",
        "",
        "## For anyone asked to review these",
        "",
        f"Every icon is from **Lucide {lucide['version']}** (lucide.dev, ISC licence): outline icons on a 24 by 24 grid, 2 px lines with round ends,",
        "no fill, drawn in the colour of the words next to them. The programs use no other icon set, so the review is about **choosing**:",
        "for each command, does the icon say what the command does at a glance? Where it does not, suggest a better Lucide icon **by its",
        "name** (each name below links to its picture). Please do not redraw or recolour icons. Pictures that are not buttons (logos,",
        "illustrations) are a separate job and use the colours below.",
        "",
        "Main buttons show an icon and a word; menu items show an icon, a word and the shortcut; small buttons in lists show the icon alone,",
        "with a spoken name and a tooltip. See `DESIGN-GUIDE.md` for the rules and what each colour is for.",
        "",
        "## Colours (from `openstage-ui.css`)",
        "",
        "| Name | Colour |",
        "|---|---|",
    ]
    out += [f"| `{name}` | `{value.upper()}` |" for name, value in colours()]
    for product, rows in plan["products"].items():
        out += ["", f"## {PRODUCT_NAMES.get(product, product)}", "", "| Where | Command | Icon | Shortcut |", "|---|---|---|---|"]
        for row in rows:
            icon = f"[{row['icon']}](https://lucide.dev/icons/{row['icon']})"
            out.append(f"| {row['area']} | {row['command']} | {icon} | {row.get('keys', '')} |")
    out.append("")
    return "\n".join(out)


def same(path, text):
    return path.is_file() and path.read_text(encoding="utf-8").replace("\r\n", "\n") == text


def main(argv):
    try:
        plan, lucide = load()
    except IconError as err:
        print(f"Stopped: {err}")
        return 1
    files = {OUT_TS: make_ts(plan, lucide), OUT_MD: make_md(plan, lucide)}
    for product, own in OWN_FILES.items():
        if own["flag"] not in argv:
            continue
        at = argv.index(own["flag"]) + 1
        if at >= len(argv):
            print(f"Stopped: {own['flag']} needs the path of {PRODUCT_NAMES[product]}'s icon file.")
            return 1
        files[pathlib.Path(argv[at]).resolve()] = make_own_ts(plan, lucide, product)
    for product, own in JS_FILES.items():
        if own["flag"] not in argv:
            continue
        at = argv.index(own["flag"]) + 1
        if at >= len(argv):
            print(f"Stopped: {own['flag']} needs the path of {PRODUCT_NAMES[product]}'s icon file.")
            return 1
        files[pathlib.Path(argv[at]).resolve()] = make_own_js(plan, lucide, product)
    for product, own in RUST_FILES.items():
        if own["flag"] not in argv:
            continue
        at = argv.index(own["flag"]) + 1
        if at >= len(argv):
            print(f"Stopped: {own['flag']} needs the path of {PRODUCT_NAMES[product]}'s icon file.")
            return 1
        files[pathlib.Path(argv[at]).resolve()] = make_own_rs(plan, lucide, product)
    if "--check" in argv:
        stale = [str(p.relative_to(ROOT)) if p.is_relative_to(ROOT) else str(p) for p, text in files.items() if not same(p, text)]
        if stale:
            print("Out of date (run python tools/make_ui_icons.py): " + ", ".join(stale))
            return 1
        print("The icon files are up to date.")
        return 0
    for path, text in files.items():
        path.write_text(text, encoding="utf-8", newline="\n")
    counts = ", ".join(f"{PRODUCT_NAMES.get(p, p)} {len(rows)} commands" for p, rows in plan["products"].items())
    extra = [str(p) for p in files if not p.is_relative_to(ROOT)]
    print(f"Wrote {OUT_TS.relative_to(ROOT)} and {OUT_MD.relative_to(ROOT)}{''.join(f' and {e}' for e in extra)} ({counts}).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
