# SPDX-License-Identifier: Apache-2.0
"""Get packs ready for the website: one checked zip for each pack, its SHA-256, and a page that lists them.

  python tools/pack_for_website.py FOLDER [FOLDER ...] --out DIR
  python tools/pack_for_website.py --out DIR              (only make the page again, from the zip files already in DIR)

Each FOLDER is a pack: a folder with a pack.json (docs/character-packs.md). For each one this

  1. checks it exactly as the editor will (tools/charpack.py, the one place that decides what a good pack is);
  2. writes DIR/<id>-<version>.zip holding the pack in one folder named for its id. Only pack.json, the pictures it names and plain text files
     (.txt and .md) at the top go in; anything else is left out, and the message says so. The same pack always makes the same bytes, so the same
     checksum;
  3. installs that zip into a temporary place with the editor's own installer, to be sure the file it made is one the editor will accept;
  4. writes DIR/<id>-<version>.zip.sha256.txt.

Then it writes DIR/index.html, a page that lists the newest version of every pack zip in DIR, with a few small pictures from each, who made it,
under what licence, how big the zip is and its SHA-256. The page needs no scripts and no server: upload DIR as it is. The page is what the editor's
"Get more packs..." button opens (PACKS_PAGE_URL in editor/src/packs.ts).

A version that is already in DIR is not written over with different pictures: raise the version in pack.json, or say --replace.
"""
import argparse
import hashlib
import html
import json
import pathlib
import shutil
import sys
import tempfile
import zipfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import charpack  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
PREVIEWS = 4
STORED_DATE = (1980, 1, 1, 0, 0, 0)
NAMES_SHOWN = 20


class SiteError(Exception):
    """Something is wrong; the message says what, for the person who has to put it right."""


# ---- the zip

def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _files_for(folder, manifest):
    """The files that go in the zip, as places inside the pack (sorted), and the ones left out."""
    root = pathlib.Path(folder)
    named = set(charpack.files_named(manifest))
    wanted = {"pack.json"} | named
    left_out = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if rel in wanted:
            continue
        if "/" not in rel and rel.lower().endswith((".txt", ".md")) and not rel.startswith("."):
            wanted.add(rel)
        else:
            left_out.append(rel)
    return sorted(wanted), left_out


def _write_zip(folder, files, top, target):
    with zipfile.ZipFile(target, "w") as archive:
        for rel in files:
            data = (pathlib.Path(folder) / rel).read_bytes()
            info = zipfile.ZipInfo(f"{top}/{rel}", date_time=STORED_DATE)
            info.external_attr = 0o644 << 16
            # Pictures are already as small as they will go; the words are worth squeezing.
            info.compress_type = zipfile.ZIP_STORED if rel.lower().endswith(charpack.PICTURE_TYPES) else zipfile.ZIP_DEFLATED
            archive.writestr(info, data)


def make_zip(folder, out, bundled=None, replace=False):
    """Check a pack, write its zip and checksum into `out`, and prove the editor will take the zip. Returns what was done, in a dict."""
    try:
        manifest = charpack.check_pack(folder)
    except charpack.PackError as e:
        raise SiteError(f"{folder}: {e}") from None
    out = pathlib.Path(out)
    out.mkdir(parents=True, exist_ok=True)
    name = f"{manifest['id']}-{manifest['version']}.zip"
    final = out / name
    files, left_out = _files_for(folder, manifest)
    work = pathlib.Path(tempfile.mkdtemp(prefix="openstage-pack-site-"))
    try:
        built = work / name
        _write_zip(folder, files, manifest["id"], built)
        try:
            tried = charpack.install_zip(built, bundled or "", work / "installed")
        except charpack.PackError as e:
            raise SiteError(f"{folder}: the zip that was made is not one the editor will take: {e}") from None
        if not tried.get("ok"):
            raise SiteError(f"{folder}: the zip that was made is not one the editor will take: {tried.get('message')}")
        new_hash = sha256_of(built)
        if final.exists() and sha256_of(final) != new_hash and not replace:
            raise SiteError(f"{name} is already in {out} with different pictures or words. Raise the version in pack.json, or say --replace.")
        shutil.copyfile(built, final)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    (out / f"{name}.sha256.txt").write_text(f"{new_hash}  {name}\n", encoding="utf-8", newline="\n")
    return {"id": manifest["id"], "version": manifest["version"], "file": name, "sha256": new_hash, "bytes": final.stat().st_size, "left_out": left_out,
            "contents": charpack.contents(manifest)}


