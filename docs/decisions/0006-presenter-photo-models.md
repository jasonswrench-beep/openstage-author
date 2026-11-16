# ADR 0006: Presenters made from a photo (Phase 0 of the Presenter add-on)

Status: Route (a) chosen by the owner on 2026-11-16 and tried the same day (see "The trial"). The LivePortrait weights are not to be listed in the model manager. How an author gets them is open (see "What is needed to go on").
Date: 2026-11-16
Applies to: the Standard and Studio kinds of the OpenStage Presenter add-on (`docs/avatar-addon-spec.md`, "Recommended tiered approach" and "Phased build plan", Phases 0 to 3).

## Why this record exists

The specification's Phase 0 is "proof and license check" and its gate is "a 1-minute clip renders on the 8 GB card with lips in sync, and every model in the plan passes the license rules".
`CLAUDE.md` says open model weights are not automatically open source and are audited one by one, and that a copyleft or unclear licence is a hard stop for anything linked, vendored or copied.
The Lite kind (illustrated presenters, Phase 1) needs no model and is built. This is the audit for the photo kinds, read on 2026-11-16 from primary pages only (raw LICENSE and README files,
Hugging Face model cards and file listings, crates.io and docs.rs, Microsoft Learn). Nothing was downloaded or installed. Two research passes read the pages; the three statements
that decide the most (the LivePortrait licence note, YuNet's MIT licence, JoyVASA's dependence on InsightFace and FFmpeg) were read again by hand.

## What was found

### JoyVASA (audio to head and face motion)

- Code: MIT (`LICENSE`, "Copyright (c) 2024 xuyangcao"). Weights (Hugging Face `jdh-algo/JoyVASA`): the tag `license: mit` and no text. Its audio encoder, `TencentGameMate/chinese-hubert-base`, is tagged MIT.
- **It needs InsightFace's pretrained models** (`buffalo_l`: `det_10g.onnx`, `2d106det.onnx`), which are non-commercial (below), and its README names no replacement.
- **It needs FFmpeg** on the PATH (`inference.py` stops without it). `CLAUDE.md` says FFmpeg is not used.
- **There is no ONNX version.** The generator is a PyTorch checkpoint (`motion_generator_hubert_chinese.pt`, 414 MB) and a pickle (`motion_template.pkl`); the pipeline that uses it in FasterLivePortrait runs it in PyTorch. Nothing found says it can be exported.
- Its acknowledgements thank DiffPoseTalk, whose repository has no licence; no copied code was found but derived code could not be ruled out. The licences of its training data were not found.
- Last commit 2026-04-16; no releases. Tested on Windows 11 by its author (RTX 4060 laptop, 8 GB, CUDA 12.1). Open issues in FasterLivePortrait report mouths that do not open and lip-sync drift with it.

### LivePortrait (the renderer) and FasterLivePortrait (its ONNX build)

- LivePortrait's own `LICENSE` is MIT and then adds: "The models of InsightFace are for non-commercial research purposes only. If you want to use the LivePortrait project for commercial purposes, you should remove and replace InsightFace's detection models". Its cropper hardcodes `buffalo_l`; there is no switch.
- The weights repository (`KlingTeam/LivePortrait`, which `KwaiVGI/LivePortrait` now redirects to) is tagged `license: mit` with no text. A maintainer's answer to the commercial question is to drop InsightFace and use another licensed detector; an open issue (#548, 2025-10-08) asks whether the remaining weights are unrestricted and has no reply. **Whether those weights are free to use commercially is unconfirmed.**
- FasterLivePortrait (code MIT, last commit 2025-06-29) has ONNX files of the human pipeline: appearance feature extractor 3.4 MB, motion extractor 112.6 MB, warping and decoder 421.2 MB, the project's own 203-point landmark model 114.7 MB, and three small stitching and retargeting models (0.18, 0.58 and 0.15 MB), about 0.65 GB in all. Its `--mp` option replaces the InsightFace detector and 106-point landmarks with MediaPipe. Its ONNX repository also holds InsightFace-sized detector files, which would not be used.
- Real time (30 frames a second and more) is reported on an RTX 3090 with TensorRT 8.x; **CPU is described as "extremely slow and not recommended"**; the ONNX path is a GPU path. Open issues report failed Windows installs of its package.

