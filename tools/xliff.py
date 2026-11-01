"""Translation files for a course: export the words to an XLIFF 1.2 file, and import the translated file as a new project.

    python xliff.py export PROJECT_DIR OUT.xlf --to fr-FR [--pseudo] [--json]
    python xliff.py import PROJECT_DIR FILE.xlf (OUT_DIR | --into PARENT_DIR) [--language fr-FR] [--json]
    python xliff.py uncovered PROJECT_DIR

A translator works in a tool that reads XLIFF (OmegaT, Weblate and many others), not in OpenStage. The
export gathers every piece of text a learner reads or hears: slide text, button labels, alt text, narration scripts, quiz choices
and answers, scenario lines, results messages and so on. A paragraph or heading is one unit; its bold, links and line breaks
travel as tags the translator can move but not change. Words are never joined into one blob, so a translation memory sees each
sentence on its own.

The import never touches the original. It writes the translated course to a new folder (OUT_DIR, or with --into a folder named
after the project and the language, such as Intro-fr-FR.osproj, inside PARENT_DIR): the translations are put back where the
words came from, the course language is set, and the narration of every translated script is marked as being in the new language
(the voice still has to be chosen). Anything it cannot put back safely is left in the original language and listed: a unit whose
source no longer matches the project, one whose tags were changed, one that lost a {placeholder}. The result is then checked with
the same checker as the editor's Problems list.

The player's own words (Next, Listen, "Slide 2 of 9" and the rest, listed in player-text.json) are in the file too, as a group at
the end, and come back as the project's playerText, so a translated course is in its language all the way through.

What it leaves alone, on purpose: names and ids, variable names and values (they are logic), file names, pronunciation entries,
and the words of caption files (they are separate WebVTT files).

Only the standard library is used. A pseudo-translation (--pseudo) fills every target with accented, longer text so the course can
be looked at in a language nobody has to read, to find text that does not fit and text that never reached the file.
"""

import copy
import html
import json
import pathlib
import re
import shutil
import sys
import xml.etree.ElementTree as ET
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))  # -I mode drops the script folder
import validate  # noqa: E402
from quiztext import read_passage  # noqa: E402

PLAYER_TEXT = validate.PLAYER_TEXT   # tools/player-text.json: each of the player's own words with its English
PLAYER_GROUP = "The player's own words"
XLIFF_NS = "urn:oasis:names:tc:xliff:document:1.2"
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"

LETTER = re.compile(r"[^\W\d_]")
PLACEHOLDER = re.compile(r"\{\{[^{}]*\}\}|\{[^{}]*\}")   # {{$score}} (a value) or {1} (a blank)
LANGUAGE = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$")
_INVALID_XML = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff￾￿]")


class XliffError(ValueError):
    """Something wrong with the project or the file, said so a person can act on it."""


def clean(text):
    return _INVALID_XML.sub("", str(text))


def xesc(text):
    """Text for an attribute."""
    return html.escape(clean(text), quote=True)


def xtext(text):
    """Text for the inside of an element."""
    return html.escape(clean(text), quote=False)


def norm(text):
    return re.sub(r"\s+", " ", text).strip()


# ---------------------------------------------------------------- html into segments and inline items

_TOKEN = re.compile(r"<!--.*?-->|<[^<>]*>|[^<]+|<", re.S)
_TAG = re.compile(r"<(/?)([A-Za-z][A-Za-z0-9]*)\b")
SEG_BLOCKS = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote"}
STRUCT = {"ul", "ol"}
VOID = {"br", "hr", "img"}
CTYPES = {"strong": "bold", "b": "bold", "em": "italic", "i": "italic", "u": "underlined", "a": "link", "br": "lb"}


def tag_info(tok):
    """(closing, name, self_closing) for a tag token, or None for text and comments."""
    if tok.startswith("<!--"):
        return None
    m = _TAG.match(tok)
    if not m:
        return None
    return bool(m.group(1)), m.group(2).lower(), tok.endswith("/>")


def is_markup(tok):
    return tok.startswith("<!--") or tag_info(tok) is not None


def has_words(tokens):
    return any(not is_markup(t) and LETTER.search(html.unescape(t)) for t in tokens)


def _matching_close(toks, i, name):
    depth = 0
    for k in range(i, len(toks)):
        info = tag_info(toks[k])
        if info and info[1] == name and not info[2]:
            depth += -1 if info[0] else 1
            if depth == 0:
                return k
    return None


def _trim(tokens):
    """Whitespace at either end of a segment belongs to the skeleton, so a translator never sees it."""
    toks = list(tokens)
    lead = trail = ""
    while toks and not is_markup(toks[0]):
        stripped = toks[0].lstrip()
        lead += toks[0][: len(toks[0]) - len(stripped)]
        if stripped:
            toks[0] = stripped
            break
        toks.pop(0)
    while toks and not is_markup(toks[-1]):
        stripped = toks[-1].rstrip()
        trail = toks[-1][len(stripped):] + trail
        if stripped:
            toks[-1] = stripped
            break
        toks.pop()
    return lead, toks, trail


