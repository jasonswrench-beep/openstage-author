"""Generate narration audio and caption timings for an OpenStage project.

Usage:  python narrate.py PROJECT_DIR [--no-generate] [--json] [--only ID,ID] [--cache-root DIR]
                          [--allow-network SERVICE,SERVICE] [--plugins-dir DIR] [--plugins-enabled ID,ID]

For every object, and every item of an interaction, with a narration script, work out the cache key (see narration_hash in
narration_key.py), then look for .cache/narration/<key>.wav and <key>.json. Missing ones are
generated, unless --no-generate is given. Nothing in the project files is
changed: the cache is derived data and lives only in .cache/.

--only ID,ID     generate audio only for those (the rest are looked up in the cache as usual). An object is named by
                 its id, an item of an interaction by "<object id>/<item id>".
--cache-root DIR keep the cache in DIR/.cache instead of PROJECT_DIR/.cache. The editor uses this to
                 narrate a project as it is on screen, unsaved, from a temporary copy of its files.

Which engine makes a voice is in the voice's name (see engines/__init__.py): a bare name is Kokoro, which runs on this
computer. A voice of an internet service (openai:alloy) is made only if the service is named in --allow-network and its
key is in the environment (OPENSTAGE_KEY_OPENAI); the text of the script is sent to that service. A voice of a plugin
(my-plugin:narrator) is made only if the plugin is in --plugins-enabled and in --plugins-dir. Without these options only
Kokoro is used, which is what Publish does: publishing never sends anything anywhere.

Captions come from the script. The only thing taken from the audio is when each word was spoken, which Kokoro (and a
plugin that says so) reports as it synthesises; for other engines the times are estimated from the length of each
sentence. Speech-to-text is never used.
Kokoro needs its own Python (see OPENSTAGE_KOKORO_PYTHON in PUBLISH EXAMPLE.bat); the
cache lookup and caption building here need only the standard library.
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import engines  # noqa: E402
import narration_key  # noqa: E402
from engines import common as engine_common  # noqa: E402

CONFIG = engines.Config()

SAMPLE_RATE = 24000
SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


def kokoro_voices():
    """The names of Kokoro's voices (tools/kokoro-voices.json)."""
    return set(json.loads(pathlib.Path(__file__).with_name("kokoro-voices.json").read_text(encoding="utf-8"))["voices"])


def checked_kokoro_voice(voice):
    """The voice, if it is exactly one of Kokoro's names; otherwise an error, before Kokoro is even loaded.

    Kokoro reads a voice it does not know as a place to load a voice file from (a path, a network share, or several joined with
    commas), and loading such a file can run code. A course can come from anyone, so only a listed name ever reaches it. No blends."""
    if not isinstance(voice, str) or voice not in kokoro_voices():
        shown = voice if isinstance(voice, str) and len(voice) <= 60 else "(not a voice name)"
        raise engine_common.EngineError(f"\"{shown}\" is not one of Kokoro's voices. Choose a voice from the list, then make the audio again.")
    return voice


# ---------------------------------------------------------------- captions

def split_sentences(script):
    """Split a script into sentences. Joining the result with single spaces gives back the
    script with whitespace normalised, which is what captions must equal."""
    return [s for s in (p.strip() for p in SENTENCE_END.split(script)) if s]


def words_with_offsets(tokens):
    """tokens: (text, whitespace, start, end) tuples, as Kokoro reports them.
    Returns (reconstructed text, [(char_start, char_end, start, end)])."""
    text, spans, pos = "", [], 0
    for tok_text, ws, start, end in tokens:
        piece = tok_text or ""
        spans.append((pos, pos + len(piece), start, end))
        pos += len(piece)
        text += piece
        ws = ws or ""
        text += ws
        pos += len(ws)
    return text, spans