### The face check

- YuNet (opencv_zoo): code and weights MIT (the folder's `LICENSE` and README), 230 KB ONNX, finds faces of 10 to 300 pixels with five landmarks (both eyes, the nose tip, both mouth corners). It is a permissive detector that can stand in for InsightFace's.
- MediaPipe BlazeFace (short range): code Apache 2.0; the model card says the model is Apache 2.0; 224 KB; six keypoints. Only third-party ONNX conversions exist.
- Runtimes: `tract-onnx` (MIT or Apache 2.0, pure Rust, no DLL) lists the operators a small detector needs, but nobody has reported YuNet running on it, so it needs a trial with the real file. `ort` (MIT or Apache 2.0) is still a release candidate; its default fetches a prebuilt ONNX Runtime at build time, and a `load-dynamic` feature loads a library at run time instead. ONNX Runtime itself is MIT.
- **DirectML.dll is not open source.** Microsoft's redistribution terms let it be used "solely for use on Windows and Xbox" and copied and distributed within an application, and bar anything outside that. Microsoft says DirectML "is in sustained engineering" and that new work is in Windows ML, "the Windows-supported and maintained copy of ONNX Runtime", shipped through the Windows App SDK. The specification chose Windows ML for that reason.

## What this changes in the specification's plan

1. **The Standard kind as specified (JoyVASA, then LivePortrait, on ONNX Runtime through Windows ML) cannot be built as it stands.** JoyVASA has no ONNX form, so it cannot go through Windows ML; it would have to run in PyTorch, which is what the specification keeps for the Studio pack (an embedded Python with CUDA, 4 to 8 GB), and it still needs an InsightFace replacement, FFmpeg replaced by something else, and an answer on where its motion model comes from (DiffPoseTalk).
2. **LivePortrait's weights need a decision before they go in a catalogue.** They are tagged MIT, but the project itself says part of what it runs on is non-commercial, and the question whether the rest is free is open and unanswered. The specification's rule for catalogue entries ("MIT, Apache 2.0, BSD, CC0, CC-BY; anything unclear needs a decision, the default is to leave it out") makes this the owner's call.
3. **LivePortrait can be driven without JoyVASA.** The ONNX files include eye and lip retargeting (stitching) models: they take a number for how open the lips are and move the picture's keypoints to match. The mouth shapes the add-on already makes (from the speech engine's words, or from the sound) can supply that number for every picture of the clip, and the head's small sway the editor already draws can supply the pose. That needs no JoyVASA, no HuBERT, no PyTorch, no FFmpeg and no InsightFace, only the ONNX files above, a face detector, and a runtime. What it gives up: the lips open and close in time with the speech but do not take the rounded and spread shapes the Lite presenters do, and nothing moves the face by what is said. It has not been tried. **It is a design this record proposes, not one the specification chose.**
4. Neither route is real time on a computer without a good graphics card, and neither is tried on this computer's card yet. This computer has an NVIDIA GeForce RTX 3050 with 8 GB, which is the specification's Phase 0 test machine.

## The trial (2026-11-16, on the RTX 3050 computer)

The owner chose route (a), said the LivePortrait weights are **not** to be listed in the model manager, and agreed to the trial download. The files were fetched from their publishers into a scratch folder outside the repository, each checked
against the SHA-256 and size its publisher lists: the human-pipeline ONNX files of FasterLivePortrait (appearance feature extractor 3.4 MB, motion extractor 112.6 MB, the 203-point landmark model 114.7 MB, the three stitching models
0.9 MB together, the warping and decoder model 421.2 MB), YuNet (0.23 MB), five of the LivePortrait repository's example photographs, and, in a throwaway Python environment, ONNX Runtime with DirectML, NumPy, OpenCV and Pillow. Nothing went
into the repository; the scripts and files are in the session's scratch folder and can be deleted. InsightFace's files were never used.

