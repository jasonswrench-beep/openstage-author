"""ElevenLabs, with the author's own key: spoken voices and sound effects.

Only the ready-made ("premade") voices are used. A voice cloned from a recording, or designed or professionally made for
an account, is never offered (voice cloning is out of scope). The key goes only in the xi-api-key header of a request
to api.elevenlabs.io.

Written from ElevenLabs' API reference (checked 2026-10-14): POST /v1/text-to-speech/{voice_id}?output_format=pcm_24000
returns raw 16-bit signed little-endian mono samples at 24 kHz and takes voice_settings.speed; POST /v1/sound-generation
returns an MP3 of 0.5 to 30 seconds; GET /v2/voices?category=premade lists the ready-made voices. Model names change,
so the author can change them in Settings.
"""
import json
import re

from . import common
from .common import EngineError, Speech

ID = "elevenlabs"
NAME = "ElevenLabs"
HOME = "https://elevenlabs.io/"
KEY_URL = "https://elevenlabs.io/app/settings/api-keys"
BASE = "https://api.elevenlabs.io"

DEFAULT_SPEECH_MODEL = "eleven_multilingual_v2"
SOUND_MODEL = "eleven_text_to_sound_v2"

SPEED_MIN, SPEED_MAX = 0.7, 1.2
TEXT_LIMIT = 4500
PCM_RATE = 24000
SOUND_MIN, SOUND_MAX = 0.5, 30.0

_VOICE_OK = re.compile(r"^[A-Za-z0-9]{10,40}$")
_MODEL_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")


def _model(name, default):
    name = (name or "").strip() or default
    if not _MODEL_OK.match(name):
        raise EngineError(f"'{name[:40]}' is not a model name {NAME} would accept. Check it in Settings.")
    return name


def _headers(key):
    return {"xi-api-key": key, "Content-Type": "application/json", "Accept": "*/*"}


def speak(text, voice_id, speed, key, model="", transport=None):
    """The text spoken in one of the account's ready-made voices. The speed is held to the range the service allows."""
    if not _VOICE_OK.match(voice_id):
        raise EngineError(f"'{voice_id[:30]}' is not a {NAME} voice id.")
    model = _model(model, DEFAULT_SPEECH_MODEL)
    speed = min(max(float(speed), SPEED_MIN), SPEED_MAX)
    parts = []
    for piece in common.split_text(text, TEXT_LIMIT):
        body = json.dumps({"text": piece, "model_id": model, "voice_settings": {"speed": speed}}).encode("utf-8")
        url = f"{BASE}/v1/text-to-speech/{voice_id}?output_format=pcm_{PCM_RATE}"
        pcm = common.call(NAME, key, transport, "POST", url, _headers(key), body, kind="narration")
        if len(pcm) < 2:
            raise EngineError(f"{NAME} sent back no audio.")
        parts.append(common.wav_from_pcm(pcm[: len(pcm) - len(pcm) % 2], PCM_RATE))
    if not parts:
        raise EngineError("There is nothing to say.")
    return Speech(common.join_wavs(parts), None)


def sound(prompt, seconds, key, transport=None):
    """A sound effect made from the description, as MP3 bytes. `seconds` is 0.5 to 30, or None to let the service decide."""
    if not prompt.strip():
        raise EngineError("Describe the sound first.")
    if len(prompt) > 1000:
        raise EngineError("That description is too long.")
    payload = {"text": prompt, "model_id": SOUND_MODEL}
    if seconds is not None:
        seconds = float(seconds)
        if not SOUND_MIN <= seconds <= SOUND_MAX:
            raise EngineError(f"A sound can be {SOUND_MIN:g} to {SOUND_MAX:g} seconds long.")
        payload["duration_seconds"] = seconds
    answer = common.call(NAME, key, transport, "POST", f"{BASE}/v1/sound-generation?output_format=mp3_44100_128", _headers(key),
                         json.dumps(payload).encode("utf-8"), timeout=180, kind="sound request")
    if not common.has_mp3_header(answer):
        raise EngineError(f"{NAME} answered, but not with a sound OpenStage understands.")
    return answer, SOUND_MODEL


def _get_json(key, transport, url):
    answer = common.call(NAME, key, transport, "GET", url, {"xi-api-key": key, "Accept": "application/json"}, timeout=60, kind="request")
    try:
        data = json.loads(answer.decode("utf-8"))
    except ValueError:
        raise EngineError(f"{NAME} answered, but not in a way OpenStage understands.") from None
    return data if isinstance(data, dict) else {}


def check_key(key, transport=None):
    """Whether the key is accepted, by asking for one voice. Costs nothing."""
    _get_json(key, transport, f"{BASE}/v2/voices?page_size=1&category=premade")


def list_voices(key, transport=None):
    """The account's ready-made voices, as [{"id", "name", "hint"}]. Cloned, designed and professional voices are left out
    twice over: they are not asked for, and anything that still says otherwise is skipped."""
    voices, token = [], None
    for _ in range(10):
        url = f"{BASE}/v2/voices?page_size=100&category=premade" + (f"&next_page_token={token}" if token else "")
        data = _get_json(key, transport, url)
        for v in data.get("voices") or []:
            if not isinstance(v, dict) or v.get("category") not in (None, "premade"):
                continue
            vid, name = str(v.get("voice_id") or ""), str(v.get("name") or "").strip()
            if not _VOICE_OK.match(vid) or not name:
                continue
            labels = v.get("labels") if isinstance(v.get("labels"), dict) else {}
            hint = ", ".join(str(labels[k]) for k in ("gender", "accent", "age") if labels.get(k))
            voices.append({"id": vid, "name": name, "hint": hint})
        token = data.get("next_page_token") if data.get("has_more") else None
        if not token or not re.match(r"^[A-Za-z0-9_=-]{1,200}$", str(token)):
            break
    return sorted(voices, key=lambda v: v["name"].lower())
