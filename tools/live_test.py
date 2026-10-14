"""Try the AI services for real, with your own key. Run it with TEST AI SERVICES.bat, or:  python tools/live_test.py

It checks, one step at a time and asking before the service, that OpenStage Author really works with OpenAI: the key is
accepted, a short line of speech is made and given captions, and a small picture is made. It uses the same code the editor
uses. The made files are kept in dist/live-test so you can look at and listen to them, and a plain report is written beside them.

What it sends: the key, a one-line test sentence, and a one-line description of a picture. Nothing from any project.
What it costs: a small amount on your OpenAI account, the same as making that much in the editor.
What it never does: print, save or put your key in the report. The key is read from the environment (OPENSTAGE_KEY_OPENAI)
or pasted with a * shown for each character, and is forgotten when the window closes.

Also, with no key and at no cost: it shows that publishing sends nothing, and that the example voice plugin works.
"""
import getpass
import json
import pathlib
import shutil
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import engines  # noqa: E402
import narrate  # noqa: E402
from engines import common, openai_engine  # noqa: E402
from engines.common import EngineError  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parent.parent
OUTPUT = REPO / "dist" / "live-test"
SENTENCE = "This is a test of OpenStage Author. If you can hear this, the voice works."
PICTURE_WORDS = "A simple red circle on a plain white background."


class Result:
    def __init__(self, name, ok, detail):
        self.name, self.ok, self.detail = name, ok, detail

    def line(self):
        return f"{'SKIP' if self.ok is None else 'PASS' if self.ok else 'FAIL'}  {self.name}: {self.detail}"


class Failed(Exception):
    """A step that did not work, in words for the person running the test."""


class NoNetwork:
    """A stand-in for the internet that fails the test if anything tries to use it."""

    def __init__(self):
        self.calls = 0

    def __call__(self, *args):
        self.calls += 1
        raise ConnectionError("this should not have been reached")


def project_with(voice, script=SENTENCE):
    """A project folder with one narrated object, in a temporary place."""
    folder = pathlib.Path(tempfile.mkdtemp(prefix="openstage-live-test-"))
    (folder / "slides").mkdir()
    (folder / "project.json").write_text(json.dumps({"scenes": [{"slides": ["s1"]}]}), encoding="utf-8")
    narration = {"script": script, "voice": voice, "speed": 1.0, "lang": "en-US", "pronunciations": [], "audioCache": None}
    (folder / "slides" / "s1.json").write_text(json.dumps({"baseLayer": {"objects": [{"id": "t1", "narration": narration}]}, "layers": []}), encoding="utf-8")
    return folder


def make_audio(config, voice, label, keep_as):
    """Make one line of speech the way the Narration dialog does, and keep a copy. Returns a detail sentence."""
    folder = project_with(voice)
    try:
        failures = []
        result = narrate.run(folder, log=lambda *_: None, config=config, failures=failures)
        if failures:
            raise Failed(failures[0])
        info = result["t1"]
        if not info["audio"]:
            raise Failed("No audio was made, and nothing said why.")
        wav = (folder / info["audio"]).read_bytes()
        seconds, channels, rate = common.wav_info(wav)
        if not 0.5 <= seconds <= 30:
            raise Failed(f"The audio is {seconds:.1f} seconds long, which is not right for one short sentence.")
        if info["engine"] != voice.partition(":")[0]:
            raise Failed(f"The audio says it was made by {info['engineName']}, not {label}.")
        OUTPUT.mkdir(parents=True, exist_ok=True)
        (OUTPUT / keep_as).write_bytes(wav)
        timing = "captions timed from the words" if info["exactTimings"] else "captions timed by estimate"
        count = len(info["cues"])
        return f"{seconds:.1f} seconds, {count} {'caption' if count == 1 else 'captions'}, {timing}. Saved as {keep_as}."
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def read_masked(prompt, getch, write):
    """Read a line one character at a time, showing a * for each, so a paste can be seen to have worked without showing the key.
    `getch()` returns the next character typed and `write(text)` shows text."""
    write(prompt)
    chars = []
    while True:
        c = getch()
        if c in ("\r", "\n"):
            write("\n")
            return "".join(chars)
        if c == "\x03":
            raise KeyboardInterrupt
        if c in ("\x00", "\xe0"):  # an arrow key or the like: the next code is part of it
            getch()
            continue
        if c in ("\b", "\x7f"):
            if chars:
                chars.pop()
                write("\b \b")
            continue
        if c.isprintable():
            chars.append(c)
            write("*")


def masked_secret(prompt):
    """Ask for a key, showing a * for each character. Where the console cannot do that, nothing is shown."""
    try:
        import msvcrt
    except ImportError:
        return getpass.getpass(prompt)

    def write(text):
        sys.stdout.write(text)
        sys.stdout.flush()

    return read_masked(prompt, msvcrt.getwch, write)


# What a key looks like for each service, so a wrong thing pasted is noticed before it is sent.
KEY_STARTS = {
    "OpenAI": ("sk-", "OpenAI secret keys start with sk-"),
}


def key_problem(name, key):
    """Why what was pasted cannot be a key, or '' if it could be."""
    if key == "":
        return "Nothing was pasted."
    if any(c.isspace() for c in key):
        return "A key has no spaces in it. Paste only the key."
    if len(key) < 20:
        return f"That is only {len(key)} {'character' if len(key) == 1 else 'characters'}, much too short for a {name} key. A key is long."
    return ""


