"""Two kinds of question are answered in text that has to be read the same way everywhere: a keyboard shortcut ("Ctrl+Shift+S") and a passage in which
the learner chooses a word ("The dog [barked] loudly."). The player reads them in player/src/shortcut.ts and player/src/passage.ts. This is the same
reading, for the validator, the translation tool and the review document, and both are tested against the same tables of cases
(tools/shortcut-cases.json and tools/passage-cases.json), so they can never quietly disagree.

Whitespace here is what JavaScript calls whitespace, not Python's, so that the two readings agree on every character.
"""
import re
import unicodedata

_WS_CHARS = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
_WS = "\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"

# ---------------------------------------------------------------- keyboard shortcuts

MODIFIERS = ("Ctrl", "Alt", "Shift", "Meta")

_MODIFIER_NAMES = {
    "ctrl": "Ctrl", "control": "Ctrl", "ctl": "Ctrl",
    "alt": "Alt", "option": "Alt", "opt": "Alt",
    "shift": "Shift",
    "meta": "Meta", "cmd": "Meta", "command": "Meta", "win": "Meta", "windows": "Meta", "super": "Meta", "\u2318": "Meta",
}

_KEY_NAMES = {
    "enter": "Enter", "return": "Enter", "esc": "Escape", "escape": "Escape", "tab": "Tab", "space": "Space", "spacebar": "Space",
    "backspace": "Backspace", "bksp": "Backspace", "delete": "Delete", "del": "Delete", "insert": "Insert", "ins": "Insert",
    "home": "Home", "end": "End", "pageup": "PageUp", "pgup": "PageUp", "pagedown": "PageDown", "pgdn": "PageDown",
    "up": "Up", "uparrow": "Up", "arrowup": "Up", "down": "Down", "downarrow": "Down", "arrowdown": "Down",
    "left": "Left", "leftarrow": "Left", "arrowleft": "Left", "right": "Right", "rightarrow": "Right", "arrowright": "Right",
    "plus": "+", "minus": "-", "comma": ",", "period": ".", "dot": ".", "slash": "/", "backslash": "\\", "semicolon": ";", "equals": "=", "equal": "=",
    "backtick": "`", "quote": "'",
}

_PUNCTUATION = set("+-,./\\;'[]=`")

# Combinations a browser keeps for itself, which a learner cannot press on a page (they can still type them). Kept in step with BROWSER_KEEPS in
# player/src/shortcut.ts; the shared cases file lists them too, and both sides are tested against it.
BROWSER_KEEPS = ("Ctrl+W", "Ctrl+T", "Ctrl+N", "Ctrl+Shift+N", "Ctrl+Shift+T", "Ctrl+Shift+W", "Alt+F4", "Ctrl+Tab", "Ctrl+Shift+Tab", "Ctrl+PageUp", "Ctrl+PageDown")

_SPLIT = re.compile(rf"[{_WS}]*\+[{_WS}]*|[{_WS}]+(?=[^{_WS}])")
_STRIP_SEPARATORS = re.compile(rf"[{_WS}_-]+")
_FUNCTION_KEY = re.compile(r"f([1-9]|1[0-9]|2[0-4])")
_PAGE = re.compile(rf"\bpage[{_WS}]+(up|down)\b", re.IGNORECASE)
_ARROW = re.compile(rf"\b(up|down|left|right)[{_WS}]+arrow\b", re.IGNORECASE)
_PLUS_KEY = re.compile(rf"\+[{_WS}]*\+$")
_LAST_PLUS = re.compile(rf"\+?[{_WS}]*\+$")


def _key_of(token):
    """One word of what was typed, as a key, or None if it is not one."""
    t = token.strip(_WS_CHARS)
    if t == "":
        return None
    lower = _STRIP_SEPARATORS.sub("", t.lower())
    if lower in _KEY_NAMES:
        return _KEY_NAMES[lower]
    if _FUNCTION_KEY.fullmatch(lower):
        return lower.upper()
    if len(t) == 1:
        if re.fullmatch("[A-Za-z]", t):
            return t.upper()
        if re.fullmatch("[0-9]", t) or t in _PUNCTUATION:
            return t
    return None


