"""Make a short sample of one voice, so an author can hear it before choosing it.

Usage:  python voice_sample.py --cache-dir DIR [--allow-network SERVICE,SERVICE] [--plugins-dir DIR] [--plugins-enabled ID,ID]
        with one line of JSON on standard input, {"voice": "af_heart", "lang": "en-US"}, and one line of JSON as the answer.

The sample is always the same short sentence (see SENTENCES) at normal speed, in the language the voice speaks. None of the
author's own words are used, so nothing of theirs is ever sent anywhere to make it. A sample is kept in DIR under a name made
from the voice, its language, the sentence, and the model (or plugin version) that made it, so hearing the same voice again
costs nothing and a changed model gets a fresh sample. DIR belongs to the editor, not to a project; it is only a convenience
and can be emptied at any time.

Who makes the voice, and what it needs, are the same as for narration (engines/__init__.py): Kokoro runs on this computer and
needs its own Python; a voice of an internet service is made only if the service is named in --allow-network and its key is in
the environment; a plugin's voice only if the plugin is in --plugins-enabled. A sample already in DIR is played without any of
that, because nothing is made.

The answer is {"ok": true, "file": "<64 hex digits>.wav", "cached": true|false, "duration": seconds, "engine", "name", "where"}
or {"ok": false, "message": "..."} in words an author can read.
"""
import hashlib
import io
import json
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import engines  # noqa: E402
from engines import common  # noqa: E402
from engines.common import EngineError  # noqa: E402

# Bump when the way a sample is made changes in a way that should not reuse old ones.
SAMPLE_VERSION = "openstage voice sample 1"
MAX_REQUEST = 4 * 1024
MAX_VOICE = 100

# What each voice says, in the language it speaks. Short on purpose: it is quick to make and costs next to nothing.
SENTENCES = {
    "en": "Hello, this is how I sound. I can read your lesson aloud.",
    "es": "Hola, así es como sueno. Puedo leer tu lección en voz alta.",
    "fr": "Bonjour, voici ma voix. Je peux lire votre leçon à voix haute.",
    "de": "Hallo, so klinge ich. Ich kann Ihre Lektion laut vorlesen.",
    "it": "Ciao, ecco come suono. Posso leggere la tua lezione ad alta voce.",
    "pt": "Olá, é assim que eu soo. Posso ler a sua lição em voz alta.",
    "nl": "Hallo, zo klink ik. Ik kan je les hardop voorlezen.",
    "ru": "Здравствуйте, вот как звучит мой голос. Я могу прочитать ваш урок вслух.",
    "ja": "こんにちは、これが私の声です。あなたのレッスンを読み上げることができます。",
    "ko": "안녕하세요, 이것이 제 목소리입니다. 여러분의 수업을 소리 내어 읽어 드릴 수 있습니다.",
    "zh": "你好，这是我的声音。我可以为你朗读课程内容。",
    "hi": "नमस्ते, यह मेरी आवाज़ का नमूना है। आपका पाठ इस आवाज़ में पढ़ा जा सकता है।",
    "ar": "مرحبًا، هذه عينة من صوتي. يمكن قراءة درسك بصوت عالٍ.",
}

# The language a Kokoro voice speaks is the letter its name begins with.
KOKORO_LANGUAGES = {"a": "en", "b": "en", "e": "es", "f": "fr", "h": "hi", "i": "it", "j": "ja", "p": "pt", "z": "zh"}


def _kokoro_voices():
    data = json.loads((pathlib.Path(__file__).resolve().parent / "kokoro-voices.json").read_text(encoding="utf-8"))
    return set(data["voices"])


def language_of(voice, lang):
    """The language of the sample: a Kokoro voice's own, else the narration's language (en-US gives en). English if there is no sentence for it."""
    engine, rest = engines.split_voice(voice)
    base = KOKORO_LANGUAGES.get(rest[:1], "en") if engine == engines.KOKORO else str(lang or "en").split("-")[0].lower()
    return base if base in SENTENCES else "en"


def _maker(config, engine, rest):
    """What, besides the voice, decides what the sample sounds like: the model of a service, or the version of a plugin."""
    if engine == engines.KOKORO:
        return "kokoro"
    if engine in engines.SERVICES:
        return f"{engine} {config.model(engine, 'speech') or engines.SERVICES[engine].DEFAULT_SPEECH_MODEL}"
    plugin = config.plugin(engine)
    return f"plugin {engine} {plugin.version}" if plugin is not None else engine


