"""Makes the test audio for the Whisper quality trial (ADR 0002).

speech: a script read by Kokoro one sentence at a time, so the true start and end of every sentence is known.
speech-noisy: the same speech with room noise, a fan hum and keyboard clicks mixed in, like a laptop microphone.
silence, roomtone, keyboard: 30 seconds each, with no speech in them, to see whether any words are invented.
Everything is written as 16 kHz mono 16-bit WAV, which is what whisper.cpp reads.
"""
import json
import os
import sys

import numpy as np
import soundfile as sf

OUT = os.environ.get("WHISPER_TRIAL", "D:/Whisper-Trial") + "/audio"
RATE_TTS = 24000
RATE = 16000

SCRIPT = [
    "Welcome to this short lesson on making accessible online courses.",
    "In this video, I will show you how to build a module for Brightspace that meets the Web Content Accessibility Guidelines.",
    "Every picture in your course needs alternative text, so that a learner who uses a screen reader hears what the picture shows.",
    "Every video needs captions, and every caption needs to be on the screen long enough to read.",
    "At SUNY New Paltz, we use a learning management system to deliver our courses.",
    "The module you export is a SCORM package, and the learning management system reads it as a single lesson.",
    "First, open the editor and choose a new course.",
    "Next, add a slide, type a heading, and write the words that you want the learner to read.",
    "Then press the Narration button, and the editor makes a voice that says those words aloud.",
    "A learner can move through the lesson with the keyboard alone, using the Tab key and the Enter key.",
    "Nothing in the lesson should trap the keyboard, and nothing should depend on color alone.",
    "If a picture is only there for decoration, mark it as decorative, and a screen reader will skip it.",
    "Now we will record the screen while I click through the steps of the task.",
    "I will open the File menu, choose Save As, and type the name of the file.",
    "The recorder notes each click, so the editor can turn the recording into step by step slides.",
    "Each step has a picture, a short sentence, and a box around the place to click.",
    "You can watch the steps, practice them yourself, or take a short test at the end.",
    "The test scores each answer, and the score goes back to the grade book in the learning management system.",
    "Please check every description before you publish the course, because the computer can make mistakes.",
    "A good caption has no more than two lines, and each line has about forty characters.",
    "Captions should include who is speaking, and any sound that matters, such as applause or a phone ringing.",
    "In twenty twenty-six, more than eight hundred students in my department used these materials.",
    "Dr. Wrench recorded the first version in about three hours, and the final version took two weeks.",
    "If the audio is quiet, or if there is a fan running in the background, the captions may be less accurate.",
    "That is why you should always read the captions through once, from the first line to the last.",
    "Finally, remember that accessibility is not a feature you add at the end of a project.",
    "It is a way of working, and it starts with the very first slide.",
    "Thank you for watching, and I hope this lesson helps you build better courses.",
]

rng = np.random.default_rng(20261018)


def to16(x, rate=RATE_TTS):
    """Resample by linear interpolation to 16 kHz (the test noise is added after, so the resampler is not a factor in what is measured)."""
    n = int(round(len(x) * RATE / rate))
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def write(name, x):
    x = np.clip(x, -1, 1)
    sf.write(f"{OUT}/{name}.wav", (x * 32767).astype(np.int16), RATE, subtype="PCM_16")
    print(name, f"{len(x) / RATE:.1f}s")


def pink(n, level_db):
    """Pink-ish noise at a level in dB below full scale."""
    w = rng.standard_normal(n)
    f = np.fft.rfft(w)
    f /= np.sqrt(np.maximum(np.arange(len(f)), 1))
    p = np.fft.irfft(f, n)
    p /= np.sqrt(np.mean(p ** 2))
    return (p * 10 ** (level_db / 20)).astype(np.float32)


def clicks(n, per_second=6.0, level_db=-28):
    """Keyboard-like clicks: short bursts of high-passed noise with a fast decay, at random times and strengths."""
    out = np.zeros(n, dtype=np.float32)
    t = 0.0
    while True:
        t += rng.exponential(1.0 / per_second)
        i = int(t * RATE)
        if i >= n - 800:
            break
        length = int(rng.uniform(0.006, 0.02) * RATE)
        burst = np.diff(rng.standard_normal(length + 1)) * np.exp(-np.linspace(0, 7, length))
        burst /= np.max(np.abs(burst)) + 1e-9
        out[i:i + length] += (burst * 10 ** (level_db / 20) * rng.uniform(0.4, 1.0)).astype(np.float32)
    return out


def hum(n, level_db=-45):
    t = np.arange(n) / RATE
    h = np.sin(2 * np.pi * 60 * t) + 0.5 * np.sin(2 * np.pi * 120 * t) + 0.25 * np.sin(2 * np.pi * 180 * t)
    return (h / np.max(np.abs(h)) * 10 ** (level_db / 20)).astype(np.float32)


def main():
    os.makedirs(OUT, exist_ok=True)
    from kokoro import KPipeline

    pipe = KPipeline(lang_code="a")
    pause = lambda s: np.zeros(int(s * RATE), dtype=np.float32)
    parts = [pause(0.8)]
    truth = []
    cursor = len(parts[0])
    for i, sentence in enumerate(SCRIPT):
        chunks = []
        for _, _, a in pipe(sentence, voice="af_heart"):
            chunks.append(a if isinstance(a, np.ndarray) else a.detach().cpu().numpy())
        audio = to16(np.concatenate(chunks)) * 0.7
        start = cursor
        parts.append(audio)
        cursor += len(audio)
        truth.append({"index": i, "text": sentence, "startMs": round(start / RATE * 1000), "endMs": round(cursor / RATE * 1000)})
        gap = pause(rng.uniform(0.35, 0.9))
        parts.append(gap)
        cursor += len(gap)
    parts.append(pause(0.8))
    speech = np.concatenate(parts)
    json.dump(truth, open(f"{OUT}/speech.truth.json", "w"), indent=1)
    open(f"{OUT}/speech.txt", "w").write("\n".join(SCRIPT) + "\n")
    write("speech", speech)

    n = len(speech)
    # a laptop microphone: room noise, a fan's hum, keyboard clicks, and the voice a little low-passed by distance
    k = np.ones(5) / 5
    far = np.convolve(speech, k, mode="same") * 0.8
    noisy = far + pink(n, -42) + hum(n, -50) + clicks(n, 3.0, -30)
    write("speech-noisy", noisy)

    m = 30 * RATE
    write("silence", np.zeros(m, dtype=np.float32))
    write("roomtone", pink(m, -52) + hum(m, -58))
    write("keyboard", pink(m, -52) + clicks(m, 7.0, -26))
    # a stretch of music-like tones: held chords, since Whisper is known to write words over music
    t = np.arange(m) / RATE
    chord = sum(np.sin(2 * np.pi * f * t) for f in (220, 277.2, 329.6, 440)) / 4
    env = 0.5 * (1 + np.sin(2 * np.pi * 0.25 * t))
    write("tones", (chord * env * 10 ** (-24 / 20)).astype(np.float32) + pink(m, -56))


if __name__ == "__main__":
    sys.exit(main())
