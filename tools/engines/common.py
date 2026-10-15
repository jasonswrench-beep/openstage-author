"""Pieces shared by every speech, picture and sound engine: the error that is safe to show, how a web request is made and
its failures put into words, and the little bit of audio handling the engines need. Standard library only, so any Python
can run an engine that talks to a web service (Kokoro, the local speech model, is the one engine that needs its own Python).

Nothing here knows about a particular service. A key is passed in by the caller and never appears in an error.
"""
import io
import json
import re
import urllib.error
import urllib.request
import wave


class EngineError(Exception):
    """A failure described in words an author can read. Its text never contains a key."""


class Speech:
    """What a speech engine gives back: a WAV file's bytes and, if the engine knows them, when each word was spoken
    as (word, start, end) in seconds. words=None means the engine does not say, and captions are timed by estimate."""

    def __init__(self, wav, words=None):
        self.wav = wav
        self.words = words


# ---------------------------------------------------------------- web requests

USER_AGENT = "OpenStage-Author"
MAX_ANSWER = 64 * 1024 * 1024


def urllib_transport(method, url, headers, body, timeout):
    """Make one web request. Returns (status, answer bytes). A reply that is an HTTP error is still returned, so the caller
    can read what the service said; only 'could not connect at all' is raised."""
    request = urllib.request.Request(url, data=body, method=method, headers={"User-Agent": USER_AGENT, **headers})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as reply:
            return reply.status, reply.read(MAX_ANSWER + 1)
    except urllib.error.HTTPError as err:
        try:
            return err.code, err.read(64 * 1024)
        finally:
            err.close()
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        raise ConnectionError(str(getattr(err, "reason", err))) from err


_DETAIL_KEYS = ("message", "msg", "detail", "error")


def detail_of(body):
    """What an error reply says went wrong, kept short and free of anything that is not text. JSON from the services this
    tool talks to puts it under message, detail or error, sometimes nested a level or two."""
    try:
        data = json.loads(body.decode("utf-8", "replace"))
    except ValueError:
        text = body.decode("utf-8", "replace").strip()
        return "" if text.startswith("<") else _tidy(text)

    def find(value, depth=0):
        if isinstance(value, str):
            return value
        if depth > 3:
            return ""
        if isinstance(value, dict):
            for k in _DETAIL_KEYS:
                if k in value:
                    found = find(value[k], depth + 1)
                    if found:
                        return found
        if isinstance(value, list):
            for item in value:
                found = find(item, depth + 1)
                if found:
                    return found
        return ""

    return _tidy(find(data))


def _tidy(text):
    return "".join(c for c in text if c.isprintable() or c == " ")[:200].strip()


def redact(text, key):
    """The text with any trace of the key taken out."""
    if key and len(key) >= 4:
        text = text.replace(key, "(your key)")
    return text


def call(service, key, transport, method, url, headers, body=None, timeout=180, kind="request"):
    """One request to a web service, answered with its bytes or an EngineError that says in plain words what to do.
    `service` is the name the author knows it by."""
    transport = transport or urllib_transport
    try:
        status, answer = transport(method, url, headers, body, timeout)
    except ConnectionError as err:
        raise EngineError(redact(f"Could not reach {service}. Check the internet connection. ({err})", key)) from None
    if 200 <= status < 300:
        if len(answer) > MAX_ANSWER:
            raise EngineError(f"{service} sent back more than OpenStage will accept.")
        return answer
    said = redact(detail_of(answer), key)
    more = f" It said: {said}" if said else ""
    about_the_key = "api key" in said.lower() or "api_key" in said.lower()
    if status in (401, 403) or (status in (400, 422) and about_the_key):
        raise EngineError(f"{service} did not accept the key. Check the key in Settings, and that the account can use this.{more}")
    if status == 402:
        raise EngineError(f"{service} says the account has no credit left for this.{more}")
    if status == 404:
        raise EngineError(f"{service} could not find what was asked for. A voice or model name may be wrong.{more}")
    if status == 429:
        raise EngineError(f"{service} says there have been too many requests, or the account's limit is used up. Wait a little and try again.{more}")
    if status >= 500:
        raise EngineError(f"{service} had a problem on its side ({status}). Try again in a few minutes.{more}")
    raise EngineError(f"{service} did not accept the {kind} ({status}).{more}")


# ---------------------------------------------------------------- audio

def wav_from_pcm(pcm, rate=24000):
    """Raw 16-bit signed little-endian mono samples as a WAV file."""
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return out.getvalue()


def wav_info(data):
    """(seconds, channels, rate) of a WAV file's bytes, or an EngineError if it is not a WAV file this tool can use."""
    try:
        with wave.open(io.BytesIO(data), "rb") as w:
            rate, frames, channels, width = w.getframerate(), w.getnframes(), w.getnchannels(), w.getsampwidth()
    except (wave.Error, EOFError):
        raise EngineError("The speech engine did not give back a WAV file OpenStage can read.") from None
    if rate <= 0 or frames <= 0 or channels not in (1, 2) or width not in (1, 2, 3, 4):
        raise EngineError("The speech engine gave back audio with nothing in it, or in a form OpenStage cannot play.")
    return frames / rate, channels, rate


def join_wavs(parts):
    """Several WAV files of the same kind, one after the other."""
    if len(parts) == 1:
        return parts[0]
    out = io.BytesIO()
    params = None
    with wave.open(out, "wb") as w:
        for data in parts:
            with wave.open(io.BytesIO(data), "rb") as r:
                if params is None:
                    params = r.getparams()
                    w.setparams(params)
                elif (r.getnchannels(), r.getsampwidth(), r.getframerate()) != (params.nchannels, params.sampwidth, params.framerate):
                    raise EngineError("The pieces of the narration came back in different audio formats.")
                w.writeframes(r.readframes(r.getnframes()))
    return out.getvalue()


_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


def split_text(text, limit):
    """The text in pieces of at most `limit` characters, cut after a sentence where it can be and at a space where it must.
    Joining the pieces with spaces gives the text back (apart from the white space between sentences)."""
    pieces, current = [], ""
    for sentence in (s for s in _SENTENCE_END.split(text.strip()) if s):
        while len(sentence) > limit:
            cut = sentence.rfind(" ", 0, limit)
            cut = cut if cut > 0 else limit
            if current:
                pieces.append(current)
                current = ""
            pieces.append(sentence[:cut].strip())
            sentence = sentence[cut:].strip()
        if current and len(current) + 1 + len(sentence) > limit:
            pieces.append(current)
            current = ""
        current = f"{current} {sentence}".strip()
    if current:
        pieces.append(current)
    return pieces


def has_webp_header(data):
    return len(data) > 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"


def has_mp3_header(data):
    return data[:3] == b"ID3" or (len(data) > 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0)
