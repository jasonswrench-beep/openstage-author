"""OpenStage project validator. See docs/validator-spec.md.

Usage:  python validate.py PROJECT_DIR [--json]

Reads project.json and every slide it lists, checks structure against schema/*.json,
then runs the semantic rules. Exits 1 if there are errors, 0 otherwise.

The same function (validate_project) is meant to power the command line and, later,
the editor's problem list. Never write a second implementation.
"""
import decimal
import html as htmllib
from html.parser import HTMLParser
import json
import os
import pathlib
import re
import sys
from dataclasses import dataclass, asdict

try:
    from jsonschema import Draft202012Validator
    from jsonschema.exceptions import best_match
    from referencing import Registry, Resource
except ImportError as exc:  # pragma: no cover - depends on the machine
    sys.stderr.write(
        f"The checker needs the Python package '{exc.name}', which is not installed for this Python "
        f"({sys.executable}).\nInstall it with:  python -m pip install jsonschema\n"
        "or double-click OPEN EDITOR.bat, which does it for you.\n"
    )
    sys.exit(3)

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))  # -I mode drops the script folder
from narration_key import narration_hash  # noqa: E402,F401  (also used by narrate.py)

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCHEMA_DIR = ROOT / "schema"

SUPPORTED_SCHEMA_VERSION = (0, 43, 0)
# How many items each kind of interaction can show. A drawing has only so many places for them.
# Keep in step with ITEM_LIMITS in player/src/interactions.ts.
ITEM_LIMITS = {
    "clickReveal": (1, 12), "flipCards": (1, 12), "tabs": (1, 12), "accordion": (1, 20), "carousel": (1, 20),
    "steps": (1, 12), "timeline": (2, 12), "processCircle": (3, 8), "glossary": (1, 50),
    "pyramidStack": (3, 7), "pyramidMatrix": (3, 6), "circleMatrix": (3, 8),
}
# The type of variable each kind of input writes. Keep in step with INPUT_VARIABLE_TYPE in player/src/inputs.ts.
INPUT_VARIABLE_TYPE = {"checkbox": "boolean", "radio": "string", "dropdown": "string", "list": "string",
                       "likert": "number", "semantic": "number", "character": "string", "slider": "number", "dial": "number"}
INTERACTIVE = ("button", "hotspot", "quizQuestion", "interaction", "scrollingText", "input", "embed", "certificate", "download", "scenario", "timer")
# In a scenario, a line spoken by this word is spoken by the learner's own character, not by someone in the cast.
YOU = "you"

# A gap does not block keyboard access (focus follows the values' order), so it is
# a warning. Duplicates are errors. See docs/validator-spec.md.
TAB_GAP_SEVERITY = "warning"

ERROR, WARNING = "error", "warning"

# Actions that act on the course itself, so they have no target.
COURSE_ACTIONS = ("nextSlide", "previousSlide", "replaySlide")


@dataclass
class Finding:
    severity: str
    file: str
    object_id: str
    rule: str
    message: str
    detail: str = ""


# ---------------------------------------------------------------- schema

def _load_schemas():
    schemas = {}
    for name in ("project", "slide", "object", "theme", "assets"):
        schemas[name] = json.loads((SCHEMA_DIR / f"{name}.schema.json").read_text(encoding="utf-8"))
    registry = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in schemas.values())
    return {
        name: Draft202012Validator(s, registry=registry, format_checker=Draft202012Validator.FORMAT_CHECKER)
        for name, s in schemas.items()
    }


_VALIDATORS = None


def _validators():
    global _VALIDATORS
    if _VALIDATORS is None:
        _VALIDATORS = _load_schemas()
    return _VALIDATORS


def _object_at(instance, path):
    """The innermost object envelope on the way down `path`, or None."""
    node, found = instance, None
    for part in path:
        node = node[part]
        if isinstance(node, dict) and "accessibility" in node and "type" in node:
            found = node
    return found


def _schema_findings(kind, rel, data):
    """Return (findings, has_hard_errors). Hard errors mean semantic rules must skip this file."""
    findings, hard = [], False
    for err in _validators()[kind].iter_errors(data):
        if err.validator in ("oneOf", "anyOf") and err.context and not _is_media_rule(err):
            err = best_match(err.context) or err
        path = list(err.absolute_path)
        obj = _object_at(data, path)
        oid = obj.get("id", "-") if obj else "-"
        otype = obj.get("type") if obj else None
        tail = path[-1] if path else None
        where = "/".join(str(p) for p in path) or "(top level)"

        if err.validator == "pattern" and tail == "altText":
            waiting = ((obj or {}).get("accessibility") or {}).get("altSuggestion")
            detail = ""
            if isinstance(waiting, dict) and waiting.get("text"):
                detail = f'A suggested description is waiting for you to check: "{str(waiting["text"])[:160]}". Use it, or write your own.'
            findings.append(Finding(ERROR, rel, oid, "alt-text-missing",
                                    "Object needs alt text, or must be marked decorative", detail))
        elif err.validator == "maxLength" and tail == "altText":
            findings.append(Finding(ERROR, rel, oid, "alt-text-on-decorative",
                                    "Decorative objects should not carry alt text"))
        elif tail == "tabOrder" and otype in INTERACTIVE:
            findings.append(Finding(ERROR, rel, oid, "not-keyboard-reachable",
                                    "Interactive objects must be reachable by keyboard",
                                    "Give it a tab order of 1 or more."))
        elif _is_media_rule(err):
            findings.append(Finding(ERROR, rel, oid, "media-needs-captions",
                                    "Time-based media needs captions",
                                    "Add content.captions or a narration script (an audio clip can have a transcript instead)."))
        else:
            hard = True
            findings.append(Finding(ERROR, rel, oid, "schema", err.message[:200], f"at {where}"))
    return findings, hard


def _is_media_rule(err):
    return (err.validator == "anyOf" and isinstance(err.instance, dict)
            and err.instance.get("type") in ("video", "audio"))


# ---------------------------------------------------------------- loading

def _read_json(path, rel, findings):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        findings.append(Finding(ERROR, rel, "-", "file-missing", "File is missing"))
    except json.JSONDecodeError as exc:
        findings.append(Finding(ERROR, rel, "-", "json-syntax", "File is not valid JSON",
                                f"line {exc.lineno}, column {exc.colno}: {exc.msg}"))
    return None


def _version_tuple(text):
    try:
        return tuple(int(p) for p in text.split("."))
    except (ValueError, AttributeError):
        return None


# ---------------------------------------------------------------- helpers

def _layers(slide):
    return [slide["baseLayer"]] + list(slide["layers"])


def _objects(slide):
    for layer in _layers(slide):
        for obj in layer["objects"]:
            yield layer, obj


