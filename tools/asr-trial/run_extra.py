"""Extra runs: whisper.cpp's precise word alignment (-dtw), and a harsher noise condition."""
import json
import os
import subprocess
import sys
import time
import wave

import numpy as np

ROOT = os.environ.get("WHISPER_TRIAL", "D:/Whisper-Trial")
CLI = f"{ROOT}/build/bin/whisper-cli.exe"
MODELS = {"base": f"{ROOT}/models/ggml-base.en.bin", "small": f"{ROOT}/models/ggml-small.en.bin"}
AUDIO = f"{ROOT}/audio"
OUT = f"{ROOT}/results/runs"

# a harsher laptop: louder room noise, a fan, loud keyboard clicks
rng = np.random.default_rng(7)
with wave.open(f"{AUDIO}/speech.wav") as w:
    x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
n = len(x)


def pink(n, db):
    f = np.fft.rfft(rng.standard_normal(n))
    f /= np.sqrt(np.maximum(np.arange(len(f)), 1))
    p = np.fft.irfft(f, n)
    return (p / np.sqrt(np.mean(p ** 2)) * 10 ** (db / 20)).astype(np.float32)


def clicks(n, per_second, db):
    out = np.zeros(n, dtype=np.float32)
    t = 0.0
    while True:
        t += rng.exponential(1 / per_second)
        i = int(t * 16000)
        if i >= n - 800:
            break
        ln = int(rng.uniform(0.006, 0.02) * 16000)
        b = np.diff(rng.standard_normal(ln + 1)) * np.exp(-np.linspace(0, 7, ln))
        b /= np.max(np.abs(b)) + 1e-9
        out[i:i + ln] += (b * 10 ** (db / 20) * rng.uniform(0.4, 1.0)).astype(np.float32)
    return out


speech_rms = np.sqrt(np.mean(x[np.abs(x) > 0.01] ** 2))
hard = np.convolve(x, np.ones(5) / 5, mode="same") * 0.8 + pink(n, -30) + clicks(n, 6.0, -18)
hard = np.clip(hard, -1, 1)
with wave.open(f"{AUDIO}/speech-hard.wav", "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(16000)
    w.writeframes((hard * 32767).astype(np.int16).tobytes())
print("speech level (RMS of voiced parts, dBFS):", round(20 * np.log10(speech_rms), 1), "| noise at -30 dBFS, clicks at -18 dBFS")

runs = []
for model in ("base", "small"):
    runs.append((model, "speech", ["-dtw", f"{model}.en", "-nfa"], "dtw"))
    runs.append((model, "narration", ["-dtw", f"{model}.en", "-nfa"], "dtw"))
    runs.append((model, "speech-hard", [], ""))
    runs.append((model, "speech-hard", ["--prompt", "Brightspace, SCORM, SUNY New Paltz, WCAG, accessible, alt text, screen reader, Wrench."], "prompt"))

results = json.load(open(f"{ROOT}/results/runs.json"))
for model, clip, extra, label in runs:
    if not os.path.exists(f"{AUDIO}/{clip}.wav"):
        print(f"skipped {model} {clip}: no {clip}.wav in {AUDIO}")
        continue
    name = f"{model}.{clip}.t4" + (f".{label}" if label else "")
    cmd = [CLI, "-m", MODELS[model], "-f", f"{AUDIO}/{clip}.wav", "-l", "en", "-t", "4", "-ojf", "-of", f"{OUT}/{name}", "-np", "-ng"] + extra
    t0 = time.perf_counter()
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    secs = time.perf_counter() - t0
    ok = p.returncode == 0 and os.path.exists(f"{OUT}/{name}.json")
    results = [r for r in results if r["name"] != name]
    results.append({"name": name, "model": model, "clip": clip, "threads": 4, "prompt": label == "prompt", "sns": False, "dtw": label == "dtw", "seconds": round(secs, 2), "ok": ok, "stderr_tail": p.stderr[-300:] if not ok else ""})
    print(f"{name:40s} {secs:7.1f}s  {'ok' if ok else 'FAILED ' + p.stderr[-200:]}", flush=True)
json.dump(results, open(f"{ROOT}/results/runs.json", "w"), indent=1)
print("done")
