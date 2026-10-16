# ADR 0002: Speech recognition for captions from a recorded voice

Status: Proposed. The licence audit is done. The quality audit is not, and nothing has been downloaded or installed for it.
Date: 2026-10-16
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

## The quality audit that is still owed

Nothing here has been run. To decide, the plan is a short trial, and I will not start it without Jason's say-so because it needs downloads:

- Download `ggml-base.en.bin` (148 MB) and `ggml-small.en.bin` (488 MB), and build `whisper-cli.exe` from source. CMake is not on this computer's
  path, so first check whether the Visual Studio that is installed brings its own.
- Run both on two minutes of Jason's real narration, with the words that matter in this field (Brightspace, SCORM, SUNY, accessible), and on a
  30 second stretch of silence and of keyboard noise.
- Measure: the share of words that are right, how far the caption times are from where the words are, whether anything is invented in the silence, and
  how long it takes on this computer without a graphics card helping.
- **Proposed passing marks, which are Jason's to change:** at least 90 percent of words right on the narration, most caption times within half a second,
  nothing invented in the silent stretch, and a two minute recording done in under four minutes on an ordinary computer. If `base.en` is too weak and `small.en` is too slow, the
  story waits for a better model, and the rest of the captions work is not held up.

## What is built and what is not

- Built (2026-10-16): D1 (captions from a script, estimated times marked and kept marked in the file), D2 (edit, WebVTT and SRT in and out, warnings),
  D4 (a transcript from the captions and from what is on the screen). See `docs/editor.md`.
- Not built: D3 (this decision), and D6 and D7 (alt text help and audio for step text, which need the steps of Capture's Phase 7).
- D5 (audio description) already exists in the course format and the player, and its authoring is in the video's Properties panel.
