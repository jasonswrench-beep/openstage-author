"""Make a page of check boxes from the "What is left" list in ROADMAP.md. Run it with TO-DO.bat, or:  python tools/make_todo.py

The page is dist/todo/index.html. Every item that has a box in the roadmap (- [ ] or - [x]) gets a real check box you can tick with
the mouse or the keyboard. What you tick is remembered by the browser on this computer, by the item's name, so it survives the roadmap
being edited and the page being made again. An item the roadmap marks done starts ticked. The roadmap stays the one list: this only
shows it. Nothing is sent anywhere, and the page uses no outside file.
"""
import hashlib
import html
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
ROADMAP = REPO / "ROADMAP.md"
OUTPUT = REPO / "dist" / "todo" / "index.html"
HEADING = re.compile(r"^##\s+What is left\b.*$", re.M)


def inline(text):
    """A line of the roadmap as safe HTML: **bold** and `code` are kept, everything else is plain words."""
    out = html.escape(text, quote=False)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    out = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", out)
    return out


def item_key(text, taken):
    """A name for an item that stays the same when the words after its bold lead are edited: the lead, in lowercase letters and hyphens."""
    lead = re.search(r"\*\*(.+?)\*\*", text)
    base = re.sub(r"[^a-z0-9]+", "-", (lead.group(1) if lead else text[:60]).lower()).strip("-") or "item"
    key, n = base, 2
    while key in taken:
        key, n = f"{base}-{n}", n + 1
    taken.add(key)
    return key


def parse_roadmap(markdown):
    """The "What is left" part of the roadmap as {"title", "intro", "sections": [{"title", "items", "bullets", "notes"}]}.
    An item is {"key", "done", "html", "text"}."""
    text = markdown.replace("\r\n", "\n")
    start = HEADING.search(text)
    if not start:
        raise ValueError('ROADMAP.md has no "What is left" section.')
    rest = text[start.end():]
    end = re.search(r"^## ", rest, re.M)
    body = rest[: end.start()] if end else rest
    title = start.group(0).lstrip("# ").strip()
    intro, sections, taken = [], [], set()
    current = None
    for line in body.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("### "):
            current = {"title": stripped[4:].strip(), "items": [], "bullets": [], "notes": []}
            sections.append(current)
            continue
        box = re.match(r"^- \[( |x|X)\]\s+(.*)$", stripped)
        bullet = re.match(r"^- (.*)$", stripped)
        if box and current is not None:
            current["items"].append({"key": item_key(box.group(2), taken), "done": box.group(1) != " ", "html": inline(box.group(2)), "text": box.group(2)})
        elif bullet and current is not None:
            current["bullets"].append(inline(bullet.group(1)))
        elif current is not None:
            current["notes"].append(inline(stripped))
        else:
            intro.append(inline(stripped))
    return {"title": title, "intro": intro, "sections": sections}


PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenStage Author: what is left</title>
<style>
:root { --bg: #ffffff; --text: #1a1a1a; --muted: #4a5260; --line: #8c929b; --accent: #0b3fb3; --done: #1e6b2f; --code: #eef0f3; }
@media (prefers-color-scheme: dark) { :root { --bg: #15181d; --text: #f1f3f5; --muted: #b6bdc8; --line: #6b7380; --accent: #8db4ff; --done: #7fd18f; --code: #262b33; } }
body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.5 system-ui, "Segoe UI", sans-serif; }
main { max-width: 56rem; margin: 0 auto; padding: 16px; }
h1 { font-size: 1.6rem; margin: 0.6em 0 0.2em; }
h2 { font-size: 1.2rem; margin: 1.6em 0 0.4em; padding-top: 0.4em; border-top: 2px solid var(--line); }
p { margin: 0.5em 0; }
.muted { color: var(--muted); }
code { background: var(--code); padding: 0 0.25em; border-radius: 3px; font-size: 0.92em; overflow-wrap: anywhere; }
ul { list-style: none; margin: 0; padding: 0; }
li.task { display: flex; gap: 12px; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid var(--line); }
li.task input { flex: none; width: 24px; height: 24px; margin: 2px 0 0; accent-color: var(--accent); }
li.task label { flex: 1; min-width: 0; overflow-wrap: anywhere; cursor: pointer; }
li.task.ticked label { color: var(--muted); }
li.task.ticked label strong { color: var(--done); }
ul.plain { list-style: disc; padding-left: 1.4em; }
ul.plain li { margin: 0.4em 0; overflow-wrap: anywhere; }
.bar { position: sticky; top: 0; z-index: 2; background: var(--bg); border-bottom: 2px solid var(--line); padding: 8px 0; display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center; }
.bar label { display: inline-flex; gap: 8px; align-items: center; min-height: 24px; }
.bar input { width: 22px; height: 22px; accent-color: var(--accent); }
button { font: inherit; padding: 4px 12px; min-height: 28px; color: var(--text); background: var(--bg); border: 2px solid var(--line); border-radius: 6px; cursor: pointer; }
button:focus-visible, input:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
#status { font-weight: 600; }
.empty { color: var(--muted); font-style: italic; }
[hidden] { display: none !important; }
@media (forced-colors: active) { li.task { border-bottom-color: CanvasText; } }
</style>
</head>
<body>
<main>
<h1>__TITLE__</h1>
__INTRO__
<p class="muted">Tick an item when it is done. Your ticks are kept by this browser on this computer, so they are still here next time. This page is made from ROADMAP.md each time, which stays the one list.</p>
<div class="bar" role="group" aria-label="Controls">
  <span id="status" role="status" aria-live="polite"></span>
  <label><input type="checkbox" id="hide"> Hide the ticked items</label>
  <button type="button" id="reset">Clear my ticks</button>
</div>
__SECTIONS__
</main>
<script>
(function () {
  var STORE = "openstage-todo-ticks";
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch (e) { saved = {}; }
  var boxes = Array.prototype.slice.call(document.querySelectorAll("li.task input"));
  var status = document.getElementById("status");
  var hide = document.getElementById("hide");
  function write() { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch (e) { /* kept for this visit only */ } }
  function show(box) { box.closest("li").classList.toggle("ticked", box.checked); }
  function count() {
    var n = boxes.filter(function (b) { return b.checked; }).length;
    status.textContent = n + " of " + boxes.length + " ticked";
  }
  boxes.forEach(function (box) {
    var key = box.getAttribute("data-key");
    box.checked = key in saved ? !!saved[key] : box.getAttribute("data-done") === "true";
    show(box);
    box.addEventListener("change", function () { saved[key] = box.checked; write(); show(box); count(); });
  });
  hide.addEventListener("change", function () {
    // Only items that are ticked right now are hidden, so ticking one never makes it vanish from under the keyboard.
    boxes.forEach(function (b) { b.closest("li").hidden = hide.checked && b.checked; });
    status.textContent = hide.checked ? "Ticked items hidden. " + boxes.filter(function (b) { return !b.checked; }).length + " left." : "All items shown. ";
    if (!hide.checked) count();
  });
  document.getElementById("reset").addEventListener("click", function () {
    if (!window.confirm("Clear every tick you have made? Items the roadmap marks as done will show as ticked again.")) return;
    saved = {}; write();
    boxes.forEach(function (b) { b.checked = b.getAttribute("data-done") === "true"; show(b); });
    count();
  });
  count();
})();
</script>
</body>
</html>
"""


def build(markdown):
    parsed = parse_roadmap(markdown)
    sections = []
    for s in parsed["sections"]:
        parts = [f"<h2>{html.escape(s['title'], quote=False)}</h2>"]
        parts += [f"<p>{n}</p>" for n in s["notes"]]
        if s["items"]:
            lis = "".join(
                f'<li class="task"><input type="checkbox" id="t-{i["key"]}" data-key="{i["key"]}" data-done="{str(i["done"]).lower()}">'
                f'<label for="t-{i["key"]}">{i["html"]}</label></li>' for i in s["items"])
            parts.append(f"<ul>{lis}</ul>")
        if s["bullets"]:
            parts.append('<ul class="plain">' + "".join(f"<li>{b}</li>" for b in s["bullets"]) + "</ul>")
        if not (s["items"] or s["bullets"] or s["notes"]):
            parts.append('<p class="empty">Nothing here.</p>')
        sections.append("\n".join(parts))
    page = PAGE.replace("__TITLE__", html.escape(parsed["title"], quote=False))
    page = page.replace("__INTRO__", "\n".join(f"<p>{p}</p>" for p in parsed["intro"]))
    return page.replace("__SECTIONS__", "\n".join(sections))


def main():
    try:
        page = build(ROADMAP.read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        print(f"Could not make the page: {err}", file=sys.stderr)
        return 1
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(page, encoding="utf-8")
    print(f"Made {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
