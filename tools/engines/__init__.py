"""Where a narration's voice comes from.

A voice is named by one string. A bare name such as af_heart is a voice of Kokoro, the speech model that runs on this
computer, which is how every project made before other engines existed names its voices. Any other engine's voices begin
with the engine's name and a colon: openai:alloy, elevenlabs:<voice id>, or <plugin id>:<voice> for a plugin.

Nothing that makes audio is reached unless it is allowed. A service that sends text over the internet is used only if the
caller names it in Config.allow_network (the editor does that after the author has said yes, once, for that service) and a
key is set; a plugin is used only if it is in Config.plugins_enabled. Everything else is reported as 'not made', with a
reason, and the course is published without that audio, as it is when no speech engine is set up at all.
"""
import os

from . import common, elevenlabs_engine, openai_engine, plugins
from .common import EngineError, Speech

KOKORO = "kokoro"

# What each built-in engine is called, where it works, and its home page. 'where' is 'computer' or 'internet'.
BUILTIN = {
    KOKORO: {"name": "Kokoro", "where": "computer", "home": "https://huggingface.co/hexgrad/Kokoro-82M"},
    openai_engine.ID: {"name": openai_engine.NAME, "where": "internet", "home": openai_engine.HOME},
    elevenlabs_engine.ID: {"name": elevenlabs_engine.NAME, "where": "internet", "home": elevenlabs_engine.HOME},
}
SERVICES = {openai_engine.ID: openai_engine, elevenlabs_engine.ID: elevenlabs_engine}


def split_voice(voice):
    """(engine, the engine's own name for the voice)."""
    if ":" in voice:
        engine, rest = voice.split(":", 1)
        return engine, rest
    return KOKORO, voice


def key_variable(service):
    """The environment variable a service's key arrives in. A key is never put on a command line, where other programs can see it."""
    return f"OPENSTAGE_KEY_{service.upper()}"


class Config:
    """What this run is allowed to use. The default allows only Kokoro."""

    def __init__(self, allow_network=(), plugins_dir=None, plugins_enabled=(), env=None, transport=None):
        self.allow_network = set(allow_network)
        self.plugins_dir = plugins_dir
        self.plugins_enabled = set(plugins_enabled)
        self.env = os.environ if env is None else env
        self.transport = transport
        self._plugins = None

    def key(self, service):
        return self.env.get(key_variable(service), "").strip()

    def model(self, service, kind):
        """The model name the author chose for this service and kind of work (speech, picture), or '' for the engine's own default.
        It arrives in OPENSTAGE_MODEL_<SERVICE>_<KIND>. Not a secret."""
        return self.env.get(f"OPENSTAGE_MODEL_{service.upper()}_{kind.upper()}", "").strip()

    def plugin(self, plugin_id):
        """The plugin with this id if it is installed, valid and switched on, else None."""
        if self._plugins is None:
            found, _ = plugins.discover(self.plugins_dir)
            self._plugins = {p.id: p for p in found}
        return self._plugins.get(plugin_id) if plugin_id in self.plugins_enabled else None


def describe(config, voice):
    """Who makes this voice: {'engine', 'name', 'where', 'home'}. Names an unknown engine as itself."""
    engine, _ = split_voice(voice)
    if engine in BUILTIN:
        return {"engine": engine, **BUILTIN[engine]}
    plugin = config.plugin(engine)
    if plugin is not None:
        return {"engine": engine, "name": plugin.name, "where": "internet" if plugin.network else "computer", "home": ""}
    return {"engine": engine, "name": engine, "where": "unknown", "home": ""}


def status(config, voice):
    """(True, '') if this run may make audio in this voice, else (False, why not). Kokoro is always allowed here; whether it is
    installed is found out when it is used."""
    engine, rest = split_voice(voice)
    if engine == KOKORO:
        return True, ""
    if engine in SERVICES:
        name = BUILTIN[engine]["name"]
        if engine not in config.allow_network:
            return False, f"{name} has not been allowed to receive this text. Make the audio from the Narration dialog."
        if not config.key(engine):
            return False, f"There is no {name} key. Add it in Settings."
        return True, ""
    if config.plugin(engine) is not None:
        return True, ""
    return False, f"No speech engine here makes the voice '{voice}'. A plugin may be missing or switched off."


def speak(config, narration):
    """Speech for a narration whose voice is not Kokoro's. Raises EngineError, in words an author can read."""
    ok, why = status(config, narration["voice"])
    if not ok:
        raise EngineError(why)
    engine, rest = split_voice(narration["voice"])
    if engine in SERVICES:
        return SERVICES[engine].speak(narration["script"], rest, narration["speed"], config.key(engine), config.model(engine, "speech"), config.transport)
    return plugins.speak(config.plugin(engine), rest, narration["script"], narration["speed"], narration["lang"], config.env)
