"""Scores the trial's runs: words right, field terms, caption times, invented words, and speed.

For the script read by Kokoro the true words and times are known. For the real narration there is no script, so it is measured against the pauses in the audio
and against how far the two models agree (which is a guide to where to look, not a count of errors).
"""
import json
import os
import re
import statistics
import subprocess
import sys

ROOT = os.environ.get("WHISPER_TRIAL", "D:/Whisper-Trial")
RUNS = f"{ROOT}/results/runs"
AUDIO = f"{ROOT}/audio"

ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
ABBREV = {"dr": "doctor", "mr": "mister", "mrs": "missus", "vs": "versus"}


def say_int(n):
    if n < 20:
        return [ONES[n]]
    if n < 100:
        return [TENS[n // 10]] + ([ONES[n % 10]] if n % 10 else [])
    if n < 1000:
        return [ONES[n // 100], "hundred"] + (say_int(n % 100) if n % 100 else [])
    if n < 10000:
        return say_int(n // 1000) + ["thousand"] + (say_int(n % 1000) if n % 1000 else [])
    return [str(n)]


def say_number(tok):
    n = int(tok)
    if len(tok) == 4 and 1100 <= n <= 2999 and not 2000 <= n <= 2009 and n % 100 != 0:
        return say_int(n // 100) + say_int(n % 100)
    return say_int(n)


def normalise(text):
    """Lower case, no punctuation, numbers and common abbreviations written as they are said."""
    t = text.lower().replace("\u2019", "'").replace("-", " ").replace("\u2013", " ").replace("\u2014", " ")
    t = re.sub(r"(?<=\d),(?=\d{3})", "", t)
    t = re.sub(r"[^a-z0-9' ]", " ", t)
    out = []
    for w in t.split():
        w = w.strip("'")
        if not w:
            continue
        if w.isdigit():
            out += say_number(w)
        elif w in ABBREV:
            out.append(ABBREV[w])
        else:
            out.append(w)
    return out


def hyp_words(doc):
    """Words (with times, in seconds) from whisper.cpp's full JSON, and the segments."""
    words, segs = [], []
    for seg in doc["transcription"]:
        segs.append({"start": seg["offsets"]["from"] / 1000, "end": seg["offsets"]["to"] / 1000, "text": seg["text"].strip()})
        cur = None
        for tok in seg["tokens"]:
            text = tok["text"]
            if text.startswith("[_") or text.startswith("<|"):
                continue
            start, end = tok["offsets"]["from"] / 1000, tok["offsets"]["to"] / 1000
            dtw = tok.get("t_dtw", -1)
            dtw = dtw / 100 if dtw is not None and dtw >= 0 else None
            if cur is None or text.startswith(" "):
                if cur is not None:
                    words.append(cur)
                cur = {"text": text, "start": start, "end": end, "dtw": dtw}
            else:
                cur["text"] += text
                cur["end"] = end
        if cur is not None:
            words.append(cur)
    out = []
    for w in words:
        for n in normalise(w["text"]):
            out.append({"w": n, "start": w["start"], "end": w["end"], "dtw": w["dtw"], "raw": w["text"].strip()})
    return out, segs


def align(ref, hyp):
    """Word by word alignment (Levenshtein). Returns the operations as (op, ref index, hyp index)."""
    n, m = len(ref), len(hyp)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (0 if ref[i - 1] == hyp[j - 1] else 1))
    ops, i, j = [], n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + (0 if ref[i - 1] == hyp[j - 1] else 1):
            ops.append(("ok" if ref[i - 1] == hyp[j - 1] else "sub", i - 1, j - 1))
            i, j = i - 1, j - 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            ops.append(("del", i - 1, None))
            i -= 1
        else:
            ops.append(("ins", None, j - 1))
            j -= 1
    return ops[::-1]


def pct(values, p):
    if not values:
        return None
    s = sorted(values)
    return s[min(len(s) - 1, int(round(p / 100 * (len(s) - 1))))]


def summarise_errors(errs):
    if not errs:
        return None
    a = [abs(e) for e in errs]
    return {
        "n": len(a),
        "within_0.25s": round(sum(x <= 0.25 for x in a) / len(a) * 100, 1),
        "within_0.5s": round(sum(x <= 0.5 for x in a) / len(a) * 100, 1),
        "median_s": round(statistics.median(a), 2),
        "p90_s": round(pct(a, 90), 2),
        "mean_signed_s": round(statistics.mean(errs), 2),
    }


TERMS = {
    "Brightspace": r"\bbrightspace\b",
    "SCORM": r"\bscorm\b",
    "SUNY": r"\b(suny|s u n y)\b",
    "New Paltz": r"\bnew paltz\b",
    "Wrench": r"\bwrench\b",
    "Web Content Accessibility Guidelines": r"\bweb content accessibility guidelines\b",
}


def score_script(name, doc, truth_sentences, ref_text):
    hyp, segs = hyp_words(doc)
    ref_words = []
    ref_truth = []
    edges = json.load(open(f"{AUDIO}/speech.edges.json"))
    for s in truth_sentences:
        first = len(ref_words)
        for w in s["words"]:
            for n in normalise(w["text"]):
                ref_words.append(n)
                ref_truth.append({"start": w["startMs"] / 1000, "end": w["endMs"] / 1000, "sentence": s["index"], "first": False, "last": False})
        ref_truth[first]["first"] = True
        ref_truth[-1]["last"] = True
    ops = align(ref_words, [h["w"] for h in hyp])
    sub = sum(o[0] == "sub" for o in ops)
    dele = sum(o[0] == "del" for o in ops)
    ins = sum(o[0] == "ins" for o in ops)
    n = len(ref_words)
    wer = (sub + dele + ins) / n * 100
    # where it went wrong
    wrong = []
    for op, r, h in ops:
        if op == "sub":
            wrong.append(f"{ref_words[r]} -> {hyp[h]['w']}")
        elif op == "del":
            wrong.append(f"{ref_words[r]} -> (missing)")
        elif op == "ins":
            wrong.append(f"(extra) {hyp[h]['w']}")
    # times of words that were right
    start_err, end_err, matched = [], [], {}
    for op, r, h in ops:
        if op == "ok":
            start_err.append(hyp[h]["start"] - ref_truth[r]["start"])
            end_err.append(hyp[h]["end"] - ref_truth[r]["end"])
            matched[h] = r
    # the same, from the alignment times (t_dtw) when the run had them
    dtw_err = [hyp[h]["dtw"] - ref_truth[r]["start"] for op, r, h in ops if op == "ok" and hyp[h]["dtw"] is not None]
    # a sentence's first and last word, against where the voice really starts and stops in the sound
    edge_start = [hyp[h]["start"] - edges[ref_truth[r]["sentence"]]["onsetMs"] / 1000 for op, r, h in ops if op == "ok" and ref_truth[r]["first"]]
    edge_end = [hyp[h]["end"] - edges[ref_truth[r]["sentence"]]["offsetMs"] / 1000 for op, r, h in ops if op == "ok" and ref_truth[r]["last"]]
    edge_start_dtw = [hyp[h]["dtw"] - edges[ref_truth[r]["sentence"]]["onsetMs"] / 1000 for op, r, h in ops if op == "ok" and ref_truth[r]["first"] and hyp[h]["dtw"] is not None]
    early_ends = [e for e in edge_end if e < -0.3]
    # captions as whisper cut them: a segment's start against the true start of its first right word, and its end against its last
    seg_start_err, seg_end_err = [], []
    sent_start_err, sent_end_err = [], []
    for seg in segs:
        inside = [i for i, h in enumerate(hyp) if seg["start"] - 0.01 <= h["start"] <= seg["end"] + 0.01 and i in matched]
        if inside:
            f, l = ref_truth[matched[inside[0]]], ref_truth[matched[inside[-1]]]
            seg_start_err.append(seg["start"] - f["start"])
            seg_end_err.append(seg["end"] - l["end"])
            if f["first"]:
                sent_start_err.append(seg["start"] - edges[f["sentence"]]["onsetMs"] / 1000)
            if l["last"]:
                sent_end_err.append(seg["end"] - edges[l["sentence"]]["offsetMs"] / 1000)
    joined = " ".join(h["w"] for h in hyp)
    terms = {k: bool(re.search(v, joined)) for k, v in TERMS.items()}
    return {
        "words_in_script": n, "wrong": sub + dele + ins, "substituted": sub, "missing": dele, "extra": ins, "wer_percent": round(wer, 1), "words_right_percent": round(100 - wer, 1),
        "terms_right": terms, "word_start": summarise_errors(start_err), "word_end": summarise_errors(end_err),
        "caption_start": summarise_errors(seg_start_err), "caption_end": summarise_errors(seg_end_err),
        "word_start_dtw": summarise_errors(dtw_err), "sentence_first_word_start_dtw": summarise_errors(edge_start_dtw), "sentence_ends_early_by_0.3s": f"{len(early_ends)} of {len(edge_end)}", "sentence_first_word_start": summarise_errors(edge_start), "sentence_last_word_end": summarise_errors(edge_end),
        "caption_at_sentence_start": summarise_errors(sent_start_err), "caption_at_sentence_end": summarise_errors(sent_end_err),
        "segments": len(segs), "mistakes": wrong[:60],
    }


def pauses(path, noise="-38dB", d="0.3"):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-af", f"silencedetect=noise={noise}:d={d}", "-f", "null", "-"], capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", out)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", out)]
    return starts, ends


def score_real(name, doc, other_doc):
    hyp, segs = hyp_words(doc)
    starts, ends = pauses(f"{AUDIO}/narration.wav")
    # the word that comes after each pause should start where the voice does; the one before should end where it stops
    onset_err, offset_err = [], []
    for s_end in ends:
        c = min(hyp, key=lambda h: abs(h["start"] - s_end))
        if abs(c["start"] - s_end) < 2.0:
            onset_err.append(c["start"] - s_end)
    for s_start in starts:
        c = min(hyp, key=lambda h: abs(h["end"] - s_start))
        if abs(c["end"] - s_start) < 2.0:
            offset_err.append(c["end"] - s_start)
    dtw_on = []
    for s_end in ends:
        c = min((h for h in hyp if h["dtw"] is not None), key=lambda h: abs(h["dtw"] - s_end), default=None)
        if c is not None and abs(c["dtw"] - s_end) < 2.0:
            dtw_on.append(c["dtw"] - s_end)
    res = {"words": len(hyp), "after_pause_start_dtw": summarise_errors(dtw_on), "segments": len(segs), "pauses": len(starts), "after_pause_start": summarise_errors(onset_err), "before_pause_end": summarise_errors(offset_err),
           "first_word_start_s": hyp[0]["start"], "last_word_end_s": hyp[-1]["end"]}
    if other_doc is not None:
        o, _ = hyp_words(other_doc)
        ops = align([h["w"] for h in o], [h["w"] for h in hyp])
        diff = sum(op != "ok" for op, _, _ in ops)
        res["differs_from_other_model_percent"] = round(diff / max(1, len(o)) * 100, 1)
        res["differences"] = [f"{o[r]['w'] if r is not None else '(none)'} | {hyp[h]['w'] if h is not None else '(none)'}" for op, r, h in ops if op != "ok"][:80]
    return res


def score_quiet(doc):
    hyp, segs = hyp_words(doc)
    return {"words_written": len(hyp), "text": " ".join(s["text"] for s in segs)[:300]}


def main():
    runs = {r["name"]: r for r in json.load(open(f"{ROOT}/results/runs.json"))}
    truth = json.load(open(f"{AUDIO}/speech.words.json"))
    ref_text = open(f"{AUDIO}/speech.txt").read()
    out = {}
    durations = {"narration": 109.3, "speech": 175.7, "speech-noisy": 175.7, "speech-hard": 175.7, "silence": 30, "roomtone": 30, "keyboard": 30, "tones": 30}
    for name, r in runs.items():
        if not r["ok"]:
            out[name] = {"failed": r["stderr_tail"]}
            continue
        doc = json.load(open(f"{RUNS}/{name}.json", encoding="utf-8"))
        entry = {"model": r["model"], "clip": r["clip"], "threads": r["threads"], "prompt": r["prompt"], "sns": r["sns"], "seconds": r["seconds"],
                 "times_real_time": round(r["seconds"] / durations[r["clip"]], 3)}
        if r["clip"] in ("speech", "speech-noisy", "speech-hard"):
            entry.update(score_script(name, doc, truth, ref_text))
        elif r["clip"] == "narration":
            other = "small" if r["model"] == "base" else "base"
            other_name = f"{other}.narration.t4" + (".prompt" if r["prompt"] else "")
            other_doc = json.load(open(f"{RUNS}/{other_name}.json", encoding="utf-8")) if other_name in runs and runs[other_name]["ok"] else None
            entry.update(score_real(name, doc, other_doc))
        else:
            entry.update(score_quiet(doc))
        out[name] = entry
    json.dump(out, open(f"{ROOT}/results/scores.json", "w"), indent=1)
    print("scored", len(out))


if __name__ == "__main__":
    sys.exit(main())