# ---- reading a zip that is already in the folder

def read_zip(path):
    """What the page needs from a pack zip: its cleaned manifest, its size and checksum, and where its files sit inside it. Raises SiteError if it is not a good pack zip."""
    path = pathlib.Path(path)
    try:
        archive = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError):
        raise SiteError(f"{path.name} is not a zip file that can be opened.") from None
    with archive:
        names = {i.filename for i in archive.infolist() if not i.is_dir()}
        try:
            top = charpack._find_top(names)
        except charpack.PackError as e:
            raise SiteError(f"{path.name}: {e}") from None
        prefix = f"{top}/" if top else ""
        try:
            manifest = charpack.clean_manifest(json.loads(archive.read(f"{prefix}pack.json").decode("utf-8-sig")))
        except (charpack.PackError, ValueError, UnicodeDecodeError) as e:
            raise SiteError(f"{path.name}: {e}") from None
    return {"manifest": manifest, "prefix": prefix, "bytes": path.stat().st_size, "sha256": sha256_of(path), "file": path.name}


def _version_key(version):
    return tuple(int(x) for x in version.split("."))


def newest_packs(folder):
    """The newest version of each pack zip in `folder`, by title. Returns (packs, problems); a zip that is not a good pack is a problem, and is left off the page."""
    best, problems = {}, []
    for path in sorted(pathlib.Path(folder).glob("*.zip")):
        try:
            found = read_zip(path)
        except SiteError as e:
            problems.append(str(e))
            continue
        pid = found["manifest"]["id"]
        if pid not in best or _version_key(found["manifest"]["version"]) > _version_key(best[pid]["manifest"]["version"]):
            best[pid] = found
    return sorted(best.values(), key=lambda f: (f["manifest"]["title"].casefold(), f["manifest"]["id"])), problems


# ---- the pictures beside each pack

def preview_choices(manifest):
    """Up to PREVIEWS pictures that show what a pack is like, as (place in the pack, words that describe it): the first people's heads, or backgrounds spread across the pack."""
    if manifest["people"]:
        return [(p["head"], p["alt"]) for p in manifest["people"][:PREVIEWS]]
    items = manifest["backgrounds"]
    if not items:
        return []
    count = min(PREVIEWS, len(items))
    picks = sorted({round(i * (len(items) - 1) / max(count - 1, 1)) for i in range(count)})
    return [(items[i]["file"], items[i]["alt"]) for i in picks]


def copy_previews(found, out):
    """Copy the chosen pictures out of the zip, unchanged, into DIR/previews/<id>-<version>/. Returns [(path for the page, words, width, height)]."""
    manifest = found["manifest"]
    folder = pathlib.Path(out) / "previews" / f"{manifest['id']}-{manifest['version']}"
    shutil.rmtree(folder, ignore_errors=True)
    shown = []
    with zipfile.ZipFile(pathlib.Path(out) / found["file"]) as archive:
        for n, (rel, alt) in enumerate(preview_choices(manifest), 1):
            data = archive.read(found["prefix"] + rel)
            width, height = charpack.picture_size(rel, data)
            suffix = pathlib.PurePosixPath(rel).suffix.lower()
            folder.mkdir(parents=True, exist_ok=True)
            (folder / f"{n}{suffix}").write_bytes(data)
            shown.append((f"previews/{folder.name}/{n}{suffix}", alt, width, height))
    return shown


# ---- the page

def _size_words(n):
    return f"{n / (1024 * 1024):.1f} MB" if n >= 1024 * 1024 else f"{max(1, round(n / 1024))} KB"


def _names_line(manifest):
    if manifest["people"]:
        names = [p["name"] for p in manifest["people"]]
        more = len(names) - NAMES_SHOWN
        return "People: " + ", ".join(names[:NAMES_SHOWN]) + (f", and {more} more." if more > 0 else ".")
    groups = {}
    for b in manifest["backgrounds"]:
        groups[b["group"] or "Other"] = groups.get(b["group"] or "Other", 0) + 1
    return "Groups: " + ", ".join(f"{g} ({n})" for g, n in groups.items()) + "."


def _link(url, text):
    return f'<a href="{html.escape(url, quote=True)}" rel="noopener">{html.escape(text)}</a>'


