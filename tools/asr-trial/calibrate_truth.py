"""Fixes the true word times. Kokoro's word times are relative to its own start, which has a little silence before the voice.

The real start and end of the voice in every sentence is read from the sound itself (speech.wav has digital silence between sentences, with no noise on it),
and the word times of each sentence are stretched to fit between them. Keeps the uncorrected times in speech.words.raw.json.
"""
import json
import os
import shutil
import statistics
import wave

import numpy as np

A = os.environ.get("WHISPER_TRIAL", "D:/Whisper-Trial") + "/audio"
with wave.open(f"{A}/speech.wav") as w:
    x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
RATE = 16000
voiced = np.abs(x) > 0.001
raw = json.load(open(f"{A}/speech.words.json"))
shutil.copy(f"{A}/speech.words.json", f"{A}/speech.words.raw.json")

edges, cal = [], []
lead, tail = [], []
for s in raw:
    lo = max(0, int(s["startMs"] / 1000 * RATE) - 1600)
    hi = min(len(x), int(s["endMs"] / 1000 * RATE) + 1600)
    idx = np.nonzero(voiced[lo:hi])[0]
    a, b = (lo + idx[0]) / RATE, (lo + idx[-1] + 1) / RATE
    k0, k1 = s["words"][0]["startMs"] / 1000, s["words"][-1]["endMs"] / 1000
    lead.append(k0 - a)
    tail.append(k1 - b)
    scale = (b - a) / (k1 - k0)
    words = [{"text": w["text"], "startMs": round((a + (w["startMs"] / 1000 - k0) * scale) * 1000), "endMs": round((a + (w["endMs"] / 1000 - k0) * scale) * 1000)} for w in s["words"]]
    cal.append({"index": s["index"], "startMs": round(a * 1000), "endMs": round(b * 1000), "words": words})
    edges.append({"index": s["index"], "onsetMs": round(a * 1000), "offsetMs": round(b * 1000)})

print("Kokoro's first word starts %.2f s (median) before the voice is heard; its last word ends %.2f s after it stops" % (-statistics.median(lead), statistics.median(tail)))
print("stretch of Kokoro's word times to fit the sound: median", round(statistics.median((e["offsetMs"] - e["onsetMs"]) / max(1, (r["words"][-1]["endMs"] - r["words"][0]["startMs"])) for e, r in zip(edges, raw)), 3))
json.dump(cal, open(f"{A}/speech.words.json", "w"), indent=1)
json.dump(edges, open(f"{A}/speech.edges.json", "w"), indent=1)
