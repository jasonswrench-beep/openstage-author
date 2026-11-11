# SPDX-License-Identifier: Apache-2.0
"""Make the icons the programs' own buttons and menus use, from design/icons.json.

Usage:  python tools/make_ui_icons.py          write editor/src/uiicons.gen.ts and design/ICONS.md
        python tools/make_ui_icons.py --check  only say whether those two files are up to date (exit 1 if not)
        add  --recorder PATH  to write (or check) OpenStage Recorder's own icon file too, in its repository
                              (app/src/uiicons.gen.ts there): its icons as drawn shapes, with a small drawing function,
                              because the Recorder has no copy of Author's player.
        add  --explainer PATH the same for OpenExplainer (src/ui/uiicons.gen.ts in its repository).

design/icons.json names, for each product, the Lucide icon of each command. Every name is checked against the Lucide set Author
already ships (editor/web/icons/lucide.json), so a misspelt or renamed icon stops the run instead of drawing nothing. Author's icons
are written, as their drawn shapes, into editor/src/uiicons.gen.ts, with the Lucide licence; design/ICONS.md is the same list as a
table for people (and for anyone asked to review the choices), with the colours from design/openstage-ui.css.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ICONS_JSON = ROOT / "design" / "icons.json"
STYLE_CSS = ROOT / "design" / "openstage-ui.css"
LUCIDE = ROOT / "editor" / "web" / "icons" / "lucide.json"
OUT_TS = ROOT / "editor" / "src" / "uiicons.gen.ts"
OUT_MD = ROOT / "design" / "ICONS.md"

PRODUCT_NAMES = {"author": "OpenStage Author", "recorder": "OpenStage Recorder", "explainer": "OpenExplainer"}

# The products whose icon file is written into their own repository, with the words their file's heading uses.
OWN_FILES = {
    "recorder": {"flag": "--recorder", "whose": "the Recorder's own buttons, tabs and menus", "why": "the Recorder has no copy of Author's player/src/icon.ts"},
    "explainer": {"flag": "--explainer", "whose": "OpenExplainer's own buttons, menus and panes", "why": "OpenExplainer has no copy of Author's player/src/icon.ts"},
}


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
