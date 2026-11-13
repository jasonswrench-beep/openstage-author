"""Voice plugins: other speech models, each a small program in a folder of its own.

A plugin is a folder with a plugin.json and whatever the program needs. The program is started once for a run and talks
to OpenStage one line of JSON at a time (docs/plugins.md). The voices a plugin offers are written in its plugin.json, a
fixed list, because OpenStage does not clone voices: the contract has no way to hand a plugin a recording to copy.

A plugin is a program that runs as the person using OpenStage. It can do anything that person can. So it is never part
of a project (a downloaded project cannot bring one), it does nothing until the author switches it on in Settings, and
its own claim about using the internet ('network') is shown to the author but cannot be checked.
"""
import json
import os
import pathlib
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading

from . import common
from .common import EngineError, Speech

CONTRACT = 1
RESERVED_IDS = {"kokoro", "openai"}
_ID = re.compile(r"^[a-z][a-z0-9-]{1,30}$")
_VOICE_ID = re.compile(r"^[A-Za-z0-9_.-]{1,60}$")
_LANG = re.compile(r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$")
SPEAK_TIMEOUT = 30 * 60  # a long script on a slow computer can take a while; cancelling is always possible


class PluginProblem(Exception):
    """Why a folder in the plugins folder cannot be used, in words the author can read."""


class Plugin:
    def __init__(self, folder, data):
        self.folder = folder
        self.id = data["id"]
        self.name = data["name"]
        self.version = data.get("version", "")
        self.licence = data["licence"]
        self.network = data["network"]
        self.description = data.get("description", "")
        self.command = data["command"]
        self.voices = data["voices"]
        self.pronunciations = bool(data.get("pronunciations", False))
        self.word_timings = bool(data.get("wordTimings", False))

    def summary(self):
        return {"id": self.id, "name": self.name, "version": self.version, "licence": self.licence, "network": self.network,
                "description": self.description, "pronunciations": self.pronunciations, "wordTimings": self.word_timings,
                "voices": [{"id": f"{self.id}:{v['id']}", "name": v["name"], "lang": v.get("lang"), "description": v.get("description", "")} for v in self.voices]}


def _text(data, field, limit, required=True):
    value = data.get(field)
    if value is None and not required:
        return ""
    if not isinstance(value, str) or (required and not value.strip()) or len(value) > limit:
        raise PluginProblem(f"plugin.json needs '{field}' as text of at most {limit} characters.")
    return value


def load_manifest(folder):
    """The Plugin described by folder/plugin.json, or a PluginProblem that says what is wrong with it."""
    path = pathlib.Path(folder) / "plugin.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except OSError:
        raise PluginProblem("There is no plugin.json in this folder.") from None
    except ValueError:
        raise PluginProblem("plugin.json is not valid JSON.") from None
    if not isinstance(data, dict):
        raise PluginProblem("plugin.json should be one JSON object.")
    if data.get("contract") != CONTRACT:
        raise PluginProblem(f"This plugin is written for contract {data.get('contract')!r}; this OpenStage uses contract {CONTRACT}.")
    pid = _text(data, "id", 31)
    if not _ID.match(pid) or pid in RESERVED_IDS:
        raise PluginProblem(f"The id '{pid}' will not do. Use 2 to 31 lowercase letters, digits and hyphens, starting with a letter, and not kokoro or openai.")
    _text(data, "name", 60)
    _text(data, "licence", 80)
    _text(data, "version", 30, required=False)
    _text(data, "description", 300, required=False)
    if not isinstance(data.get("network"), bool):
        raise PluginProblem("plugin.json must say whether the plugin uses the internet: \"network\": true or false.")
    if data.get("kinds") != ["voice"]:
        raise PluginProblem("In contract 1 a plugin is a voice plugin: \"kinds\": [\"voice\"].")
    command = data.get("command")
    if not (isinstance(command, list) and 1 <= len(command) <= 16 and all(isinstance(c, str) and c for c in command)):
        raise PluginProblem("plugin.json needs \"command\": the program and its arguments, as a list of text.")
    first = command[0]
    if first not in ("{python}",) and not first.startswith("{env:") and (os.path.isabs(first) or ".." in re.split(r"[\\/]", first)):
        raise PluginProblem("The program must be {python}, {env:NAME}, a name found on the PATH, or a path inside the plugin's folder.")
    voices = data.get("voices")
    if not (isinstance(voices, list) and 1 <= len(voices) <= 300):
        raise PluginProblem("plugin.json needs \"voices\": a fixed list of the voices the plugin has (1 to 300).")
    seen = set()
    for v in voices:
        if not (isinstance(v, dict) and isinstance(v.get("id"), str) and _VOICE_ID.match(v["id"]) and isinstance(v.get("name"), str) and v["name"].strip()):
            raise PluginProblem("Each voice needs an id (letters, digits, . _ -) and a name.")
        lang = v.get("lang")
        if lang is not None and not (isinstance(lang, str) and _LANG.match(lang)):
            raise PluginProblem(f"The language of voice '{v['id']}' should be a code such as en-US, or null.")
        if v["id"] in seen:
            raise PluginProblem(f"Voice '{v['id']}' is listed twice.")
        seen.add(v["id"])
    return Plugin(pathlib.Path(folder), data)


def discover(plugins_dir):
    """(plugins, problems) for the folders directly inside plugins_dir. A folder that cannot be used is reported, not hidden."""
    plugins, problems = [], []
    root = pathlib.Path(plugins_dir) if plugins_dir else None
    if root is None or not root.is_dir():
        return plugins, problems
    seen = set()
    for folder in sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith(".")):
        try:
            plugin = load_manifest(folder)
        except PluginProblem as err:
            problems.append({"folder": folder.name, "problem": str(err)})
            continue
        if plugin.id in seen:
            problems.append({"folder": folder.name, "problem": f"Another plugin already uses the id '{plugin.id}'."})
            continue
        seen.add(plugin.id)
        plugins.append(plugin)
    return plugins, problems