def parse_shortcut(text):
    """Read a shortcut however it was written: (modifiers in the usual order, key), or None if it is not one (no key, more than one key, a word that
    is not a key, or only modifiers)."""
    trimmed = unicodedata.normalize("NFC", text).strip(_WS_CHARS)
    trimmed = _PAGE.sub(lambda m: "page" + m.group(1), trimmed)
    trimmed = _ARROW.sub(lambda m: m.group(1) + "arrow", trimmed)
    if trimmed == "":
        return None
    # A final "+" is the plus key itself ("Ctrl++"), not a separator.
    plus_key = bool(_PLUS_KEY.search(trimmed)) or trimmed == "+"
    body = _LAST_PLUS.sub("", trimmed, count=1) if plus_key else trimmed
    tokens = [] if body == "" else [t for t in _SPLIT.split(body) if t.strip(_WS_CHARS) != ""]
    mods = set()
    keys = ["+"] if plus_key else []
    for token in tokens:
        name = token.strip(_WS_CHARS).lower()
        if name in _MODIFIER_NAMES:
            mods.add(_MODIFIER_NAMES[name])
            continue
        key = _key_of(token)
        if key is None:
            return None
        keys.append(key)
    if len(keys) != 1:
        return None
    return ([m for m in MODIFIERS if m in mods], keys[0])


def format_shortcut(shortcut):
    mods, key = shortcut
    return "+".join([*mods, key])


def canonical_shortcut(text):
    """The one way a shortcut typed in any way is written, or None if it is not a shortcut."""
    parsed = parse_shortcut(text)
    return None if parsed is None else format_shortcut(parsed)


# ---------------------------------------------------------------- which-word passages

MAX_PASSAGE_WORDS = 300

_TOKEN = re.compile(rf"[^{_WS}]+|[{_WS}]+")
_MARK = re.compile(r"\[([^\[\]]*)\]")


def _is_core(ch):
    return unicodedata.category(ch)[0] in ("L", "N")


def read_passage(source):
    """A passage cut into its words and what is wrong with it: {"words": [(text, right)...], "pieces": [...], "problems": [codes]}. The codes are no-words,
    none-marked, empty-mark, split-mark, double-mark and too-many-words, in the order they were found."""
    pieces, words, problems = [], [], []

    def problem(code):
        if code not in problems:
            problems.append(code)

    for token in _TOKEN.findall(unicodedata.normalize("NFC", source)):
        if token[0] in _WS_CHARS:
            pieces.append(("text", token))
            continue
        marks = _MARK.findall(token)
        right = False
        shown = token
        if len(marks) > 1:
            problem("double-mark")
        if marks:
            if marks[0] == "":
                problem("empty-mark")
            right = marks[0] != ""
            shown = _MARK.sub(lambda m: m.group(1), token)
        # A bracket left over means a mark that runs across words, which a learner could not choose as one.
        if "[" in shown or "]" in shown:
            problem("split-mark")
            shown = shown.replace("[", "").replace("]", "")
        start = 0
        while start < len(shown) and not _is_core(shown[start]):
            start += 1
        end = len(shown)
        while end > start and not _is_core(shown[end - 1]):
            end -= 1
        core = shown[start:end]
        if core == "":
            pieces.append(("text", shown))
            continue
        if start > 0:
            pieces.append(("text", shown[:start]))
        word_id = f"w{len(words) + 1}"
        words.append((core, right))
        pieces.append(("word", core, word_id))
        if end < len(shown):
            pieces.append(("text", shown[end:]))
    if not words:
        problem("no-words")
    elif not any(right for _, right in words):
        problem("none-marked")
    if len(words) > MAX_PASSAGE_WORDS:
        problem("too-many-words")
    return {"words": words, "pieces": pieces, "problems": problems}


def shown_passage(source):
    """The passage as the learner reads it: the words and punctuation, with no marks."""
    return "".join(p[1] for p in read_passage(source)["pieces"])