def sample_key(config, voice, lang):
    """The 64 hex digits that name a voice's sample. Public so a test can see that a different model is a different sample."""
    engine, rest = engines.split_voice(voice)
    language = language_of(voice, lang)
    text = "\n".join([SAMPLE_VERSION, voice, language, SENTENCES[language], _maker(config, engine, rest)])
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _kokoro_wav(voice, sentence):
    import soundfile as sf
    import narrate

    samples, _ = narrate.synthesise({"voice": voice, "script": sentence, "pronunciations": [], "speed": 1.0})
    out = io.BytesIO()
    sf.write(out, samples, narrate.SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return out.getvalue()


def make_wav(config, voice, lang):
    """The sample's WAV bytes. Raises EngineError in words an author can read."""
    engine, rest = engines.split_voice(voice)
    sentence = SENTENCES[language_of(voice, lang)]
    if engine == engines.KOKORO:
        if rest not in _kokoro_voices():
            raise EngineError("That is not a voice Kokoro has.")
        try:
            return _kokoro_wav(voice, sentence)
        except ImportError as exc:
            import narrate

            raise EngineError(narrate.kokoro_missing(exc)) from None
        except Exception as exc:  # Kokoro has many ways to fail (a missing model file, a language it lacks a helper for)
            said = (str(exc).strip().splitlines() or [""])[0][:150]
            raise EngineError("Kokoro could not make a sample of this voice." + (f" It said: {said}" if said else "")) from None
    return engines.speak(config, {"voice": voice, "script": sentence, "speed": 1.0, "lang": lang}).wav


def run(request, config, cache_dir):
    """The answer for one sample. Never raises for something an author can fix."""
    voice, lang = request.get("voice"), request.get("lang", "en-US")
    if not isinstance(voice, str) or not voice or len(voice) > MAX_VOICE or any(ord(c) < 32 for c in voice) or not isinstance(lang, str):
        return {"ok": False, "message": "That is not a voice."}
    who = engines.describe(config, voice)
    answer ={"engine": who["engine"], "name": who["name"], "where": who["where"]}
    try:
        cache = pathlib.Path(cache_dir)
        key = sample_key(config, voice, lang)
        target = cache / f"{key}.wav"
        if target.is_file() and target.stat().st_size > 44:
            try:
                duration = common.wav_info(target.read_bytes())[0]
                return {"ok": True, "file": target.name, "cached": True, "duration": round(duration, 3), **answer}
            except EngineError:
                pass  # a damaged sample is made again
        wav = make_wav(config, voice, lang)
        duration = common.wav_info(wav)[0]
        cache.mkdir(parents=True, exist_ok=True)
        temporary = cache / f"{key}.{os.getpid()}.part"
        try:
            temporary.write_bytes(wav)
            os.replace(temporary, target)
        finally:
            if temporary.exists():
                temporary.unlink()
        return {"ok": True, "file": target.name, "cached": False, "duration": round(duration, 3), **answer}
    except EngineError as err:
        return {"ok": False, "message": str(err)}
    except OSError as err:
        return {"ok": False, "message": f"Could not keep the sample: {err.strerror or err}"}


def parse_args(argv):
    """The options, or None if the arguments do not make sense."""
    options, it = {"cache_dir": None, "allow_network": set(), "plugins_dir": None, "plugins_enabled": set()}, iter(argv)
    for a in it:
        value = next(it, None) if a in ("--cache-dir", "--allow-network", "--plugins-dir", "--plugins-enabled") else None
        if value is None:
            return None
        if a == "--cache-dir":
            options["cache_dir"] = value
        elif a == "--plugins-dir":
            options["plugins_dir"] = value
        else:
            options["allow_network" if a == "--allow-network" else "plugins_enabled"] = {v for v in value.split(",") if v}
    return options if options["cache_dir"] else None


def main(argv):
    options = parse_args(argv)
    if options is None:
        print("Usage: voice_sample.py --cache-dir DIR [--allow-network SERVICE,SERVICE] [--plugins-dir DIR] [--plugins-enabled ID,ID]", file=sys.stderr)
        return 2
    try:
        request = json.loads(sys.stdin.read(MAX_REQUEST + 1)[:MAX_REQUEST] or "{}")
        if not isinstance(request, dict):
            raise ValueError
    except ValueError:
        print(json.dumps({"ok": False, "message": "The request was not understood."}))
        return 0
    config = engines.Config(allow_network=options["allow_network"], plugins_dir=options["plugins_dir"], plugins_enabled=options["plugins_enabled"])
    try:
        print(json.dumps(run(request, config, options["cache_dir"]), ensure_ascii=False))
    finally:
        engines.plugins.close_all()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
