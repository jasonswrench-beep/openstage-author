# ADR 0002: Speech recognition for captions from a recorded voice

Status: Accepted for building. The licence audit (2026-10-16) and the quality audit (2026-10-18) are done: Whisper passes, with the conditions under "Revised decision for the build". The speech recognition itself is not built yet.
Date: 2026-10-16 (quality audit added 2026-10-18)
Applies to: Capture's story D3 (captions from a recorded voice), and the "Whisper for imported media" item on the roadmap.

## The question

An author who recorded their own voice should not have to type every caption. Story D3 in `docs/capture/prd.md` allows captions to be made from the
recorded audio only if all of this holds:

- it runs on the author's own computer, and nothing is sent anywhere;
- the result is labelled "auto-generated, unreviewed" until the author approves it;
- it plugs in through a "captions from media" contract, so no model-specific code enters the course format or the player;
- the tool has passed a licence audit and a quality audit. **If no tool passes, this story leaves Release 1.** The script-based captions (D1) and the
  caption editor (D2) stay either way, and they are built.

Speech recognition is never run when the author has a script. The script gives exact words, and the recogniser's only extra is timing.

## What was checked

Read on 2026-10-16 from each project's own page, its licence file, and the package and model listings. Licences and maintenance can change, so check
again before relying on a row.

| Piece | Licence | What matters for OpenStage |
| --- | --- | --- |
| `openai/whisper` (the original, Python) | MIT (code). Its README says the weights are MIT too | Needs the command-line tool ffmpeg installed. OpenStage has a rule against shipping FFmpeg, so this route is out |
| The same model's Hugging Face card (`openai/whisper-small`) | The card's front matter says Apache-2.0 | **Disagrees with the original repository's MIT.** Both are permissive and allow what OpenStage needs, but NOTICE must name the licence of the exact files that are used, not one of the two |
| `ggml-org/whisper.cpp` | MIT, copyright "The ggml authors" 2023-2026 | Plain C and C++ with no dependencies. CPU works; Vulkan and CUDA are optional. Input is 16-bit WAV, with no ffmpeg needed. Latest release v1.9.5 (2026-10-06) has no prebuilt files attached, so it is built from source with CMake |
| Models for whisper.cpp (`ggerganov/whisper.cpp` on Hugging Face) | The repository is tagged MIT | `ggml-base.en` about 148 MB, `ggml-small.en` about 488 MB, `ggml-medium.en` about 1.5 GB (sizes from the listing) |
| `SYSTRAN/faster-whisper` (Python) | MIT. Its engine CTranslate2 is MIT too, and the converted model `Systran/faster-whisper-small` says MIT | Needs the Python package `av` (PyAV) for any audio, even a WAV. See the next row |
| PyAV (`av`) | BSD-3-Clause | Its Windows wheels carry a bundled FFmpeg. The build recipe (`pyav-ffmpeg`) lists x264 and x265 among what is built in. Those two libraries are GPL (general knowledge, not read on these pages), and an FFmpeg built with them is GPL as a whole. The pages I read do not state the licence of the bundled build, so this has to be checked in the licence files inside the wheel before anything depends on it. Until then this route is out |
| `tazz4843/whisper-rs` (Rust bindings to whisper.cpp) | Unlicense (public domain) | The GitHub repository was archived by its owner on 2025-07-30 and moved to Codeberg. Fine for reading, a poor thing to build on without looking at the new home first |

Not read, so not assessed: Vosk, sherpa-onnx, Moonshine, NVIDIA's Parakeet and Canary models, and wav2vec 2.0. They are listed so that they are not
forgotten if Whisper fails the quality audit.

**Licence verdict.** The model and whisper.cpp pass: both are permissive, with no copyleft and no field-of-use limit. The faster-whisper route does not
pass, only because of the FFmpeg that PyAV brings. That is a verdict about licences, and it is not yet a verdict about quality.

## What Whisper's own model card warns about

These are the model card's limits, restated, and each one shapes the design below:

- It can write words that were never said (hallucination), and it can repeat itself. Silence and music are where this shows most.
- Accuracy is uneven across languages, accents, dialects and speakers. The card reports 3.4 percent word errors on clean English read aloud and 7.6
  percent on harder English; those are the numbers for tidy test recordings, not for a screen recording made on a laptop.
- It cannot be used for real-time captions as it comes.
- The card advises against transcribing people who did not consent. OpenStage records the author's own voice and the computer's own sound, which
  may include someone else's voice in a call; the recorder already keeps the microphone and the computer's sound apart, so the author can choose
  which one to transcribe.

## Proposed decision

1. **Use whisper.cpp, as a separate program the editor starts**, in the same way as the recorder. `whisper-cli.exe` is built from the MIT source,
   put beside the editor, and run as a process. Nothing links to it. A separate process also keeps the licence question separate, as ADR 0001 does for
   the recorder. Do not use faster-whisper, openai-whisper or PyAV.
2. **The contract ("captions from media"), kept small so another recogniser can replace Whisper:**
   - in: a 16 kHz, mono, 16-bit WAV file, a language code, and the path of a model file;
   - out: JSON lines, `progress` and then `segment` with `startMs`, `endMs` and `text`, or an error in plain words;
   - it never uses the network. The editor starts it with no way to reach the internet where Windows allows that, and the tool itself has no download code.
3. **The audio comes from the edit, not from the raw microphone file.** Capture's `render` already knows the edit's cuts and its mix. An audio-only
   export (16 kHz mono WAV of the edit) would make the times match the finished video exactly. That export is a small addition to Capture; it is not built.
4. **Models are the author's choice and arrive only when they press a button.** The editor says the size, where the file comes from, and that it is
   kept in the editor's own folder, never in a course. Then it downloads it, checks the SHA-256 against a value written down in the editor, and says
   so. Nothing is downloaded without that button.
5. **The result goes into the same captions dialog** as everything else, in the same list, marked "auto-generated, unreviewed" in the same way the
   estimated times from a script are marked today (a NOTE in the WebVTT file, and a note in the dialog that stays until the author presses a button).
   The review works by keyboard and the state is said in words, as the story requires.
6. **A script wins.** With a script, the captions are made from it, and the recogniser would be used only to place the sentences in time. That use
   is not built either, and a quiet-gap method (find the pauses in the audio and place sentences between them) may do the job with no model at all.

## The quality audit plan (it has now been run: see the results below)

The plan was a short trial, which needed Jason's say-so because it downloads models. He gave it on 2026-10-18.

- Download `ggml-base.en.bin` (148 MB) and `ggml-small.en.bin` (488 MB), and build `whisper-cli.exe` from source. CMake is not on this computer's
  path, so first check whether the Visual Studio that is installed brings its own.
- Run both on two minutes of Jason's real narration, with the words that matter in this field (Brightspace, SCORM, SUNY, accessible), and on a
  30 second stretch of silence and of keyboard noise.
- Measure: the share of words that are right, how far the caption times are from where the words are, whether anything is invented in the silence, and
  how long it takes on this computer without a graphics card helping.
- **Proposed passing marks, which are Jason's to change:** at least 90 percent of words right on the narration, most caption times within half a second,
  nothing invented in the silent stretch, and a two minute recording done in under four minutes on an ordinary computer. If `base.en` is too weak and `small.en` is too slow, the
  story waits for a better model, and the rest of the captions work is not held up.

## The quality audit: what was run and what it found (2026-10-18)

Jason said to go ahead. What was done, on this computer (a 13th-generation Intel Core i9, 24 cores, no graphics card used):

- `whisper.cpp` v1.9.5 was fetched from GitHub (MIT) and built as `whisper-cli.exe` with the CMake and C++ compiler that come with Visual Studio 2026, for the processor only. The program imports only Windows
  basics, the C++ runtime and OpenMP: **no network library at all**. The two models came from `huggingface.co/ggerganov/whisper.cpp` (tagged MIT) and their SHA-256 values match what Hugging Face publishes:
  `ggml-base.en.bin` 147,964,211 bytes, `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`; `ggml-small.en.bin` 487,614,201 bytes,
  `c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d`. Everything is in `D:\Whisper-Trial` (outside the repository; the models are never committed).