def split_html(src):
    """The html as parts: ("skel", raw text kept as it is) and ("seg", tokens to translate). Joined again they are the original."""
    toks = _TOKEN.findall(src)
    parts = []
    run = []

    def add_segment(tokens):
        if has_words(tokens):
            lead, core, trail = _trim(tokens)
            if lead:
                parts.append(("skel", lead))
            parts.append(("seg", core))
            if trail:
                parts.append(("skel", trail))
        elif tokens:
            parts.append(("skel", "".join(tokens)))

    def flush():
        if run:
            add_segment(list(run))
            run.clear()

    i, n = 0, len(toks)
    while i < n:
        tok = toks[i]
        info = tag_info(tok)
        if info and not info[0] and not info[2] and info[1] in SEG_BLOCKS:
            j = _matching_close(toks, i, info[1])
            if j is not None:
                flush()
                parts.append(("skel", tok))
                add_segment(toks[i + 1:j])
                parts.append(("skel", toks[j]))
                i = j + 1
                continue
        if info and (info[1] in STRUCT or info[1] in SEG_BLOCKS):
            flush()
            parts.append(("skel", tok))
        elif not run and not is_markup(tok) and not tok.strip():
            parts.append(("skel", tok))
        else:
            run.append(tok)
        i += 1
    flush()
    return parts


def join_parts(parts, replacements):
    """The html again, with the segments in `replacements` (by their number) swapped for new html."""
    out, seg = [], 0
    for kind, value in parts:
        if kind == "skel":
            out.append(value)
        else:
            out.append(replacements.get(seg, "".join(value)))
            seg += 1
    return "".join(out)


def to_items(tokens):
    """Inline items for a segment: ("t", text), ("open", tag, id, pair), ("close", tag, id, pair) and ("ph", tag, id, 0)."""
    items, stack, n, pair = [], [], 0, 0
    for tok in tokens:
        if tok.startswith("<!--"):
            n += 1
            items.append(("ph", tok, n, 0))
            continue
        info = tag_info(tok)
        if info is None:
            text = html.unescape(tok)
            if items and items[-1][0] == "t":
                items[-1] = ("t", items[-1][1] + text, 0, 0)
            else:
                items.append(("t", text, 0, 0))
            continue
        closing, name, selfc = info
        n += 1
        if name in VOID or selfc:
            items.append(("ph", tok, n, 0))
        elif not closing:
            pair += 1
            stack.append((name, len(items), pair))
            items.append(("open", tok, n, pair))
        else:
            k = next((k for k in range(len(stack) - 1, -1, -1) if stack[k][0] == name), None)
            if k is None:
                items.append(("ph", tok, n, 0))
                continue
            for _, pos, _ in stack[k + 1:]:
                items[pos] = ("ph", items[pos][1], items[pos][2], 0)
            _, _, pr = stack[k]
            del stack[k:]
            items.append(("close", tok, n, pr))
    for _, pos, _ in stack:
        items[pos] = ("ph", items[pos][1], items[pos][2], 0)
    return items


def _ctype(literal):
    if literal.startswith("<!--"):
        return "x-html-comment"
    info = tag_info(literal)
    name = info[1] if info else "tag"
    return CTYPES.get(name, "x-html-" + name)


def items_to_xml(items):
    out = []
    for kind, val, i, pr in items:
        if kind == "t":
            out.append(xtext(val))
        elif kind == "open":
            out.append(f'<bpt id="{i}" rid="{pr}" ctype="{_ctype(val)}">{xtext(val)}</bpt>')
        elif kind == "close":
            out.append(f'<ept id="{i}" rid="{pr}">{xtext(val)}</ept>')
        else:
            out.append(f'<ph id="{i}" ctype="{_ctype(val)}">{xtext(val)}</ph>')
    return "".join(out)


def items_to_html(items):
    return "".join(html.escape(val, quote=False) if kind == "t" else val for kind, val, _, _ in items)


def items_plain(items):
    return norm("".join(val for kind, val, _, _ in items if kind == "t"))


def canon(items):
    """What must match between the source in the project and the source in a file: the text and the tags, not their numbering."""
    out = []
    for kind, val, _, _ in items:
        if kind == "t":
            if out and out[-1][0] == "t":
                out[-1] = ("t", out[-1][1] + val)
            else:
                out.append(("t", val))
        else:
            out.append(("x", val))
    return out


def strip_edges(items):
    items = list(items)
    if items and items[0][0] == "t":
        items[0] = ("t", items[0][1].lstrip(), 0, 0)
    if items and items[-1][0] == "t":
        items[-1] = ("t", items[-1][1].rstrip(), 0, 0)
    return [it for it in items if not (it[0] == "t" and not it[1])]


def _local(tag):
    return tag.split("}")[-1]


def items_from_element(el):
    """The inline items inside a <source> or <target>. Tags are read from the content of ph, bpt, ept and it elements."""
    items = []

    def add_text(s):
        if not s:
            return
        if items and items[-1][0] == "t":
            items[-1] = ("t", items[-1][1] + s, 0, 0)
        else:
            items.append(("t", s, 0, 0))

    def walk(e):
        add_text(e.text)
        for ch in e:
            tag = _local(ch.tag)
            if tag in ("ph", "bpt", "ept", "it"):
                literal = "".join(ch.itertext())
                kind = {"bpt": "open", "ept": "close"}.get(tag, "ph")
                try:
                    ident = int(ch.get("id") or 0)
                    pair = int(ch.get("rid") or 0)
                except ValueError:
                    ident = pair = 0
                items.append((kind, literal, ident, pair))
            elif tag == "mrk":
                walk(ch)
            else:
                raise XliffError(f"it holds an inline element <{tag}> that OpenStage cannot put back")
            add_text(ch.tail)

    walk(el)
    return items


# ---------------------------------------------------------------- what is translatable

