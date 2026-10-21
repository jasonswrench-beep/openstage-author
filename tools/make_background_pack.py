# SPDX-License-Identifier: Apache-2.0
"""Make a pack of backgrounds from the pictures a picture service made.

Each background is one wide picture (a room, a corridor, a building). This tool
  * makes every picture the same size, 1920 by 1080 points by default (a slide's usual 16 by 9 shape), and writes it as WebP, which is a good deal smaller
    than the PNG it came from with no difference to the eye, and
  * writes pack.json beside them, from the descriptions you wrote.
It needs FFmpeg, which has to be on this computer already (on the PATH, or named in OPENSTAGE_FFMPEG), to shrink the pictures and write them as WebP. FFmpeg is only
used here, to make the files; what comes out is plain WebP pictures, and nothing of FFmpeg is part of OpenStage Author. docs/character-packs.md explains the format.

  make_background_pack.py SOURCE.json [--raw FOLDER] [--out FOLDER] [--jobs N]

SOURCE.json is a pack.json (see the format; "packVersion" may be left out, it is 2) with a few extra words for this tool:
  "folder"       (top level, optional) where the original pictures are, written from the folder SOURCE.json is in. Default: that folder.
                 --raw FOLDER says it on the command line instead, and wins.
  "size"         (top level, optional) [width, height] each picture is made, in points. Default [1920, 1080].
  "webpQuality"  (top level, optional) 1 to 100, how closely a WebP picture follows the original. Default 85.
  and in each background "source" is the name of the original picture file, with or without .png. The "file" of each background is written for you
  (backgrounds/<id>.webp).
The pictures are written to FOLDER (default: character-packs/<pack id> in this repository).
"""
import argparse
import concurrent.futures
import json
import os
import pathlib
import shutil
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import charpack  # noqa: E402
from make_character_pack import find_ffmpeg  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_SIZE = (1920, 1080)


class MakeError(Exception):
    """Something in the source needs putting right; the message says what."""


def read_source(path):
    path = pathlib.Path(path)
    try:
        source = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as e:
        raise MakeError(f"The source file cannot be read: {e}") from None
    if not isinstance(source, dict) or not isinstance(source.get("backgrounds"), list):
        raise MakeError("The source file must be a pack description with a list of backgrounds.")
    return source


def to_webp(source, target, size, quality, ffmpeg):
    """One picture, made `size` = (width, height) and written to `target` as WebP by FFmpeg."""
    command = [ffmpeg, "-v", "error", "-y", "-i", str(source), "-vf", f"scale={size[0]}:{size[1]}:flags=lanczos", "-c:v", "libwebp",
               "-quality", str(quality), "-compression_level", "6", "-frames:v", "1", str(target)]
    try:
        done = subprocess.run(command, capture_output=True, timeout=300)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise MakeError(f"FFmpeg could not be run to make {target.name}: {e}") from None
    head = target.read_bytes()[:12] if target.is_file() else b""
    if done.returncode != 0 or not head.startswith(b"RIFF") or head[8:12] != b"WEBP":
        raise MakeError(f"FFmpeg did not make {target.name} (it may have no WebP encoder, libwebp). " + done.stderr.decode("utf-8", "replace").strip()[:200])


def make(source_path, out=None, jobs=0, say=print, raw=None):
    """Make the pack. Returns the folder it was written to."""
    source_path = pathlib.Path(source_path)
    source = read_source(source_path)
    ffmpeg = find_ffmpeg()
    if ffmpeg is None:
        raise MakeError("FFmpeg is needed to make WebP pictures, and it was not found. Install it, or name it in OPENSTAGE_FFMPEG.")
    size = source.get("size", list(DEFAULT_SIZE))
    if not (isinstance(size, list) and len(size) == 2 and all(isinstance(n, int) and 16 <= n <= 4096 for n in size)):
        raise MakeError("\"size\" must be two whole numbers, from 16 to 4096.")
    quality = source.get("webpQuality", 85)
    if not isinstance(quality, int) or not 1 <= quality <= 100:
        raise MakeError("\"webpQuality\" must be a whole number from 1 to 100.")
    folder = pathlib.Path(raw) if raw else source_path.parent / source.get("folder", ".")
    if not folder.is_dir():
        raise MakeError(f"The folder of original pictures, {folder}, is not there.")

    manifest = {k: v for k, v in source.items() if k not in ("folder", "size", "webpQuality", "backgrounds")}
    manifest["packVersion"] = charpack.BACKGROUND_PACK_VERSION
    manifest["backgrounds"] = []
    work = []
    for i, b in enumerate(source["backgrounds"], 1):
        if not isinstance(b, dict) or not isinstance(b.get("id"), str) or not isinstance(b.get("source"), str):
            raise MakeError(f"Background {i} needs an \"id\" and a \"source\" (the original picture's file name).")
        name = b["source"] if b["source"].lower().endswith(".png") else b["source"] + ".png"
        original = folder / name
        if not original.is_file():
            raise MakeError(f"Background \"{b['id']}\": the picture {name} is not in {folder}.")
        entry = {k: v for k, v in b.items() if k != "source"}
        entry["file"] = f"backgrounds/{b['id']}.webp"
        manifest["backgrounds"].append(entry)
        work.append((original, entry["file"]))

    # Check the description before any picture is made, so a mistake in the words does not cost a long wait.
    try:
        charpack.clean_manifest(manifest)
    except charpack.PackError as e:
        raise MakeError(str(e)) from None

    out = pathlib.Path(out) if out else REPO / "character-packs" / manifest["id"]
    pictures = out / "backgrounds"
    if pictures.is_dir():
        for stale in pictures.glob("*.webp"):
            stale.unlink()
    pictures.mkdir(parents=True, exist_ok=True)

    def run(item):
        original, rel = item
        to_webp(original, out / rel, tuple(size), quality, ffmpeg)
        return rel

    jobs = jobs or min(6, os.cpu_count() or 1)
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, jobs)) as pool:
        for n, rel in enumerate(pool.map(run, work), 1):
            say(f"  {n}/{len(work)}  {rel}")
    (out / "pack.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    made = charpack.check_pack(out)
    say(f"Made {made['id']}: {charpack.contents(made)}, {made['bytes'] // 1024} KB, in {out}")
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source")
    parser.add_argument("--raw")
    parser.add_argument("--out")
    parser.add_argument("--jobs", type=int, default=min(6, os.cpu_count() or 1))
    args = parser.parse_args(argv)
    try:
        make(args.source, args.out, args.jobs, raw=args.raw)
    except (MakeError, charpack.PackError) as e:
        print(f"Could not make the pack: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