def build_cues(script, spans, duration):
    """One cue per sentence, timed from the first to the last timed word in it.
    Returns (cues, exact). exact is False if timings had to be estimated from length."""
    sentences = split_sentences(script)
    cues, search_from, exact = [], 0, True
    for sentence in sentences:
        a = script.index(sentence, search_from)
        b = a + len(sentence)
        search_from = b
        timed = [(s, e) for (cs, ce, s, e) in spans if s is not None and e is not None and cs < b and ce > a]
        if timed:
            cues.append({"start": min(s for s, _ in timed), "end": max(e for _, e in timed), "text": sentence})
        else:
            exact = False
            cues.append({"start": None, "end": None, "text": sentence, "_a": a, "_b": b})
    if not exact:  # estimate untimed sentences from their share of the script's length
        total = max(len(script), 1)
        for cue in cues:
            if cue["start"] is None:
                cue["start"] = duration * cue["_a"] / total
                cue["end"] = duration * cue["_b"] / total
    for cue in cues:
        cue.pop("_a", None)
        cue.pop("_b", None)
        cue["start"] = round(float(cue["start"]), 3)
        cue["end"] = round(min(float(cue["end"]), duration), 3)
    return cues, exact


def cue_at(cues, t):
    for cue in cues:
        if cue["start"] <= t < cue["end"]:
            return cue
    return None


# ---------------------------------------------------------------- project walk

def item_key(obj_id, item_id):
    """What an interaction item's narration is called in --only, in the results, and in the published course."""
    return f"{obj_id}/{item_id}"


def narrated_objects(project_dir):
    """Yields (slide id, key, narration) for every narration: an object's, then each of an interaction's items, and each audio
    description of a video. The key is the object's id, or item_key for an item or a description."""
    project_dir = pathlib.Path(project_dir)
    project = json.loads((project_dir / "project.json").read_text(encoding="utf-8"))
    seen = set()
    for scene in project["scenes"]:
        for slide_id in scene["slides"]:
            if slide_id in seen:
                continue
            seen.add(slide_id)
            path = project_dir / "slides" / f"{slide_id}.json"
            if not path.exists():
                continue
            slide = json.loads(path.read_text(encoding="utf-8"))
            for layer in [slide["baseLayer"], *slide["layers"]]:
                for obj in layer["objects"]:
                    if obj.get("narration"):
                        yield slide_id, obj["id"], obj["narration"]
                    if obj.get("type") == "interaction":
                        for item in obj["content"]["items"]:
                            if item.get("narration"):
                                yield slide_id, item_key(obj["id"], item["id"]), item["narration"]
                    if obj.get("type") == "scenario":
                        for node in obj["content"]["nodes"]:
                            lines = list(node["lines"]) + [line for choice in node["choices"] for line in choice["response"]]
                            for line in lines:
                                if line.get("narration"):
                                    yield slide_id, item_key(obj["id"], line["id"]), line["narration"]
                    if obj.get("type") == "video":
                        for cue in ((obj.get("content") or {}).get("description") or {}).get("cues", []):
                            if cue.get("narration"):
                                yield slide_id, item_key(obj["id"], cue["id"]), cue["narration"]


def cache_paths(project_dir, narration):
    key = narration_key.narration_hash(narration).split(":", 1)[1]
    base = pathlib.Path(project_dir) / ".cache" / "narration"
    return key, base / f"{key}.wav", base / f"{key}.json"


# ---------------------------------------------------------------- synthesis

def apply_pronunciations(script, pronunciations):
    """Kokoro reads [word](/ipa/) as an IPA override."""
    for p in pronunciations:
        script = re.sub(rf"\b{re.escape(p['term'])}\b", lambda m, p=p: f"[{m.group(0)}](/{p['ipa']}/)", script)
    return script


_pipelines = {}


def synthesise(narration):
    """Run Kokoro. Returns (samples as float32 numpy array, token tuples)."""
    voice = checked_kokoro_voice(narration.get("voice"))  # before anything of Kokoro is imported or read
    import numpy as np
    from kokoro import KPipeline

    lang_code = voice[0]  # Kokoro voice ids begin with their language letter
    if lang_code not in _pipelines:
        _pipelines[lang_code] = KPipeline(lang_code=lang_code, repo_id="hexgrad/Kokoro-82M")
    pipeline = _pipelines[lang_code]

    text = apply_pronunciations(narration["script"], narration["pronunciations"])
    audio, tokens, offset = [], [], 0.0
    for result in pipeline(text, voice=voice, speed=float(narration["speed"]), split_pattern=None):
        samples = result.audio.detach().cpu().numpy() if hasattr(result.audio, "detach") else np.asarray(result.audio)
        for t in result.tokens or []:
            start = None if t.start_ts is None else offset + t.start_ts
            end = None if t.end_ts is None else offset + t.end_ts
            tokens.append((t.text, t.whitespace, start, end))
        audio.append(samples)
        offset += len(samples) / SAMPLE_RATE
    return np.concatenate(audio).astype("float32"), tokens