# ---------------------------------------------------------------- running one

def resolve_command(plugin, env=None):
    """The command line, with {python} and {env:NAME} filled in and a program inside the plugin's folder given its full path."""
    env = os.environ if env is None else env
    out = []
    for i, part in enumerate(plugin.command):
        if part == "{python}":
            out.append(sys.executable)
        elif part.startswith("{env:") and part.endswith("}"):
            name = part[5:-1]
            value = env.get(name, "").strip()
            if not value:
                raise EngineError(f"The plugin '{plugin.name}' needs the environment variable {name} to name the program it runs. Set it, then open OpenStage Author again.")
            out.append(value)
        elif i == 0 and re.search(r"[\\/]", part):
            out.append(str((plugin.folder / part).resolve()))
        elif i == 0:
            out.append(shutil.which(part) or part)
        else:
            out.append(part)
    return out


def plugin_environment(env):
    """What a plugin is given of the environment: everything but the keys of the services (OPENSTAGE_KEY_...). A plugin is someone else's
    program, and a key the author gave for one service is not for it."""
    return {name: value for name, value in env.items() if not name.upper().startswith("OPENSTAGE_KEY_")}


class Session:
    """A running plugin. One request at a time; the answer to each is one line of JSON."""

    def __init__(self, plugin, env=None):
        self.plugin = plugin
        command = resolve_command(plugin, env)
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
        try:
            self.process = subprocess.Popen(command, cwd=str(plugin.folder), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                            stderr=subprocess.PIPE, creationflags=flags, env=plugin_environment(os.environ if env is None else env))
        except OSError as err:
            raise EngineError(f"The plugin '{plugin.name}' could not be started: {err}") from None
        self.lines = queue.Queue()
        self.stderr_tail = []
        self._readers = [threading.Thread(target=self._read_stdout, daemon=True), threading.Thread(target=self._read_stderr, daemon=True)]
        for t in self._readers:
            t.start()

    def _read_stdout(self):
        for raw in self.process.stdout:
            self.lines.put(raw.decode("utf-8", "replace").strip())
        self.lines.put(None)

    def _read_stderr(self):
        for raw in self.process.stderr:
            self.stderr_tail = (self.stderr_tail + [raw.decode("utf-8", "replace").strip()])[-5:]

    def request(self, message, timeout=SPEAK_TIMEOUT):
        """Send one request and wait for its answer. Lines the plugin prints that are not an answer (progress, logs) are ignored."""
        try:
            self.process.stdin.write((json.dumps({"contract": CONTRACT, **message}) + "\n").encode("utf-8"))
            self.process.stdin.flush()
        except OSError:
            raise EngineError(self._stopped()) from None
        while True:
            try:
                line = self.lines.get(timeout=timeout)
            except queue.Empty:
                self.close()
                raise EngineError(f"The plugin '{self.plugin.name}' did not finish in {timeout // 60} minutes, so it was stopped.") from None
            if line is None:
                raise EngineError(self._stopped())
            if line.startswith("{"):
                try:
                    answer = json.loads(line)
                except ValueError:
                    continue
                if isinstance(answer, dict) and "ok" in answer:
                    return answer

    def _stopped(self):
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            pass
        for t in self._readers:  # let what it printed on its way out be read
            t.join(timeout=1)
        said = " ".join(t for t in self.stderr_tail if t)[:300]
        return f"The plugin '{self.plugin.name}' stopped before it answered." + (f" It said: {said}" if said else "")

    def close(self):
        try:
            self.process.stdin.close()
        except OSError:
            pass
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        for t in self._readers:
            t.join(timeout=1)
        for pipe in (self.process.stdout, self.process.stderr):
            try:
                pipe.close()
            except OSError:
                pass