def _hex_rgb(value):
    if not isinstance(value, str):
        return None
    m = re.fullmatch(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})", value.strip())
    if not m:
        return None
    h = m.group(1)
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def _luminance(rgb):
    def lin(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(fg, bg):
    a, b = _luminance(fg), _luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def _is_large_text(style):
    size = style.get("fontSize")
    if not isinstance(size, (int, float)):
        return False
    weight = style.get("fontWeight")
    bold = weight == "bold" or (isinstance(weight, (int, float)) and weight >= 700)
    return size >= 24 or (bold and size >= 18.66)


_IPA_OK = re.compile(
    r"^[\sa-z"
    r"ɐ-ʯ"   # IPA extensions
    r"ʰ-˿"   # modifier letters (includes primary/secondary stress, length)
    r"̀-ͯ"   # combining diacritics
    r"ᴀ-ᶿ"   # phonetic extensions
    r"βθχ"  # beta, theta, chi
    r"æðøŋœ"  # ordinary letters the IPA uses: cat, this, sing (outside the blocks above)
    r"‖‿͡.|()↗↘↑↓"
    r"]+$"
)


def _voices():
    data = json.loads((pathlib.Path(__file__).parent / "kokoro-voices.json").read_text(encoding="utf-8"))
    return set(data["voices"])


# A voice with no colon is one of Kokoro's. Another engine's voice begins with the engine's name and a colon (docs/format-spec.md, "Voices").
_ENGINE_VOICE = re.compile(r"^[a-z][a-z0-9-]{1,30}:[A-Za-z0-9_.-]{1,60}$")
# Internet services whose ready-made voices are known here, so a misspelt one is found. Their rules ask that listeners are told a voice is AI-made.
SERVICE_VOICES = {"openai": "OpenAI"}


def _openai_voices():
    return set(json.loads((pathlib.Path(__file__).parent / "openai-voices.json").read_text(encoding="utf-8"))["voices"])


def voice_known(voice):
    """Whether a voice name can be right. Kokoro's are checked against its list, and OpenAI's against its own. A plugin's voices
    can be known only on the computer the plugin is installed on, so any well-formed name is accepted."""
    if voice in _voices():
        return True
    if not _ENGINE_VOICE.match(voice):
        return False
    engine, _, rest = voice.partition(":")
    if engine == "openai":
        return rest in _openai_voices()
    return True


# ---------------------------------------------------------------- themes

COLOR_ROLES = ("background", "surface", "text", "muted", "accent", "accentStrong", "onAccentStrong",
               "dark", "onDark", "good", "bad", "line")
STYLE_THEME_KEYS = ("color", "fill", "stroke", "background", "fontFamily")


def default_theme():
    """The theme used when a project names none. The same file the editor offers as 'Classic'."""
    return json.loads((ROOT / "themes" / "classic.theme.json").read_text(encoding="utf-8"))


def theme_token_known(theme, value):
    """Is this 'theme:...' value something the theme defines?"""
    if value.startswith("theme:color."):
        return value[len("theme:color."):] in theme["colors"]
    if value.startswith("theme:font."):
        return value[len("theme:font."):] in theme["fonts"]
    if value.startswith("theme:bg."):
        return value[len("theme:bg."):] in theme["backgrounds"]
    return False


def resolve_color(theme, value):
    """A theme colour or a hex colour, as a hex string. None if it is neither."""
    if not isinstance(value, str):
        return None
    v = value.strip()
    if v.startswith("theme:color."):
        return theme["colors"].get(v[len("theme:color."):])
    return v if _hex_rgb(v) is not None else None


def _color_ref(theme, ref):
    return theme["colors"].get(ref, ref)


def background_colors(theme, value):
    """The colours a slide background is made of, one for solid and two for a gradient."""
    if isinstance(value, str) and value.startswith("theme:bg."):
        bg = theme["backgrounds"].get(value[len("theme:bg."):])
    elif isinstance(value, str) and _hex_rgb(value) is not None:
        return [value]
    else:
        bg = theme["backgrounds"]["default"]
    if bg is None:
        bg = theme["backgrounds"]["default"]
    if bg["type"] == "solid":
        return [_color_ref(theme, bg["color"])]
    return [_color_ref(theme, bg["from"]), _color_ref(theme, bg["to"])]


# The rules about themes shared with the player and the editor: tools/theme-rules.json.
THEME_RULES = json.loads((ROOT / "tools" / "theme-rules.json").read_text(encoding="utf-8"))

# Pairs of theme colours that are used as text on a background. Each must meet WCAG AA.
THEME_PAIRS = tuple(tuple(p) for p in THEME_RULES["pairs"])
LOGO_MARGIN = THEME_RULES["logo"]["margin"]


def logo_box(stage, logo):
    """Where a theme's logo sits on the stage, as (x, y, width, height): in its corner, a fixed margin in from the edges."""
    w, h = logo["width"], logo["height"]
    x = LOGO_MARGIN if logo["corner"].endswith("left") else stage["width"] - LOGO_MARGIN - w
    y = LOGO_MARGIN if logo["corner"].startswith("top") else stage["height"] - LOGO_MARGIN - h
    return (x, y, w, h)


def _check_logo(rel, theme, asset_root, add):
    """A logo is a picture on every slide, so it needs a name for a screen reader (or to be marked decorative) and a file."""
    logo = theme.get("logo")
    if not logo:
        return
    if logo["decorative"] and logo["alt"].strip():
        add(ERROR, rel, theme["id"], "theme-logo-decorative-alt", "A decorative logo must not have alt text",
            "A logo marked decorative is hidden from screen readers, so its alt text would never be read. Clear it, or untick decorative.")
    elif not logo["decorative"] and not logo["alt"].strip():
        add(ERROR, rel, theme["id"], "theme-logo-alt", "The logo needs alt text, or must be marked decorative",
            "A screen reader user hears the logo on every slide. Say what it is, for example \"New Paltz logo\", or mark it decorative.")
    target = (asset_root / logo["src"]).resolve()
    if asset_root.resolve() not in target.parents or not target.is_file():
        add(ERROR, rel, theme["id"], "theme-logo-missing", "The logo file is missing", f"{logo['src']} does not exist in the project.")


def _logo_overlap(rel, slide, theme, stage, add):
    """The logo sits on every slide, in its corner. Anything a learner needs that reaches into that corner is covered or crowded by it."""
    logo = theme.get("logo")
    if not logo or not stage:
        return
    lx, ly, lw, lh = logo_box(stage, logo)
    hit = []
    for _, obj in _objects(slide):
        if obj["accessibility"]["decorative"]:
            continue
        g = obj["geometry"]
        if g["x"] < lx + lw and g["x"] + g["width"] > lx and g["y"] < ly + lh and g["y"] + g["height"] > ly:
            hit.append(obj["name"])
    if hit:
        shown = ", ".join(f"'{n}'" for n in hit[:3]) + (f" and {len(hit) - 3} more" if len(hit) > 3 else "")
        add(WARNING, rel, slide["id"], "theme-logo-overlap", "The logo overlaps content on this slide",
            f"The logo fills the {logo['corner'].replace('-', ' ')} corner, from {lx},{ly} to {lx + lw},{ly + lh}. {shown} reach{'es' if len(hit) == 1 else ''} into it. "
            "Move the content, or move or shrink the logo.")


def _check_theme(rel, theme, add):
    for fg, bg in THEME_PAIRS:
        ratio = contrast_ratio(_hex_rgb(theme["colors"][fg]), _hex_rgb(theme["colors"][bg]))
        if ratio < THEME_RULES["minimumRatio"]:
            add(ERROR, rel, theme["id"], "theme-contrast", "Theme colours do not contrast enough",
                f"In theme '{theme['name']}', {fg} ({theme['colors'][fg]}) on {bg} ({theme['colors'][bg]}) "
                f"is {ratio:.2f}:1; WCAG 2.2 AA needs 4.5:1.")


def _theme_tokens(rel, slide, theme, add):
    def scan(owner, style):
        for key in STYLE_THEME_KEYS:
            v = style.get(key)
            if isinstance(v, str) and v.startswith("theme:") and not theme_token_known(theme, v):
                add(ERROR, rel, owner, "theme-token-unknown", "Style uses a theme value that does not exist",
                    f"'{key}' is '{v}', which the theme does not define.")
    bg = slide.get("background")
    if isinstance(bg, str) and bg.startswith("theme:") and not theme_token_known(theme, bg):
        add(ERROR, rel, slide["id"], "theme-token-unknown", "Style uses a theme value that does not exist",
            f"The slide background is '{bg}', which the theme does not define.")
    for _, obj in _objects(slide):
        scan(obj["id"], obj["style"])
        for state in obj["states"].values():
            scan(obj["id"], state.get("style", {}))


# ---------------------------------------------------------------- semantic rules

def input_values(slides):
    """For each variable an input saves to, the values it can ever hold: the saved value of each option, or 0
    (unanswered) and each point of a scale. Checkboxes can only be true or false, so they are left out."""
    allowed = {}
    for slide in slides:
        for _, obj in _objects(slide):
            if obj["type"] != "input":
                continue
            c = obj["content"]
            if c["kind"] in ("radio", "dropdown", "list"):
                allowed.setdefault(c["variable"], set()).update([""] + [o["value"] for o in c["options"]])
            elif c["kind"] == "character":
                allowed.setdefault(c["variable"], set()).update([""] + list(c["characters"]))
            elif c["kind"] in ("likert", "semantic"):
                top = len(c["scale"]) if c["kind"] == "likert" else c["points"]
                for row in c["rows"]:
                    allowed.setdefault(row["variable"], set()).update(range(0, top + 1))
    return allowed


def _groups(rel, slide, add):
    """A group is the objects of one layer that share a `group` tag. It needs two or more, and they must all be on the one layer."""
    members = {}
    for layer in _layers(slide):
        for obj in layer["objects"]:
            tag = obj.get("group")
            if tag:
                members.setdefault(tag, []).append((layer["id"], obj["id"]))
    for tag, found in sorted(members.items()):
        layers_seen = {layer_id for layer_id, _ in found}
        if len(layers_seen) > 1:
            add(ERROR, rel, found[0][1], "group-split", "A group has objects on different layers",
                f"Group '{tag}' has objects on the layers {', '.join(sorted(layers_seen))}. A group has to be on one layer.")
        elif len(found) < 2:
            add(WARNING, rel, found[0][1], "group-single", "A group has only one object",
                f"Group '{tag}' has one object, so it groups nothing.")


def _check_slide(rel, slide, variables, slides_by_id, add, theme, allowed=None, stage=None, cast=None, chosen=None, order=None, variable_names=None):
    layer_ids = {layer["id"] for layer in _layers(slide)}
    objects_by_id = {obj["id"]: obj for _, obj in _objects(slide)}

    for layer in _layers(slide):
        _tab_order(rel, layer, add)
    _groups(rel, slide, add)
    _theme_tokens(rel, slide, theme, add)
    _logo_overlap(rel, slide, theme, stage, add)
    slide_bg = background_colors(theme, slide.get("background"))

    imported = [obj for _, obj in _objects(slide) if obj["provenance"] and "sourceDeck" in obj["provenance"]]
    new = [obj for _, obj in _objects(slide) if not obj["provenance"]]
    if imported and new:
        add(WARNING, rel, slide["id"], "provenance-mixed",
            "Slide mixes imported and new objects; re-sync will only affect imported ones")

    for layer, obj in _objects(slide):
        oid = obj["id"]
        _alt_suggestion(rel, obj, add)
        _hotspot(rel, obj, add)
        _click_needs_key(rel, obj, add)
        _contrast(rel, obj, add, theme, slide_bg)
        _states(rel, obj, add)
        _triggers(rel, obj, variables, slides_by_id, layer_ids, objects_by_id, add, allowed or {})
        _navigation(rel, slide, obj, order or [], add)
        _icon(rel, obj, add, theme, slide_bg)
        _feedback_refs(rel, obj, layer_ids, add)
        _quiz(rel, obj, add)
        _interaction(rel, obj, add)
        _table(rel, obj, add)
        _input(rel, obj, variables, add, cast or {})
        _scenario(rel, obj, variables, cast or {}, chosen or set(), add)
        _embed(rel, obj, add)
        _image(rel, obj, add)
        _download(rel, obj, add)
        _timer(rel, obj, add)
        _shuffle_words(rel, obj, add)
        _description(rel, obj, add)
        _narration(rel, obj, add)
        _bubble(rel, obj, add)
        _value_text(rel, obj, variable_names or set(), add)


# Words that show a value while the course is played: a text holds {{Name}}, and the player puts the variable's value there (player/src/valuetext.ts reads them the same way).
VALUE_REFERENCE = re.compile(r"\{\{([^{}\n]{1,80})\}\}")
BUILT_IN_VALUES = ("$score", "$possible", "$percent", "$answered", "$questions", "$correct")


def _value_text(rel, obj, names, add):
    """Every {{Name}} in a text names a variable the course has, or one of the values the course works out itself (they start with a dollar sign). References are read in each
    stretch of words between tags, as the player reads them, so a tag in the middle of one breaks it."""
    if obj["type"] != "text":
        return
    seen = []
    for stretch in re.split(r"<[^>]*>", str(obj["content"].get("html", ""))):
        for m in VALUE_REFERENCE.finditer(htmllib.unescape(stretch)):
            name = m.group(1).strip()
            if not name or name in seen:
                continue
            seen.append(name)
            known = name in BUILT_IN_VALUES if name.startswith("$") else name.lower() in names
            if not known:
                what = ("The course works out only these: " + ", ".join(BUILT_IN_VALUES) + ".") if name.startswith("$") else "No variable has that name. Add it in Variables, or write the name as it is there."
                add(ERROR, rel, obj["id"], "value-text-unknown", "A text shows a value that does not exist", f"It says {{{{{name}}}}}. {what}")


BUBBLE_KINDS = ("speech", "thought")
BUBBLE_TAILS = ("left", "right")


def _bubble(rel, obj, add):
    """A speech or thought bubble is a `shape` whose form is one (an empty bubble) or a `text` with a `bubble` (a bubble with words in it). Its tail, if it names one, is on
    the left or the right. The player draws anything else as it would draw the plain version, so this is a mistake to correct rather than a broken course."""
    content = obj["content"]
    if obj["type"] == "text":
        kind = content.get("bubble")
        if "bubble" in content and kind not in BUBBLE_KINDS:
            add(ERROR, rel, obj["id"], "bubble-invalid", "A text bubble is neither a speech nor a thought bubble",
                f"Its bubble is {json.dumps(kind)}; it can be \"speech\" or \"thought\". Leave it out to have plain text.")
            return
        is_bubble = "bubble" in content
    elif obj["type"] == "shape":
        is_bubble = content.get("shape") in BUBBLE_KINDS
    else:
        return
    if is_bubble and "tail" in content and content["tail"] not in BUBBLE_TAILS:
        add(ERROR, rel, obj["id"], "bubble-invalid", "A bubble's tail is on neither side",
            f"Its tail is {json.dumps(content['tail'])}; it can be \"left\" or \"right\".")


def _alt_suggestion(rel, obj, add):
    """A suggested description (format 0.28.0) is only ever a suggestion: the course ignores it, and a missing alt text is still an error. Once the object has its own
    alt text, or is decorative, a suggestion that is still attached is left over, so it is reported to be tidied away."""
    a = obj.get("accessibility") or {}
    if a.get("altSuggestion") and (a.get("decorative") or (a.get("altText") or "").strip()):
        add(WARNING, rel, obj["id"], "alt-suggestion-unused",
            "A suggested description is still attached to an object that does not need one",
            "Remove the suggestion, or clear the alt text if you would rather use it.")


def _tab_order(rel, layer, add):
    by_value = {}
    for obj in layer["objects"]:
        t = obj["accessibility"]["tabOrder"]
        if isinstance(t, int) and t >= 1:
            by_value.setdefault(t, []).append(obj["id"])
    for value, ids in by_value.items():
        if len(ids) > 1:
            for oid in ids:
                add(ERROR, rel, oid, "tab-order-duplicate",
                    "Tab order must be unique within a layer",
                    f"Tab order {value} is used by {', '.join(ids)} on layer {layer['id']}.")
    values = sorted(by_value)
    if values and values != list(range(1, len(values) + 1)):
        add(TAB_GAP_SEVERITY, rel, layer["id"], "tab-order-gaps", "Tab order has gaps",
            f"Values on this layer are {values}; they should run 1 to {len(values)} with none missing.")


HOTSPOT_MIN = 24       # WCAG 2.2, 2.5.8 Target Size (Minimum): 24 by 24 CSS pixels
HOTSPOT_COMFORT = 35   # 24 CSS pixels once the stage is scaled down to 70 percent, the narrowest it is drawn before it reflows


def _hotspot(rel, obj, add):
    """A hotspot is a transparent button over a picture. It is named by its alt text, and it must be big enough to press."""
    if obj["type"] != "hotspot":
        return
    oid = obj["id"]
    if obj["accessibility"]["decorative"]:
        add(ERROR, rel, oid, "hotspot-decorative", "A hotspot cannot be decorative",
            "A hotspot can be pressed, so a screen reader user needs its name. Turn off decorative and write what it does.")
    if obj["content"]:
        add(WARNING, rel, oid, "hotspot-content", "A hotspot has no content of its own",
            "Anything in its content is ignored. The picture it sits over belongs in an image object.")
    g = obj["geometry"]
    smallest = min(g["width"], g["height"])
    if smallest < HOTSPOT_MIN:
        add(ERROR, rel, oid, "hotspot-too-small", "A hotspot is too small to press",
            f"It is {g['width']:g} by {g['height']:g}. WCAG 2.2 asks for at least {HOTSPOT_MIN} by {HOTSPOT_MIN} pixels.")
    elif smallest < HOTSPOT_COMFORT:
        add(WARNING, rel, oid, "hotspot-small", "A hotspot may be too small to press when the slide is drawn smaller",
            f"It is {g['width']:g} by {g['height']:g}. The slide is drawn at 70 percent of its size before it switches to one column, "
            f"so make the hotspot at least {HOTSPOT_COMFORT} pixels each way to stay above {HOTSPOT_MIN}.")


def _click_needs_key(rel, obj, add):
    if obj["type"] not in INTERACTIVE:
        return

    def sig(t):
        return (t["action"], t["target"], json.dumps(t.get("value"), sort_keys=True),
                json.dumps(t["conditions"], sort_keys=True), t.get("operation", "set"))

    key_sigs = {sig(t) for t in obj["triggers"] if t["event"] == "keyActivate"}
    for t in obj["triggers"]:
        if t["event"] == "click" and sig(t) not in key_sigs:
            add(ERROR, rel, obj["id"], "click-without-key", "Interactive objects must be operable by keyboard",
                f"Trigger {t['id']} responds to click but has no matching keyActivate trigger "
                f"(same action, target, value and conditions).")


READY_LOOKS = ("hover", "visited", "disabled")


def _look_stacks(states):
    """Every way the player can stack an object's looks, as (label, names, overrides). It paints the object's own style, then 'visited'
    once the object has been used, then the look a rule applied, then 'hover' while the pointer or the keyboard is on it, so
    a later look wins over an earlier one. `overrides` are the style properties those looks set, ready to lay over the object's own style."""
    named = [n for n in states if n not in ("hover", "visited")]
    out, seen = [], set()
    for visited in ([False, True] if "visited" in states else [False]):
        for look in [None] + named:
            for hover in ([False, True] if "hover" in states else [False]):
                stack = [n for n, on in (("visited", visited), (look, look is not None), ("hover", hover)) if on]
                if not stack:
                    continue
                overrides = {}
                for n in stack:
                    overrides.update(states[n].get("style", {}))
                key = json.dumps(overrides, sort_keys=True)
                if not overrides or key in seen:  # a look that changes nothing looks like the object itself, which is checked already
                    continue
                seen.add(key)
                quoted = [f"'{n}'" for n in stack]
                label = f" in state {quoted[0]}" if len(quoted) == 1 else f" in the states {', '.join(quoted[:-1])} and {quoted[-1]} together"
                out.append((label, stack, overrides))
    return out


def _variants(obj):
    """The object as it can look: its own style first, then each stack of looks laid over it."""
    return [("", [], obj["style"])] + [(label, names, {**obj["style"], **over}) for label, names, over in _look_stacks(obj["states"])]


def _solidness(style, names):
    """How solid the object is painted, 0 to 1. A disabled object is left out: WCAG does not ask a control that cannot be used for contrast."""
    value = style.get("opacity")
    if "disabled" in names or isinstance(value, bool) or not isinstance(value, (int, float)):
        return 1.0
    return min(1.0, max(0.0, float(value)))


def _mix(top, back, solidness):
    """A colour painted at this solidness over another colour."""
    return tuple(t * solidness + b * (1 - solidness) for t, b in zip(top, back))


def _contrast(rel, obj, add, theme, slide_bg):
    """Text against what is behind it: the object's own fill if it has one, otherwise the slide
    background. A theme colour counts as the colour it stands for. Text with no colour of its own
    uses the theme's text colour, and a button with none uses the theme's button colours. This is checked for the object's own look
    and for each look it can take, and a look that makes the object see-through counts: fading text fades what is behind it too."""
    if obj["type"] not in ("text", "button", "quizQuestion"):
        return
    is_button = obj["type"] == "button"
    # A part of a text can have a colour of its own (a span with style color:#rrggbb): each is held to the same contrast as the text's.
    part_colours = []
    if obj["type"] == "text":
        part_colours = sorted(set(m.lower() for m in re.findall(r'<span[^>]*\bstyle="[^"]*?\bcolor:\s*(#[0-9a-fA-F]{6})', str(obj["content"].get("html", "")))))
    for label, names, style in _variants(obj):
        colour = style.get("color")
        own_fill = style.get("fill", style.get("background"))
        fg = resolve_color(theme, colour) if colour is not None else theme["colors"]["onAccentStrong" if is_button else "text"]
        _contrast_of_parts(rel, obj, add, theme, slide_bg, label, names, style, part_colours, own_fill)
        if own_fill is not None:
            bgs = [resolve_color(theme, own_fill)]
        elif is_button:
            bgs = [theme["colors"]["accentStrong"]]
        else:
            bgs = slide_bg
        if fg is None or any(b is None for b in bgs):
            continue  # a colour that is neither hex nor a theme colour; reported as an unknown theme value
        need = 3.0 if _is_large_text(style) else 4.5
        solid = _solidness(style, names)
        if solid < 1.0 and all(_hex_rgb(b) is not None for b in slide_bg):
            # Painted at this solidness over the slide: both the text and its own fill fade into what is behind.
            has_fill = own_fill is not None or is_button
            ratio = min(
                contrast_ratio(_mix(_hex_rgb(fg), _hex_rgb(back), solid), _mix(_hex_rgb(bgs[0]), _hex_rgb(back), solid) if has_fill else _hex_rgb(back))
                for back in slide_bg)
            how = f" at {round(solid * 100)}% solid"
        else:
            ratio = min(contrast_ratio(_hex_rgb(fg), _hex_rgb(b)) for b in bgs)
            how = ""
        if ratio < need:
            add(ERROR, rel, obj["id"], "contrast", "Contrast too low",
                f"{fg} on {' to '.join(bgs)}{how}{label} is {ratio:.2f}:1; WCAG 2.2 AA needs {need}:1.")


def _contrast_of_parts(rel, obj, add, theme, slide_bg, label, names, style, part_colours, own_fill):
    """The colours of parts of a text, against the same background and with the same size rule as the whole text."""
    if not part_colours:
        return
    bgs = [resolve_color(theme, own_fill)] if own_fill is not None else slide_bg
    if any(b is None for b in bgs):
        return
    need = 3.0 if _is_large_text(style) else 4.5
    solid = _solidness(style, names)
    for colour in part_colours:
        if solid < 1.0 and all(_hex_rgb(b) is not None for b in slide_bg):
            ratio = min(contrast_ratio(_mix(_hex_rgb(colour), _hex_rgb(back), solid), _hex_rgb(back)) for back in slide_bg)
        else:
            ratio = min(contrast_ratio(_hex_rgb(colour), _hex_rgb(b)) for b in bgs)
        if ratio < need:
            add(ERROR, rel, obj["id"], "contrast", "Contrast too low",
                f"Part of the text, {colour} on {' to '.join(bgs)}{label}, is {ratio:.2f}:1; WCAG 2.2 AA needs {need}:1.")


def _states(rel, obj, add):
    """A look is another way the object can appear. 'normal' is the object's own appearance, so it cannot also be a look."""
    if "normal" in obj["states"]:
        add(ERROR, rel, obj["id"], "state-name-normal", "A look cannot be named normal",
            "Normal is the object's own appearance, which a rule can return to. A look with that name would never be used. Give it another name.")


def _navigation(rel, slide, obj, order, add):
    """A button that goes to the next slide on the last one, or to the previous slide on the first, goes nowhere."""
    if slide["id"] not in order:
        return
    first, last = order[0] == slide["id"], order[-1] == slide["id"]
    reported = set()
    for t in obj["triggers"]:
        key = t["action"]
        if key in reported:
            continue
        if t["action"] == "nextSlide" and last:
            reported.add(key)
            add(WARNING, rel, obj["id"], "trigger-next-last", "Next goes nowhere on the last slide",
                f"Trigger {t['id']} goes to the next slide, but this is the last slide of the course.")
        elif t["action"] == "previousSlide" and first:
            reported.add(key)
            add(WARNING, rel, obj["id"], "trigger-previous-first", "Back goes nowhere on the first slide",
                f"Trigger {t['id']} goes to the previous slide, but this is the first slide of the course.")


def _icon(rel, obj, add, theme, slide_bg):
    """An icon is a picture: it needs to be seen against what is behind it (WCAG 2.2, 1.4.11, 3 to 1), unless it is only decoration.
    That holds for each look it can take too, and for a look that makes it see-through."""
    if obj["type"] != "icon" or obj["accessibility"]["decorative"]:
        return
    if any(_hex_rgb(b) is None for b in slide_bg):
        return
    for label, names, style in _variants(obj):
        colour = style.get("color")
        fg = resolve_color(theme, colour) if colour is not None else theme["colors"]["text"]
        if fg is None:
            continue
        solid = _solidness(style, names)
        how = f" at {round(solid * 100)}% solid" if solid < 1.0 else ""
        ratio = min(contrast_ratio(_mix(_hex_rgb(fg), _hex_rgb(b), solid), _hex_rgb(b)) for b in slide_bg)
        if ratio < 3.0:
            add(WARNING, rel, obj["id"], "icon-contrast", "An icon is hard to see",
                f"{fg} on {' to '.join(slide_bg)}{how}{label} is {ratio:.2f}:1; WCAG 2.2 AA (1.4.11) asks for 3:1 for a picture that carries meaning. Choose a stronger colour, or mark the icon decorative.")


def _icon_credit(project, slides, add):
    """The icons come from an open set whose licence asks for its notice to travel with them. The credits page carries it."""
    if project["credits"]:
        return
    for rel, slide in slides.items():
        for _, obj in _objects(slide):
            if obj["type"] == "icon" or (obj["type"] == "button" and obj["content"].get("icon")):
                add(WARNING, rel, obj["id"], "icon-credit-page-off", "This course uses icons, but the credits page is off",
                    "The icons are from Lucide (ISC licence), which asks for its copyright notice and licence to be kept with them. "
                    "Switch the credits page on, which carries the notice, or carry it another way.")
                return


def _voice_credit(project, slides, add):
    """A voice made by an AI service is credited on the credits page, which is where the course tells listeners. If the page is off, nobody is told."""
    if project["credits"]:
        return
    told = set()
    for rel, slide in slides.items():
        for _, obj in _objects(slide):
            for n, _owner in narrations_of(obj):
                engine = n["voice"].partition(":")[0] if ":" in n["voice"] else ""
                if engine in SERVICE_VOICES and engine not in told:
                    told.add(engine)
                    add(WARNING, rel, obj["id"], "voice-credit-page-off", f"This course has {SERVICE_VOICES[engine]} voices, but the credits page is off",
                        f"{SERVICE_VOICES[engine]}'s rules ask that listeners are told a voice is made by an AI service. The credits page says so. Switch it on, or tell listeners another way.")


def _value_type(v):
    """The variable type a JSON value belongs to. A true or false is not a number."""
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"
    return "string"


def _triggers(rel, obj, variables, slides_by_id, layer_ids, objects_by_id, add, allowed):
    # A click and its matching key press are one rule to the author, so a problem with the rule is reported once.
    reported = set()
    raw_add = add

    def add(sev, rel_, oid, rule, message, detail=""):  # noqa: F811
        key = (rule, message, re.sub(r"^Trigger \S+: ", "", detail))
        if key in reported:
            return
        reported.add(key)
        raw_add(sev, rel_, oid, rule, message, detail)

    for t in obj["triggers"]:
        action, target = t["action"], t["target"]
        if action == "jumpToSlide":
            ok = target in slides_by_id
        elif action in ("showLayer", "hideLayer"):
            ok = target in layer_ids
        elif action == "setVariable":
            ok = target in variables
        elif action in COURSE_ACTIONS:
            ok = target == ""
        elif action == "stopTimer":
            ok = target in objects_by_id
            if ok and objects_by_id[target]["type"] != "timer":
                add(ERROR, rel, obj["id"], "stop-timer-target", "Stop the timer needs a timer",
                    f"Trigger {t['id']}: '{target}' is a {objects_by_id[target]['type']} object, not a timer.")
        else:  # playMedia, pauseMedia, changeState
            ok = target in objects_by_id
        if not ok:
            add(ERROR, rel, obj["id"], "trigger-target-missing", "Trigger points at something missing",
                f"Trigger {t['id']}: action {action} targets '{target}', which does not exist.")
        elif action == "changeState":
            _change_state(rel, obj, t, objects_by_id[target], add)
        for c in t["conditions"]:
            if c["variable"] not in variables:
                add(ERROR, rel, obj["id"], "condition-unknown-variable", "Condition uses an unknown variable",
                    f"Trigger {t['id']}: condition uses '{c['variable']}', which is not defined in project.json.")
            else:
                want = variables[c["variable"]]
                if _value_type(c["value"]) != want:
                    add(ERROR, rel, obj["id"], "condition-value-type", "Condition compares a variable with the wrong kind of value",
                        f"Trigger {t['id']}: '{c['variable']}' is a {want}, but the value {json.dumps(c['value'])} is a {_value_type(c['value'])}.")
                elif c["operator"] == "equals" and c["variable"] in allowed and c["value"] not in allowed[c["variable"]]:
                    add(WARNING, rel, obj["id"], "condition-never-true", "This condition can never be true",
                        f"Trigger {t['id']}: no answer to an input saves {json.dumps(c['value'])} in '{c['variable']}'. Choose one of the input's own answers.")
                elif want != "number" and c["operator"] not in ("equals", "notEquals"):
                    add(WARNING, rel, obj["id"], "condition-operator", "Condition puts text or true and false in order",
                        f"Trigger {t['id']}: '{c['operator']}' only makes sense for numbers; '{c['variable']}' is a {want}.")
        if t.get("operation") == "add" and action != "setVariable":
            add(ERROR, rel, obj["id"], "trigger-operation-action", "Only setting a variable can add",
                f"Trigger {t['id']}: 'add' is for setVariable, but this rule's action is {action}.")
        if action == "setVariable" and target in variables:
            want = variables[target]
            if t.get("operation") == "add":
                if want != "number":
                    add(ERROR, rel, obj["id"], "trigger-operation-type", "Adding needs a number variable",
                        f"Trigger {t['id']}: '{target}' is a {want}, so a number cannot be added to it.")
                elif "value" in t and _value_type(t["value"]) != "number":
                    add(ERROR, rel, obj["id"], "trigger-value-type", "Adding something that is not a number",
                        f"Trigger {t['id']}: the value {json.dumps(t['value'])} is a {_value_type(t['value'])}, and only a number can be added.")
            elif "value" not in t:
                if want != "boolean":
                    add(ERROR, rel, obj["id"], "trigger-value-type", "Setting a variable needs a value",
                        f"Trigger {t['id']}: with no value a variable is set to true, but '{target}' is a {want}.")
            elif _value_type(t["value"]) != want:
                add(ERROR, rel, obj["id"], "trigger-value-type", "Setting a variable to the wrong kind of value",
                    f"Trigger {t['id']}: '{target}' is a {want}, but the value {json.dumps(t['value'])} is a {_value_type(t['value'])}.")
        event, kind = t["event"], obj["type"]
        if (event in ("click", "keyActivate") and kind not in ("button", "hotspot", "quizQuestion")) or (event == "mediaComplete" and kind not in ("video", "audio")) or (event == "timerEnd" and kind != "timer"):
            add(WARNING, rel, obj["id"], "trigger-event-never", "This rule's event never happens on this kind of object",
                f"Trigger {t['id']}: a {kind} object cannot cause '{event}'. Move the rule to an object that can, or use a different event.")


def _change_state(rel, obj, t, target, add):
    """A rule that applies a look: the object has to have it, and a screen reader user is told about it, because a change that is only
    seen is a change they miss. 'normal' is the object's own appearance, and a disabled control already says so to assistive technology."""
    value = t.get("value", "normal")
    if not isinstance(value, str):
        add(ERROR, rel, obj["id"], "trigger-value-type", "A look is named by text",
            f"Trigger {t['id']}: the value {json.dumps(value)} is a {_value_type(value)}, but the name of a look is text.")
        return
    looks = target["states"]
    if value != "normal" and value not in looks:
        add(ERROR, rel, obj["id"], "trigger-state-missing", "A rule applies a look the object does not have",
            f"Trigger {t['id']}: the rule applies the look '{value}' to '{target['id']}', which has no look with that name. "
            f"Add the look to that object, or choose one it has, or normal.")
    elif value not in ("normal", "disabled") and not looks[value].get("announce") and not target["accessibility"]["decorative"]:
        add(WARNING, rel, obj["id"], "state-silent", "A screen reader user is not told about this change",
            f"Trigger {t['id']}: the look '{value}' of '{target['id']}' has no spoken message, so only a learner who can see it knows it was applied. "
            f"Write what a screen reader should say in the look's Spoken message box.")


BLANK_MARKER = re.compile(r"\{([A-Za-z0-9_-]+)\}")


def _tidy(text):
    return " ".join(text.split())


def _quiz(rel, obj, add):
    """A question of any kind: its parts must make sense, so that it has a right answer a learner can give."""
    if obj["type"] != "quizQuestion":
        return
    c = obj["content"]
    kind = c["questionType"]
    oid = obj["id"]

    def duplicates(values):
        return sorted({v for v in values if values.count(v) > 1})

    if kind in ("multipleChoice", "multipleResponse"):
        choices = c["choices"]
        ids = [x["id"] for x in choices]
        for dup in duplicates(ids):
            add(ERROR, rel, oid, "quiz-duplicate-choice", "Quiz answers must have different ids",
                f"More than one answer has the id '{dup}'.")
        correct = sum(1 for x in choices if x["correct"])
        if kind == "multipleChoice" and correct != 1:
            add(ERROR, rel, oid, "quiz-correct-answer", "Quiz needs exactly one correct answer",
                f"This question has {correct} answers marked correct.")
        if kind == "multipleResponse":
            if correct == 0:
                add(ERROR, rel, oid, "quiz-correct-answer", "Quiz needs at least one correct answer",
                    "No answer in this question is marked correct.")
            elif correct == len(choices):
                add(WARNING, rel, oid, "quiz-all-correct", "Every answer in this question is marked correct",
                    "A learner could tick everything and be right, so the question tests nothing.")
    elif kind == "shortAnswer":
        if any(not a.strip() for a in c["answers"]):
            add(ERROR, rel, oid, "quiz-empty-answer", "An accepted answer is empty", "Every accepted answer needs some text.")
    elif kind == "numeric":
        if c["min"] > c["max"]:
            add(ERROR, rel, oid, "quiz-numeric-range", "The lowest accepted number is above the highest",
                f"The accepted range runs from {c['min']} to {c['max']}, which no number is in.")
    elif kind == "fillBlanks":
        blank_ids = [b["id"] for b in c["blanks"]]
        for dup in duplicates(blank_ids):
            add(ERROR, rel, oid, "quiz-duplicate-blank", "Blanks must have different ids", f"More than one blank has the id '{dup}'.")
        markers = BLANK_MARKER.findall(c["text"])
        for m in sorted(set(markers) - set(blank_ids)):
            add(ERROR, rel, oid, "quiz-blank-missing", "The sentence has a blank with no answer",
                f"The text has a blank {{{m}}} but no answer is set for it.")
        for b in sorted(set(blank_ids) - set(markers)):
            add(ERROR, rel, oid, "quiz-blank-unused", "A blank is not in the sentence",
                f"Blank '{b}' has answers but {{{b}}} is not in the text.")
        for b in c["blanks"]:
            if any(not a.strip() for a in b["answers"]):
                add(ERROR, rel, oid, "quiz-empty-answer", "An accepted answer is empty", f"Blank '{b['id']}' has an empty answer.")
        if c["mode"] != "typed":
            bank = [_tidy(w) for w in c["wordBank"]]
            lowered = [w.lower() for w in bank]
            for dup in duplicates(lowered):
                add(ERROR, rel, oid, "quiz-word-bank-duplicate", "The word bank repeats a word", f"The word '{dup}' is in the word bank more than once.")
            for b in c["blanks"]:
                if b["answers"] and _tidy(b["answers"][0]) not in bank:
                    add(ERROR, rel, oid, "quiz-word-bank", "A right answer is not in the word bank",
                        f"Blank '{b['id']}' is right with '{b['answers'][0]}', which a learner cannot choose because it is not in the word bank.")
    elif kind == "matching":
        for dup in duplicates([p["id"] for p in c["pairs"]]):
            add(ERROR, rel, oid, "quiz-duplicate-pair", "Pairs must have different ids", f"More than one pair has the id '{dup}'.")
        options = [_tidy(p["match"]).lower() for p in c["pairs"]] + [_tidy(e).lower() for e in c["extras"]]
        for dup in duplicates(options):
            add(ERROR, rel, oid, "quiz-match-duplicate", "Two matches read the same",
                f"'{dup}' is offered more than once, so a learner could not tell which is meant.")
    elif kind == "sequencing":
        for dup in duplicates([i["id"] for i in c["items"]]):
            add(ERROR, rel, oid, "quiz-duplicate-item", "Items must have different ids", f"More than one item has the id '{dup}'.")
        for dup in duplicates([_tidy(i["text"]).lower() for i in c["items"]]):
            add(WARNING, rel, oid, "quiz-item-duplicate", "Two items read the same",
                f"'{dup}' appears more than once, so a learner cannot tell which place is which.")
    elif kind == "hotspot":
        if not c["image"]["alt"].strip():
            add(ERROR, rel, oid, "quiz-hotspot-alt", "The picture needs alt text", "A learner who cannot see the picture needs to know what it shows.")
        for dup in duplicates([r["id"] for r in c["regions"]]):
            add(ERROR, rel, oid, "quiz-duplicate-region", "Areas must have different ids", f"More than one area has the id '{dup}'.")
        if not any(r["correct"] for r in c["regions"]):
            add(ERROR, rel, oid, "quiz-correct-answer", "Quiz needs at least one correct area", "No area is marked correct.")
        for r in c["regions"]:
            if not r["label"].strip():
                add(ERROR, rel, oid, "quiz-region-label", "An area needs a label", f"Area '{r['id']}' has no label, so it cannot be chosen from the list.")
            if r["x"] + r["width"] > 100.0001 or r["y"] + r["height"] > 100.0001:
                add(ERROR, rel, oid, "quiz-region-bounds", "An area runs off the picture", f"Area '{r['label'] or r['id']}' is not wholly inside the picture.")
        for dup in duplicates([_tidy(r["label"]).lower() for r in c["regions"]]):
            add(WARNING, rel, oid, "quiz-region-duplicate", "Two areas have the same label", f"'{dup}' labels more than one area, so the list cannot tell them apart.")


def _interaction(rel, obj, add):
    if obj["type"] != "interaction":
        return
    items = obj["content"]["items"]
    ids = [i["id"] for i in items]
    low, high = ITEM_LIMITS.get(obj["content"]["kind"], (1, 50))
    if not low <= len(items) <= high:
        add(ERROR, rel, obj["id"], "interaction-item-count", "Interaction has the wrong number of items for its kind",
            f"A {obj['content']['kind']} needs {low} to {high} items; this one has {len(items)}.")
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        add(ERROR, rel, obj["id"], "interaction-duplicate-item", "Interaction items must have different ids",
            f"More than one item has the id '{dup}'.")
    for item in items:
        image = item["image"]
        if not image:
            continue
        if image["decorative"] and image["alt"].strip():
            add(ERROR, rel, obj["id"], "interaction-image-alt", "Decorative images must have no alt text",
                f"The image on item '{item['title']}' is marked decorative but has alt text.")
        elif not image["decorative"] and not image["alt"].strip():
            add(ERROR, rel, obj["id"], "interaction-image-alt", "Interaction image needs alt text, or must be marked decorative",
                f"The image on item '{item['title']}' has no alt text.")


def _table(rel, obj, add):
    if obj["type"] != "table":
        return
    t = obj["content"]
    widths = {len(r) for r in t["rows"]}
    if len(widths) > 1:
        add(ERROR, rel, obj["id"], "table-not-rectangular", "Every row of a table needs the same number of cells",
            f"The rows have {', '.join(str(w) for w in sorted(widths))} cells.")
    if not t["headerRow"] and not t["headerColumn"]:
        add(ERROR, rel, obj["id"], "table-needs-header", "A table needs a header row or a header column",
            "Without headers a screen reader cannot say which column or row a cell belongs to.")
    headers = []
    if t["headerRow"]:
        headers += t["rows"][0]
    if t["headerColumn"]:
        headers += [r[0] for r in t["rows"] if r]
    if any(not h.strip() for h in headers):
        add(WARNING, rel, obj["id"], "table-empty-header", "A header cell is empty",
            "A screen reader has nothing to say for an empty header, so give each header some text.")


def _input(rel, obj, variables, add, cast=None):
    if obj["type"] != "input":
        return
    c = obj["content"]
    kind = c["kind"]
    oid = obj["id"]
    parts = c.get("items") or c.get("rows") or c.get("options") or []
    if kind == "character":
        people = c["characters"]
        for dup in sorted({i for i in people if people.count(i) > 1}):
            add(ERROR, rel, oid, "input-duplicate-id", "Input parts must have different ids", f"The person '{dup}' is listed more than once.")
        for person in dict.fromkeys(people):
            if person == YOU or person not in (cast or {}):
                add(ERROR, rel, oid, "input-character-unknown", "A choice of character names someone who is not in the cast",
                    f"'{person}' is not in the project's cast. Add them in the Characters dialog, or take them out of this input.")
    ids = [p["id"] for p in parts]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        add(ERROR, rel, oid, "input-duplicate-id", "Input parts must have different ids", f"More than one part has the id '{dup}'.")

    refs = [c["variable"]] if kind in ("radio", "dropdown", "list", "character", "slider", "dial") else [p["variable"] for p in parts]
    want = INPUT_VARIABLE_TYPE[kind]
    for ref in refs:
        if ref not in variables:
            add(ERROR, rel, oid, "input-unknown-variable", "Input saves to a variable that does not exist",
                f"'{ref}' is not defined in project.json.")
        elif variables[ref] != want:
            add(ERROR, rel, oid, "input-variable-type", "Input saves to a variable of the wrong type",
                f"A {kind} input saves a {want}, but '{ref}' is a {variables[ref]}.")
    if kind in ("checkbox", "likert", "semantic"):
        for dup in sorted({r for r in refs if refs.count(r) > 1}):
            add(ERROR, rel, oid, "input-shared-variable", "Two parts of an input save to the same variable",
                f"'{dup}' would be overwritten by whichever part was changed last.")
    if kind in ("radio", "dropdown", "list"):
        values = [o["value"] for o in c["options"]]
        if any(v == "" for v in values):
            add(ERROR, rel, oid, "input-empty-value", "An option's saved value cannot be empty",
                "An empty value means \"nothing chosen\", so no option can use it.")
        for dup in sorted({v for v in values if v and values.count(v) > 1}):
            add(ERROR, rel, oid, "input-duplicate-value", "Two options save the same value", f"More than one option saves '{dup}'.")
    if kind == "semantic":
        for row in c["rows"]:
            if not row.get("right", "").strip():
                add(ERROR, rel, oid, "input-semantic-pole", "Both ends of a scale row need a word",
                    f"The row '{row['label']}' has no word for its right-hand end.")
    if kind in ("slider", "dial"):
        lowest, highest, step = c["min"], c["max"], c["step"]
        if not lowest < highest:
            add(ERROR, rel, oid, "input-slider-range", "The highest value of a slider or dial must be above the lowest",
                f"The lowest is {lowest} and the highest is {highest}, so there is nothing to choose between.")
        else:
            # The value is kept as a number with no more than 3 decimals, so what an LMS is told is exact, and there must not be so many steps that the keys cannot get anywhere.
            decimals = max(0, -decimal.Decimal(str(step)).normalize().as_tuple().exponent)
            if decimals > 3:
                add(ERROR, rel, oid, "input-slider-step", "The step of a slider or dial has too many decimals",
                    f"The step is {step}. Use a step with no more than 3 decimals, such as 0.001.")
            elif (highest - lowest) / step > 10000:
                add(ERROR, rel, oid, "input-slider-step", "A slider or dial has too many steps",
                    f"From {lowest} to {highest} in steps of {step} is more than 10000 steps. Use a larger step.")


_YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_VIMEO_ID = re.compile(r"^[0-9]{1,12}$")
_VIMEO_HASH = re.compile(r"^[A-Za-z0-9]{0,32}$")


def _image(rel, obj, add):
    """A picture with an Enlarge button (content.enlargeable, added in 0.43.0). The button is named after the picture's alt text, so a decorative picture, which says nothing, cannot have one."""
    if obj["type"] != "image" or not obj["content"].get("enlargeable"):
        return
    if obj["accessibility"].get("decorative"):
        add(ERROR, rel, obj["id"], "image-enlarge-decorative", "A decorative picture cannot have an Enlarge button",
            "The button is named after the picture's alt text, and a decorative picture has none. Describe the picture and mark it as not decorative, or turn Enlarge off.")


def _embed(rel, obj, add):
    if obj["type"] != "embed":
        return
    c = obj["content"]
    oid = obj["id"]
    ok = bool(_YOUTUBE_ID.match(c["id"])) if c["provider"] == "youtube" else bool(_VIMEO_ID.match(c["id"]) and _VIMEO_HASH.match(c["hash"]))
    if not ok:
        add(ERROR, rel, oid, "embed-id-invalid", "The video address is not a valid " + ("YouTube" if c["provider"] == "youtube" else "Vimeo") + " video",
            f"'{c['id']}' is not the form of a {c['provider']} video id.")
    if not c["captionsConfirmed"]:
        add(ERROR, rel, oid, "embed-captions-unconfirmed", "Confirm that the embedded video has captions",
            "OpenStage cannot see inside YouTube or Vimeo. Check that the video has accurate captions, then confirm it in the object's properties.")
    if not re.sub(r"<[^>]*>", "", c["transcript"]).strip():
        add(ERROR, rel, oid, "embed-transcript-missing", "An embedded video needs a transcript",
            "The transcript is shown under the video for anyone who cannot watch or hear it.")
    add(WARNING, rel, oid, "embed-needs-internet", "An embedded video needs an internet connection",
        "The learner's browser must be online, and the LMS must allow embedded YouTube or Vimeo players.")


# The kinds of file a course can offer for download: tools/download-types.json, shared with the editor and the player.
DOWNLOAD_TYPES = {t["ext"]: t["label"] for t in json.loads((ROOT / "tools" / "download-types.json").read_text(encoding="utf-8"))["types"]}


def _timer(rel, obj, add):
    """A countdown. Its numbers are checked by the schema. What the validator adds is that running out should lead somewhere, and that the
    timer is not itself something that vanishes, because a learner who needs more time must be able to find the way to add it or turn it off."""
    if obj["type"] != "timer":
        return
    if not any(t["event"] == "timerEnd" for t in obj["triggers"]):
        add(WARNING, rel, obj["id"], "timer-no-end-rule", "Nothing happens when this timer runs out",
            "A timer is only a clock until a rule answers 'the time runs out'. Add a rule to the timer that shows a layer, goes to a slide or changes a variable.")


def _download(rel, obj, add):
    if obj["type"] != "download":
        return
    c = obj["content"]
    oid = obj["id"]
    if not c["title"].strip():
        add(ERROR, rel, oid, "download-title-missing", "A file to download needs a name",
            "The name is what the learner sees on the link, such as \"Course handbook\".")
    if not c["description"].strip():
        add(ERROR, rel, oid, "download-description-missing", "A file to download needs a description",
            "The description tells learners what the file is before they download it. Say what is in it and why they might want it.")
    if not c["accessibleConfirmed"]:
        add(ERROR, rel, oid, "download-unconfirmed", "Confirm that this file is accessible",
            "OpenStage cannot see inside a document. Check that it can be read with a screen reader (a tagged PDF, or a Word file with real headings and picture descriptions), then confirm it in the object's properties.")
    ext = c["src"].rsplit(".", 1)[-1].lower() if "." in c["src"].rsplit("/", 1)[-1] else ""
    if ext not in DOWNLOAD_TYPES:
        add(ERROR, rel, oid, "download-file-type", "This kind of file cannot be offered for download",
            f"'{c['src']}' is not one of: {', '.join(sorted(DOWNLOAD_TYPES))}.")


def _credits(project, assets_data, slides, asset_root, add):
    """The record of where assets came from. Entries are checked against the files and against the project's own setting."""
    entries = assets_data["assets"]
    # A file is used if a slide names it, or a person in the cast has it as their picture (no slide names that).
    used = json.dumps(slides) + json.dumps(project.get("characters") or [])
    seen = set()
    for e in entries:
        rel = "assets.json"
        if e["path"] in seen:
            add(ERROR, rel, e["path"], "credit-duplicate", "An asset is listed twice", f"{e['path']} appears more than once.")
        seen.add(e["path"])
        target = (asset_root / e["path"]).resolve()
        if asset_root.resolve() not in target.parents or not target.is_file():
            add(WARNING, rel, e["path"], "credit-asset-missing", "A credited asset is not in the project", f"{e['path']} does not exist.")
        s = e["source"]
        if s["requiresCredit"] and not (s["creator"].strip() and s["url"].strip() and s["licence"].strip()):
            add(ERROR, rel, e["path"], "credit-incomplete", "Credit is required but incomplete",
                f"{e['path']} needs the creator, the source link and the licence.")
        if s["requiresCredit"] and not project["credits"] and e["path"] in used:
            add(WARNING, rel, e["path"], "credit-page-off", "This project uses an asset that needs credit, but the credits page is off",
                f"{e['path']} requires credit. Switch the credits page on, or credit the creator another way.")


def _feedback_refs(rel, obj, layer_ids, add):
    refs = []
    if obj["type"] == "quizQuestion":
        refs += list(obj["content"]["feedback"].values())
    if obj["simulation"]:
        refs += list(obj["simulation"]["feedback"].values())
    for ref in refs:
        if ref not in layer_ids:
            add(ERROR, rel, obj["id"], "trigger-target-missing", "Trigger points at something missing",
                f"Feedback layer '{ref}' does not exist on this slide.")


def narrations_of(obj):
    """Every narration an object holds: its own, then one for each item of an interaction that has one, and one for each audio
    description of a video that has one. Yields (narration, what it belongs to), where the second part is "" for the object itself."""
    if obj["narration"]:
        yield obj["narration"], ""
    if obj["type"] == "interaction":
        for item in obj["content"]["items"]:
            if item.get("narration"):
                yield item["narration"], f" (item '{item['title']}')"
    if obj["type"] == "video":
        for cue in ((obj["content"].get("description") or {}).get("cues") or []):
            if cue.get("narration"):
                yield cue["narration"], f" (audio description at {_clock(cue['time'])})"
    if obj["type"] == "scenario":
        for _, line, where in scenario_lines(obj["content"]):
            if line.get("narration"):
                yield line["narration"], f" ({where})"


def _clock(ms):
    """A time in a video as people write it: 1:05."""
    seconds = int(ms // 1000)
    return f"{seconds // 60}:{seconds % 60:02d}"


def _description(rel, obj, add):
    """An audio description is a list of cues on a video: at this time, say this. Each should be spoken as well as written."""
    description = obj["content"].get("description") if isinstance(obj.get("content"), dict) else None
    oid = obj["id"]
    if obj["type"] == "audio" and description is not None:
        add(ERROR, rel, oid, "description-on-audio", "An audio clip cannot have an audio description",
            "An audio description says what a picture shows, and a sound clip has no picture. Put it on a video.")
        return
    if obj["type"] != "video" or description is None:
        return
    seen = set()
    for cue in description["cues"]:
        at = _clock(cue["time"])
        if cue["id"] in seen:
            add(ERROR, rel, oid, "description-duplicate-id", "Two descriptions have the same id",
                f"The description at {at} shares its id '{cue['id']}' with another on this video.")
        seen.add(cue["id"])
        if not cue["text"].strip():
            add(ERROR, rel, oid, "description-text-missing", "A description has no words",
                f"The description at {at} needs words that say what the picture shows at that moment.")
        if not cue["narration"]:
            add(WARNING, rel, oid, "description-not-voiced", "A description is not spoken",
                f"The description at {at} can only be read. WCAG 2.2 (1.2.5, level AA) asks for audio description that is heard with the video, "
                "so use the description as the voice, then make the audio.")


def scenario_lines(content):
    """Every line of a scenario, in the order a learner meets them: for each situation its lines, then the response to each of
    its choices. Yields (situation, line, where) where `where` says in words which one it is."""
    for node in content["nodes"]:
        for line in node["lines"]:
            yield node, line, f"line '{_brief(line['text'])}' in '{node['title']}'"
        for choice in node["choices"]:
            for line in choice["response"]:
                yield node, line, f"response '{_brief(line['text'])}' to '{choice['label']}' in '{node['title']}'"


def _brief(text, limit=30):
    """The start of some text, to point at it in a message."""
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "..."


def _scenario(rel, obj, variables, cast, chosen, add):
    """A scenario is a map of situations. It has to start somewhere that exists, every choice has to lead somewhere that exists,
    and a learner has to be able to get to an end. Everyone it names (speakers, variables) has to exist."""
    if obj["type"] != "scenario":
        return
    c = obj["content"]
    oid = obj["id"]
    nodes = {n["id"]: n for n in c["nodes"]}

    # one set of ids, because the path a learner took is remembered by them and audio is filed under them
    seen = {}
    for node in c["nodes"]:
        seen.setdefault(node["id"], []).append("situation")
        for line in node["lines"]:
            seen.setdefault(line["id"], []).append("line")
        for choice in node["choices"]:
            seen.setdefault(choice["id"], []).append("choice")
            for line in choice["response"]:
                seen.setdefault(line["id"], []).append("line")
    for meter in c["meters"]:
        seen.setdefault(meter["id"], []).append("meter")
    for dup, kinds in sorted(seen.items()):
        if len(kinds) > 1:
            add(ERROR, rel, oid, "scenario-duplicate-id", "Two parts of a scenario have the same id",
                f"'{dup}' is used {len(kinds)} times in this scenario ({', '.join(kinds)}). Every situation, choice, line and meter needs its own.")

    if c["start"] not in nodes:
        add(ERROR, rel, oid, "scenario-start-missing", "A scenario has to start in a situation that exists",
            f"The start, '{c['start']}', is not one of this scenario's situations.")

    for node in c["nodes"]:
        labels = []
        for choice in node["choices"]:
            if choice["next"] not in nodes:
                add(ERROR, rel, oid, "scenario-next-missing", "A choice leads to a situation that does not exist",
                    f"The choice '{_brief(choice['label'])}' in '{node['title']}' leads to '{choice['next']}'.")
            if not choice["label"].strip():
                add(ERROR, rel, oid, "scenario-choice-empty", "A choice has no words",
                    f"A choice in '{node['title']}' needs words that say what the learner does.")
            else:
                labels.append(" ".join(choice["label"].split()).lower())
            for effect in choice["effects"]:
                kind = variables.get(effect["variable"])
                if kind is None:
                    add(ERROR, rel, oid, "scenario-effect-variable", "A choice changes a variable that does not exist",
                        f"The choice '{_brief(choice['label'])}' adds to '{effect['variable']}', which is not defined in project.json.")
                elif kind != "number":
                    add(ERROR, rel, oid, "scenario-effect-variable", "A choice can only add to a number variable",
                        f"The choice '{_brief(choice['label'])}' adds to '{effect['variable']}', which is a {kind}.")
        for dup in sorted({x for x in labels if labels.count(x) > 1}):
            add(WARNING, rel, oid, "scenario-choice-duplicate", "Two choices say the same thing",
                f"In '{node['title']}' more than one choice reads \"{dup}\". A learner using a screen reader cannot tell them apart.")

    for node, line, where in scenario_lines(c):
        if not line["text"].strip():
            add(ERROR, rel, oid, "scenario-line-empty", "A line has no words", f"The {where} has no text.")
        speaker = line["speaker"]
        if speaker is not None and speaker != YOU and speaker not in cast:
            add(ERROR, rel, oid, "scenario-speaker-unknown", "A line is spoken by someone who is not in the cast",
                f"The {where} is spoken by '{speaker}', who is not in the project's cast.")
        pose = line.get("pose")
        if pose is not None:
            if speaker is None:
                add(ERROR, rel, oid, "scenario-pose-narrator", "A line told by the narrator has a pose",
                    f"The {where} is told by the narrator, who has no pictures. A pose belongs to a person in the cast.")
            elif speaker in cast and pose not in {p["id"] for p in cast[speaker].get("poses", [])}:
                add(ERROR, rel, oid, "scenario-pose-unknown", "A line shows its speaker in a pose they do not have",
                    f"The {where} shows {cast[speaker]['name']} in the pose '{pose}', which {cast[speaker]['name']} does not have. Choose one of their poses, or none.")
            # A line spoken by "you" shows the pose in the person the learner chose, if they have it; who that will be is not known here.
        voice = (line["narration"] or {}).get("voice")
        if voice and speaker in cast and cast[speaker]["voice"] != voice:
            add(WARNING, rel, oid, "scenario-voice-differs", "A line is not read in its speaker's voice",
                f"The {where} is spoken by {cast[speaker]['name']}, whose voice is {cast[speaker]['voice']}, but it is read in {voice}.")

    # a learner has to be able to finish
    if c["start"] in nodes:
        reached, queue = {c["start"]}, [c["start"]]
        while queue:
            for choice in nodes[queue.pop()]["choices"]:
                if choice["next"] in nodes and choice["next"] not in reached:
                    reached.add(choice["next"])
                    queue.append(choice["next"])
        for node in c["nodes"]:
            if node["id"] not in reached:
                add(WARNING, rel, oid, "scenario-unreachable", "A situation can never be reached",
                    f"No choice leads to '{node['title']}', and it is not the start.")
        if not any(not nodes[n]["choices"] for n in reached):
            add(WARNING, rel, oid, "scenario-no-ending", "A learner can never finish this scenario",
                "Every situation that can be reached has choices. Add a situation with no choices, as an ending, and lead to it.")

    for meter in c["meters"]:
        kind = variables.get(meter["variable"])
        if kind is None or kind != "number":
            add(ERROR, rel, oid, "scenario-meter-variable", "A meter shows something that is not a number variable",
                f"The meter '{meter['label']}' shows '{meter['variable']}', " + ("which is not defined in project.json." if kind is None else f"which is a {kind}."))
        if meter["min"] >= meter["max"]:
            add(ERROR, rel, oid, "scenario-meter-range", "A meter's smallest value must be less than its largest",
                f"The meter '{meter['label']}' goes from {meter['min']} to {meter['max']}.")

    if c["finishedVariable"] is not None and variables.get(c["finishedVariable"]) != "boolean":
        add(ERROR, rel, oid, "scenario-finished-variable", "The variable set at an ending must be a true or false variable",
            f"'{c['finishedVariable']}' " + ("is not defined in project.json." if c["finishedVariable"] not in variables else f"is a {variables[c['finishedVariable']]}."))

    you = c["you"]
    if you is not None:
        if variables.get(you) != "string":
            add(ERROR, rel, oid, "scenario-you-variable", "The variable that holds the learner's character must be a text variable",
                f"'{you}' " + ("is not defined in project.json." if you not in variables else f"is a {variables[you]}."))
        elif you not in chosen:
            add(WARNING, rel, oid, "scenario-you-unset", "Nothing lets the learner choose who they are",
                f"This scenario shows the character saved in '{you}', but no choice of character saves to it, so the learner will always be just \"you\". "
                "Add a Choose a character input to an earlier slide.")


def _characters(project, asset_root, add):
    """The cast. Each person needs a name, a voice that exists, and a picture that is described (or marked as decoration)."""
    rel = "project.json"
    people = project.get("characters") or []
    ids = [p["id"] for p in people]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        add(ERROR, rel, dup, "character-duplicate-id", "Two people in the cast have the same id", f"More than one person has the id '{dup}'.")
    names = [" ".join(p["name"].split()).lower() for p in people]
    for person in people:
        pid = person["id"]
        if pid == YOU:
            add(ERROR, rel, pid, "character-id-reserved", "A person in the cast cannot have the id 'you'",
                "'you' means the learner in a scenario. Give this person another id.")
        if not person["name"].strip():
            add(ERROR, rel, pid, "character-name-empty", "A person in the cast needs a name", "The name is what the learner reads beside their lines.")
        elif names.count(" ".join(person["name"].split()).lower()) > 1:
            add(WARNING, rel, pid, "character-name-duplicate", "Two people in the cast have the same name",
                f"More than one person is called '{person['name']}'. A learner cannot tell them apart.")
        if not voice_known(person["voice"]):
            add(ERROR, rel, pid, "voice-unknown", "Unknown voice", f"'{person['voice']}' is not in the available voice set (the voice of {person['name']}).")
        picture = person["picture"]
        if picture:
            if picture["decorative"] and picture["alt"].strip():
                add(ERROR, rel, pid, "character-picture-alt", "Decorative pictures must have no alt text",
                    f"The picture of {person['name']} is marked decorative but has alt text.")
            elif not picture["decorative"] and not picture["alt"].strip():
                add(ERROR, rel, pid, "character-picture-alt", "A picture of a person needs alt text, or must be marked decorative",
                    f"The picture of {person['name']} has no alt text. Say what they look like, in a few words.")
            target = (asset_root / picture["src"]).resolve()
            if asset_root.resolve() not in target.parents or not target.is_file():
                add(ERROR, rel, pid, "asset-missing", "Asset missing", f"{picture['src']} does not exist in the project.")
        pose_ids = [x["id"] for x in person.get("poses", [])]
        for dup in sorted({i for i in pose_ids if pose_ids.count(i) > 1}):
            add(ERROR, rel, pid, "character-pose-duplicate", "Two poses of one person have the same id", f"{person['name']} has more than one pose with the id '{dup}'.")
        for pose in person.get("poses", []):
            target = (asset_root / pose["src"]).resolve()
            if asset_root.resolve() not in target.parents or not target.is_file():
                add(ERROR, rel, pid, "asset-missing", "Asset missing", f"{pose['src']} does not exist in the project (the pose '{pose['id']}' of {person['name']}).")


def _narration(rel, obj, add):
    oid = obj["id"]
    for n, owner in narrations_of(obj):
        if not voice_known(n["voice"]):
            add(ERROR, rel, oid, "voice-unknown", "Unknown voice", f"'{n['voice']}' is not in the available voice set{owner}.")
        for p in n["pronunciations"]:
            if not _IPA_OK.match(p["ipa"]):
                add(ERROR, rel, oid, "ipa-invalid", "Pronunciation override is not valid IPA",
                    f"'{p['ipa']}' for '{p['term']}' contains characters outside the IPA set{owner}.")
        cache = n["audioCache"]
        if cache:
            if cache["hash"] != narration_hash(n):
                add(WARNING, rel, oid, "narration-stale", f"Narration audio is stale and will be regenerated{owner}")


# ---------------------------------------------------------------- entry point

def source_excluded(rel, patterns):
    """Whether a path inside the project (forward slashes, relative to the project folder) is left out of a package's source/ copy.
    A pattern with no slash matches a file or folder of that name at any depth; a pattern with a slash is a path from the project
    folder, and a folder takes everything inside it. The publisher has the same rule in player/src/exclude.ts, and both are tested
    against tools/source-exclude-cases.json."""
    parts = rel.split("/")
    for pattern in patterns:
        pattern = pattern.rstrip("/")
        if not pattern:
            continue
        if "/" not in pattern:
            if pattern in parts:
                return True
        elif rel == pattern or rel.startswith(pattern + "/"):
            return True
    return False


CAPTURE_FILES = ("events.jsonl",)
CAPTURE_FOLDERS = ("capture", "captures")


def _capture_material(project, project_dir, add):
    """Raw recording material (an interaction log, footage) must not sit in the project: the package carries the whole project folder
    in source/, and assets/ is published with the course, so every learner could download it."""
    patterns = project.get("sourceExclude", [])
    for folder, dirs, files in os.walk(project_dir):
        rel_folder = pathlib.Path(folder).relative_to(project_dir).as_posix()
        rel_folder = "" if rel_folder == "." else rel_folder
        found = [d for d in dirs if d.lower() in CAPTURE_FOLDERS]
        found_files = [f for f in files if f.lower() in CAPTURE_FILES]
        dirs[:] = [d for d in dirs if d != ".cache" and d.lower() not in CAPTURE_FOLDERS]
        for name in found + found_files:
            rel = f"{rel_folder}/{name}" if rel_folder else name
            published = rel.split("/")[0] == "assets"
            if published:
                add(WARNING, "project.json", rel, "capture-material-in-project", "Raw recording material is in the published assets",
                    f"'{rel}' looks like raw recording material (an interaction log or footage). Everything under assets/ is published with the course, "
                    "so every learner could download it. Keep recordings outside the project folder.")
            elif not source_excluded(rel, patterns):
                add(WARNING, "project.json", rel, "capture-material-in-project", "Raw recording material is inside the project",
                    f"'{rel}' looks like raw recording material (an interaction log or footage). Everything in the project folder goes into the "
                    "source/ folder of a published package, so every learner could download it. Keep it outside the project folder, "
                    "or list it in sourceExclude in project.json.")


def validate_project(project_dir, asset_root=None):
    """asset_root: where assets/ and .cache/ are looked for, if not under project_dir. The
    editor validates unsaved work from a temporary folder and points this at the real project."""
    project_dir = pathlib.Path(project_dir)
    asset_root = pathlib.Path(asset_root) if asset_root else project_dir
    findings = []

    def add(sev, rel, oid, rule, message, detail=""):
        findings.append(Finding(sev, rel, oid, rule, message, detail))

    project = _read_json(project_dir / "project.json", "project.json", findings)
    if project is None:
        return findings

    ver = _version_tuple(project.get("schemaVersion")) if isinstance(project, dict) else None
    if ver and ver < SUPPORTED_SCHEMA_VERSION:
        add(ERROR, "project.json", "-", "needs-migration", "Project was made with an older version and needs updating",
            f"Project is {project['schemaVersion']}; this version uses {'.'.join(map(str, SUPPORTED_SCHEMA_VERSION))}. "
            "The editor offers to update it, or run tools/migrate.py. The old files are kept as a backup.")
        return findings
    if ver and ver > SUPPORTED_SCHEMA_VERSION:
        add(ERROR, "project.json", "-", "newer-schema", "Project was made with a newer version",
            f"Project is {project['schemaVersion']}; this validator understands up to "
            f"{'.'.join(map(str, SUPPORTED_SCHEMA_VERSION))}.")
        return findings

    p_findings, p_hard = _schema_findings("project", "project.json", project)
    findings += p_findings
    if p_hard:
        return findings

    theme = default_theme()
    ref = (project.get("theme") or {}).get("ref")
    if ref:
        theme_data = _read_json(project_dir / ref, ref, findings)
        if theme_data is not None:
            t_findings, t_hard = _schema_findings("theme", ref, theme_data)
            findings += t_findings
            if not t_hard:
                theme = theme_data
                _check_theme(ref, theme, add)
                _check_logo(ref, theme, asset_root, add)

    variables = {v["id"]: v["type"] for v in project["variables"]}
    listed = [s for scene in project["scenes"] for s in scene["slides"]]
    slides, hard_files = {}, set()
    for slide_id in dict.fromkeys(listed):
        rel = f"slides/{slide_id}.json"
        path = project_dir / rel
        if not path.exists():
            add(ERROR, "project.json", slide_id, "slide-file-missing", "Slide file missing",
                f"A scene lists '{slide_id}' but {rel} does not exist.")
            continue
        data = _read_json(path, rel, findings)
        if data is None:
            continue
        s_findings, hard = _schema_findings("slide", rel, data)
        findings += s_findings
        if hard:
            hard_files.add(rel)
            continue
        if data["id"] != slide_id:
            add(ERROR, rel, data["id"], "slide-id-mismatch", "Slide id does not match its file name",
                f"{rel} contains id '{data['id']}'.")
        slides[rel] = data

    on_disk = {f"slides/{p.name}" for p in (project_dir / "slides").glob("*.json")} if (project_dir / "slides").is_dir() else set()
    for rel in sorted(on_disk - {f"slides/{s}.json" for s in listed}):
        add(WARNING, rel, "-", "slide-orphan", "Slide file is not in any scene")

    slides_by_id = {s["id"] for s in slides.values()}
    slides_by_id |= set(listed)  # a missing file is reported once above, not again per trigger

    # Cross-file rules.
    seen_ids, seen_prov, seen_steps, seen_deck_slides, named_decks = {}, {}, {}, {}, set()
    for rel, slide in slides.items():
        step = slide.get("provenance")
        if step and "sourceCapture" in step:
            seen_steps.setdefault((step["sourceCapture"], step["stepId"]), []).append((rel, slide["id"]))
        elif step and "sourceDeck" in step:
            seen_deck_slides.setdefault((step["sourceDeck"], step["slideId"]), []).append((rel, slide["id"]))
            named_decks.add(step["sourceDeck"])
        for _, obj in _objects(slide):
            seen_ids.setdefault(obj["id"], []).append((rel, obj["name"]))
            prov = obj["provenance"]
            if prov and "sourceDeck" in prov:
                seen_prov.setdefault((prov["sourceDeck"], prov["shapeId"]), []).append((rel, obj["id"]))
                named_decks.add(prov["sourceDeck"])
    for oid, where in seen_ids.items():
        if len(where) > 1:
            for rel, name in where:
                add(ERROR, rel, oid, "duplicate-object-id", "Duplicate object id",
                    f"'{oid}' (\"{name}\") is one of {len(where)} objects with this id.")
    for (deck, shape), where in seen_prov.items():
        if len(where) > 1:
            for rel, oid in where:
                add(WARNING, rel, oid, "provenance-duplicate",
                    "Duplicate provenance, re-sync behaviour undefined",
                    f"Source deck '{deck}' shape {shape} appears {len(where)} times.")

    for (deck, slide_id), where in seen_deck_slides.items():
        if len(where) > 1:
            for rel, sid in where:
                add(WARNING, rel, sid, "provenance-duplicate",
                    "Duplicate provenance, re-sync behaviour undefined",
                    f"Source deck '{deck}' slide {slide_id} is the source of {len(where)} slides.")
    listed_decks = {d["id"] for d in project.get("sources", [])}
    for deck in sorted(named_decks - listed_decks):
        add(WARNING, "project.json", "-", "import-source-missing",
            "Imported slides name a deck that the project does not list",
            f"Slides or shapes say they came from '{deck}', but the project lists no such deck, so a changed deck cannot be placed the way it was.")

    for (capture, step), where in seen_steps.items():
        if len(where) > 1:
            for rel, sid in where:
                add(WARNING, rel, sid, "provenance-duplicate",
                    "Duplicate provenance, re-sync behaviour undefined",
                    f"Capture '{capture}' step {step} is the source of {len(where)} slides.")

    _capture_material(project, project_dir, add)
    _characters(project, asset_root, add)
    _icon_credit(project, slides, add)
    _voice_credit(project, slides, add)
    _completion(project, slides, listed, add)
    _banks(project, slides, listed, add)
    _results(slides, add)
    _timing(slides, add)
    _hidden_navigation(slides, listed, add)

    # Where assets came from. The file is optional.
    if (project_dir / "assets.json").is_file():
        assets_data = _read_json(project_dir / "assets.json", "assets.json", findings)
        if assets_data is not None:
            a_findings, a_hard = _schema_findings("assets", "assets.json", assets_data)
            findings += a_findings
            if not a_hard:
                _credits(project, assets_data, list(slides.values()), asset_root, add)

    # Per-slide rules, and asset / cache checks that need the project folder.
    saved_by_inputs = input_values(list(slides.values()))
    cast = {p["id"]: p for p in project.get("characters") or []}
    chosen = {obj["content"]["variable"] for s in slides.values() for _, obj in _objects(s)
              if obj["type"] == "input" and obj["content"]["kind"] == "character"}
    for rel, slide in slides.items():
        _check_slide(rel, slide, variables, slides_by_id, add, theme, saved_by_inputs, project["stage"], cast, chosen, list(dict.fromkeys(listed)),
                     {v["name"].strip().lower() for v in project["variables"]})
        for _, obj in _objects(slide):
            _assets(asset_root, rel, obj, add)

    return findings


_LETTERED = re.compile(r"^\s*\(?[A-Ha-h][.):]\s")
_POSITIONAL = re.compile(r"\b(all|none|neither|both)\b.{0,12}\b(of the above|of these)\b|\b(both|either)\s+[A-Ha-h]\s+(and|or)\s+[A-Ha-h]\b|\bthe above\b", re.IGNORECASE)


def _banks(project, slides, order, add):
    """Question banks (player/src/bank.ts): each learner is shown some of a run of slides, picked at random. The slides have to be there, in
    one bank each, and there have to be enough of them. What the learner is shown is worked out when they begin, so a rule that jumps to a
    slide of a bank may lead somewhere that learner was never given."""
    banks = project.get("banks") or []
    rel = "project.json"
    by_id = {s["id"]: s for s in slides.values()}
    position = {sid: i for i, sid in enumerate(dict.fromkeys(order))}
    ids = [b["id"] for b in banks]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        add(ERROR, rel, dup, "bank-duplicate-id", "Two question banks have the same id", f"More than one bank has the id '{dup}'.")
    owner = {}
    for bank in banks:
        bid = bank["id"]
        for sid in bank["slides"]:
            if sid not in by_id:
                add(ERROR, rel, bid, "bank-slide-missing", "A question bank holds a slide that is not in the course",
                    f"Bank '{bank['name']}' lists '{sid}', which does not exist. Take it out of the bank.")
            elif sid in owner and owner[sid] != bid:
                add(ERROR, rel, bid, "bank-slide-shared", "A slide is in two question banks",
                    f"'{sid}' is in banks '{owner[sid]}' and '{bid}'. A slide can be in one bank only.")
            owner.setdefault(sid, bid)
        known = [s for s in bank["slides"] if s in by_id]
        spots = sorted(position[s] for s in known if s in position)
        if spots and spots[-1] - spots[0] + 1 != len(spots):
            add(WARNING, rel, bid, "bank-not-together", "The slides of a question bank are not side by side",
                f"Bank '{bank['name']}' holds slides with other slides between them. The slides shown take the place of the bank's first slide, so the slides between "
                "stay where they are and a learner may meet them before every question of the bank. Put the bank's slides together.")
        if known and bank["draw"] > len(known):
            add(ERROR, rel, bid, "bank-draw-too-many", "A question bank is asked to show more slides than it has",
                f"Bank '{bank['name']}' shows {bank['draw']} slides but holds {len(known)}. Lower the number, or add slides to the bank.")
        elif known and bank["draw"] == len(known) and not bank["shuffle"]:
            add(WARNING, rel, bid, "bank-does-nothing", "A question bank shows every slide in the same order, so it changes nothing",
                f"Bank '{bank['name']}' shows all {len(known)} of its slides in the author's order. Show fewer of them, or mix the order.")
        quiz_points = {}
        for sid in known:
            quiz_points[sid] = [o["content"]["scoring"]["points"] for _, o in _objects(by_id[sid]) if o["type"] == "quizQuestion"]
        bare = [sid for sid, points in quiz_points.items() if not points]
        if bare:
            add(WARNING, rel, bid, "bank-slide-no-question", "A slide in a question bank has no question",
                f"Bank '{bank['name']}': {', '.join(bare)} {'has' if len(bare) == 1 else 'have'} no question, so a learner may be shown a slide that asks nothing.")
        if len({sum(points) for points in quiz_points.values() if points}) > 1:
            add(WARNING, rel, bid, "bank-points-differ", "The questions in a bank are worth different points",
                f"Bank '{bank['name']}' holds questions worth different points, so what is possible, and the score, depends on which ones a learner is shown. "
                "The percentage still means the same thing, but make them worth the same if the points are shown to the learner.")
    for srel, slide in slides.items():
        for _, obj in _objects(slide):
            for t in obj["triggers"]:
                if t["action"] == "jumpToSlide" and t["target"] in owner:
                    add(WARNING, srel, obj["id"], "jump-into-bank", "A rule jumps to a slide in a question bank",
                        f"Trigger {t['id']} goes to '{t['target']}', which is in a bank. Each learner is shown only some of a bank's slides, so this learner may not have that slide, and then the rule does nothing.")


def _shuffle_words(rel, obj, add):
    """A question that mixes its answers cannot have answers that depend on where they are: 'A.', 'All of the above', 'Both A and B'."""
    if obj["type"] != "quizQuestion" or not obj["content"].get("shuffle"):
        return
    odd = [c["label"] for c in obj["content"].get("choices", []) if _LETTERED.search(c["label"]) or _POSITIONAL.search(c["label"])]
    if odd:
        add(WARNING, rel, obj["id"], "shuffle-position-words", "A question that mixes its answers has an answer that depends on its place",
            f"'{odd[0]}' only makes sense if the answers stay in order, and they will not. Reword it, or turn off Shuffle the answers.")


def _hidden_navigation(slides, order, add):
    """A slide that leaves out the course's Back and Next (hideNavigation) must have a way out of its own: a rule on something on it that goes to a slide,
    or a time after which it moves on by itself. Without one a learner is stuck there. The last slide of the course has nowhere to go and is let be."""
    last = list(dict.fromkeys(order))[-1] if order else None
    for rel, slide in slides.items():
        if not slide.get("hideNavigation") or slide["id"] == last:
            continue
        leaves = slide["duration"] is not None or any(
            t["action"] in ("jumpToSlide", "nextSlide", "previousSlide") for _, obj in _objects(slide) for t in obj["triggers"])
        if not leaves:
            add(ERROR, rel, slide["id"], "navigation-no-way-out", "A slide with no Back and Next has no way out",
                "Back and Next are left out of this slide, and nothing on it (on any layer) goes to another slide, so a learner would be stuck here. "
                "Add a button with a rule that goes to a slide, or show Back and Next again.")


def _completion(project, slides, order, add):
    """Counting a course complete only when every slide has been seen cannot work if a rule can jump past a slide:
    a learner who takes that path never sees it, so never finishes."""
    if project["completion"]["slides"] != "all":
        return
    index = {sid: i for i, sid in enumerate(dict.fromkeys(order))}
    said = set()
    for rel, slide in slides.items():
        here = index.get(slide["id"])
        if here is None:
            continue
        for _, obj in _objects(slide):
            for t in obj["triggers"]:
                there = index.get(t["target"]) if t["action"] == "jumpToSlide" else None
                if there is None or there <= here + 1 or (obj["id"], t["target"]) in said:
                    continue
                said.add((obj["id"], t["target"]))
                skipped = there - here - 1
                add(WARNING, rel, obj["id"], "completion-skippable",
                    "A rule skips slides, but this course is complete only when every slide has been seen",
                    f"A rule goes from slide {here + 1} to slide {there + 1}, past {skipped} slide{'s' if skipped != 1 else ''}. "
                    "A learner who takes that path never completes the course. In the course settings, choose to complete "
                    "when the learner reaches the last slide.")


_WORDS_PER_SECOND = 3  # a comfortable reading pace, for the warning about text that goes too soon

_PARAGRAPH_TAGS = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "li"}


class _Paragraphs(HTMLParser):
    """The paragraphs of a text, for timing them one at a time (a text's timing.paragraphs): a heading, a paragraph, a quotation, or a list item with the lists inside it,
    in the order they come. The same rule is in player/src/paragraphs.ts and editor/src/paragraphs.ts; player/src/paragraph-cases.json holds the cases all three are tested on."""

    VOID = {"br", "hr", "img", "input", "meta", "link", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.found = []  # the words of each paragraph
        self.open_block = None  # depth of the open paragraph's own tag, and where its words go

    def handle_starttag(self, tag, attrs):
        if tag in self.VOID:
            return
        depth = len(self.stack)
        if self.open_block is None:
            top_level = depth == 0 and tag in _PARAGRAPH_TAGS and tag != "li"
            list_item = tag == "li" and depth == 1 and self.stack[0] in ("ul", "ol")
            if top_level or list_item:
                self.open_block = (depth, [])
                self.found.append(self.open_block[1])
        self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in self.VOID or tag not in self.stack:
            return
        while self.stack:
            top = self.stack.pop()
            if self.open_block is not None and len(self.stack) == self.open_block[0]:
                self.open_block = None
            if top == tag:
                break

    def handle_data(self, data):
        if self.open_block is not None:
            self.open_block[1].append(data)


def paragraphs_of(html):
    """The words of each paragraph of a text's HTML, each on one line."""
    parser = _Paragraphs()
    parser.feed(html or "")
    parser.close()
    return [" ".join("".join(words).split()) for words in parser.found]


def _timing(slides, add):
    """Things that appear or disappear on their own, and slides that move on on their own, can leave a learner behind."""
    for rel, slide in slides.items():
        duration = slide["duration"]
        has_question = any(o["type"] == "quizQuestion" for _, o in _objects(slide))
        if duration is not None and has_question:
            add(WARNING, rel, slide["id"], "slide-advances-with-question", "A slide with a question moves on by itself",
                "A learner who is still thinking would be moved past the question. Finishing every question is needed to complete the course.")
        on_slide = {o["id"]: o for _, o in _objects(slide)}
        follows_media = False
        waits_for_click = False
        click_steps = {}  # layer id -> the step numbers on it
        last_delay = 0
        for layer, obj in _objects(slide):
            t = obj["timing"]
            oid = obj["id"]
            if t["appear"] == "media":
                follows_media = True
                target = on_slide.get(t["media"])
                if t["media"] == oid:
                    add(ERROR, rel, oid, "timing-media-self", "An object cannot follow itself",
                        "Choose a video or audio clip on this slide for it to follow.")
                elif target is None or target["type"] not in ("video", "audio"):
                    add(ERROR, rel, oid, "timing-media-missing", "This object follows a video or audio clip that is not on its slide",
                        f"'{t['media']}' is not a video or audio object on this slide. Choose one, or show the object a set time after the slide opens.")
            if t["appear"] == "click":
                waits_for_click = True
                click_steps.setdefault(layer["id"], set()).add(t["step"])
                last_delay = max(last_delay, t["start"])
            until = t.get("until")
            if until:
                waits_for_click = True
                click_steps.setdefault(layer["id"], set()).add(until["step"])
                last_delay = max(last_delay, until["start"])
                if t["appear"] == "media":
                    add(ERROR, rel, oid, "timing-until-media", "An object that follows a clip cannot also go away at a step",
                        "Take away the step it goes at, or show it a set time after the slide opens instead of following the clip.")
                elif t["appear"] == "click" and until["step"] <= t["step"]:
                    add(WARNING, rel, oid, "timing-until-before-appear", "This object goes away before it ever shows",
                        f"It appears at step {t['step']} and goes away at step {until['step']}, so a learner never sees it. Choose a later step to go at.")
            if t["appear"] == "narration" and not obj["narration"]:
                add(ERROR, rel, oid, "timing-narration-missing", "This object is set to appear with its narration, but it has none",
                    "Write the object's narration, or choose to show it a set time after the slide opens.")
            if duration is not None and layer is slide["baseLayer"] and t["appear"] == "time" and t["start"] >= duration:
                add(WARNING, rel, oid, "timing-after-advance", "This object would appear after the slide has moved on",
                    f"It appears at {t['start'] / 1000:g} seconds and the slide moves on at {duration / 1000:g}.")
            parts = t.get("paragraphs")
            if parts:
                # A text that comes in or goes away one paragraph at a time: each paragraph is a timing of its own.
                if obj["type"] != "text":
                    add(ERROR, rel, oid, "timing-paragraphs-type", "Only a text can come in one paragraph at a time",
                        "Take away the paragraph timing, or put the words in a text box.")
                else:
                    count = len(paragraphs_of(obj["content"].get("html", "")))
                    if len(parts) != count:
                        add(WARNING, rel, oid, "timing-paragraphs-count",
                            f"This text has {count} paragraph{'s' if count != 1 else ''}, but timing for {len(parts)}",
                            "A paragraph with no timing is always there, and timing for a paragraph that is not there is not used. Open Timing and set each paragraph again.")
                for number, part in enumerate(parts, 1):
                    if part["appear"] == "click":
                        waits_for_click = True
                        click_steps.setdefault(layer["id"], set()).add(part["step"])
                        last_delay = max(last_delay, part["start"])
                    gone = part.get("until")
                    if gone:
                        waits_for_click = True
                        click_steps.setdefault(layer["id"], set()).add(gone["step"])
                        last_delay = max(last_delay, gone["start"])
                        if part["appear"] == "click" and gone["step"] <= part["step"]:
                            add(WARNING, rel, oid, "timing-until-before-appear", f"Paragraph {number} goes away before it ever shows",
                                f"It appears at step {part['step']} and goes away at step {gone['step']}, so a learner never sees it. Choose a later step to go at.")
                    if duration is not None and layer is slide["baseLayer"] and part["appear"] == "time" and part["start"] >= duration:
                        add(WARNING, rel, oid, "timing-after-advance", f"Paragraph {number} would appear after the slide has moved on",
                            f"It appears at {part['start'] / 1000:g} seconds and the slide moves on at {duration / 1000:g}.")
            leaves = t["visibleFor"] is not None or bool(t.get("until")) or any(p.get("until") or p["visibleFor"] is not None for p in parts or [])
            if obj["animation"]["exit"]["effect"] != "none" and not leaves:
                add(WARNING, rel, oid, "animation-exit-never", "This object has an exit effect but never goes",
                    "An exit effect plays when the object disappears, at the end of its time or at a step, and this object has neither, so the effect would never play.")
            if t["visibleFor"] is not None and obj["type"] in INTERACTIVE:
                add(WARNING, rel, oid, "timing-control-disappears", "A control that disappears can leave a learner stuck",
                    "A learner who needs more time, or uses a keyboard or a screen reader, may not reach it before it goes.")
            if t["visibleFor"] is not None and obj["type"] in ("text", "scrollingText"):
                words = len(re.sub(r"<[^>]*>", " ", obj["content"].get("html", "")).split())
                needed = max(3000, int(words / _WORDS_PER_SECOND * 1000))
                if t["visibleFor"] < needed:
                    add(WARNING, rel, oid, "timing-too-brief", "This text may disappear before it can be read",
                        f"It stays for {t['visibleFor'] / 1000:g} seconds. At a comfortable pace {words} words take about {needed / 1000:g}.")
        auto = slide.get("autoSteps")
        # Steps that come by themselves are all there once the last has come and its own delay has passed; only a slide that moves on sooner than that leaves them behind.
        auto_done = auto["first"] + (max(len(s) for s in click_steps.values()) - 1) * auto["every"] + last_delay if auto and click_steps else None
        if duration is not None and waits_for_click and (auto_done is None or auto_done >= duration):
            if auto_done is None:
                add(WARNING, rel, slide["id"], "timing-click-advance", "A slide that moves on by itself holds objects that wait for the learner to show them",
                    "The slide would move on after its own time, whether or not the learner has pressed Show next item for each one. Let the learner decide when to go on.")
            else:
                add(WARNING, rel, slide["id"], "timing-click-advance", "A slide that moves on by itself would move on before its items have all come",
                    f"The items come by themselves, the last at {auto_done / 1000:g} seconds, and the slide moves on at {duration / 1000:g}. Give the slide more time, or let the learner decide when to go on.")
        if duration is not None and follows_media:
            add(WARNING, rel, slide["id"], "timing-media-advance", "A slide that moves on by itself holds objects that follow a video or audio clip",
                "The slide would move on after its own time, whether or not the clip has reached them. Let the learner decide when to go on.")


def _results(slides, add):
    """A results box and a certificate both report on the quiz, so they mean nothing in a course that has none."""
    objects = [(rel, obj) for rel, slide in slides.items() for _, obj in _objects(slide)]
    if any(o["type"] == "quizQuestion" for _, o in objects):
        return
    for rel, obj in objects:
        if obj["type"] == "results":
            add(WARNING, rel, obj["id"], "results-no-quiz", "This results box has no quiz to report on",
                "The course has no quiz questions, so the box would only ever say that nothing has been answered.")
        elif obj["type"] == "certificate":
            add(WARNING, rel, obj["id"], "certificate-no-quiz", "No one can earn this certificate, because the course has no quiz",
                "A certificate is given only to a learner who passes, and passing means passing a quiz. Add quiz questions, or take the certificate out.")


def _assets(project_dir, rel, obj, add):  # project_dir here is the asset root
    refs = []
    if obj["type"] in ("image", "video", "audio", "download"):
        refs.append(obj["content"].get("src"))
    if obj["type"] in ("video", "audio"):
        refs.append(obj["content"].get("captions"))
    if obj["type"] == "interaction":
        refs += [i["image"]["src"] for i in obj["content"]["items"] if i["image"]]
    if obj["type"] == "quizQuestion" and obj["content"]["questionType"] == "hotspot":
        refs.append(obj["content"]["image"]["src"])
    for ref in filter(None, refs):
        target = (project_dir / ref).resolve()
        inside = project_dir.resolve() in target.parents
        if not inside or not target.is_file():
            add(ERROR, rel, obj["id"], "asset-missing", "Asset missing", f"{ref} does not exist in the project.")
    for n, owner in narrations_of(obj):
        if n["audioCache"]:
            cache_path = (project_dir / n["audioCache"]["path"])
            if not cache_path.is_file():
                add(WARNING, rel, obj["id"], "narration-not-generated", f"Narration audio not yet generated{owner}")


# ---------------------------------------------------------------- reporting

def sort_findings(findings):
    order = {ERROR: 0, WARNING: 1}
    return sorted(findings, key=lambda f: (f.file != "project.json", f.file, order[f.severity], f.object_id))


def format_text(findings):
    out, current = [], None
    for f in sort_findings(findings):
        if f.file != current:
            current = f.file
            out.append("")
            out.append(f.file)
        tag = "ERROR" if f.severity == ERROR else "WARN "
        out.append(f"  {tag}  {f.object_id:<10} {f.message}")
        if f.detail:
            out.append(f"  {'':5}  {'':<10} {f.detail}")
    errors = sum(f.severity == ERROR for f in findings)
    warns = len(findings) - errors
    out.append("")
    out.append(f"{errors} error{'s' if errors != 1 else ''}, {warns} warning{'s' if warns != 1 else ''}")
    return "\n".join(out).lstrip("\n")


def main(argv):
    asset_root = None
    args = []
    it = iter(argv)
    for a in it:
        if a == "--asset-root":
            asset_root = next(it, None)
        elif not a.startswith("--"):
            args.append(a)
    if len(args) != 1:
        print("Usage: validate.py PROJECT_DIR [--json] [--asset-root DIR]")
        return 2
    findings = validate_project(args[0], asset_root)
    if "--json" in argv:
        print(json.dumps([asdict(f) for f in sort_findings(findings)], indent=2, ensure_ascii=False))
    else:
        print(format_text(findings))
    return 1 if any(f.severity == ERROR for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