What was tried: a trimmed copy of FasterLivePortrait's own inference steps (its crop, landmarks, motion extractor, appearance features, lip and eye retargeting, and warping model), with YuNet as the face finder and no driving video:
the picture of one photo is made from only a number for how open the lips are, a number for how open the eyes are, and (not used in the end) a small turn of the head.

What it showed:

1. **It works, and the mouth is controllable.** From one photo, the lip number alone opens and closes the mouth believably, with teeth and the inside of the mouth, on a painted portrait and on two photographs. A face finder
   other than InsightFace (YuNet, with its five landmarks) is enough for the crop; the project's own 203-point landmark model gives the lip and eye ratios. A short stretch of the clip's real mouth track (from the Windows voice's phonemes)
   mapped to these pictures reads as talking.
2. **Per-frame animation is too slow, and the graphics card cannot help as the model is exported.** The warping model has two three-dimensional `GridSample` operators. DirectML cannot start the model (it fails when the session is made, with the
   memory options DirectML asks for as well), and on the processor (32 threads) a picture takes 2 to 10 seconds, so a minute of video at 25 pictures a second would take hours. Running it on the graphics card would mean the CUDA provider
   (with its several gigabytes of NVIDIA libraries) or cutting the graph around the two operators; neither was tried.
3. **So a photo presenter does not need to be animated per frame: it can be a set of pictures, made once.** The mouth shapes the add-on already makes are six; six lip numbers and two eye states are twelve pictures of the photo (about 100 seconds on this
   computer with the processor alone, about 1.9 GB of memory at the peak), and a clip is then made like an illustrated presenter's: the editor picks the picture for each moment of the mouth track, crossfades when it changes, and sways the whole picture a
   little. That keeps the per-clip work in the editor's fast encoder, needs no graphics card and no DirectML (whose DLL is not open source), and makes the expensive step a one-time cost for each photo, which an author could leave to run.
4. **Limits seen:** the six shapes come out as about four looks (closed, slightly open, open and a middle one; the rounded and the spread mouth are hard to tell apart); "eyes shut" came out as half shut on all three; where the lips are
   hidden (a moustache) the mouth hardly moves; the head does not turn (the sway would be a movement of the flat picture); the pictures are the 512 by 512 crop LivePortrait works on, not the whole photograph (pasting back was not tried);
   only five photographs were tried.

Not tried: anything in Rust (ONNX Runtime has to be reached from the add-on, which is Rust: the CPU build of the library loads at run time and is MIT), the CUDA or the graph-cutting routes, paste-back, photographs of faces turned away or
wearing glasses, and a computer with fewer cores (a laptop with 8 would take about three times as long).

## What is needed to go on

- **(answered: route (a).)** ~~Which route for a photo presenter:~~ (a) LivePortrait driven by the add-on's own mouth shapes (3 above), (b) JoyVASA and LivePortrait in PyTorch as the Studio pack, (c) no photo presenters for now, with the effort put into more illustrated ones.
- **(answered: no.)** ~~Whether LivePortrait's weights may be listed~~ in the model manager's catalogue. Which leaves open **how an author gets them**: by putting the files in the models folder themselves (the add-on would check they are the right ones and tell them where they come from and what their licence says), or not at all.
- **(answered: yes, and done.)** ~~Permission to download for a trial~~ on this computer (nothing is downloaded without it): for (a), the human-pipeline ONNX files of FasterLivePortrait (about 653 MB in all, from `huggingface.co/warmshao/FasterLivePortrait`), YuNet (230 KB, from `opencv/opencv_zoo`), and ONNX Runtime with its GPU provider (several hundred MB, from Microsoft or its package index). Each would be checked against the SHA-256 the publisher lists and removed afterwards if the trial is not kept.

## What was built meanwhile

Only what does not depend on the answers: the hardware check of the specification (graphics cards by vendor, name and dedicated memory through DXGI, memory, free space where models are kept, whether an NVIDIA card can run CUDA) and its table of which kinds a computer is capable of. On this computer it says the Standard and Studio kinds are within reach and not offered, because no photo engine is installed.
Not built, because they wait on the decision about the design and about how an author gets the weights: the model manager and its catalogue, the photo check, the `.osavatar` package and its consent record, the render queue, and the photo dialog.
