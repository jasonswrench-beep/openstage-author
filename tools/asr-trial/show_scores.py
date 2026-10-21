import json
import os
import sys

S = json.load(open(os.environ.get("WHISPER_TRIAL", "D:/Whisper-Trial") + "/results/scores.json"))


def row(name):
    e = S[name]
    return e


print("== SCRIPT READ BY KOKORO (known words and times)")
for name in sorted(k for k in S if S[k].get("clip") in ("speech", "speech-noisy", "speech-hard")):
    e = S[name]
    ws, we, cs, ce = e["word_start"], e["word_end"], e["caption_start"], e["caption_end"]
    print(f"{name:34s} words right {e['words_right_percent']:5.1f}%  (wrong {e['wrong']}: sub {e['substituted']}, missing {e['missing']}, extra {e['extra']})  {e['seconds']:5.1f}s = {e['times_real_time']:.2f}x real time")
    print(f"{'':34s} terms: " + ", ".join(f"{k} {'ok' if v else 'MISSED'}" for k, v in e["terms_right"].items()))
    print(f"{'':34s} word start: median {ws['median_s']}s p90 {ws['p90_s']}s within 0.5s {ws['within_0.5s']}% bias {ws['mean_signed_s']}s | word end: median {we['median_s']}s within 0.5s {we['within_0.5s']}%")
    print(f"{'':34s} caption start: median {cs['median_s']}s p90 {cs['p90_s']}s within 0.5s {cs['within_0.5s']}% | caption end: median {ce['median_s']}s p90 {ce['p90_s']}s within 0.5s {ce['within_0.5s']}%  ({e['segments']} captions)")
    def f(k):
        v = e.get(k)
        return "n/a" if not v else f"median {v['median_s']}s, within 0.5s {v['within_0.5s']}% (n {v['n']})"
    print(f"{'':34s} sentence edges (exact, from the sound): first word start {f('sentence_first_word_start')} | last word end {f('sentence_last_word_end')}")
    print(f"{'':34s} captions that begin/end at a sentence edge: start {f('caption_at_sentence_start')} | end {f('caption_at_sentence_end')}")
    print(f"{'':34s} alignment mode word start: {f('word_start_dtw')}")
    print(f"{'':34s} alignment mode, first word of a sentence vs the voice: {f('sentence_first_word_start_dtw')} | default ends that are early by 0.3s+: {e.get('sentence_ends_early_by_0.3s')}")
    print(f"{'':34s} mistakes: " + "; ".join(e["mistakes"][:14]))

print()
print("== YOUR NARRATION (no script)")
for name in sorted(k for k in S if S[k].get("clip") == "narration"):
    e = S[name]
    a, b = e["after_pause_start"], e["before_pause_end"]
    print(f"{name:34s} {e['words']} words, {e['segments']} captions, {e['seconds']:5.1f}s = {e['times_real_time']:.2f}x real time; differs from the other model on {e.get('differs_from_other_model_percent')}%")
    print(f"{'':34s} alignment mode, word after a pause vs the voice: {('n/a' if not e.get('after_pause_start_dtw') else e['after_pause_start_dtw'])}")
    print(f"{'':34s} word after a pause starts within 0.5s of the voice: {a['within_0.5s']}% (median {a['median_s']}s, p90 {a['p90_s']}s, n {a['n']}); word before a pause ends within 0.5s: {b['within_0.5s']}% (median {b['median_s']}s)")

print()
print("== NO SPEECH (words written)")
for name in sorted(k for k in S if S[k].get("clip") in ("silence", "roomtone", "keyboard", "tones")):
    e = S[name]
    print(f"{name:34s} {e['words_written']} words  {e['seconds']}s  {e['text'][:120]!r}")

if len(sys.argv) > 1 and sys.argv[1] == "diff":
    for name in ("base.narration.t4", "small.narration.t4"):
        print()
        print("==", name, "differences from the other model (other | this)")
        for d in S[name].get("differences", []):
            print("  ", d)
