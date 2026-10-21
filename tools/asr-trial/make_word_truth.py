"""Re-reads the trial's script with Kokoro, exactly as make_test_audio.py did, but keeps the time of every word Kokoro says.

Kokoro decides how long every sound lasts before it makes the audio, so these times are the true times of the words in speech.wav.
Writes speech.words.json. It does not touch any audio file. It checks that its sentence times match speech.truth.json.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_test_audio import RATE, RATE_TTS, SCRIPT, to16, rng  # noqa: E402

OUT = os.environ.get("WHISPER_TRIAL", "D:/Whisper-Trial") + "/audio"


def main():
    from kokoro import KPipeline

    pipe = KPipeline(lang_code="a")
    cursor = int(0.8 * RATE)
    sentences = []
    for i, sentence in enumerate(SCRIPT):
        words = []
        chunk_start = cursor
        total = 0
        for r in pipe(sentence, voice="af_heart"):
            a = r.audio
            a = a if isinstance(a, np.ndarray) else a.detach().cpu().numpy()
            offset = chunk_start / RATE + total / RATE_TTS
            for t in r.tokens or []:
                if t.start_ts is None or t.end_ts is None:
                    continue
                if not any(c.isalnum() for c in t.text):
                    continue
                words.append({"text": t.text, "startMs": round((offset + t.start_ts) * 1000), "endMs": round((offset + t.end_ts) * 1000)})
            total += len(a)
        n16 = len(to16(np.zeros(total, dtype=np.float32)))
        end = chunk_start + n16
        sentences.append({"index": i, "startMs": round(chunk_start / RATE * 1000), "endMs": round(end / RATE * 1000), "words": words})
        cursor = end + int(rng.uniform(0.35, 0.9) * RATE)
    old = json.load(open(f"{OUT}/speech.truth.json"))
    worst = max(max(abs(o["startMs"] - s["startMs"]), abs(o["endMs"] - s["endMs"])) for o, s in zip(old, sentences))
    print("sentences", len(sentences), "words", sum(len(s["words"]) for s in sentences), "worst difference from the sentence times already made (ms):", worst)
    json.dump(sentences, open(f"{OUT}/speech.words.json", "w"), indent=1)


if __name__ == "__main__":
    main()
