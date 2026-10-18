"""Runs whisper-cli over the trial's audio, one run at a time, and keeps the output and the time each run took."""
import json
import os
import subprocess
import sys
import time

ROOT = os.environ.get("WHISPER_TRIAL", "D:/Whisper-Trial")
CLI = f"{ROOT}/build/bin/whisper-cli.exe"
MODELS = {"base": f"{ROOT}/models/ggml-base.en.bin", "small": f"{ROOT}/models/ggml-small.en.bin"}
AUDIO = f"{ROOT}/audio"
OUT = f"{ROOT}/results/runs"
PROMPT = "Brightspace, SCORM, SUNY New Paltz, WCAG, accessible, alt text, screen reader, Wrench."

os.makedirs(OUT, exist_ok=True)

runs = []
for model in ("base", "small"):
    for clip in ("narration", "speech", "speech-noisy"):
        runs.append((model, clip, 4, False, False))
    runs.append((model, "narration", 2, False, False))
    for clip in ("narration", "speech"):
        runs.append((model, clip, 4, True, False))
    for clip in ("silence", "roomtone", "keyboard", "tones"):
        runs.append((model, clip, 4, False, False))
        runs.append((model, clip, 4, False, True))


def tag(model, clip, threads, prompt, sns):
    return f"{model}.{clip}.t{threads}" + (".prompt" if prompt else "") + (".sns" if sns else "")


results = []
for model, clip, threads, prompt, sns in runs:
    if not os.path.exists(f"{AUDIO}/{clip}.wav"):
        print(f"skipped {model} {clip}: no {clip}.wav in {AUDIO}")
        continue
    name = tag(model, clip, threads, prompt, sns)
    cmd = [CLI, "-m", MODELS[model], "-f", f"{AUDIO}/{clip}.wav", "-l", "en", "-t", str(threads), "-ojf", "-of", f"{OUT}/{name}", "-np", "-ng"]
    if prompt:
        cmd += ["--prompt", PROMPT]
    if sns:
        cmd += ["-sns"]
    t0 = time.perf_counter()
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    secs = time.perf_counter() - t0
    ok = p.returncode == 0 and os.path.exists(f"{OUT}/{name}.json")
    results.append({"name": name, "model": model, "clip": clip, "threads": threads, "prompt": prompt, "sns": sns, "seconds": round(secs, 2), "ok": ok, "stderr_tail": p.stderr[-300:] if not ok else ""})
    print(f"{name:40s} {secs:7.1f}s  {'ok' if ok else 'FAILED'}", flush=True)

json.dump(results, open(f"{ROOT}/results/runs.json", "w"), indent=1)
print("done")