- **Test audio.** (1) Jason's own narration, `Recordings/Voice Narrations/Narration 1.m4a`: 109 seconds, a clean studio recording. It has no script, so it is judged by how the two models agree and by whether
  words start where the voice does after a pause. (2) A 176-second script with the words that matter here (Brightspace, SCORM, SUNY New Paltz, Wrench, alt text) read by Kokoro one sentence at a time, so the true
  words and the true start and end of every sentence are known (the voice edges are read from the sound itself, and the word times inside a sentence are Kokoro's own, stretched to fit those edges, so they are only
  as good as that). The same speech was also made **noisy** (room noise, a fan, keyboard clicks, like a laptop microphone) and **harsh** (the voice only about 4 dB above the noise, loud clicks). (3) Four 30-second
  clips with no speech: perfect silence, room tone, keyboard clicks, held tones.
- The scripts are in `tools/asr-trial/` so the trial can be run again when a better model appears (`tools/asr-trial/README.md`).

### Results

| Test | base.en (148 MB) | small.en (488 MB) |
| --- | --- | --- |
| Jason's narration: the words | 271 words, the same words as small.en | 271 words, the same words as base.en. Read through: whole sentences, nothing wrong that I could see |
| Script, clean: words right | 99.8% (1 wrong: "Paltz") | 99.8% (1 wrong: "Paltz"); **100% with a list of the course's words given as a hint** |
| Script, laptop noise: words right | 97.8% (missed "Brightspace" and "New Paltz") | 98.9% (missed "New Paltz" and "Wrench") |
| Script, harsh noise: words right | 83.3% | 93.3% (93.7% with the hint) |
| Time for Jason's 109 seconds, 4 threads | 7.8 s (0.07 times as long as the recording) | 20.8 s (0.19 times) |
| The same, 2 threads (a slower computer) | 13.1 s (0.12) | 34.0 s (0.31) |
| Memory in use | 410 MB | 880 MB |
| Where captions start, built-in times: sentence starts within 0.5 s of the voice | 36% | 82% to 86% |
| Where they start, alignment mode (`-dtw`): sentence starts within 0.5 s | **100%** (median 0.08 s) | **100%** (median 0.15 s) |
| Alignment mode: every word's start within 0.5 s | 99.6% | 93.3% |
| Alignment mode, Jason's narration: the word after each pause within 0.5 s of the voice | 96% (median 0.12 s) | 96% (median 0.20 s) |
| 30 seconds of perfect silence | one word, "You" | `[BLANK_AUDIO]`, or "you" with the non-speech option on |
| Room tone, keyboard, held tones | no words; notes such as `(keyboard clicking)`, `[BLANK_AUDIO]` | no words; notes such as `(keyboard clicking)`, `(gentle music)` |

Other findings:

- **The built-in times are not good enough, alignment mode is.** whisper.cpp's ordinary times come in segments that run one into the next, so a caption appears up to a whole pause early (base.en) or lingers
  up to a pause too long (small.en: sentence ends a median 1.3 seconds late, and early by more than 0.3 seconds for 0 of 28 sentences on the clean script and 1 of 28 with noise). Alignment mode (`-dtw <model>` with `-nfa`, which costs about 20% more time) gives each word its own
  time, and those were accurate. The caption's end still has to be set by the editor from the next word and the real sound, because the audio is in hand.
- **The words that matter here need help.** "New Paltz" was heard as "pouts" or "pals" by both models, and "Brightspace" and "Wrench" fail under noise. Giving the recogniser the course's own words as a hint
  (`--prompt`) fixed them for small.en on the clean recording, and not for base.en. Under harsh noise the hint was not enough ("SUNY", "Wrench"). Every result must be read before it is trusted.