class Unit:
    """One thing to translate: a string at a place in a file, or one paragraph of an html string."""

    def __init__(self, uid, file, pointer, kind, group, note, items=None, text=None, seg=None):
        self.id = uid
        self.file = file          # "project" or a slide id
        self.pointer = pointer    # keys and indexes into that file's JSON
        self.kind = kind          # "plain" or "html"
        self.group = group
        self.note = note
        self.items = items        # html: the segment's inline items
        self.text = text          # plain: the string
        self.seg = seg            # html: the segment's number within its field
        self.mirrors = []         # other places that say exactly the same words: (file, pointer)

    @property
    def plain(self):
        return norm(self.text) if self.kind == "plain" else items_plain(self.items)


def _expand(node, parts, path=()):
    if not parts:
        yield path, node
        return
    head, rest = parts[0], parts[1:]
    if head == "[]":
        if isinstance(node, list):
            for k, v in enumerate(node):
                yield from _expand(v, rest, path + (k,))
    elif head == "*":
        if isinstance(node, dict):
            for k, v in node.items():
                yield from _expand(v, rest, path + (k,))
    elif isinstance(node, dict) and head in node:
        yield from _expand(node[head], rest, path + (head,))


def get_at(root, pointer):
    for p in pointer:
        root = root[p]
    return root


def set_at(root, pointer, value):
    get_at(root, pointer[:-1])[pointer[-1]] = value


# (pattern, kind, label, mirrors-an-earlier-unit); ("each", pattern, [entries]) walks a list, each element its own scope.
def _p(pattern, label, kind="plain", mirror=False):
    return (pattern, kind, label, mirror)


def _each(pattern, *entries):
    return ("each", pattern, list(entries))


_TAIL = [
    _p("accessibility.altText", "Alt text", mirror=True),
    _p("narration.script", "Narration script", mirror=True),
    _p("states.*.announce", "What a screen reader says for this look"),
]
_HTML = lambda label: [_p("content.html", label, "html")]  # noqa: E731
_TRANSCRIPT = [_p("content.transcript", "Transcript", "html")]

SPECS = {
    "text": _HTML("Text"),
    "scrollingText": _HTML("Text"),
    "button": [_p("content.label", "Button label")],
    "audio": _TRANSCRIPT,
    "video": _TRANSCRIPT,
    "embed": _TRANSCRIPT,
    "download": [_p("content.title", "Title"), _p("content.description", "What the file is")],
    "certificate": [_p("content.title", "Title"), _p("content.statement", "Statement"), _p("content.achievement", "Achievement"), _p("content.issuedBy", "Issued by")],
    "timer": [_p("content.label", "Label")],
    "results": [_p("content.heading", "Heading"), _p("content.passMessage", "Pass message"), _p("content.failMessage", "Fail message")],
    "table": [_p("content.caption", "Caption"), _p("content.rows.[].[]", "Cell")],
    "input": [
        _p("content.prompt", "Prompt"), _p("content.hint", "Hint"), _p("content.startLabel", "Start label"), _p("content.endLabel", "End label"), _p("content.unit", "Unit"),
        _p("content.options.[].label", "Choice"), _p("content.items.[].label", "Item"), _p("content.rows.[].label", "Statement"),
        _p("content.rows.[].right", "Opposite"), _p("content.scale.[]", "Scale point"),
    ],
    "interaction": [
        _p("content.graphic.alt", "Picture description"),
        _each("content.items.[]", _p("title", "Item title"), _p("body", "Item text", "html"), _p("image.alt", "Item picture description"),
              _p("narration.script", "Item narration script", mirror=True)),
    ],
    "quizQuestion": [
        _p("content.choices.[].label", "Choice"), _p("content.extras.[]", "Extra wrong option"), _p("content.items.[].text", "Item to put in order"),
        _p("content.pairs.[].premise", "Left side of a match"), _p("content.pairs.[].match", "Right side of a match"),
        _p("content.wordBank.[]", "Word bank"), _p("content.blanks.[].answers.[]", "Accepted answer for a blank"),
        _p("content.answers.[]", "Accepted answer"), _p("content.text", "Text with blanks"), _p("content.image.alt", "Picture description"),
        _p("content.regions.[].label", "Place on the picture"),
        _p("content.passage", "Passage to choose a word from: keep the [square brackets] round the right word"),
    ],
    "scenario": [
        _p("content.meters.[].label", "Meter"), _p("content.reflection", "Reflection"),
        _each("content.nodes.[]", _p("title", "Situation title"), _p("prompt", "Question"),
              _each("lines.[]", _p("text", "Line"), _p("narration.script", "Line narration script", mirror=True)),
              _each("choices.[]", _p("label", "Choice"),
                    _each("response.[]", _p("text", "Response"), _p("narration.script", "Response narration script", mirror=True)))),
    ],
}