def _article(found, shown):
    m = found["manifest"]
    credit = m["credit"]
    esc = html.escape
    uid = f"pack-{m['id']}"
    maker = _link(credit["creatorUrl"], credit["creator"]) if credit["creatorUrl"] else esc(credit["creator"])
    licence = esc(credit["licence"].rstrip("."))
    pictures = ""
    if shown:
        pictures = '<ul class="previews">' + "".join(
            f'<li><img src="{esc(src, quote=True)}" alt="{esc(alt, quote=True)}" width="{w}" height="{h}" loading="lazy"></li>' for src, alt, w, h in shown) + "</ul>"
    description = f"<p>{esc(m['description'])}</p>" if m["description"] else ""
    kind = charpack.pack_kind(m)
    return (
        f'<article class="pack" aria-labelledby="{uid}">\n'
        f'<h2 id="{uid}">{esc(m["title"])}</h2>\n'
        f"{description}\n{pictures}\n"
        f'<p>{esc(_names_line(m))}</p>\n'
        "<dl>\n"
        f"<dt>Kind</dt><dd>{esc(kind[0].upper() + kind[1:])} with {esc(charpack.contents(m))}</dd>\n"
        f"<dt>Made by</dt><dd>{maker}</dd>\n"
        f"<dt>Licence</dt><dd>{licence}. {_link(credit['url'], 'More about this pack and its licence')}</dd>\n"
        f"<dt>Version</dt><dd>{esc(m['version'])}</dd>\n"
        f"<dt>Zip file</dt><dd>{esc(found['file'])}, {esc(_size_words(found['bytes']))}</dd>\n"
        f'<dt>SHA-256</dt><dd><code>{esc(found["sha256"])}</code></dd>\n'
        "</dl>\n"
        f'<p><a class="download" href="{esc(found["file"], quote=True)}" download>Download {esc(m["title"])} (zip file, {esc(_size_words(found["bytes"]))})</a></p>\n'
        "</article>"
    )


STYLE = """
:root { color-scheme: light dark; --bg: #ffffff; --text: #1b1b1b; --muted: #4a4a4a; --link: #0a4fb4; --card: #f5f5f5; --line: #8a8a8a; }
@media (prefers-color-scheme: dark) { :root { --bg: #121212; --text: #ececec; --muted: #c4c4c4; --link: #8ab4f8; --card: #1e1e1e; --line: #7a7a7a; } }
body { margin: 0; padding: 0 16px 48px; background: var(--bg); color: var(--text); font: 1.0625rem/1.55 system-ui, "Segoe UI", sans-serif; }
main, header, footer { max-width: 60rem; margin: 0 auto; }
a { color: var(--link); }
.skip { position: absolute; left: -999px; } .skip:focus { position: static; display: inline-block; margin: 8px 0; }
h1 { font-size: 1.9rem; line-height: 1.2; margin: 28px 0 12px; } h2 { font-size: 1.4rem; margin: 0 0 8px; } h3 { font-size: 1.15rem; }
.pack { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 16px 20px; margin: 20px 0; }
.previews { list-style: none; display: flex; flex-wrap: wrap; gap: 10px; padding: 0; margin: 12px 0; }
.previews img { display: block; height: 120px; width: auto; max-width: 100%; border-radius: 6px; border: 1px solid var(--line); background: var(--bg); }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 12px 0; }
dt { font-weight: 600; } dd { margin: 0; overflow-wrap: anywhere; }
code { font: 0.95rem ui-monospace, Consolas, monospace; }
.download { display: inline-block; padding: 8px 14px; border: 2px solid var(--link); border-radius: 6px; font-weight: 600; }
.note { color: var(--muted); }
@media (max-width: 34rem) { dl { grid-template-columns: 1fr; } dt { margin-top: 6px; } }
"""

