"""OpenStage project validator. See docs/validator-spec.md.

Usage:  python validate.py PROJECT_DIR [--json]

Reads project.json and every slide it lists, checks structure against schema/*.json,
then runs the semantic rules. Exits 1 if there are errors, 0 otherwise.

The same function (validate_project) is meant to power the command line and, later,
the editor's problem list. Never write a second implementation.
"""
import json
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

SUPPORTED_SCHEMA_VERSION = (0, 14, 0)
# How many items each kind of interaction can show. A drawing has only so many places for them.
# Keep in step with ITEM_LIMITS in player/src/interactions.ts.
ITEM_LIMITS = {
    "clickReveal": (1, 12), "flipCards": (1, 12), "tabs": (1, 12), "accordion": (1, 20), "carousel": (1, 20),
    "steps": (1, 12), "timeline": (2, 12), "processCircle": (3, 8), "glossary": (1, 50),
    "pyramidStack": (3, 7), "pyramidMatrix": (3, 6), "circleMatrix": (3, 8),
}
# The type of variable each kind of input writes. Keep in step with INPUT_VARIABLE_TYPE in player/src/inputs.ts.
INPUT_VARIABLE_TYPE = {"checkbox": "boolean", "radio": "string", "dropdown": "string", "list": "string",
                       "likert": "number", "semantic": "number"}
INTERACTIVE = ("button", "hotspot", "quizQuestion", "interaction", "scrollingText", "input", "embed", "certificate", "download")

# A gap does not block keyboard access (focus follows the values' order), so it is
# a warning. Duplicates are errors. See docs/validator-spec.md.
TAB_GAP_SEVERITY = "warning"

ERROR, WARNING = "error", "warning"


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
            findings.append(Finding(ERROR, rel, oid, "alt-text-missing",
                                    "Object needs alt text, or must be marked decorative"))
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


# Pairs of theme colours that are used as text on a background. Each must meet WCAG AA.
THEME_PAIRS = (("text", "background"), ("muted", "background"), ("text", "surface"),
               ("onAccentStrong", "accentStrong"), ("onDark", "dark"), ("good", "background"), ("bad", "background"))


def _check_theme(rel, theme, add):
    for fg, bg in THEME_PAIRS:
        ratio = contrast_ratio(_hex_rgb(theme["colors"][fg]), _hex_rgb(theme["colors"][bg]))
        if ratio < 4.5:
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
            elif c["kind"] in ("likert", "semantic"):
                top = len(c["scale"]) if c["kind"] == "likert" else c["points"]
                for row in c["rows"]:
                    allowed.setdefault(row["variable"], set()).update(range(0, top + 1))
    return allowed


def _check_slide(rel, slide, variables, slides_by_id, add, theme, allowed=None):
    layer_ids = {layer["id"] for layer in _layers(slide)}
    object_ids = {obj["id"] for _, obj in _objects(slide)}

    for layer in _layers(slide):
        _tab_order(rel, layer, add)
    _theme_tokens(rel, slide, theme, add)
    slide_bg = background_colors(theme, slide.get("background"))

    imported = [obj for _, obj in _objects(slide) if obj["provenance"]]
    new = [obj for _, obj in _objects(slide) if not obj["provenance"]]
    if imported and new:
        add(WARNING, rel, slide["id"], "provenance-mixed",
            "Slide mixes imported and new objects; re-sync will only affect imported ones")

    for layer, obj in _objects(slide):
        oid = obj["id"]
        _click_needs_key(rel, obj, add)
        _contrast(rel, obj, add, theme, slide_bg)
        _triggers(rel, obj, variables, slides_by_id, layer_ids, object_ids, add, allowed or {})
        _feedback_refs(rel, obj, layer_ids, add)
        _quiz(rel, obj, add)
        _interaction(rel, obj, add)
        _table(rel, obj, add)
        _input(rel, obj, variables, add)
        _embed(rel, obj, add)
        _download(rel, obj, add)
        _narration(rel, obj, add)


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


