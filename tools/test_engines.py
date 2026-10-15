"""Tests for the speech and picture engines and the plugin runner. Nothing here reaches the internet: the services are
played by stand-ins that record what they were asked and answer as the services' documentation says they do, and the plugin
tests run the example plugin in examples/plugins for real. Run with:  python tools/test_engines.py
"""
import base64
import http.server
import io
import json
import os
import pathlib
import shutil
import sys
import tempfile
import threading
import unittest
import wave

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import engines  # noqa: E402
import generate  # noqa: E402
import live_test  # noqa: E402
import narrate  # noqa: E402
from engines import common, openai_engine, plugins  # noqa: E402
from engines.common import EngineError  # noqa: E402

EXAMPLES = pathlib.Path(__file__).resolve().parent.parent / "examples" / "plugins"
WEBP = b"RIFF" + (36).to_bytes(4, "little") + b"WEBPVP8 " + b"\x00" * 28
KEY = "sk-test-0123456789abcdef"


def pcm(seconds, rate=24000):
    return b"\x01\x02" * int(seconds * rate)


class Fake:
    """A stand-in for the internet. Answers are queued; every request is kept."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.calls = []

    def __call__(self, method, url, headers, body, timeout):
        self.calls.append({"method": method, "url": url, "headers": headers, "body": json.loads(body) if body else None})
        status, answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, Exception):
            raise answer
        return status, answer if isinstance(answer, bytes) else json.dumps(answer).encode("utf-8")


def seconds_of(wav):
    return common.wav_info(wav)[0]


class WebRequests(unittest.TestCase):
    def fail(self, status, body, key=KEY):
        with self.assertRaises(EngineError) as ctx:
            common.call("Acme", key, Fake((status, body)), "GET", "https://x.test/", {})
        return str(ctx.exception)

    def test_what_a_service_says_is_found_wherever_it_keeps_it(self):
        self.assertEqual(common.detail_of(b'{"error": {"message": "Billing limit reached", "type": "x"}}'), "Billing limit reached")
        self.assertEqual(common.detail_of(b'{"detail": {"status": "quota_exceeded", "message": "Out of credits"}}'), "Out of credits")
        self.assertEqual(common.detail_of(b'{"detail": [{"loc": ["body"], "msg": "field required", "type": "x"}]}'), "field required")
        self.assertEqual(common.detail_of(b"plain words"), "plain words")
        self.assertEqual(common.detail_of(b"<html>Bad gateway</html>"), "", "a web page says nothing useful")
        self.assertEqual(common.detail_of(b'{"other": 1}'), "")

    def test_every_failure_is_put_in_words(self):
        self.assertIn("did not accept the key", self.fail(401, {"error": {"message": "bad"}}))
        self.assertIn("did not accept the key", self.fail(403, {}))
        self.assertIn("no credit left", self.fail(402, {}))
        self.assertIn("could not find", self.fail(404, {}))
        self.assertIn("too many requests", self.fail(429, {}))
        self.assertIn("problem on its side (503)", self.fail(503, {}))
        self.assertIn("It said: Content not allowed", self.fail(400, {"error": {"message": "Content not allowed"}}))

    def test_a_key_never_appears_in_an_error(self):
        said = self.fail(401, {"error": {"message": f"Incorrect API key provided: {KEY}."}})
        self.assertNotIn(KEY, said)
        self.assertIn("(your key)", said)
        with self.assertRaises(EngineError) as ctx:
            common.call("Acme", KEY, Fake((0, ConnectionError(f"refused for {KEY}"))), "GET", "https://x.test/", {})
        self.assertNotIn(KEY, str(ctx.exception))
        self.assertIn("Could not reach Acme", str(ctx.exception))

    def test_the_real_transport_against_a_local_server(self):
        seen = {}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                seen["auth"] = self.headers.get("Authorization")
                seen["body"] = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                code = 401 if self.path == "/denied" else 200
                self.send_response(code)
                self.end_headers()
                self.wfile.write(b'{"error": {"message": "nope"}}' if code == 401 else b"hello")

            def log_message(self, *args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            base = f"http://127.0.0.1:{server.server_port}"
            got = common.call("Acme", KEY, None, "POST", base + "/ok", {"Authorization": "Bearer abc"}, b"{}")
            self.assertEqual(got, b"hello")
            self.assertEqual(seen["auth"], "Bearer abc")
            with self.assertRaises(EngineError) as ctx:
                common.call("Acme", KEY, None, "POST", base + "/denied", {}, b"{}")
            self.assertIn("did not accept the key", str(ctx.exception))
        finally:
            server.shutdown()
            server.server_close()
        with self.assertRaises(EngineError) as ctx:
            common.call("Acme", KEY, None, "GET", f"http://127.0.0.1:{server.server_port}/", {}, timeout=2)
        self.assertIn("Could not reach Acme", str(ctx.exception))


class KeyProblems(unittest.TestCase):
    def test_a_400_that_is_about_the_key_is_said_to_be_about_the_key(self):
        # ElevenLabs answers a key ID pasted in place of the key with a 400, not a 401.
        with self.assertRaises(EngineError) as ctx:
            common.call("ElevenLabs", "abc", Fake((400, {"detail": {"message": "API key ID used as API key - only valid API keys can be used."}})), "GET", "https://x.test/", {})
        self.assertIn("did not accept the key", str(ctx.exception))
        self.assertIn("It said: API key ID used as API key", str(ctx.exception))


class Audio(unittest.TestCase):
    def test_raw_samples_become_a_wav_file(self):
        wav = common.wav_from_pcm(pcm(2.0))
        self.assertAlmostEqual(seconds_of(wav), 2.0, places=2)
        self.assertEqual(common.wav_info(wav)[1:], (1, 24000))

    def test_pieces_are_joined(self):
        joined = common.join_wavs([common.wav_from_pcm(pcm(1.0)), common.wav_from_pcm(pcm(0.5))])
        self.assertAlmostEqual(seconds_of(joined), 1.5, places=2)

    def test_pieces_in_different_formats_are_refused(self):
        with self.assertRaises(EngineError):
            common.join_wavs([common.wav_from_pcm(pcm(1.0)), common.wav_from_pcm(pcm(1.0, 16000), 16000)])

    def test_something_that_is_not_a_wav_file_is_refused(self):
        with self.assertRaises(EngineError):
            common.wav_info(b"not audio")
        with self.assertRaises(EngineError):
            common.wav_info(common.wav_from_pcm(b""))

    def test_text_is_cut_into_pieces_that_fit(self):
        text = "One sentence here. " * 40 + "Then a very long one " + "word " * 300 + "ends."
        pieces = common.split_text(text, 200)
        self.assertTrue(all(0 < len(p) <= 200 for p in pieces), [len(p) for p in pieces])
        self.assertEqual(" ".join(pieces).split(), text.split(), "nothing is lost or reordered")
        self.assertEqual(common.split_text("Short.", 200), ["Short."])
        self.assertEqual(common.split_text("   ", 200), [])


class OpenAI(unittest.TestCase):
    def test_speech_asks_for_raw_samples_in_the_chosen_voice(self):
        fake = Fake((200, pcm(1.0)))
        speech = openai_engine.speak("Hello there.", "coral", 1.25, KEY, "", fake)
        call = fake.calls[0]
        self.assertEqual(call["url"], "https://api.openai.com/v1/audio/speech")
        self.assertEqual(call["headers"]["Authorization"], f"Bearer {KEY}")
        self.assertEqual(call["body"], {"model": "gpt-4o-mini-tts", "input": "Hello there.", "voice": "coral", "response_format": "pcm", "speed": 1.25})
        self.assertAlmostEqual(seconds_of(speech.wav), 1.0, places=2)
        self.assertIsNone(speech.words, "OpenAI does not say when each word is spoken")

    def test_the_speed_is_held_to_what_the_service_takes(self):
        fake = Fake((200, pcm(0.5)))
        openai_engine.speak("Hi.", "alloy", 9, KEY, "", fake)
        self.assertEqual(fake.calls[0]["body"]["speed"], 4.0)

    def test_a_longer_script_goes_in_pieces_and_comes_back_whole(self):
        fake = Fake((200, pcm(1.0)))
        speech = openai_engine.speak("A sentence that fills a line. " * 400, "alloy", 1, KEY, "", fake)
        self.assertGreater(len(fake.calls), 1)
        self.assertTrue(all(len(c["body"]["input"]) <= 4096 for c in fake.calls))
        self.assertAlmostEqual(seconds_of(speech.wav), len(fake.calls), places=1)

    def test_only_the_ready_made_voices_are_used(self):
        fake = Fake((200, pcm(1.0)))
        for bad in ("not-a-voice", "voice_1234", "../x", ""):
            with self.assertRaises(EngineError):
                openai_engine.speak("Hi.", bad, 1, KEY, "", fake)
        self.assertEqual(fake.calls, [], "nothing was sent")

    def test_the_model_can_be_changed_but_not_into_nonsense(self):
        fake = Fake((200, pcm(0.5)))
        openai_engine.speak("Hi.", "alloy", 1, KEY, "tts-1-hd", fake)
        self.assertEqual(fake.calls[0]["body"]["model"], "tts-1-hd")
        with self.assertRaises(EngineError):
            openai_engine.speak("Hi.", "alloy", 1, KEY, "bad name!", fake)

    def test_a_picture(self):
        fake = Fake((200, {"data": [{"b64_json": base64.b64encode(WEBP).decode()}]}))
        data, model = openai_engine.picture("A red barn", "wide", "low", KEY, "", fake)
        self.assertEqual(data, WEBP)
        self.assertEqual(model, "gpt-image-1")
        call = fake.calls[0]
        self.assertEqual(call["url"], "https://api.openai.com/v1/images/generations")
        self.assertEqual(call["body"], {"model": "gpt-image-1", "prompt": "A red barn", "n": 1, "size": "1536x1024", "quality": "low", "output_format": "webp", "output_compression": 85})

    def test_a_png_is_not_what_was_asked_for(self):
        png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
        with self.assertRaises(EngineError):
            openai_engine.picture("A barn", "square", "low", KEY, "", Fake((200, {"data": [{"b64_json": base64.b64encode(png).decode()}]})))

    def test_a_picture_that_is_not_one(self):
        for answer in ({"data": []}, {"data": [{"b64_json": base64.b64encode(b"junk").decode()}]}, {"nope": 1}):
            with self.assertRaises(EngineError):
                openai_engine.picture("A barn", "square", "low", KEY, "", Fake((200, answer)))

    def test_picture_choices_are_checked_before_anything_is_sent(self):
        fake = Fake((200, {}))
        for args in (("", "square", "low"), ("a", "huge", "low"), ("a", "square", "ultra")):
            with self.assertRaises(EngineError):
                openai_engine.picture(*args, KEY, "", fake)
        self.assertEqual(fake.calls, [])

    def test_the_key_check_costs_nothing(self):
        fake = Fake((200, {"data": []}))
        openai_engine.check_key(KEY, fake)
        self.assertEqual((fake.calls[0]["method"], fake.calls[0]["url"]), ("GET", "https://api.openai.com/v1/models"))


class Choosing(unittest.TestCase):
    def test_a_voice_names_its_engine(self):
        self.assertEqual(engines.split_voice("af_heart"), ("kokoro", "af_heart"))
        self.assertEqual(engines.split_voice("openai:alloy"), ("openai", "alloy"))
        self.assertEqual(engines.split_voice("my-plugin:a:b"), ("my-plugin", "a:b"))

    def test_openais_voices_come_from_the_one_shared_list(self):
        shared = json.loads((pathlib.Path(__file__).resolve().parent / "openai-voices.json").read_text(encoding="utf-8"))["voices"]
        self.assertEqual(openai_engine.VOICES, shared)
        self.assertTrue(all(v.isalpha() and v.islower() for v in shared))

    def test_nothing_is_sent_unless_it_is_allowed_and_has_a_key(self):
        env = {engines.key_variable("openai"): KEY}
        self.assertEqual(engines.status(engines.Config(env=env), "openai:alloy")[0], False)
        self.assertEqual(engines.status(engines.Config(allow_network=["openai"], env={}), "openai:alloy")[0], False)
        self.assertIn("key", engines.status(engines.Config(allow_network=["openai"], env={}), "openai:alloy")[1])
        self.assertEqual(engines.status(engines.Config(allow_network=["openai"], env=env), "openai:alloy"), (True, ""))
        self.assertEqual(engines.status(engines.Config(allow_network=["somewhere-else"], env=env), "openai:alloy")[0], False, "permission is for one service by name")
        gone = engines.status(engines.Config(allow_network=["elevenlabs"], env={engines.key_variable("elevenlabs"): KEY}), "elevenlabs:21m00Tcm4TlvDq8ikWAM")
        self.assertEqual(gone[0], False, "a service that is no longer here is not reached, whatever the settings say")

    def test_kokoro_is_always_allowed_here(self):
        self.assertEqual(engines.status(engines.Config(), "af_heart"), (True, ""))

    def test_an_unknown_engine_is_not_guessed_at(self):
        ok, why = engines.status(engines.Config(), "mystery:voice")
        self.assertFalse(ok)
        self.assertIn("mystery:voice", why)

    def test_who_makes_a_voice(self):
        config = engines.Config()
        self.assertEqual(engines.describe(config, "af_heart")["where"], "computer")
        self.assertEqual(engines.describe(config, "openai:alloy"), {"engine": "openai", "name": "OpenAI", "where": "internet", "home": "https://openai.com/"})
        self.assertEqual(engines.describe(config, "mystery:v")["where"], "unknown")

    def test_the_model_a_author_chose_reaches_the_engine(self):
        config = engines.Config(env={"OPENSTAGE_MODEL_OPENAI_SPEECH": " tts-1 "})
        self.assertEqual(config.model("openai", "speech"), "tts-1")
        self.assertEqual(config.model("openai", "picture"), "")


class Plugins(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="openstage-plugins-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.addCleanup(plugins.close_all)

    def manifest(self, **changes):
        base = json.loads((EXAMPLES / "tone-voice" / "plugin.json").read_text(encoding="utf-8"))
        base.update(changes)
        return base

    def install(self, folder, manifest):
        (self.tmp / folder).mkdir(parents=True, exist_ok=True)
        (self.tmp / folder / "plugin.json").write_text(json.dumps(manifest), encoding="utf-8")
        return self.tmp / folder

    def problem(self, **changes):
        with self.assertRaises(plugins.PluginProblem) as ctx:
            plugins.load_manifest(self.install("p", self.manifest(**changes)))
        return str(ctx.exception)

    def test_the_example_is_a_valid_plugin(self):
        plugin = plugins.load_manifest(EXAMPLES / "tone-voice")
        self.assertEqual((plugin.id, plugin.network, plugin.word_timings), ("tone-voice", False, True))
        self.assertEqual([v["id"] for v in plugin.summary()["voices"]], ["tone-voice:low", "tone-voice:high"])

    def test_manifests_are_checked(self):
        self.assertIn("contract", self.problem(contract=2))
        self.assertIn("kokoro", self.problem(id="kokoro"))
        self.assertIn("id", self.problem(id="Not Ok"))
        self.assertIn("network", self.problem(network="no"))
        self.assertIn("voice plugin", self.problem(kinds=["picture"]))
        self.assertIn("command", self.problem(command=[]))
        self.assertIn("inside the plugin", self.problem(command=["..\\evil.exe"]))
        self.assertIn("inside the plugin", self.problem(command=["C:\\evil.exe"]))
        self.assertIn("voices", self.problem(voices=[]))
        self.assertIn("twice", self.problem(voices=[{"id": "a", "name": "A"}, {"id": "a", "name": "B"}]))
        self.assertIn("language", self.problem(voices=[{"id": "a", "name": "A", "lang": "English please"}]))
        self.assertIn("licence", self.problem(licence=""))

    def test_a_folder_that_will_not_do_is_reported_not_hidden(self):
        self.install("good", self.manifest())
        self.install("bad", self.manifest(id="kokoro"))
        (self.tmp / "empty").mkdir()
        found, problems = plugins.discover(self.tmp)
        self.assertEqual([p.id for p in found], ["tone-voice"])
        self.assertEqual(sorted(p["folder"] for p in problems), ["bad", "empty"])

    def test_two_plugins_cannot_share_an_id(self):
        self.install("one", self.manifest())
        self.install("two", self.manifest())
        found, problems = plugins.discover(self.tmp)
        self.assertEqual(len(found), 1)
        self.assertIn("already uses", problems[0]["problem"])

    def test_a_missing_folder_is_no_plugins(self):
        self.assertEqual(plugins.discover(self.tmp / "nowhere"), ([], []))
        self.assertEqual(plugins.discover(None), ([], []))

    def test_the_command_is_filled_in(self):
        plugin = plugins.load_manifest(self.install("p", self.manifest(command=["{python}", "-u", "voice.py"])))
        self.assertEqual(plugins.resolve_command(plugin)[1:], ["-u", "voice.py"])
        inside = plugins.load_manifest(self.install("q", self.manifest(id="other", command=[".venv\\Scripts\\python.exe", "x.py"])))
        self.assertTrue(plugins.resolve_command(inside)[0].startswith(str((self.tmp / "q").resolve())))
        named = plugins.load_manifest(self.install("r", self.manifest(id="third", command=["{env:TONE_PYTHON}", "x.py"])))
        with self.assertRaises(EngineError) as ctx:
            plugins.resolve_command(named, {})
        self.assertIn("TONE_PYTHON", str(ctx.exception))
        self.assertEqual(plugins.resolve_command(named, {"TONE_PYTHON": "C:\\py\\python.exe"})[0], "C:\\py\\python.exe")

    def speak(self, text="Hello there world.", voice="low", speed=1.0, folder=None):
        plugin = plugins.load_manifest(folder or EXAMPLES / "tone-voice")
        return plugins.speak(plugin, voice, text, speed, "en-US")

    def test_the_example_plugin_speaks_for_real(self):
        speech = self.speak()
        self.assertGreater(seconds_of(speech.wav), 0.5)
        self.assertEqual([w[0] for w in speech.words], ["Hello", "there", "world"])
        self.assertLess(speech.words[0][2], speech.words[1][1] + 0.001)

    def test_one_run_uses_one_process(self):
        self.speak("One.")
        first = plugins._sessions["tone-voice"].process.pid
        self.speak("Two.")
        self.assertEqual(plugins._sessions["tone-voice"].process.pid, first)

    def test_a_plugin_that_says_it_cannot_is_believed(self):
        with self.assertRaises(EngineError) as ctx:
            self.speak("Please FAIL now.")
        self.assertIn("asked to fail", str(ctx.exception))
        self.speak("It still works afterwards.")

    def test_only_the_voices_in_the_list_can_be_asked_for(self):
        with self.assertRaises(EngineError):
            self.speak(voice="clone-of-my-boss")

    def test_a_plugin_that_stops_is_reported(self):
        folder = self.install("crash", self.manifest(id="crashy", command=["{python}", "crash.py"]))
        (folder / "crash.py").write_text("import sys\nsys.stderr.write('model file missing\\n')\nsys.exit(3)\n", encoding="utf-8")
        with self.assertRaises(EngineError) as ctx:
            self.speak(folder=folder)
        self.assertIn("stopped before it answered", str(ctx.exception))
        self.assertIn("model file missing", str(ctx.exception))

    def test_a_plugin_that_writes_nothing_is_reported(self):
        folder = self.install("quiet", self.manifest(id="quiet-one", command=["{python}", "q.py"]))
        (folder / "q.py").write_text("import sys, json\nfor line in sys.stdin:\n    print(json.dumps({'ok': True}), flush=True)\n", encoding="utf-8")
        with self.assertRaises(EngineError) as ctx:
            self.speak(folder=folder)
        self.assertIn("wrote no audio file", str(ctx.exception))

    def test_a_plugin_that_returns_something_that_is_not_audio_is_refused(self):
        folder = self.install("junk", self.manifest(id="junk-one", command=["{python}", "j.py"]))
        (folder / "j.py").write_text(
            "import sys, json\nfor line in sys.stdin:\n    r = json.loads(line)\n    open(r['out'], 'wb').write(b'not a wav')\n    print(json.dumps({'ok': True}), flush=True)\n",
            encoding="utf-8")
        with self.assertRaises(EngineError):
            self.speak(folder=folder)

    def test_times_are_used_only_if_the_plugin_promised_them(self):
        folder = self.install("nowords", self.manifest(id="no-words", wordTimings=False, command=["{python}", str(EXAMPLES / "tone-voice" / "voice.py")]))
        self.assertIsNone(self.speak(folder=folder).words)


class Narrating(unittest.TestCase):
    """The narration run, with the services and the plugin standing by."""

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="openstage-narrate-engines-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.addCleanup(plugins.close_all)
        self.project = self.tmp / "project"
        (self.project / "slides").mkdir(parents=True)
        (self.project / "project.json").write_text(json.dumps({"scenes": [{"slides": ["s1"]}]}), encoding="utf-8")
        self.write_slide([("a", "openai:alloy", "First one. It has two sentences."), ("b", "tone-voice:low", "Second one here.")])
        self.plugin_dir = self.tmp / "plugins"
        shutil.copytree(EXAMPLES / "tone-voice", self.plugin_dir / "tone-voice")

    def write_slide(self, items):
        objects = [{"id": oid, "narration": {"script": script, "voice": voice, "speed": 1.0, "lang": "en-US", "pronunciations": [], "audioCache": None}}
                   for oid, voice, script in items]
        (self.project / "slides" / "s1.json").write_text(json.dumps({"baseLayer": {"objects": objects}, "layers": []}), encoding="utf-8")

    def config(self, fake=None, allow=("openai",), enabled=("tone-voice",), key=KEY):
        env = {engines.key_variable("openai"): key} if key else {}
        return engines.Config(allow_network=allow, plugins_dir=str(self.plugin_dir), plugins_enabled=enabled, env=env, transport=fake)

    def run_it(self, config, **kw):
        failures = []
        result = narrate.run(self.project, log=lambda *_: None, config=config, failures=failures, **kw)
        return result, failures

    def test_nothing_is_sent_and_no_plugin_runs_unless_allowed(self):
        fake = Fake((200, pcm(1.0)))
        result, failures = self.run_it(self.config(fake, allow=(), enabled=()))
        self.assertEqual(fake.calls, [])
        self.assertEqual(failures, [])
        self.assertIsNone(result["a"]["audio"])
        self.assertIsNone(result["b"]["audio"])

    def test_the_default_run_is_kokoro_only(self):
        result = narrate.run(self.project, log=lambda *_: None)
        self.assertIsNone(result["a"]["audio"])
        self.assertIsNone(result["b"]["audio"])

    def test_an_allowed_service_makes_audio_with_estimated_caption_times(self):
        fake = Fake((200, pcm(2.0)))
        result, failures = self.run_it(self.config(fake), only={"a"})
        self.assertEqual(failures, [])
        self.assertEqual(len(fake.calls), 1)
        info = result["a"]
        self.assertTrue(info["audio"])
        self.assertAlmostEqual(info["duration"], 2.0, places=2)
        self.assertEqual((info["engine"], info["engineName"], info["where"]), ("openai", "OpenAI", "internet"))
        self.assertFalse(info["exactTimings"], "OpenAI gives no word times, so the times are estimates")
        self.assertEqual([c["text"] for c in info["cues"]], ["First one.", "It has two sentences."])
        self.assertTrue((self.project / info["audio"]).is_file())
        self.assertIsNone(result["b"]["audio"], "only was respected")

    def test_who_made_the_audio_is_kept_with_it(self):
        self.run_it(self.config(Fake((200, b""))), only={"b"})
        # Later, on a computer that does not have the plugin, the audio still names its maker.
        result, _ = self.run_it(engines.Config(plugins_dir=None, plugins_enabled=()), only=set())
        info = result["b"]
        self.assertTrue(info["audio"])
        self.assertEqual((info["engine"], info["engineName"], info["where"]), ("tone-voice", "Tone voice (example plugin)", "computer"))

    def test_a_plugin_with_word_times_gives_exact_captions(self):
        result, failures = self.run_it(self.config(Fake((200, b""))), only={"b"})
        self.assertEqual(failures, [])
        info = result["b"]
        self.assertTrue(info["exactTimings"])
        self.assertEqual((info["engine"], info["engineName"], info["where"]), ("tone-voice", "Tone voice (example plugin)", "computer"))
        self.assertEqual([c["text"] for c in info["cues"]], ["Second one here."])

    def test_audio_already_made_is_not_made_again_or_paid_for_again(self):
        fake = Fake((200, pcm(1.0)))
        self.run_it(self.config(fake))
        calls = len(fake.calls)
        self.run_it(self.config(fake))
        self.assertEqual(len(fake.calls), calls)

    def test_a_cached_voice_is_still_used_when_the_service_is_no_longer_allowed(self):
        self.run_it(self.config(Fake((200, pcm(1.0)))))
        result, _ = self.run_it(self.config(Fake((500, {})), allow=(), enabled=(), key=""))
        self.assertTrue(result["a"]["audio"] and result["b"]["audio"], "publishing a course made earlier needs no key and no permission")

    def test_a_failure_is_reported_and_the_rest_of_that_engine_is_not_tried(self):
        self.write_slide([("a", "openai:alloy", "One."), ("b", "openai:echo", "Two."), ("c", "tone-voice:high", "Three.")])
        fake = Fake((401, {"error": {"message": "Incorrect API key provided"}}))
        result, failures = self.run_it(self.config(fake))
        self.assertEqual(len(fake.calls), 1, "a wrong key is not tried again and again")
        self.assertEqual(len(failures), 1)
        self.assertIn("did not accept the key", failures[0])
        self.assertIsNone(result["a"]["audio"])
        self.assertIsNone(result["b"]["audio"])
        self.assertTrue(result["c"]["audio"], "another engine is not held up by it")

    def test_the_command_line_is_read(self):
        self.assertEqual(narrate.parse_args(["P", "--allow-network", "openai", "--plugins-dir", "D", "--plugins-enabled", "a,b"]),
                         ("P", {"only": None, "cache_root": None, "allow_network": {"openai"}, "plugins_dir": "D", "plugins_enabled": {"a", "b"}}))
        self.assertIsNone(narrate.parse_args(["P", "--allow-network"]))
        self.assertIsNone(narrate.parse_args(["P", "--plugins-dir"]))

    def test_words_are_laid_on_the_script(self):
        spans = narrate.spans_from_words("Hello there, world.", [("Hello", 0.0, 0.4), ("there", 0.5, 0.9), ("world", 1.0, 1.4)])
        self.assertEqual(spans, [(0, 5, 0.0, 0.4), (6, 11, 0.5, 0.9), (13, 18, 1.0, 1.4)])
        self.assertEqual(narrate.spans_from_words("Hello there.", [("Goodbye", 0, 1)]), [], "words that are not in the script are not trusted")


class Generating(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="openstage-generate-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def config(self, fake, allow=("openai",), openai=KEY, plugins_dir=None, enabled=()):
        env = {}
        if openai:
            env[engines.key_variable("openai")] = openai
        return engines.Config(allow_network=allow, env=env, transport=fake, plugins_dir=plugins_dir, plugins_enabled=enabled)

    def test_a_picture_is_written_where_asked(self):
        out = self.tmp / "made.webp"
        fake = Fake((200, {"data": [{"b64_json": base64.b64encode(WEBP).decode()}]}))
        answer = generate.run("picture", {"service": "openai", "prompt": "A barn", "size": "square", "quality": "low", "out": str(out)}, self.config(fake))
        self.assertEqual(answer, {"ok": True, "bytes": len(WEBP), "format": "webp", "service": "openai", "model": "gpt-image-1"})
        self.assertEqual(out.read_bytes(), WEBP)

    def test_nothing_happens_for_a_service_that_was_not_allowed(self):
        fake = Fake((200, {}))
        for op, request in (("check", {"service": "openai"}),
                            ("picture", {"service": "openai", "prompt": "x", "size": "square", "quality": "low", "out": str(self.tmp / "x.webp")})):
            answer = generate.run(op, request, self.config(fake, allow=()))
            self.assertFalse(answer["ok"], op)
            self.assertIn("has not been allowed", answer["message"])
        self.assertEqual(fake.calls, [])

    def test_a_missing_key_is_said_plainly(self):
        answer = generate.run("check", {"service": "openai"}, self.config(Fake((200, {})), openai=""))
        self.assertEqual(answer, {"ok": False, "message": "There is no OpenAI key. Add it in Settings."})

    def test_a_service_openstage_does_not_have_is_said_so(self):
        out = str(self.tmp / "x.webp")
        for name in ("midjourney", "elevenlabs"):
            self.assertIn("not a service OpenStage knows", generate.run("check", {"service": name}, self.config(Fake((200, {}))))["message"], name)
            self.assertIn("not a service OpenStage knows", generate.run("picture", {"service": name, "prompt": "x", "size": "square", "quality": "low", "out": out}, self.config(Fake((200, {}))))["message"], name)

    def test_the_result_goes_only_where_it_makes_sense(self):
        fake = Fake((200, {"data": [{"b64_json": base64.b64encode(WEBP).decode()}]}))
        answer = generate.run("picture", {"service": "openai", "prompt": "x", "size": "square", "quality": "low", "out": str(self.tmp / "x.exe")}, self.config(fake))
        self.assertFalse(answer["ok"])
        self.assertEqual(fake.calls, [], "the place is checked before anything is paid for")

    def test_a_failure_from_the_service_is_the_answer(self):
        answer = generate.run("picture", {"service": "openai", "prompt": "x", "size": "square", "quality": "low", "out": str(self.tmp / "x.webp")},
                              self.config(Fake((400, {"error": {"message": "Your request was rejected by the safety system."}}))))
        self.assertFalse(answer["ok"])
        self.assertIn("rejected by the safety system", answer["message"])

    def test_plugins_are_listed_without_running_anything(self):
        answer = generate.run("plugins", {}, self.config(Fake((200, {})), plugins_dir=str(EXAMPLES), enabled=("tone-voice",)))
        self.assertTrue(answer["ok"])
        self.assertEqual([(p["id"], p["enabled"]) for p in answer["plugins"]], [("tone-voice", True)])
        off = generate.run("plugins", {}, self.config(Fake((200, {})), plugins_dir=str(EXAMPLES)))
        self.assertEqual([(p["id"], p["enabled"]) for p in off["plugins"]], [("tone-voice", False)])

    def test_the_command_line_is_read(self):
        self.assertEqual(generate.parse_args(["picture", "--allow-network", "openai"]), ("picture", {"allow_network": {"openai"}, "plugins_dir": None, "plugins_enabled": set()}))
        self.assertIsNone(generate.parse_args([]))
        self.assertIsNone(generate.parse_args(["nonsense"]))
        self.assertIsNone(generate.parse_args(["picture", "check"]))
        for gone in ("voices", "sound"):
            self.assertIsNone(generate.parse_args([gone]), f"{gone} went with the service that did it")
        self.assertIsNone(generate.parse_args(["picture", "--allow-network"]))



class LiveTestScript(unittest.TestCase):
    """tools/live_test.py is what Jason runs with a real key. It is tried here against stand-in services, so it is known to work before it spends anything."""

    OPENAI_KEY = "sk-live-secret-key-123456"

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="openstage-live-script-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.addCleanup(plugins.close_all)
        self.saved_output = live_test.OUTPUT
        live_test.OUTPUT = self.tmp / "out"
        self.addCleanup(setattr, live_test, "OUTPUT", self.saved_output)
        self.calls = []

    def internet(self, status=200):
        """Stand-in services that answer as their documentation says."""
        def transport(method, url, headers, body, timeout):
            self.calls.append((method, url))
            if status != 200:
                return status, json.dumps({"error": {"message": "Incorrect API key provided"}}).encode("utf-8")
            if url.startswith("https://api.openai.com/v1/models"):
                return 200, b'{"data": []}'
            if url.endswith("/v1/audio/speech"):
                return 200, pcm(2.0)
            if url.endswith("/v1/images/generations"):
                return 200, json.dumps({"data": [{"b64_json": base64.b64encode(WEBP).decode()}]}).encode("utf-8")
            raise AssertionError(f"unexpected request: {method} {url}")
        return transport

    def run_it(self, answers, transport=None, env=None):
        said, asked, secrets_asked = [], [], []
        replies = iter(answers)

        def ask(question):
            asked.append(question)
            return next(replies)

        def secret(question):
            secrets_asked.append(question)
            return next(replies)

        results = live_test.run_live_test(ask, secret, said.append, transport=transport, env=env if env is not None else {})
        return results, said, asked, secrets_asked

    def test_nothing_is_asked_of_a_service_that_is_declined_and_the_free_checks_still_run(self):
        results, said, asked, secrets_asked = self.run_it(["n"])
        self.assertEqual([r.name for r in results], ["Publishing sends nothing", "The example voice plugin works"])
        self.assertTrue(all(r.ok for r in results), [r.line() for r in results])
        self.assertEqual(secrets_asked, [], "no key is asked for a service that is not tested")
        self.assertEqual(self.calls, [])
        self.assertTrue((live_test.OUTPUT / "live-test-results.txt").is_file())
        self.assertTrue((live_test.OUTPUT / "example-plugin.wav").is_file())

    def test_a_working_service_passes_every_step_and_keeps_what_it_made(self):
        results, said, asked, secrets_asked = self.run_it(["y", self.OPENAI_KEY], transport=self.internet())
        self.assertEqual(len(results), 5)
        self.assertTrue(all(r.ok for r in results), [r.line() for r in results])
        for name in ("openai-voice.wav", "openai-picture.webp", "example-plugin.wav"):
            self.assertTrue((live_test.OUTPUT / name).is_file(), name)
        self.assertEqual((live_test.OUTPUT / "openai-picture.webp").read_bytes(), WEBP)
        self.assertEqual(len(secrets_asked), 1)
        self.assertIn(("POST", "https://api.openai.com/v1/audio/speech"), self.calls)
        self.assertIn(("POST", "https://api.openai.com/v1/images/generations"), self.calls)
        self.assertIn("Everything that was tried worked.", (live_test.OUTPUT / "live-test-results.txt").read_text(encoding="utf-8"))

    def test_a_key_is_never_shown_or_written(self):
        _, said, _, _ = self.run_it(["y", self.OPENAI_KEY], transport=self.internet())
        shown = " ".join(said)
        self.assertNotIn(self.OPENAI_KEY, shown)
        for path in live_test.OUTPUT.glob("*.txt"):
            self.assertNotIn(self.OPENAI_KEY, path.read_text(encoding="utf-8"))

    def test_a_wrong_key_fails_plainly_and_does_not_leak(self):
        results, said, _, _ = self.run_it(["y", self.OPENAI_KEY], transport=self.internet(status=401))
        failed = [r for r in results if r.ok is False]
        self.assertEqual(len(failed), 1, [r.line() for r in results])
        self.assertIn("did not accept the key", failed[0].detail)
        self.assertEqual([r.ok for r in results][-2:], [False, None], "the rest of that service is not tried, and the report says so")
        self.assertEqual(len([c for c in self.calls if "api.openai.com" in c[1]]), 1, "only the key check reached the service")
        everything = "\n".join(said) + (live_test.OUTPUT / "live-test-results.txt").read_text(encoding="utf-8")
        self.assertNotIn(self.OPENAI_KEY, everything)
        self.assertIn("did not work. Send this file back", everything)

    def test_a_key_in_the_environment_is_used_without_asking_for_it(self):
        env = {engines.key_variable("openai"): self.OPENAI_KEY}
        results, said, _, secrets_asked = self.run_it(["y"], transport=self.internet(), env=env)
        self.assertEqual(secrets_asked, [])
        self.assertTrue(any("using the key in OPENSTAGE_KEY_OPENAI" in line for line in said))
        self.assertTrue(all(r.ok for r in results), [r.line() for r in results])

    def test_no_key_typed_means_not_tested_rather_than_a_crash(self):
        results, _, _, secrets_asked = self.run_it(["y", "", "", ""], transport=self.internet())
        self.assertFalse(results[-1].ok)
        self.assertIn("not tested", results[-1].detail)
        self.assertEqual(len(secrets_asked), 3, "asked three times, then given up on")
        self.assertEqual(self.calls, [])

    def test_something_that_cannot_be_a_key_is_asked_for_again_before_anything_is_sent(self):
        # A single "y" typed at the key prompt is what a real run sent to OpenAI the first time.
        results, said, _, secrets_asked = self.run_it(["y", "y", "has a space in it and is long enough", self.OPENAI_KEY], transport=self.internet())
        self.assertEqual(len(secrets_asked), 3)
        self.assertTrue(any("only 1 character," in line for line in said), said)
        self.assertTrue(any("no spaces" in line for line in said), said)
        self.assertTrue(any("Got it: 25 characters, starting sk-" in line for line in said), said)
        self.assertTrue(all(r.ok for r in results), [r.line() for r in results])

    def test_a_key_that_starts_wrongly_is_questioned_and_can_be_used_anyway(self):
        odd = "abcdefghijklmnopqrstuvwxyz0123"
        results, said, asked, _ = self.run_it(["y", odd, "n", self.OPENAI_KEY], transport=self.internet())
        self.assertTrue(any("start with sk-" in line for line in said), said)
        self.assertIn("  Use it anyway? (y/n) ", asked)
        self.assertTrue(all(r.ok for r in results), [r.line() for r in results])
        sent = []
        inner = self.internet()

        def watching(method, url, headers, body, timeout):
            sent.append(headers.get("Authorization"))
            return inner(method, url, headers, body, timeout)

        self.run_it(["y", odd, "y"], transport=watching)
        self.assertEqual(sent[0], f"Bearer {odd}", "used anyway when the author says so")

    def test_a_pasted_key_shows_a_star_for_each_character_and_nothing_more(self):
        typed = iter(list("sk-abc") + ["\x08", "d", "\x00", "H", "\r"])  # the backspace removes c; the special key and its code are ignored
        out = []
        got = live_test.read_masked("Key: ", lambda: next(typed), out.append)
        self.assertEqual(got, "sk-abd")
        self.assertEqual("".join(out), "Key: ******\b \b*\n")
        keys = iter(["a", "\x03"])
        with self.assertRaises(KeyboardInterrupt):
            live_test.read_masked("", lambda: next(keys), lambda text: None)

    def test_a_step_that_breaks_unexpectedly_is_a_failed_step_and_the_rest_go_on(self):
        def odd(method, url, headers, body, timeout):
            if url.endswith("/v1/images/generations"):
                raise RuntimeError(f"surprise containing {self.OPENAI_KEY}")
            return self.internet()(method, url, headers, body, timeout)
        results, said, _, _ = self.run_it(["y", self.OPENAI_KEY], transport=odd)
        picture = next(r for r in results if r.name == "OpenAI makes a picture")
        self.assertFalse(picture.ok)
        self.assertNotIn(self.OPENAI_KEY, picture.detail)
        self.assertTrue(next(r for r in results if r.name == "OpenAI makes a voice").ok)

    def test_the_batch_file_runs_the_script(self):
        bat = (pathlib.Path(__file__).resolve().parent.parent / "TEST AI SERVICES.bat").read_bytes()
        self.assertIn(b"tools\\live_test.py", bat)
        self.assertIn(b"\r\n", bat, "a batch file needs Windows line endings for labels and blocks to work")

if __name__ == "__main__":
    unittest.main(verbosity=1)
