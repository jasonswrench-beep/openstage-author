"""Make a picture or a sound with an internet service, list a service's voices, check a key, or list the voice plugins.

Usage:  python generate.py OP [--allow-network SERVICE,SERVICE] [--plugins-dir DIR] [--plugins-enabled ID,ID]
        with one line of JSON describing the job on standard input, and one line of JSON as the answer on standard output.

OP is one of
  plugins    the voice plugins found in --plugins-dir, and whether each is switched on. Nothing is run and nothing is sent.
  check      {"service": "openai"}  asks the service whether the key is accepted (it costs nothing)
  voices     {"service": "elevenlabs"}  the account's ready-made voices
  picture    {"service": "openai", "prompt": "...", "size": "square|wide|tall", "quality": "low|medium|high", "out": "FILE.png"}
  sound      {"service": "elevenlabs", "prompt": "...", "seconds": 5 or null, "out": "FILE.mp3"}

Anything that talks to a service needs the service named in --allow-network (the editor passes it only after the author
has said yes, once, for that service) and its key in the environment (OPENSTAGE_KEY_OPENAI, OPENSTAGE_KEY_ELEVENLABS).
The key is never put on the command line or in the answer. The model to use, if the author changed it, arrives in
OPENSTAGE_MODEL_<SERVICE>_<KIND>. The answer is {"ok": true, ...} or {"ok": false, "message": "..."}; a message is in
words an author can read.
"""
import json
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import engines  # noqa: E402
from engines import plugins  # noqa: E402
from engines.common import EngineError  # noqa: E402

MAX_REQUEST = 256 * 1024


def _service(request, config, kind):
    """The service module the request names, if this run may use it for this kind of work."""
    name = request.get("service")
    service = engines.SERVICES.get(name) if isinstance(name, str) else None
    if service is None:
        raise EngineError("That is not a service OpenStage knows.")
    if name not in config.allow_network:
        raise EngineError(f"{service.NAME} has not been allowed to receive this. Allow it in Settings first.")
    if not config.key(name):
        raise EngineError(f"There is no {service.NAME} key. Add it in Settings.")
    if kind and not hasattr(service, kind):
        raise EngineError(f"{service.NAME} does not offer that here.")
    return service


def _out(request, suffix):
    out = request.get("out")
    if not isinstance(out, str) or not out.lower().endswith(suffix):
        raise EngineError("Where to put the result was not given.")
    return pathlib.Path(out)


def do_plugins(request, config):
    found, problems = plugins.discover(config.plugins_dir)
    return {"ok": True, "plugins": [{**p.summary(), "enabled": p.id in config.plugins_enabled} for p in found], "problems": problems}


def do_check(request, config):
    service = _service(request, config, "check_key")
    service.check_key(config.key(service.ID), config.transport)
    return {"ok": True}


def do_voices(request, config):
    service = _service(request, config, "list_voices")
    return {"ok": True, "voices": service.list_voices(config.key(service.ID), config.transport)}


def do_picture(request, config):
    service = _service(request, config, "picture")
    out = _out(request, ".png")
    prompt, size, quality = str(request.get("prompt", "")), str(request.get("size", "")), str(request.get("quality", "medium"))
    data, model = service.picture(prompt, size, quality, config.key(service.ID), config.model(service.ID, "picture"), config.transport)
    out.write_bytes(data)
    return {"ok": True, "bytes": len(data), "format": "png", "service": service.ID, "model": model}


def do_sound(request, config):
    service = _service(request, config, "sound")
    out = _out(request, ".mp3")
    seconds = request.get("seconds")
    if seconds is not None and (isinstance(seconds, bool) or not isinstance(seconds, (int, float))):
        raise EngineError("How long the sound should be must be a number of seconds.")
    data, model = service.sound(str(request.get("prompt", "")), seconds, config.key(service.ID), config.transport)
    out.write_bytes(data)
    return {"ok": True, "bytes": len(data), "format": "mp3", "service": service.ID, "model": model}


OPS = {"plugins": do_plugins, "check": do_check, "voices": do_voices, "picture": do_picture, "sound": do_sound}


def run(op, request, config):
    """The answer for one job. Never raises for something an author can fix."""
    try:
        return OPS[op](request, config)
    except EngineError as err:
        return {"ok": False, "message": str(err)}
    except OSError as err:
        return {"ok": False, "message": f"Could not save the result: {err.strerror or err}"}


def parse_args(argv):
    """(op, options), or None if the arguments do not make sense."""
    op, options, it = None, {"allow_network": set(), "plugins_dir": None, "plugins_enabled": set()}, iter(argv)
    for a in it:
        if a in ("--allow-network", "--plugins-enabled"):
            value = next(it, None)
            if value is None:
                return None
            options["allow_network" if a == "--allow-network" else "plugins_enabled"] = {v for v in value.split(",") if v}
        elif a == "--plugins-dir":
            options["plugins_dir"] = next(it, None)
            if options["plugins_dir"] is None:
                return None
        elif not a.startswith("--") and op is None:
            op = a
        else:
            return None
    return (op, options) if op in OPS else None


def main(argv):
    parsed = parse_args(argv)
    if parsed is None:
        print(f"Usage: generate.py {'|'.join(OPS)} [--allow-network SERVICE,SERVICE] [--plugins-dir DIR] [--plugins-enabled ID,ID]", file=sys.stderr)
        return 2
    op, options = parsed
    try:
        request = json.loads(sys.stdin.read(MAX_REQUEST + 1)[:MAX_REQUEST] or "{}")
        if not isinstance(request, dict):
            raise ValueError
    except ValueError:
        print(json.dumps({"ok": False, "message": "The request was not understood."}))
        return 0
    config = engines.Config(allow_network=options["allow_network"], plugins_dir=options["plugins_dir"], plugins_enabled=options["plugins_enabled"])
    print(json.dumps(run(op, request, config), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
