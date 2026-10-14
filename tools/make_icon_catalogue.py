"""Make the editor's icon list from a Lucide package.

Usage:  python make_icon_catalogue.py PACKAGE_DIR [OUT_FILE]

PACKAGE_DIR is an unpacked lucide-static package (it needs icon-nodes.json, tags.json, package.json and LICENSE). The result, by default
editor/web/icons/lucide.json, holds every icon as the shapes a project keeps (see the icon object in docs/format-spec.md), its search words,
and the licence text, so the notice travels with the data. Nothing here runs the package: it only reads three data files.

An icon whose shapes do not fit the format (a tag or attribute the format does not allow) is left out and named, not repaired.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TAGS = ("path", "circle", "rect", "ellipse", "line", "polyline", "polygon")
NUMBERS = ("cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2")
PATH_DATA = re.compile(r"^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]*$")
POINTS = re.compile(r"^[0-9eE.,\s+-]*$")


def shape_of(node):
    """A Lucide node [tag, attributes] as one shape of the project format, or None if it does not fit."""
    tag, attrs = node
    if tag not in TAGS:
        return None
    shape = {"tag": tag}
    for key, value in attrs.items():
        if key in NUMBERS:
            try:
                shape[key] = float(value) if "." in str(value) else int(value)
            except ValueError:
                return None
        elif key == "d":
            if not PATH_DATA.match(value) or len(value) > 2000:
                return None
            shape["d"] = value
        elif key == "points":
            if not POINTS.match(value) or len(value) > 1000:
                return None
            shape["points"] = value
        elif key == "fill":
            if value not in ("none", "currentColor"):
                return None
            shape["fill"] = value
        elif key == "key":
            continue  # Lucide's own bookkeeping
        else:
            return None
    return shape


def main(argv):
    if not argv:
        sys.stderr.write(__doc__)
        return 2
    package = pathlib.Path(argv[0])
    out = pathlib.Path(argv[1]) if len(argv) > 1 else ROOT / "editor" / "web" / "icons" / "lucide.json"
    nodes = json.loads((package / "icon-nodes.json").read_text(encoding="utf-8"))
    tags = json.loads((package / "tags.json").read_text(encoding="utf-8"))
    version = json.loads((package / "package.json").read_text(encoding="utf-8"))["version"]
    licence = (package / "LICENSE").read_text(encoding="utf-8")

    icons, skipped = {}, []
    for name in sorted(nodes):
        shapes = [shape_of(n) for n in nodes[name]]
        if not shapes or any(s is None for s in shapes) or len(shapes) > 24:
            skipped.append(name)
            continue
        words = sorted({w.lower() for w in tags.get(name, [])})
        icons[name] = {"t": words, "s": shapes}

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"set": "lucide", "version": version, "licence": licence, "icons": icons}, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(icons)} icons written to {out} ({out.stat().st_size // 1024} KB), Lucide {version}")
    if skipped:
        print(f"{len(skipped)} left out because their shapes do not fit the format: {', '.join(skipped)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
