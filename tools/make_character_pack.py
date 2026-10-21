# SPDX-License-Identifier: Apache-2.0
"""Make a character pack from the pictures a picture service made.

Each person is a folder of PNG pictures with a clear (transparent) background, one picture for each pose. This tool
  * cuts every picture of a person to the same frame (the smallest that holds all of their poses), so changing pose does not make them jump,
  * makes them smaller (a person is 560 points tall by default),
  * cuts a square head-and-shoulders picture from the standing pose, for the places where a person is shown small, and
  * writes pack.json beside them, from the descriptions you wrote.
It needs nothing but Python. With --webp it also uses FFmpeg, which has to be on this computer already (on the PATH, or named in OPENSTAGE_FFMPEG), to write
the pictures as WebP, about a quarter of the size of the PNG ones with no difference to the eye. FFmpeg is only used here, to make the files; what comes out is
plain WebP pictures, and nothing of FFmpeg is part of OpenStage Author. docs/character-packs.md explains the format and how to write the source file.

  make_character_pack.py SOURCE.json [--raw FOLDER] [--out FOLDER] [--only PERSON] [--jobs N] [--webp | --png]

SOURCE.json is a pack.json (see the format; "packVersion" may be left out) with a few extra words for this tool:
  "folder"       (top level, optional) where the people's folders are, written from the folder SOURCE.json is in. Default: that folder.
                 --raw FOLDER says it on the command line instead, and wins.
  "poseHeight"   (top level, optional) how tall a pose picture is made, in points. Default 560.
  "headSize"     (top level, optional) how wide and tall the head picture is made. Default 256.
  "pictures"     (top level, optional) "png" (the default) or "webp"; --webp and --png on the command line say it instead, and win.
  "webpQuality"  (top level, optional) 1 to 100, how closely a WebP picture follows the original. Default 85.
  for each person:
  "folder"       the folder of their pictures, inside "folder". Default: their id.
  "default"      the pose the head picture is cut from. Default "neutral".
  "headBox"      (optional) [left, top, size] in points of the original picture, to say exactly where the head picture is cut from.
  and in each pose "file" is the start of the picture's file name, enough to tell it from the others.
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
import pngio  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parent.parent
MARGIN = 6          # clear points kept round the figure
HEAD_SHARE = 0.30   # how much of the figure's height the square head picture takes
HEAD_TOP = 0.04     # of the square, left clear above the head


class MakeError(Exception):
    """Something in the source needs putting right; the message says what."""


def _find(folder, start, where):
    """The one picture whose name starts with `start`. Pictures with the same content (a copy saved twice) count as one."""
    found = sorted(p for p in folder.glob("*.png") if p.name.startswith(start))
    if not found:
        raise MakeError(f"{where}: no picture in {folder} starts with \"{start}\".")
    if len({p.read_bytes() for p in found}) > 1:
        raise MakeError(f"{where}: more than one picture starts with \"{start}\" ({', '.join(p.name[:24] for p in found[:3])}). Use more of the name.")
    return found[0]


def find_ffmpeg():
    """FFmpeg, if this computer has it: named in OPENSTAGE_FFMPEG, or on the PATH. None if not."""
    named = os.environ.get("OPENSTAGE_FFMPEG")
    if named and os.path.isfile(named):
        return named
    return shutil.which("ffmpeg")


def to_webp(png, quality, ffmpeg):
    """A PNG picture as the bytes of a WebP picture with its clear parts kept, made by FFmpeg."""
    command = [ffmpeg, "-v", "error", "-y", "-f", "image2pipe", "-c:v", "png", "-i", "-", "-c:v", "libwebp", "-quality", str(quality),
               "-compression_level", "6", "-pix_fmt", "yuva420p", "-f", "image2pipe", "-"]
    try:
        done = subprocess.run(command, input=png, capture_output=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise MakeError(f"FFmpeg could not be run to make a WebP picture: {e}") from None
    if done.returncode != 0 or not done.stdout.startswith(b"RIFF") or done.stdout[8:12] != b"WEBP":
        raise MakeError("FFmpeg did not make a WebP picture (it may have no WebP encoder, libwebp). " + done.stderr.decode("utf-8", "replace").strip()[:200])
    return done.stdout


def _encode(png, webp):
    """The picture as it is written: the PNG as it is, or, if `webp` is (quality, ffmpeg), as WebP."""
    return png if webp is None else to_webp(png, webp[0], webp[1])


def _box_of(path):
    w, h, px = pngio.read_png(pathlib.Path(path).read_bytes())
    return (w, h), pngio.content_box(w, h, px)


def _render(path, box, size, webp=None):
    """One pose: cut to the frame, made `size` = (width, height) points, as PNG bytes (or WebP, see _encode)."""
    w, h, px = pngio.read_png(pathlib.Path(path).read_bytes())
    cw, ch, cropped = pngio.crop(w, h, px, box)
    if (cw, ch) != size:
        cropped = pngio.resize(cw, ch, cropped, size[0], size[1])
    return _encode(pngio.write_png(size[0], size[1], cropped), webp)


def _head(path, head_box, size, webp=None):
    """The square head-and-shoulders picture, as PNG bytes (or WebP, see _encode)."""
    w, h, px = pngio.read_png(pathlib.Path(path).read_bytes())
    if head_box:
        left, top, side = head_box
    else:
        box = pngio.content_box(w, h, px)
        if box is None:
            raise MakeError(f"{pathlib.Path(path).name} has nothing in it.")
        x0, y0, x1, y1 = box
        side = round(HEAD_SHARE * (y1 - y0))
        # Centre on the head: the middle of what is solid in the top tenth of the figure.
        band_end = y0 + max(1, round((y1 - y0) * 0.10))
        xs = [x for y in range(y0, band_end) for x in range(x0, x1) if px[(y * w + x) * 4 + 3] >= 128]
        centre = sum(xs) / len(xs) if xs else (x0 + x1) / 2
        left, top = round(centre - side / 2), round(y0 - HEAD_TOP * side)
    cw, ch, cropped = pngio.crop(w, h, px, (left, top, left + side, top + side))
    size = min(size, cw)  # never made larger than the original
    if cw != size:
        cropped = pngio.resize(cw, ch, cropped, size, size)
    return _encode(pngio.write_png(size, size, cropped), webp)


def read_source(path):
    path = pathlib.Path(path)
    try:
        source = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as e:
        raise MakeError(f"The source file cannot be read: {e}") from None
    if not isinstance(source, dict) or not isinstance(source.get("people"), list):
        raise MakeError("The source file must be a pack description with a list of people.")
    return source


def make(source_path, out=None, only=None, jobs=0, say=print, raw=None, pictures=None):
    """Make the pack. Returns the folder it was written to. `jobs` is how many pictures to work on at once (0: one at a time)."""
    source_path = pathlib.Path(source_path)
    source = read_source(source_path)
    source.setdefault("packVersion", charpack.PACK_VERSION)
    root = pathlib.Path(raw).resolve() if raw else (source_path.parent / source.get("folder", ".")).resolve()
    pose_height = int(source.get("poseHeight", 560))
    head_size = int(source.get("headSize", 256))
    kind = pictures or source.get("pictures", "png")
    if kind not in ("png", "webp"):
        raise MakeError("\"pictures\" must be \"png\" or \"webp\".")
    webp = None
    if kind == "webp":
        quality = int(source.get("webpQuality", 85))
        if not 1 <= quality <= 100:
            raise MakeError("webpQuality must be from 1 to 100.")
        ffmpeg = find_ffmpeg()
        if ffmpeg is None:
            raise MakeError("Making WebP pictures needs FFmpeg, and there is none on this computer (put it on the PATH, or name it in OPENSTAGE_FFMPEG). Leave out --webp to make PNG pictures.")
        webp = (quality, ffmpeg)
    ext = "webp" if webp else "png"
    if not (64 <= pose_height <= 2048 and 32 <= head_size <= 1024):
        raise MakeError("poseHeight must be from 64 to 2048 and headSize from 32 to 1024.")
    for p in source["people"]:
        if not isinstance(p, dict) or not isinstance(p.get("id"), str):
            raise MakeError("Every person needs an id.")
    selected = [p for p in source["people"] if only is None or p["id"] == only]
    if not selected:
        raise MakeError(f"There is no person called \"{only}\" in the source file.")

    # Check the words first, with placeholder files, so a typo does not cost minutes of work.
    draft = json.loads(json.dumps(source))
    for p in draft["people"]:
        p["head"] = f"{p['id']}/head.png"
        for pose in p.get("poses", []):
            pose["file"] = f"{p['id']}/{pose.get('id', 'x')}.png"
    try:
        charpack.clean_manifest(draft)
    except charpack.PackError as e:
        raise MakeError(str(e)) from None

    pack_id = source["id"]
    out = pathlib.Path(out) if out else REPO / "character-packs" / pack_id
    out.mkdir(parents=True, exist_ok=True)

    pool = concurrent.futures.ProcessPoolExecutor(max_workers=jobs) if jobs > 0 else None

    def run(fn, items):
        if pool is None:
            return [fn(*item) for item in items]
        return [f.result() for f in [pool.submit(fn, *item) for item in items]]

    try:
        for person in selected:
            pid = person["id"]
            folder = root / person.get("folder", pid)
            if not folder.is_dir():
                raise MakeError(f"Person \"{pid}\": the folder {folder} is not there.")
            files = {}
            for pose in person.get("poses", []):
                files[pose["id"]] = _find(folder, pose["file"], f"Person \"{pid}\", pose \"{pose['id']}\"")
            if len(set(files.values())) != len(files):
                raise MakeError(f"Person \"{pid}\": two poses use the same picture.")
            default = person.get("default", "neutral")
            if not person.get("headBox") and default not in files:
                raise MakeError(f"Person \"{pid}\": the head picture is cut from the pose \"{default}\", which they do not have. Name another with \"default\".")
            say(f"{person.get('name', pid)}: {len(files)} poses")
            boxes = run(_box_of, [(path,) for path in files.values()])
            sizes = {size for size, _ in boxes}
            if len(sizes) > 1:
                raise MakeError(f"Person \"{pid}\": the pictures are not all the same size, so they cannot share a frame.")
            solid = [b for _, b in boxes if b]
            if not solid:
                raise MakeError(f"Person \"{pid}\": the pictures have nothing in them.")
            (sw, sh), = sizes
            frame = (max(0, min(b[0] for b in solid) - MARGIN), max(0, min(b[1] for b in solid) - MARGIN),
                     min(sw, max(b[2] for b in solid) + MARGIN), min(sh, max(b[3] for b in solid) + MARGIN))
            fw, fh = frame[2] - frame[0], frame[3] - frame[1]
            scale = min(1.0, pose_height / fh)
            size = (max(1, round(fw * scale)), max(1, round(fh * scale)))
            (out / pid).mkdir(parents=True, exist_ok=True)
            # What an earlier run made of this person goes, so that a pack never carries pictures that pack.json no longer names.
            for old in (out / pid).iterdir():
                if old.is_file() and old.suffix.lower() in (".png", ".webp"):
                    old.unlink()
            rendered = run(_render, [(path, frame, size, webp) for path in files.values()])
            for pose_id, data in zip(files, rendered):
                (out / pid / f"{pose_id}.{ext}").write_bytes(data)
            head_from = files.get(default) or next(iter(files.values()))
            (out / pid / f"head.{ext}").write_bytes(_head(head_from, person.get("headBox"), head_size, webp))
            say(f"  frame {fw} by {fh} points, made {size[0]} by {size[1]}")
    finally:
        if pool is not None:
            pool.shutdown()

    manifest = json.loads(json.dumps(source))
    manifest = {"packVersion": manifest.pop("packVersion"), **manifest}
    for key in ("folder", "poseHeight", "headSize", "pictures", "webpQuality"):
        manifest.pop(key, None)
    for p in manifest["people"]:
        for key in ("folder", "default", "headBox"):
            p.pop(key, None)
        p["head"] = f"{p['id']}/head.{ext}"
        for pose in p.get("poses", []):
            pose["file"] = f"{p['id']}/{pose['id']}.{ext}"
    if only is None:
        (out / "pack.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        try:
            checked = charpack.check_pack(out)
        except charpack.PackError as e:
            raise MakeError(f"The pack was written but is not good: {e}") from None
        count = len(checked["people"])
        say(f"Pack \"{checked['title']}\" is good: {count} {'person' if count == 1 else 'people'}, {checked['bytes'] / (1024 * 1024):.1f} MB, in {out}")
    else:
        say(f"Pictures of {only} written to {out}. (pack.json is only written when every person is made.)")
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source")
    parser.add_argument("--raw")
    parser.add_argument("--out")
    parser.add_argument("--only")
    parser.add_argument("--jobs", type=int, default=min(6, os.cpu_count() or 1))
    parser.add_argument("--webp", action="store_const", const="webp", dest="pictures", help="write WebP pictures (needs FFmpeg)")
    parser.add_argument("--png", action="store_const", const="png", dest="pictures", help="write PNG pictures")
    args = parser.parse_args(argv)
    try:
        make(args.source, args.out, args.only, args.jobs, raw=args.raw, pictures=args.pictures)
    except (MakeError, pngio.PngError) as e:
        print(f"Could not make the pack: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