HOW = """<h2 id="how">How to add a pack</h2>
<ol>
<li>Download the zip file of the pack you want. Leave it as it is: you do not need to unzip it.</li>
<li>In OpenStage Author, open the library of people (<strong>Characters</strong>, then <strong>Choose from the library...</strong>) or the background picker (<strong>Background picture...</strong> in the Design box, on a slide with nothing selected).</li>
<li>Press <strong>Add a character pack...</strong> (in the background picker, <strong>Add a pack...</strong>) and choose the zip file.</li>
<li>OpenStage Author checks all of it before it keeps anything, and then the pack is in the list. A pack that is already there is updated. To take a pack away, press <strong>Remove this pack</strong> twice.</li>
</ol>
<p>The same steps are in the editor, too: the <strong>Get more packs...</strong> button in either window brings you to this page.</p>
<h2>Good to know</h2>
<ul>
<li>A pack is pictures and words only. Nothing in a pack is ever run.</li>
<li>Every pack says who made its pictures and what you may do with them. When you use one of its pictures, OpenStage Author puts the maker and the licence on your course's credits page for you.</li>
<li>The picture of a person or a background is copied into your project. Taking a pack away later changes nothing in a course that already used it.</li>
</ul>
"""

CHECK = """<h2 id="check">Checking a download (optional)</h2>
<p class="note">Each pack lists a SHA-256 checksum. To check that your copy is the same file, open Windows PowerShell in the folder it was saved to and run <code>Get-FileHash FILENAME.zip</code>, replacing FILENAME with the file's name. The long code it prints should match the one on this page, whether it is in capital letters or not.</p>
"""


def page(packs_shown):
    """The whole page as text. `packs_shown` is a list of (found, previews)."""
    if packs_shown:
        body = "\n".join(_article(found, shown) for found, shown in packs_shown)
    else:
        body = "<p>No packs are listed yet.</p>"
    return (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        "<title>Packs for OpenStage Author</title>\n"
        '<meta name="description" content="More pictures of people and backgrounds to download and add to OpenStage Author.">\n'
        f"<style>{STYLE}</style>\n</head>\n<body>\n"
        '<a class="skip" href="#packs">Skip to the packs</a>\n'
        "<header>\n<h1>Packs for OpenStage Author</h1>\n"
        "<p>A pack is a set of pictures with words that describe them: people to put in a scenario, or backgrounds to put behind a slide. "
        'Download a pack here and add it to <a href="https://openstageauthor.com">OpenStage Author</a>, which is free.</p>\n</header>\n'
        f'<main>\n<section aria-labelledby="how">\n{HOW}</section>\n'
        f'<section id="packs" aria-labelledby="list"><h2 id="list">Packs to download</h2>\n{body}\n</section>\n'
        f'<section aria-labelledby="check">\n{CHECK}</section>\n</main>\n'
        "<!-- Made by tools/pack_for_website.py from the zip files beside this page. -->\n</body>\n</html>\n"
    )


def make_page(out):
    """Write DIR/index.html for the newest version of every pack zip in `out`. Returns (how many packs are on the page, problems)."""
    out = pathlib.Path(out)
    out.mkdir(parents=True, exist_ok=True)
    packs, problems = newest_packs(out)
    shown = [(found, copy_previews(found, out)) for found in packs]
    live = {f"{f['manifest']['id']}-{f['manifest']['version']}" for f in packs}
    previews = out / "previews"
    if previews.is_dir():
        for stale in previews.iterdir():
            if stale.is_dir() and stale.name not in live:
                shutil.rmtree(stale, ignore_errors=True)
    (out / "index.html").write_text(page(shown), encoding="utf-8", newline="\n")
    return len(packs), problems


# ---- command line

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("folders", nargs="*", help="pack folders to zip")
    parser.add_argument("--out", required=True, help="the folder to put the zip files and the page in")
    parser.add_argument("--bundled", default=str(ROOT / "character-packs"), help="the packs that come with the program (a pack may not take their ids)")
    parser.add_argument("--replace", action="store_true", help="write over a zip of the same version that holds different pictures or words")
    args = parser.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        for folder in args.folders:
            done = make_zip(folder, args.out, args.bundled, args.replace)
            print(f"Made {done['file']}: {done['contents']}, {_size_words(done['bytes'])}.")
            print(f"  SHA-256: {done['sha256']}")
            for rel in done["left_out"]:
                print(f"  Left out, because a pack holds only pictures, pack.json and plain text: {rel}")
        count, problems = make_page(args.out)
    except SiteError as e:
        print(f"Stopped: {e}")
        return 1
    for p in problems:
        print(f"Not on the page: {p}")
    print(f"The page {pathlib.Path(args.out) / 'index.html'} lists {count} {'pack' if count == 1 else 'packs'}. Upload the whole folder as it is.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