class _Collector:
    def __init__(self):
        self.units = []
        self.covered = set()   # (file, normalised path) of every string the exporter accounts for
        self.captions = []

    def norm_path(self, pointer):
        return ".".join("[]" if isinstance(p, int) else p for p in pointer)

    def cover(self, file, pointer):
        self.covered.add((file, self.norm_path(pointer)))

    def add_plain(self, scope, file, pointer, value, group, note, mirror=False):
        self.cover(file, pointer)
        if not isinstance(value, str) or not LETTER.search(value):
            return
        if mirror:
            for cand in scope:
                if cand.plain == norm(value):
                    cand.mirrors.append((file, pointer))
                    return
        unit = Unit(self._id(file, pointer), file, pointer, "plain", group, note, text=value)
        scope.append(unit)
        self.units.append(unit)

    def add_html(self, scope, file, pointer, value, group, note):
        self.cover(file, pointer)
        if not isinstance(value, str):
            return
        seg = 0
        for kind, content in split_html(value):
            if kind != "seg":
                continue
            unit = Unit(self._id(file, pointer, seg), file, pointer, "html", group, note, items=to_items(content), seg=seg)
            scope.append(unit)
            self.units.append(unit)
            seg += 1

    def _id(self, file, pointer, seg=None):
        base = f"{file}|{'/'.join(str(p) for p in pointer)}"
        return base if seg is None else f"{base}#{seg}"

    def walk_entries(self, node, base, entries, file, group, note_prefix, scope):
        for entry in entries:
            if entry[0] == "each":
                _, pattern, sub = entry
                for pointer, element in _expand(node, pattern.split(".")):
                    self.walk_entries(element, base + pointer, sub, file, group, note_prefix, [])
                continue
            pattern, kind, label, mirror = entry
            for pointer, value in _expand(node, pattern.split(".")):
                full = base + pointer
                note = f"{note_prefix}{label}"
                if kind == "html":
                    self.add_html(scope, file, full, value, group, note)
                else:
                    self.add_plain(scope, file, full, value, group, note, mirror)

    def add_object(self, obj, file, base, group, layer_label):
        label = {"quizQuestion": "Question", "scrollingText": "Scrolling text"}.get(obj["type"], obj["type"].capitalize())
        prefix = f'{layer_label}{label} "{obj.get("name", "")}": '
        scope = []
        self.walk_entries(obj, base, SPECS.get(obj["type"], []), file, group, prefix, scope)
        self.walk_entries(obj, base, _TAIL, file, group, prefix, scope)
        if obj["type"] == "video" and isinstance(obj.get("content", {}).get("captions"), str):
            self.captions.append(obj["content"]["captions"])


def _slide_ids(project):
    ids = []
    for scene in project.get("scenes", []):
        for sid in scene.get("slides", []):
            if sid not in ids:
                ids.append(sid)
    for bank in project.get("banks", []):
        for sid in bank.get("slides", []):
            if sid not in ids:
                ids.append(sid)
    return ids


def read_json(path):
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def file_style(path):
    """How a file is laid out besides its indent: (uses CRLF line endings, ends with a newline)."""
    raw = pathlib.Path(path).read_bytes()
    return b"\r\n" in raw, raw.endswith(b"\n")


def write_json(path, data, style=(False, True)):
    """Two-space indent and accents as they are, with the file's own line endings and its ending, so a translated project differs
    from the original only where the words are."""
    crlf, final_newline = style
    text = json.dumps(data, indent=2, ensure_ascii=False) + ("\n" if final_newline else "")
    pathlib.Path(path).write_bytes((text.replace("\n", "\r\n") if crlf else text).encode("utf-8"))


class Course:
    """A project read for translation: its files and its units, in the order a translator meets them."""

    def __init__(self, project_dir):
        self.dir = pathlib.Path(project_dir)
        pj = self.dir / "project.json"
        if not pj.is_file():
            raise XliffError(f"{self.dir} is not a project: project.json is not there")
        self.project = read_json(pj)
        self.style = {"project": file_style(pj)}
        self.slides = {}
        for sid in _slide_ids(self.project):
            path = self.dir / "slides" / f"{sid}.json"
            if not path.is_file():
                raise XliffError(f"The course plays slide {sid}, but slides/{sid}.json is not in the project")
            self.slides[sid] = read_json(path)
            self.style[sid] = file_style(path)
        self.collector = c = _Collector()
        self.units = c.units
        self._collect(c)

    def _collect(self, c):
        project = self.project
        scope = []
        c.add_plain(scope, "project", ("meta", "title"), project["meta"]["title"], "Course", "Course title")
        for i, scene in enumerate(project.get("scenes", [])):
            c.add_plain(scope, "project", ("scenes", i, "name"), scene.get("name"), "Course", "Section name")
        for i, person in enumerate(project.get("characters", [])):
            who = person.get("name", "")
            c.add_plain(scope, "project", ("characters", i, "name"), person.get("name"), "Course", "Name of a person in the cast")
            c.add_plain(scope, "project", ("characters", i, "role"), person.get("role"), "Course", f"Role of {who}")
            if isinstance(person.get("picture"), dict):
                c.add_plain(scope, "project", ("characters", i, "picture", "alt"), person["picture"].get("alt"), "Course", f"Picture description of {who}")
        for number, (sid, slide) in enumerate(self.slides.items(), 1):
            group = f"Slide {number}: {slide.get('name', sid)}"
            c.add_plain([], sid, ("name",), slide.get("name"), group, "Slide name")
            layers = [(("baseLayer",), slide["baseLayer"], "")] + [(("layers", k), layer, f'On layer "{layer.get("name", "")}": ') for k, layer in enumerate(slide.get("layers", []))]
            for base, layer, layer_label in layers:
                for j, obj in enumerate(layer.get("objects", [])):
                    c.add_object(obj, sid, base + ("objects", j), group, layer_label)
        # The player's own words come last, so a translator meets the course's words first. They start as English whatever the project
        # holds, so a file made twice is the same file and a translation that was already put in does not change what is asked.
        for key, entry in PLAYER_TEXT.items():
            c.add_plain([], "project", ("playerText", key), entry["text"], PLAYER_GROUP, f"The player's own words: {entry['note']}")

    def file_json(self, file):
        return self.project if file == "project" else self.slides[file]

    def groups(self):
        """[(group name, [units])] in order."""
        out = []
        for unit in self.units:
            if not out or out[-1][0] != unit.group:
                out.append((unit.group, []))
            out[-1][1].append(unit)
        return out

    def captions(self):
        return sorted(set(self.collector.captions))


