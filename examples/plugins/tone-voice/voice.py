"""An example voice plugin for OpenStage Author. It is not a real voice: for every word it plays a short beep.

It shows the whole contract (docs/plugins.md) in about forty lines:
  - OpenStage starts this program once and writes one line of JSON per job to its standard input;
  - the program answers each with one line of JSON on its standard output, and exits when its input closes;
  - for {"op": "speak"} the program writes a WAV file to the path in "out" and says how long each word took.
Anything else it prints (progress, logs) is ignored, as long as it does not start with a curly bracket.
Standard library only, so it runs in any Python.
"""
import json
import math
import re
import struct
import sys
import wave

RATE = 24000
PITCH = {"low": 220.0, "high": 660.0}


def beep(seconds, pitch):
    frames = int(seconds * RATE)
    return b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * pitch * i / RATE))) for i in range(frames))


def speak(request):
    if "FAIL" in request["text"]:
        return {"ok": False, "message": "The example voice was asked to fail."}
    pitch = PITCH.get(request["voice"], 440.0)
    each = 0.18 / max(float(request["speed"]), 0.1)
    gap = each / 3
    words, t, audio = [], 0.0, b""
    for match in re.finditer(r"[^\W_]+(?:['-][^\W_]+)*", request["text"]):
        words.append({"text": match.group(0), "start": round(t, 3), "end": round(t + each, 3)})
        audio += beep(each, pitch) + b"\x00\x00" * int(gap * RATE)
        t += each + gap
    with wave.open(request["out"], "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(audio)
    return {"ok": True, "duration": round(t, 3), "words": words}


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    request = json.loads(line)
    print("working on it", flush=True)  # not JSON, so OpenStage ignores it
    answer = speak(request) if request.get("op") == "speak" else {"ok": False, "message": "Unknown job."}
    print(json.dumps(answer), flush=True)