def run_live_test(ask, secret, say, transport=None, env=None):
    """Walk through the tests. `ask(question)` returns what the person typed, `secret(question)` the same with nothing shown, `say(text)` shows a line.
    `transport` and `env` are for the tests of this script. Returns the list of Results."""
    import os
    env = dict(os.environ if env is None else env)
    results = []
    secrets = []  # keys typed or found, so nothing that is shown or written can contain one

    def hide(text):
        for secret_value in secrets:
            if len(secret_value) >= 4:
                text = text.replace(secret_value, "(your key)")
        return text

    def step(name, work):
        say(f"  ... {name}")
        try:
            detail = work()
            results.append(Result(name, True, hide(detail)))
        except (Failed, EngineError) as err:
            results.append(Result(name, False, hide(str(err))))
        except Exception as err:  # a step that breaks in a way nobody expected is a failed step, not a crashed test
            results.append(Result(name, False, hide(f"{type(err).__name__}: {err}")))
        say("  " + results[-1].line())

    say("")
    say("OpenStage Author: try the AI services for real")
    say("=================================================")
    say("OpenAI is asked about first. What is sent: your key, a one-line test sentence, and a one-line description. Nothing from any project.")
    say("It costs a small amount on that service's account, the same as making that much in the editor. Your key is never shown, saved or put in the report.")
    say("")

    # ---- free, no key
    say("Free checks (no key, nothing sent)")
    blocker = NoNetwork()

    def publishing_sends_nothing():
        folder = project_with("openai:alloy")
        try:
            config = engines.Config(env={engines.key_variable("openai"): "sk-not-a-real-key"}, transport=blocker)
            result = narrate.run(folder, log=lambda *_: None, config=config)
            if blocker.calls:
                raise Failed("Something tried to reach the internet without permission. That should never happen.")
            if result["t1"]["audio"] is not None:
                raise Failed("Audio appeared for a service that was not allowed.")
            return "A key with no permission is not used: nothing was sent and no audio was made."
        finally:
            shutil.rmtree(folder, ignore_errors=True)

    step("Publishing sends nothing", publishing_sends_nothing)

    def example_plugin():
        plugins = REPO / "examples" / "plugins"
        config = engines.Config(plugins_dir=str(plugins), plugins_enabled={"tone-voice"})
        try:
            return make_audio(config, "tone-voice:low", "the example plugin", "example-plugin.wav")
        finally:
            engines.plugins.close_all()

    step("The example voice plugin works", example_plugin)
    say("")

    # ---- the services
    def get_key(name, variable):
        """The key from the environment, or pasted with a * shown for each character, and looked at before anything is sent. None if there is no usable key."""
        found = env.get(variable, "").strip()
        if found:
            secrets.append(found)
            say(f"  (using the key in {variable})")
            return found
        for _ in range(3):
            key = secret(f"  Paste your {name} SECRET key, then press Enter (a * shows for each character): ").strip()
            secrets.append(key)
            problem = key_problem(name, key)
            if problem:
                say(f"  {problem}")
                continue
            prefix, hint = KEY_STARTS[name]
            if not key.startswith(prefix):
                say(f"  {hint}, and this starts {key[:3]}.")
                if not ask("  Use it anyway? (y/n) ").strip().lower().startswith("y"):
                    continue
            say(f"  Got it: {len(key)} characters, starting {key[:3]}")
            return key
        return None

    def wants(name, what):
        answer = ask(f"Test {name}? It will {what}. (y/n) ").strip().lower()
        return answer.startswith("y")

    def models():
        return {k: v for k, v in env.items() if k.startswith("OPENSTAGE_MODEL_")}

    if wants("OpenAI", "check your key, make one short line of speech, and make one small low-quality picture"):
        key = get_key("OpenAI", engines.key_variable("openai"))
        if key:
            config = engines.Config(allow_network=["openai"], env={engines.key_variable("openai"): key, **models()}, transport=transport)
            step("OpenAI accepts your key", lambda: (openai_engine.check_key(key, transport), "The key was accepted.")[1])
            if results[-1].ok:
                step("OpenAI makes a voice", lambda: make_audio(config, "openai:alloy", "OpenAI", "openai-voice.wav"))

                def picture():
                    data, model = openai_engine.picture(PICTURE_WORDS, "square", "low", key, config.model("openai", "picture"), transport)
                    OUTPUT.mkdir(parents=True, exist_ok=True)
                    (OUTPUT / "openai-picture.png").write_bytes(data)
                    return f"A picture of {len(data) // 1024} KB was made with {model}. Saved as openai-picture.png (open it: it should be a red circle)."

                step("OpenAI makes a picture", picture)
            else:
                results.append(Result("OpenAI voice and picture", None, "Not tried, because the key was not accepted."))
        else:
            results.append(Result("OpenAI", False, "No usable key was given, so it was not tested."))
        say("")

    # ---- the report
    report = ["OpenStage Author: AI services test", ""] + [r.line() for r in results] + [""]
    failed = [r for r in results if r.ok is False]
    tested = any(r.name.startswith("OpenAI") and r.ok is not None for r in results)
    report.append(f"{len(failed)} of {len(results)} did not work. Send this file back and say what you saw." if failed
                  else "Everything that was tried worked." if tested
                  else "Only the free checks were run. Run it again and say y to test OpenAI with your key.")
    text = hide("\n".join(report) + "\n")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "live-test-results.txt").write_text(text, encoding="utf-8")
    say("Result")
    say("------")
    for line in report[2:]:
        say(line)
    say("")
    say(f"The files it made, and this result as live-test-results.txt, are in: {OUTPUT}")
    return results


def main():
    try:
        results = run_live_test(input, masked_secret, print)
    except (KeyboardInterrupt, EOFError):
        print("\nStopped. Nothing more was sent.")
        return 1
    return 0 if all(r.ok for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