# ---------------------------------------------------------------- what is not words

# Paths (after OBJ. for an object) that hold ids, references, names for the author, switches and logic, never words a learner reads.
# Nothing here may end in a word a learner reads: label, title, text, body, alt, caption, prompt, html, script, description, message.
NOT_WORDS = [
    "OBJ.id", "OBJ.type", "OBJ.name", "OBJ.group", "OBJ.geometry.*", "OBJ.style.*", "OBJ.timing.*", "OBJ.animation.*", "OBJ.provenance.*",
    "OBJ.simulation.*", "OBJ.accessibility.role", "OBJ.triggers.*", "OBJ.states.*",
    "OBJ.*narration.voice", "OBJ.*narration.lang", "OBJ.*narration.pronunciations.*", "OBJ.*narration.audioCache.*",
    "OBJ.content.bubble", "OBJ.content.tail", "OBJ.content.shape", "OBJ.content.src", "OBJ.content.name", "OBJ.content.set", "OBJ.content.shapes.*",
    "OBJ.content.icon.*", "OBJ.content.iconPlacement", "OBJ.content.captions", "OBJ.content.provider", "OBJ.content.id", "OBJ.content.hash",
    "OBJ.content.kind", "OBJ.content.mode", "OBJ.content.orientation", "OBJ.content.questionType", "OBJ.content.feedback.*",
    "OBJ.content.variable", "OBJ.content.characters.*", "OBJ.content.finishedVariable", "OBJ.content.you", "OBJ.content.start",
    "OBJ.content.options.[].value", "OBJ.content.options.[].id", "OBJ.content.items.[].id", "OBJ.content.items.[].variable", "OBJ.content.items.[].image.src",
    "OBJ.content.rows.[].id", "OBJ.content.rows.[].variable", "OBJ.content.choices.[].id", "OBJ.content.blanks.[].id",
    "OBJ.content.graphic.src", "OBJ.content.image.src", "OBJ.content.regions.[].id", "OBJ.content.keys.[]",
    "OBJ.content.meters.[].id", "OBJ.content.meters.[].variable",
    "OBJ.content.nodes.[].id", "OBJ.content.nodes.[].kind", "OBJ.content.nodes.[].choices.[].id", "OBJ.content.nodes.[].choices.[].next",
    "OBJ.content.nodes.[].choices.[].effects.*", "OBJ.content.nodes.[].choices.[].response.[].speaker", "OBJ.content.nodes.[].choices.[].response.[].pose",
    "OBJ.content.nodes.[].lines.[].speaker", "OBJ.content.nodes.[].lines.[].pose", "OBJ.content.nodes.[].lines.[].id",
    "OBJ.content.nodes.[].choices.[].response.[].id", "OBJ.content.pairs.[].id",
]
SLIDE_NOT_WORDS = [
    "id", "layout", "background", "duration", "LAYER.id", "LAYER.name",
]
PROJECT_NOT_WORDS = [
    "schemaVersion", "meta.author", "meta.created", "meta.modified", "meta.language", "theme.*", "completion.*", "variables.*", "banks.*", "sources.*",
    "sourceExclude.*", "settings.*", "scenes.[].id", "scenes.[].slides.*", "characters.[].id", "characters.[].voice", "characters.[].picture.src",
    "characters.[].poses.*", "characters.[].library.*",
]


def _normalise(file, path):
    p = path
    if file != "project":
        p = re.sub(r"^(baseLayer|layers\.\[\])\.objects\.\[\]\.", "OBJ.", p)
        p = re.sub(r"^(baseLayer|layers\.\[\])\.(id|name)$", r"LAYER.\2", p)
    return p


def _glob(pattern):
    """A pattern in which * stands for any run of characters, dots included. (fnmatch would read [] as a character class.)"""
    return re.compile("^" + ".*".join(re.escape(part) for part in pattern.split("*")) + "$")


def _string_leaves(node, path=()):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from _string_leaves(v, path + (k,))
    elif isinstance(node, list):
        for k, v in enumerate(node):
            yield from _string_leaves(v, path + (k,))
    elif isinstance(node, str) and node:
        yield path, node


def uncovered(project_dir):
    """Strings in the project that are neither exported nor known to be something other than words: (file, path, sample).
    A new kind of text that nobody told the exporter about turns up here."""
    course = Course(project_dir)
    c = course.collector
    found = []
    files = [("project", course.project)] + list(course.slides.items())
    for file, data in files:
        patterns = PROJECT_NOT_WORDS if file == "project" else NOT_WORDS + SLIDE_NOT_WORDS
        for pointer, value in _string_leaves(data):
            path = c.norm_path(pointer)
            if (file, path) in c.covered:
                continue
            shown = _normalise(file, path)
            if any(_glob(pat).match(shown) for pat in patterns):
                continue
            found.append((file, path, value[:60]))
    return found


# ---------------------------------------------------------------- pseudo-translation

_ACCENTS = dict(zip("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
                    "àƀçďéƒĝĥìĵķłḿñöþqŕšťüṿẃxýžÀßÇĎÉFĜĤÌĴĶĿṀÑÖÞQŔŠŤÜṼẂXÝŽ"))