def spans_from_words(script, words):
    """Word times from an engine that reports them as (word, start, end), laid on the script as the spans build_cues wants.
    If the words do not line up with the script, no spans: captions are then timed by estimate rather than wrongly."""
    spans, pos = [], 0
    for text, start, end in words:
        at = script.find(text, pos)
        if at < 0:
            return []
        spans.append((at, at + len(text), start, end))
        pos = at + len(text)
    return spans


def generate_elsewhere(project_dir, narration):
    """Audio from an engine other than Kokoro: an internet service or a plugin. Needs only the standard library."""
    key, wav, meta = cache_paths(project_dir, narration)
    speech = engines.speak(CONFIG, narration)
    duration = engine_common.wav_info(speech.wav)[0]
    spans = spans_from_words(narration["script"], speech.words) if speech.words else []
    cues, exact = build_cues(narration["script"], spans, duration)
    wav.parent.mkdir(parents=True, exist_ok=True)
    wav.write_bytes(speech.wav)
    # Who made the audio is kept with it, so a course published later (or on another computer, without the plugin) still names the right maker.
    meta.write_text(json.dumps({"hash": "sha256:" + key, "duration": round(duration, 3), "exactTimings": exact, "cues": cues,
                                "madeBy": engines.describe(CONFIG, narration["voice"])}, indent=2, ensure_ascii=False), encoding="utf-8")


def generate(project_dir, narration):
    if engines.split_voice(narration["voice"])[0] != engines.KOKORO:
        return generate_elsewhere(project_dir, narration)
    import soundfile as sf

    key, wav, meta = cache_paths(project_dir, narration)
    samples, tokens = synthesise(narration)
    duration = len(samples) / SAMPLE_RATE
    rebuilt, spans = words_with_offsets(tokens)
    if rebuilt.strip() != narration["script"].strip():
        spans = []  # token text drifted from the script (for example an IPA override): estimate instead
    cues, exact = build_cues(narration["script"], spans, duration)
    wav.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(wav), samples, SAMPLE_RATE, subtype="PCM_16")
    meta.write_text(json.dumps({"hash": "sha256:" + key, "duration": round(duration, 3),
                                "exactTimings": exact, "cues": cues}, indent=2, ensure_ascii=False),
                    encoding="utf-8")


# ---------------------------------------------------------------- entry point

# The parts without which Kokoro itself is not there. Anything else that cannot be imported is an extra a language needs (the Japanese
# and Chinese voices need packages the English ones do not), and Kokoro's voices in other languages still work.
KOKORO_CORE = {"kokoro", "soundfile", "numpy", "torch"}


def kokoro_missing(exc):
    if exc.name and exc.name not in KOKORO_CORE:
        return (f"Kokoro is installed here, but this voice's language needs an extra part ({exc.name}) that has not been installed, "
                "so this voice cannot be made on this computer. Kokoro's voices in other languages are not affected.")
    return (f"Kokoro is not available in this Python ({exc.name}). "
            "Set OPENSTAGE_KOKORO_PYTHON to a Python that has it, or use --no-generate.")


