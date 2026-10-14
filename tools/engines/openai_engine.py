"""OpenAI, with the author's own key: spoken voices and pictures.

Only OpenAI's ready-made voices are used. A voice made from someone's recorded sample is never offered, here or anywhere
in OpenStage (voice cloning is out of scope). The key goes only in the Authorization header of a request to
api.openai.com; this module has no way to send anything anywhere else.

Written from OpenAI's API reference (checked 2026-10-14): POST /v1/audio/speech takes up to 4096 characters and, as
response_format "pcm", returns raw 16-bit signed little-endian mono samples at 24 kHz; POST /v1/images/generations
returns the picture of a GPT image model as base64 in data[0].b64_json. Model names change, so the author can change
them in Settings; these are only what is used until they do.
"""
import base64
import json
import pathlib
import re

from . import common
from .common import EngineError, Speech

ID = "openai"
NAME = "OpenAI"
HOME = "https://openai.com/"
KEY_URL = "https://platform.openai.com/api-keys"
BASE = "https://api.openai.com"

DEFAULT_SPEECH_MODEL = "gpt-4o-mini-tts"
DEFAULT_PICTURE_MODEL = "gpt-image-1"

# The built-in voices, as the API reference lists them (tools/openai-voices.json, which the validator and the editor read too).
# They speak many languages; none is tied to one.
VOICES = json.loads((pathlib.Path(__file__).resolve().parent.parent / "openai-voices.json").read_text(encoding="utf-8"))["voices"]

SPEED_MIN, SPEED_MAX = 0.25, 4.0
TEXT_LIMIT = 4000  # the service takes 4096 characters; a little under is safe
PCM_RATE = 24000

# How a picture is shaped, in the words the author sees, and what the service calls it.
PICTURE_SIZES = {"square": "1024x1024", "wide": "1536x1024", "tall": "1024x1536"}
PICTURE_QUALITIES = ("low", "medium", "high")

_MODEL_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")


def _model(name, default):
    name = (name or "").strip() or default
    if not _MODEL_OK.match(name):
        raise EngineError(f"'{name[:40]}' is not a model name {NAME} would accept. Check it in Settings.")
    return name


def _headers(key):
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "*/*"}


def speak(text, voice, speed, key, model="", transport=None):
    """The text spoken in one of the ready-made voices. Long text goes in several requests and comes back joined."""
    if voice not in VOICES:
        raise EngineError(f"'{voice[:30]}' is not one of {NAME}'s ready-made voices.")
    model = _model(model, DEFAULT_SPEECH_MODEL)
    speed = min(max(float(speed), SPEED_MIN), SPEED_MAX)
    parts = []
    for piece in common.split_text(text, TEXT_LIMIT):
        body = json.dumps({"model": model, "input": piece, "voice": voice, "response_format": "pcm", "speed": speed}).encode("utf-8")
        pcm = common.call(NAME, key, transport, "POST", f"{BASE}/v1/audio/speech", _headers(key), body, kind="narration")
        if len(pcm) < 2:
            raise EngineError(f"{NAME} sent back no audio.")
        parts.append(common.wav_from_pcm(pcm[: len(pcm) - len(pcm) % 2], PCM_RATE))
    if not parts:
        raise EngineError("There is nothing to say.")
    return Speech(common.join_wavs(parts), None)


def picture(prompt, size, quality, key, model="", transport=None):
    """A picture drawn from the description, as PNG bytes."""
    if size not in PICTURE_SIZES:
        raise EngineError(f"The shape of a picture is one of: {', '.join(PICTURE_SIZES)}.")
    if quality not in PICTURE_QUALITIES:
        raise EngineError(f"The quality of a picture is one of: {', '.join(PICTURE_QUALITIES)}.")
    if not prompt.strip():
        raise EngineError("Describe the picture first.")
    if len(prompt) > 32000:
        raise EngineError("That description is too long.")
    model = _model(model, DEFAULT_PICTURE_MODEL)
    body = json.dumps({"model": model, "prompt": prompt, "n": 1, "size": PICTURE_SIZES[size], "quality": quality,
                       "output_format": "png"}).encode("utf-8")
    answer = common.call(NAME, key, transport, "POST", f"{BASE}/v1/images/generations", _headers(key), body, timeout=300, kind="picture request")
    try:
        data = base64.b64decode(json.loads(answer.decode("utf-8"))["data"][0]["b64_json"], validate=False)
    except (ValueError, KeyError, IndexError, TypeError):
        raise EngineError(f"{NAME} answered, but not with a picture OpenStage understands.") from None
    if not common.has_png_header(data):
        raise EngineError(f"{NAME} answered, but not with a picture OpenStage understands.")
    return data, model


def check_key(key, transport=None):
    """Whether the key is accepted, without making anything that costs: asks for the list of models."""
    common.call(NAME, key, transport, "GET", f"{BASE}/v1/models", {"Authorization": f"Bearer {key}", "Accept": "application/json"}, timeout=30, kind="key check")