def pseudo(text, marked=False):
    """Accented and longer, the way a translation often is, with {placeholders} left alone. A passage with its right word in [square brackets] is not
    wrapped in more brackets, which would be another mark."""
    out, last = [], 0
    for m in PLACEHOLDER.finditer(text):
        out.append("".join(_ACCENTS.get(ch, ch) for ch in text[last:m.start()]))
        out.append(m.group())
        last = m.end()
    out.append("".join(_ACCENTS.get(ch, ch) for ch in text[last:]))
    body = "".join(out)
    words = len(text.split())
    if marked:
        return f"{body}{' ~' * max(1, words // 3)}"
    return f"[{body}{' ~' * max(1, words // 3)}]"


def pseudo_items(items, marked=False):
    return [("t", pseudo(val, marked), 0, 0) if kind == "t" and LETTER.search(val) else (kind, val, i, pr) for kind, val, i, pr in items]


def _is_passage(unit):
    """The passage of a which-word question: its right word is marked with square brackets, which a translation has to keep."""
    return unit.kind == "plain" and tuple(unit.pointer[-2:]) == ("content", "passage")


_MARK = re.compile(r"\[[^\[\]]+\]")


def _passage_problem(source, target):
    """Why a translated passage cannot be put back, or None: it must have the same number of marks, each round one word."""
    if len(_MARK.findall(source)) != len(_MARK.findall(target)):
        return "the [square brackets] that mark the right word were lost or added"
    new = [p for p in read_passage(target)["problems"] if p not in read_passage(source)["problems"]]
    if new:
        return "the right word is no longer one word in square brackets (" + ", ".join(new) + ")"
    return None


# ---------------------------------------------------------------- export

def _words(text):
    return len(text.split())


def export(project_dir, target_language, make_pseudo=False):
    """The XLIFF 1.2 file for translating the project into `target_language`, as bytes, and a short account of it."""
    if not LANGUAGE.match(target_language or ""):
        raise XliffError(f"'{target_language}' is not a language tag such as fr-FR or es")
    course = Course(project_dir)
    meta = course.project["meta"]
    source_language = meta["language"]
    if target_language == source_language:
        raise XliffError(f"The course is already in {source_language}. Choose another language, or a different variety such as en-GB.")
    out = ['<?xml version="1.0" encoding="UTF-8"?>', f'<xliff version="1.2" xmlns="{XLIFF_NS}">']
    out.append(f'  <file original="{xesc(meta["title"])}" source-language="{xesc(source_language)}" target-language="{xesc(target_language)}" datatype="x-openstage" tool-id="openstage-author">')
    out.append('    <header>')
    out.append(f'      <tool tool-id="openstage-author" tool-name="OpenStage Author" tool-version="{xesc(course.project["schemaVersion"])}"/>')
    out.append('      <note>Translate the text inside each source element. The coloured or bracketed tags in it are formatting and links: keep every one, '
               'and you may move them. Keep any {placeholder} exactly as it is. Do not change the source text: the import checks it still matches the course.</note>')
    out.append('    </header>')
    out.append('    <body>')
    words = 0
    for group, units in course.groups():
        gid = "player-text" if units[0].pointer[0] == "playerText" else units[0].file
        out.append(f'      <group id="{xesc(gid)}" resname="{xesc(group)}">')
        for u in units:
            source_items = u.items if u.kind == "html" else [("t", u.text, 0, 0)]
            words += _words(u.plain)
            out.append(f'        <trans-unit id="{xesc(u.id)}" xml:space="preserve" restype="x-{u.kind}">')
            out.append(f'          <source xml:lang="{xesc(source_language)}">{items_to_xml(source_items)}</source>')
            if make_pseudo:
                target = pseudo_items(source_items, _is_passage(u))
                out.append(f'          <target xml:lang="{xesc(target_language)}" state="needs-review-translation">{items_to_xml(target)}</target>')
            out.append(f'          <note from="developer">{xtext(u.note)}</note>')
            out.append('        </trans-unit>')
        out.append('      </group>')
    out += ['    </body>', '  </file>', '</xliff>', '']
    summary = {
        "units": len(course.units), "words": words, "slides": len(course.slides), "sourceLanguage": source_language,
        "targetLanguage": target_language, "captionFiles": course.captions(),
    }
    return "\n".join(out).encode("utf-8"), summary


# ---------------------------------------------------------------- import

def _read_file(data):
    raw = data if isinstance(data, bytes) else pathlib.Path(data).read_bytes()
    head = raw[:200000].lower()
    if b"<!doctype" in head or b"<!entity" in head:
        raise XliffError("The file has a document type or entity declaration, which a translation file does not need. It was not read.")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as err:
        raise XliffError(f"The file is not well-formed XML: {err}") from err
    if _local(root.tag) != "xliff":
        raise XliffError("The file is not an XLIFF file: the top element is not <xliff>.")
    if root.get("version") not in ("1.2", "1.1", "1.0"):
        raise XliffError(f"The file is XLIFF {root.get('version')}; OpenStage reads XLIFF 1.2.")
    return root


def _units_in_file(root):
    """{id: (source element, target element or None, state)} and the target language."""
    found, language = {}, None
    for file in root.iter():
        if _local(file.tag) != "file":
            continue
        language = language or file.get("target-language")
        for tu in file.iter():
            if _local(tu.tag) != "trans-unit":
                continue
            source = target = None
            for ch in tu:
                if _local(ch.tag) == "source":
                    source = ch
                elif _local(ch.tag) == "target" and target is None:
                    target = ch
            if tu.get("id") and source is not None:
                found[tu.get("id")] = (source, target, (target.get("state") if target is not None else None))
    return found, language