- **It never invented a sentence.** The only invented word anywhere was "You" on perfect silence. Perfect silence is exactly what an edit can contain (a cut, a gap), so the editor must drop any caption
  that lies in silence, and any note in brackets, parentheses or music signs, before showing the result.
- Numbers come out as digits ("2026", "800"), which is fine in a caption, and punctuation and capitals are added.

### Against the passing marks proposed above

| Mark | Result |
| --- | --- |
| At least 90% of words right on the narration | **Pass.** 99.8% on a clean known script and 97.8% to 98.9% with laptop noise; Jason's real narration agrees word for word between the two models. With harsh noise only small.en passes (93%) |
| Most caption times within half a second | **Pass with alignment mode and the editor setting the ends.** Fails with the built-in times for base.en |
| Nothing invented in the silent stretch | **Pass only with a filter** (drop captions lying in silence and bracketed notes). Raw, base.en writes "You" on perfect silence |
| A two-minute recording in under four minutes on an ordinary computer | **Pass by a wide margin.** A two-minute recording takes about 9 seconds (base.en) or 25 seconds (small.en) here, and about 15 and 37 seconds on two threads. A computer five times slower than that would still finish with small.en in about three minutes |

**Verdict: Whisper passes, so D3 stays in Release 1.** It passes as a way of making a first draft that the author checks, which is how the story is already worded ("auto-generated, unreviewed").

### What the trial did not cover

- **One real speaker** (Jason), one clean 109-second recording, and no script to count its errors against. Other voices, accents, a poor microphone, a recording over a call, and speech over music were not tested.
  The model card warns that accuracy is uneven across speakers, and nothing here contradicts that.
- The known-script tests use a computer voice. It is clean, so real people will do somewhat worse than the clean figures; the noisy and harsh clips are the guide to how much.
- Recordings longer than a few minutes (whisper.cpp reads in 30-second windows and can repeat itself over long silences), non-English speech, a graphics card, and a computer with an ARM processor.
- The program was built for this computer's processor. A program to give to other people needs a generic build, and the C++ and OpenMP runtimes it needs (`VCRUNTIME140`, `MSVCP140`, `VCOMP140`) have to be
  bundled or linked in. That is a build task, not a quality question.
- Word times inside a sentence were checked against Kokoro's own timing (stretched to fit the voice's real start and end), not against a person's careful marking.

### Revised decision for the build

The proposed decision above stands, with these changes after seeing the results:

1. **The default model is `small.en` (488 MB)**, with `base.en` (148 MB) offered as a faster, less careful choice. The download button shows the size, the source and the SHA-256 written above, and checks it.
2. **Use alignment mode for word times** (`-dtw small.en -nfa`). The contract's `segment` lines gain a `words` list (text, `startMs`), and the editor builds each caption's lines from it.
3. **Pass the course's own words as a hint**: names and terms from slide headings, the narration scripts and the project's title, trimmed to a short list. Never anything else from the course.
4. **Filter the result before the author sees it**: drop notes in brackets, parentheses or music signs, drop any caption in a stretch with no sound, and keep the "auto-generated, unreviewed" mark until the author
   approves it. The audio-only export from Capture (item 3 above) is still needed so the recognised times match the finished video.
5. **Build for other people**: a generic processor build, with the runtimes linked in or shipped, and `NOTICE` naming the licence of the exact files used (the original repository says MIT for the weights; the
   Hugging Face card for `whisper-small` says Apache-2.0; both are permissive).

## What is built and what is not

- Built (2026-10-16): D1 (captions from a script, estimated times marked and kept marked in the file), D2 (edit, WebVTT and SRT in and out, warnings),
  D4 (a transcript from the captions and from what is on the screen). See `docs/editor.md`.
- Not built: D3 (this decision; it is now cleared to be built), and D6 (alt text suggested from the steps; the audio for step text, D7, is built).
- D5 (audio description) already exists in the course format and the player, and its authoring is in the video's Properties panel.