def _click_needs_key(rel, obj, add):
    if obj["type"] not in INTERACTIVE:
        return

    def sig(t):
        return (t["action"], t["target"], json.dumps(t.get("value"), sort_keys=True),
                json.dumps(t["conditions"], sort_keys=True))

    key_sigs = {sig(t) for t in obj["triggers"] if t["event"] == "keyActivate"}
    for t in obj["triggers"]:
        if t["event"] == "click" and sig(t) not in key_sigs:
            add(ERROR, rel, obj["id"], "click-without-key", "Interactive objects must be operable by keyboard",
                f"Trigger {t['id']} responds to click but has no matching keyActivate trigger "
                f"(same action, target, value and conditions).")


def _contrast(rel, obj, add, theme, slide_bg):
    """Text against what is behind it: the object's own fill if it has one, otherwise the slide
    background. A theme colour counts as the colour it stands for. Text with no colour of its own
    uses the theme's text colour, and a button with none uses the theme's button colours."""
    if obj["type"] not in ("text", "button", "quizQuestion"):
        return
    is_button = obj["type"] == "button"
    variants = [("", obj["style"])]
    for name, state in obj["states"].items():
        if "style" in state:
            variants.append((f" in state '{name}'", {**obj["style"], **state["style"]}))
    for label, style in variants:
        colour = style.get("color")
        own_fill = style.get("fill", style.get("background"))
        fg = resolve_color(theme, colour) if colour is not None else theme["colors"]["onAccentStrong" if is_button else "text"]
        if own_fill is not None:
            bgs = [resolve_color(theme, own_fill)]
        elif is_button:
            bgs = [theme["colors"]["accentStrong"]]
        else:
            bgs = slide_bg
        if fg is None or any(b is None for b in bgs):
            continue  # a colour that is neither hex nor a theme colour; reported as an unknown theme value
        need = 3.0 if _is_large_text(style) else 4.5
        ratio = min(contrast_ratio(_hex_rgb(fg), _hex_rgb(b)) for b in bgs)
        if ratio < need:
            add(ERROR, rel, obj["id"], "contrast", "Contrast too low",
                f"{fg} on {' to '.join(bgs)}{label} is {ratio:.2f}:1; WCAG 2.2 AA needs {need}:1.")


def _value_type(v):
    """The variable type a JSON value belongs to. A true or false is not a number."""
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"
    return "string"


def _triggers(rel, obj, variables, slides_by_id, layer_ids, object_ids, add, allowed):
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
        else:  # playMedia, pauseMedia, changeState
            ok = target in object_ids
        if not ok:
            add(ERROR, rel, obj["id"], "trigger-target-missing", "Trigger points at something missing",
                f"Trigger {t['id']}: action {action} targets '{target}', which does not exist.")
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
        if action == "setVariable" and target in variables:
            want = variables[target]
            if "value" not in t:
                if want != "boolean":
                    add(ERROR, rel, obj["id"], "trigger-value-type", "Setting a variable needs a value",
                        f"Trigger {t['id']}: with no value a variable is set to true, but '{target}' is a {want}.")
            elif _value_type(t["value"]) != want:
                add(ERROR, rel, obj["id"], "trigger-value-type", "Setting a variable to the wrong kind of value",
                    f"Trigger {t['id']}: '{target}' is a {want}, but the value {json.dumps(t['value'])} is a {_value_type(t['value'])}.")
        event, kind = t["event"], obj["type"]
        if (event in ("click", "keyActivate") and kind not in ("button", "hotspot", "quizQuestion")) or (event == "mediaComplete" and kind not in ("video", "audio")):
            add(WARNING, rel, obj["id"], "trigger-event-never", "This rule's event never happens on this kind of object",
                f"Trigger {t['id']}: a {kind} object cannot cause '{event}'. Move the rule to an object that can, or use a different event.")


def _quiz(rel, obj, add):
    if obj["type"] != "quizQuestion":
        return
    choices = obj["content"]["choices"]
    ids = [c["id"] for c in choices]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        add(ERROR, rel, obj["id"], "quiz-duplicate-choice", "Quiz answers must have different ids",
            f"More than one answer has the id '{dup}'.")
    correct = sum(1 for c in choices if c["correct"])
    if correct != 1:
        add(ERROR, rel, obj["id"], "quiz-correct-answer", "Quiz needs exactly one correct answer",
            f"This question has {correct} answers marked correct.")


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