def _markup_problem(source_items, target_items):
    """Why a translated unit cannot be put back, or None."""
    src = Counter(val for kind, val, _, _ in source_items if kind != "t")
    tgt = Counter(val for kind, val, _, _ in target_items if kind != "t")
    if src != tgt:
        missing = list((src - tgt).elements())
        extra = list((tgt - src).elements())
        bits = []
        if missing:
            bits.append("lost " + ", ".join(missing[:3]))
        if extra:
            bits.append("added " + ", ".join(extra[:3]))
        return "the tags were changed (" + "; ".join(bits) + ")"
    stack = []
    for kind, val, _, _ in target_items:
        if kind == "open":
            stack.append((tag_info(val) or (0, "?", 0))[1])
        elif kind == "close":
            name = (tag_info(val) or (0, "?", 0))[1]
            if not stack or stack.pop() != name:
                return "the tags are out of order or cross each other"
    if stack:
        return "a tag is not closed"
    src_ph = Counter(PLACEHOLDER.findall("".join(v for k, v, _, _ in source_items if k == "t")))
    tgt_ph = Counter(PLACEHOLDER.findall("".join(v for k, v, _, _ in target_items if k == "t")))
    if src_ph != tgt_ph:
        lost = list((src_ph - tgt_ph).elements())
        return "a placeholder was changed or lost" + (f" ({', '.join(lost[:3])})" if lost else "")
    return None


def _within(inner, outer):
    try:
        inner.relative_to(outer)
        return True
    except ValueError:
        return False


def translated_name(project_dir, language):
    """The name a translated copy of a project gets: Intro.osproj into fr-FR is Intro-fr-FR.osproj."""
    raw = pathlib.Path(project_dir).resolve().name
    stem = raw[: -len(".osproj")] if raw.lower().endswith(".osproj") else raw
    return f"{stem}-{language}.osproj"


def import_xliff(project_dir, xliff, out_dir=None, language=None, into=None):
    """Write the translated course to `out_dir` (a new or empty folder), or with `into` to a folder inside it named after the project and
    the language, and return a report of what was done."""
    project_dir = pathlib.Path(project_dir).resolve()
    root = _read_file(xliff)
    in_file, file_language = _units_in_file(root)
    language = language or file_language
    if not language or not LANGUAGE.match(language):
        raise XliffError("The file does not say which language it is translated into (the target-language of its <file>), and none was given.")
    if out_dir is None:
        if into is None:
            raise XliffError("Say where the translated course goes.")
        out_dir = pathlib.Path(into) / translated_name(project_dir, language)
    out_dir = pathlib.Path(out_dir).resolve()
    if _within(out_dir, project_dir) or _within(project_dir, out_dir):
        raise XliffError("The translated course must go in a folder of its own: not the project, not a folder that holds it, and not one inside it.")
    if out_dir.exists() and (not out_dir.is_dir() or any(out_dir.iterdir())):
        raise XliffError(f"{out_dir} already exists and is not empty. Choose a new folder so nothing is overwritten.")
    course = Course(project_dir)
    if language == course.project["meta"]["language"]:
        raise XliffError(f"The file is for {language}, which is the course's own language.")

    report = {"translated": 0, "untranslated": 0, "outOfDate": [], "rejected": [], "unknown": [], "language": language}
    done = {}   # unit id -> translated items (html) or text (plain)
    known = {u.id for u in course.units}
    for uid in in_file:
        if uid not in known:
            report["unknown"].append(uid)
    for u in course.units:
        entry = in_file.get(u.id)
        if entry is None:
            report["untranslated"] += 1
            continue
        source_el, target_el, _ = entry
        try:
            file_source = canon(strip_edges(items_from_element(source_el)))
            here = canon(strip_edges(u.items if u.kind == "html" else [("t", u.text, 0, 0)]))
            if file_source != here:
                report["outOfDate"].append(u.id)
                continue
            if target_el is None or not "".join(target_el.itertext()).strip():
                report["untranslated"] += 1
                continue
            target_items = strip_edges(items_from_element(target_el))
        except XliffError as err:
            report["rejected"].append({"id": u.id, "reason": str(err)})
            continue
        source_items = u.items if u.kind == "html" else [("t", u.text, 0, 0)]
        if u.kind == "plain" and any(kind != "t" for kind, _, _, _ in target_items):
            report["rejected"].append({"id": u.id, "reason": "this is plain text, but the translation has tags in it"})
            continue
        problem = _markup_problem(strip_edges(source_items), target_items)
        if not problem and _is_passage(u):
            problem = _passage_problem(u.text, "".join(v for _, v, _, _ in target_items))
        if problem:
            report["rejected"].append({"id": u.id, "reason": problem})
            continue
        if canon(target_items) == canon(strip_edges(source_items)):
            report["untranslated"] += 1   # the same as the source: nothing to put back
            continue
        done[u.id] = target_items
        report["translated"] += 1

    # Put the translations into copies of the files.
    files = {"project": copy.deepcopy(course.project)}
    files.update({sid: copy.deepcopy(s) for sid, s in course.slides.items()})
    by_field = {}
    narration_changed = set()

    def narration_note(file, pointer):
        if pointer[-1] == "script" and len(pointer) >= 2 and pointer[-2] == "narration":
            narration_changed.add((file, pointer[:-1]))

    for u in course.units:
        target = done.get(u.id)
        if target is None:
            continue
        plain = items_plain(target)
        if u.kind == "plain":
            if u.pointer[0] == "playerText":
                files["project"].setdefault("playerText", {})
            set_at(files[u.file], u.pointer, "".join(v for _, v, _, _ in target))
            narration_note(u.file, u.pointer)
        else:
            by_field.setdefault((u.file, u.pointer), {})[u.seg] = items_to_html(target)
        for mfile, mpointer in u.mirrors:
            set_at(files[mfile], mpointer, plain)
            narration_note(mfile, mpointer)
    for (file, pointer), replacements in by_field.items():
        parts = split_html(get_at(course.file_json(file), pointer))
        set_at(files[file], pointer, join_parts(parts, replacements))
    for file, pointer in narration_changed:
        node = get_at(files[file], pointer)
        if isinstance(node, dict) and "lang" in node:
            node["lang"] = language
        if isinstance(node, dict) and "audioCache" in node:
            node["audioCache"] = None
    files["project"]["meta"]["language"] = language
    report["narrationToVoice"] = len(narration_changed)

    shutil.copytree(project_dir, out_dir, ignore=shutil.ignore_patterns(".cache"), dirs_exist_ok=True)
    write_json(out_dir / "project.json", files["project"], course.style["project"])
    for sid, data in files.items():
        if sid != "project":
            write_json(out_dir / "slides" / f"{sid}.json", data, course.style[sid])

    before = {(f.rule, f.file, f.object_id) for f in validate.validate_project(project_dir) if f.severity == "error"}
    after = validate.validate_project(out_dir)
    errors = [f for f in after if f.severity == "error"]
    report["validator"] = {
        "errors": len(errors), "warnings": len(after) - len(errors),
        "newErrors": [f"{f.file} {f.object_id}: {f.message}" for f in errors if (f.rule, f.file, f.object_id) not in before][:10],
    }
    report["captionFiles"] = course.captions()
    report["out"] = str(out_dir)
    return report