# ---------------------------------------------------------------- speech through a plugin

_sessions = {}


def close_all():
    for session in _sessions.values():
        session.close()
    _sessions.clear()


def speak(plugin, voice_id, text, speed, lang, env=None):
    """The text spoken by one of the plugin's voices. Returns a Speech; word times are included only if the plugin gave them."""
    if voice_id not in {v["id"] for v in plugin.voices}:
        raise EngineError(f"The plugin '{plugin.name}' has no voice '{voice_id[:40]}'.")
    session = _sessions.get(plugin.id)
    if session is None or session.process.poll() is not None:
        session = _sessions[plugin.id] = Session(plugin, env)
    folder = tempfile.mkdtemp(prefix="openstage-plugin-")
    try:
        out = os.path.join(folder, "speech.wav")
        answer = session.request({"op": "speak", "text": text, "voice": voice_id, "speed": float(speed), "lang": lang, "out": out})
        if answer.get("ok") is not True:
            said = str(answer.get("message") or "").strip()[:300]
            raise EngineError(f"The plugin '{plugin.name}' could not make the audio." + (f" It said: {said}" if said else ""))
        try:
            with open(out, "rb") as f:
                wav = f.read()
        except OSError:
            raise EngineError(f"The plugin '{plugin.name}' said it was done but wrote no audio file.") from None
        common.wav_info(wav)
        return Speech(wav, _word_times(answer.get("words")) if plugin.word_timings else None)
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def _word_times(words):
    """[(word, start, end)] from a plugin's answer, or None if it is not in that form."""
    if not isinstance(words, list):
        return None
    out = []
    for w in words:
        if not (isinstance(w, dict) and isinstance(w.get("text"), str) and isinstance(w.get("start"), (int, float)) and isinstance(w.get("end"), (int, float))):
            return None
        out.append((w["text"], float(w["start"]), float(w["end"])))
    return out
