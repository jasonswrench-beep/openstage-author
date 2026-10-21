# Speech recognition trial (ADR 0002)

These scripts ran the quality audit for Capture's story D3 (captions from a recorded voice) on 2026-10-18. The results and what they mean are in
`docs/decisions/0002-speech-recognition.md`. Keep them to run the trial again when a better model or a new version of whisper.cpp appears.

Nothing here is part of the editor, and nothing here is needed to use it. The models and the audio are large and are never committed: they live in a folder outside the repository
(`D:\Whisper-Trial`, or the folder named by the `WHISPER_TRIAL` environment variable).

1. Put the whisper.cpp source in `<trial>\source\whisper.cpp` (`git clone --depth 1 --branch v1.9.5 https://github.com/ggml-org/whisper.cpp.git`) and run `build-whisper-cli.bat`
   (Visual Studio's CMake, Ninja and compiler; the path at its top is for Visual Studio 2026 Professional).
2. Download `ggml-base.en.bin` and `ggml-small.en.bin` from `huggingface.co/ggerganov/whisper.cpp` into `<trial>\models` and check their SHA-256 against the values in the ADR.
3. Make the test audio with a Python that has Kokoro, numpy and soundfile (the audiobook studio's `.venv` has them): `make_test_audio.py`, then `make_word_truth.py`, then `calibrate_truth.py`.
   This writes a 176-second script read by Kokoro with its true word times, a noisy copy, and four clips with no speech.
4. Optionally put a real narration at `<trial>\audio\narration.wav` (16 kHz, mono, 16-bit; `ffmpeg -i in.m4a -ac 1 -ar 16000 -sample_fmt s16 narration.wav`). It has no script, so it is judged by
   whether words start where the voice does after a pause, and by how much the two models agree. Runs for a clip that is not there are skipped.
5. `python run_trial.py`, `python run_extra.py` (needs numpy), then `python score_trial.py` and `python show_scores.py`.

Honest limits: the known-script audio is a computer voice, and the true times of words inside a sentence are only Kokoro's own times stretched to fit the sound. See the ADR for the rest.