def _input(rel, obj, variables, add):
    if obj["type"] != "input":
        return
    c = obj["content"]
    kind = c["kind"]
    oid = obj["id"]
    parts = c.get("items") or c.get("rows") or c.get("options") or []
    ids = [p["id"] for p in parts]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        add(ERROR, rel, oid, "input-duplicate-id", "Input parts must have different ids", f"More than one part has the id '{dup}'.")

    refs = [c["variable"]] if kind in ("radio", "dropdown", "list") else [p["variable"] for p in parts]
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


_YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_VIMEO_ID = re.compile(r"^[0-9]{1,12}$")
_VIMEO_HASH = re.compile(r"^[A-Za-z0-9]{0,32}$")


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
    used = json.dumps(slides)
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
    """Every narration an object holds: its own, then one for each item of an interaction that has one.
    Yields (narration, what it belongs to), where the second part is "" for the object itself."""
    if obj["narration"]:
        yield obj["narration"], ""
    if obj["type"] == "interaction":
        for item in obj["content"]["items"]:
            if item.get("narration"):
                yield item["narration"], f" (item '{item['title']}')"


def _narration(rel, obj, add):
    oid = obj["id"]
    for n, owner in narrations_of(obj):
        if n["voice"] not in _voices():
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
    seen_ids, seen_prov = {}, {}
    for rel, slide in slides.items():
        for _, obj in _objects(slide):
            seen_ids.setdefault(obj["id"], []).append((rel, obj["name"]))
            prov = obj["provenance"]
            if prov:
                seen_prov.setdefault((prov["sourceDeck"], prov["shapeId"]), []).append((rel, obj["id"]))
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

    _completion(project, slides, listed, add)
    _results(slides, add)
    _timing(slides, add)

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
    for rel, slide in slides.items():
        _check_slide(rel, slide, variables, slides_by_id, add, theme, saved_by_inputs)
        for _, obj in _objects(slide):
            _assets(asset_root, rel, obj, add)

    return findings


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


def _timing(slides, add):
    """Things that appear or disappear on their own, and slides that move on on their own, can leave a learner behind."""
    for rel, slide in slides.items():
        duration = slide["duration"]
        has_question = any(o["type"] == "quizQuestion" for _, o in _objects(slide))
        if duration is not None and has_question:
            add(WARNING, rel, slide["id"], "slide-advances-with-question", "A slide with a question moves on by itself",
                "A learner who is still thinking would be moved past the question. Finishing every question is needed to complete the course.")
        for layer, obj in _objects(slide):
            t = obj["timing"]
            oid = obj["id"]
            if t["appear"] == "narration" and not obj["narration"]:
                add(ERROR, rel, oid, "timing-narration-missing", "This object is set to appear with its narration, but it has none",
                    "Write the object's narration, or choose to show it a set time after the slide opens.")
            if duration is not None and layer is slide["baseLayer"] and t["appear"] == "time" and t["start"] >= duration:
                add(WARNING, rel, oid, "timing-after-advance", "This object would appear after the slide has moved on",
                    f"It appears at {t['start'] / 1000:g} seconds and the slide moves on at {duration / 1000:g}.")
            if obj["animation"]["exit"]["effect"] != "none" and t["visibleFor"] is None:
                add(WARNING, rel, oid, "animation-exit-never", "This object has an exit effect but never goes",
                    "An exit effect plays when the object disappears at the end of its time, and this object has no end time, so the effect would never play.")
            if t["visibleFor"] is not None and obj["type"] in INTERACTIVE:
                add(WARNING, rel, oid, "timing-control-disappears", "A control that disappears can leave a learner stuck",
                    "A learner who needs more time, or uses a keyboard or a screen reader, may not reach it before it goes.")
            if t["visibleFor"] is not None and obj["type"] in ("text", "scrollingText"):
                words = len(re.sub(r"<[^>]*>", " ", obj["content"].get("html", "")).split())
                needed = max(3000, int(words / _WORDS_PER_SECOND * 1000))
                if t["visibleFor"] < needed:
                    add(WARNING, rel, oid, "timing-too-brief", "This text may disappear before it can be read",
                        f"It stays for {t['visibleFor'] / 1000:g} seconds. At a comfortable pace {words} words take about {needed / 1000:g}.")


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