# ---------------------------------------------------------------- command line

def _usage():
    print(__doc__.split("\n\n")[1].rstrip(), file=sys.stderr)
    return 2


def _option(argv, name):
    if name in argv:
        i = argv.index(name)
        if i + 1 < len(argv):
            return argv[i + 1], argv[:i] + argv[i + 2:]
    return None, argv


def main(argv):
    # Scripts, alt text and names can be in any language, and a Windows pipe or console is not UTF-8 unless asked: what is printed (the JSON the editor
    # and the publisher read, the progress and the messages) is made UTF-8 so a course in Japanese does not stop the tool.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    if not argv:
        return _usage()
    command, rest = argv[0], argv[1:]
    as_json = "--json" in rest
    use_pseudo = "--pseudo" in rest
    rest = [a for a in rest if a not in ("--json", "--pseudo")]
    try:
        if command == "export":
            target, rest = _option(rest, "--to")
            if len(rest) != 2 or not target:
                return _usage()
            data, summary = export(rest[0], target, use_pseudo)
            out = pathlib.Path(rest[1])
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
            if as_json:
                print(json.dumps({"ok": True, "path": str(out), **summary}))
            else:
                print(f"Translation file: {out}\n{summary['units']} units, {summary['words']} words, from {summary['sourceLanguage']} to {summary['targetLanguage']}.")
                if summary["captionFiles"]:
                    print("Not included: the captions in " + ", ".join(summary["captionFiles"]) + " (WebVTT files are translated separately).")
            return 0
        if command == "import":
            language, rest = _option(rest, "--language")
            into, rest = _option(rest, "--into")
            if len(rest) != (2 if into else 3):
                return _usage()
            report = import_xliff(rest[0], rest[1], None if into else rest[2], language, into)
            if as_json:
                print(json.dumps({"ok": True, **report}))
            else:
                print(f"Translated course: {report['out']} ({report['language']})")
                print(f"{report['translated']} units put back, {report['untranslated']} left in the original language, "
                      f"{len(report['outOfDate'])} out of date, {len(report['rejected'])} refused, {len(report['unknown'])} not in the course.")
                for r in report["rejected"][:20]:
                    print(f"  refused {r['id']}: {r['reason']}")
                for uid in report["outOfDate"][:20]:
                    print(f"  out of date {uid}: the course has changed since the file was made")
                v = report["validator"]
                print(f"The checker finds {v['errors']} errors and {v['warnings']} warnings in the translated course.")
                for line in v["newErrors"]:
                    print(f"  new error: {line}")
                if report["narrationToVoice"]:
                    print(f"{report['narrationToVoice']} narration scripts are now marked {report['language']}: choose a voice for that language.")
                if report["captionFiles"]:
                    print("Caption files are not translated: " + ", ".join(report["captionFiles"]))
            return 0
        if command == "uncovered":
            if len(rest) != 1:
                return _usage()
            found = uncovered(rest[0])
            for file, path, sample in found:
                print(f"{file}  {path}  {sample!r}")
            print(f"{len(found)} strings are not accounted for." if found else "Every string is exported or known not to be words.")
            return 1 if found else 0
    except (XliffError, OSError, KeyError) as err:
        message = f"The translation could not be done: {err}"
        print(json.dumps({"ok": False, "message": message}) if as_json else message, file=sys.stdout if as_json else sys.stderr)
        return 1
    return _usage()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