def run(project_dir, allow_generate=True, log=print, only=None, cache_root=None, config=None, failures=None):
    """Returns {key: info}, where the key is an object's id or "<object id>/<item id>" for an interaction item.
    info['audio'] is None if no audio is cached.
    only: generate just these keys. cache_root: where .cache lives, if not in the project.
    config: which engines may be used (engines.Config); the default is Kokoro only.
    failures: a list that gets one message for each engine that failed. After an engine fails, the rest of its narrations
    are not tried in this run, so a wrong key or an empty account is not hit again and again."""
    global CONFIG
    previous, CONFIG = CONFIG, (config or CONFIG)
    try:
        out = {}
        cache_dir = cache_root or project_dir
        failed = {}
        for slide_id, oid, n in narrated_objects(project_dir):
            key, wav, meta = cache_paths(cache_dir, n)
            engine = engines.split_voice(n["voice"])[0]
            who = engines.describe(CONFIG, n["voice"])
            cached = wav.exists() and meta.exists()
            wanted = only is None or oid in only
            if not cached and allow_generate and wanted:
                allowed, why = engines.status(CONFIG, n["voice"])
                if engine in failed:
                    log(f"  missing     {oid}  ({who['name']} failed earlier in this run)")
                elif not allowed:
                    log(f"  missing     {oid}  ({why})")
                else:
                    log(f"  generating  {oid}  ({len(n['script'])} characters, {who['name']})")
                    try:
                        generate(cache_dir, n)
                    except (engine_common.EngineError, ImportError) as exc:
                        message = kokoro_missing(exc) if isinstance(exc, ImportError) else str(exc)
                        failed[engine] = message
                        if failures is not None:
                            failures.append(message)
                        log(f"  failed      {oid}  ({message})")
            elif not cached:
                log(f"  missing     {oid}  (not generated)")
            else:
                log(f"  cached      {oid}")
            have = wav.exists() and meta.exists()
            info = json.loads(meta.read_text(encoding="utf-8")) if have else {}
            who = info.get("madeBy") or who
            out[oid] = {
                "slide": slide_id, "script": n["script"], "lang": n["lang"], "voice": n["voice"],
                "hash": key, "audio": f".cache/narration/{key}.wav" if have else None,
                "duration": info.get("duration"), "cues": info.get("cues"),
                "exactTimings": info.get("exactTimings"),
                "engine": who["engine"], "engineName": who["name"], "where": who["where"], "home": who["home"],
            }
        return out
    finally:
        CONFIG = previous


def parse_args(argv):
    """Returns (project dir, options), or None if the arguments do not make sense."""
    args, it = [], iter(argv)
    options = {"only": None, "cache_root": None, "allow_network": set(), "plugins_dir": None, "plugins_enabled": set()}
    lists = {"--only": "only", "--allow-network": "allow_network", "--plugins-enabled": "plugins_enabled"}
    texts = {"--cache-root": "cache_root", "--plugins-dir": "plugins_dir"}
    for a in it:
        if a in lists or a in texts:
            value = next(it, None)
            if value is None:
                return None
            if a in lists:
                options[lists[a]] = {v for v in value.split(",") if v}
            else:
                options[texts[a]] = value
        elif not a.startswith("--"):
            args.append(a)
    return (args[0], options) if len(args) == 1 else None


def main(argv):
    # Scripts, alt text and names can be in any language, and a Windows pipe or console is not UTF-8 unless asked: what is printed (the JSON the editor
    # and the publisher read, the progress and the messages) is made UTF-8 so a course in Japanese does not stop the tool.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parsed = parse_args(argv)
    if parsed is None:
        print("Usage: narrate.py PROJECT_DIR [--no-generate] [--json] [--only ID,ID] [--cache-root DIR] "
              "[--allow-network SERVICE,SERVICE] [--plugins-dir DIR] [--plugins-enabled ID,ID]")
        return 2
    project_dir, options = parsed
    as_json = "--json" in argv
    log = (lambda *_: None) if as_json else print
    # With --json, progress goes to stderr so stdout stays machine-readable.
    progress = (lambda m: print(m, file=sys.stderr)) if as_json else log
    config = engines.Config(allow_network=options["allow_network"], plugins_dir=options["plugins_dir"],
                            plugins_enabled=options["plugins_enabled"])
    failures = []
    try:
        result = run(project_dir, allow_generate="--no-generate" not in argv, log=progress,
                     only=options["only"], cache_root=options["cache_root"], config=config, failures=failures)
    finally:
        engines.plugins.close_all()
    if failures:
        # The editor shows the last lines of this to the author.
        for message in failures:
            print(f"NOT MADE: {message}", file=sys.stderr)
        return 1
    if as_json:
        print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
