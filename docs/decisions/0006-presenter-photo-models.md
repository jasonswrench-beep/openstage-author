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
- Last commit 2026-04-16; no releases. Tested on Windows 11 by its author (a laptop with an 8 GB graphics card, CUDA 12.1). Open issues in FasterLivePortrait report mouths that do not open and lip-sync drift with it.

### LivePortrait (the renderer) and FasterLivePortrait (its ONNX build)

- LivePortrait's own `LICENSE` is MIT and then adds: "The models of InsightFace are for non-commercial research purposes only. If you want to use the LivePortrait project for commercial purposes, you should remove and replace InsightFace's detection models". Its cropper hardcodes `buffalo_l`; there is no switch.
- The weights repository (`KlingTeam/LivePortrait`, which `KwaiVGI/LivePortrait` now redirects to) is tagged `license: mit` with no text. A maintainer's answer to the commercial question is to drop InsightFace and use another licensed detector; an open issue (#548, 2025-10-08) asks whether the remaining weights are unrestricted and has no reply. **Whether those weights are free to use commercially is unconfirmed.**
- FasterLivePortrait (code MIT, last commit 2025-06-29) has ONNX files of the human pipeline: appearance feature extractor 3.4 MB, motion extractor 112.6 MB, warping and decoder 421.2 MB, the project's own 203-point landmark model 114.7 MB, and three small stitching and retargeting models (0.18, 0.58 and 0.15 MB), about 0.65 GB in all. Its `--mp` option replaces the InsightFace detector and 106-point landmarks with MediaPipe. Its ONNX repository also holds InsightFace-sized detector files, which would not be used.
- Real time (30 frames a second and more) is reported on a graphics card with 24 GB and TensorRT 8.x; **CPU is described as "extremely slow and not recommended"**; the ONNX path is a GPU path. Open issues report failed Windows installs of its package.

### The face check

- YuNet (opencv_zoo): code and weights MIT (the folder's `LICENSE` and README), 230 KB ONNX, finds faces of 10 to 300 pixels with five landmarks (both eyes, the nose tip, both mouth corners). It is a permissive detector that can stand in for InsightFace's.
- MediaPipe BlazeFace (short range): code Apache 2.0; the model card says the model is Apache 2.0; 224 KB; six keypoints. Only third-party ONNX conversions exist.
- Runtimes: `tract-onnx` (MIT or Apache 2.0, pure Rust, no DLL) lists the operators a small detector needs, but nobody has reported YuNet running on it, so it needs a trial with the real file. `ort` (MIT or Apache 2.0) is still a release candidate; its default fetches a prebuilt ONNX Runtime at build time, and a `load-dynamic` feature loads a library at run time instead. ONNX Runtime itself is MIT.
- **DirectML.dll is not open source.** Microsoft's redistribution terms let it be used "solely for use on Windows and Xbox" and copied and distributed within an application, and bar anything outside that. Microsoft says DirectML "is in sustained engineering" and that new work is in Windows ML, "the Windows-supported and maintained copy of ONNX Runtime", shipped through the Windows App SDK. The specification chose Windows ML for that reason.

## What this changes in the specification's plan

1. **The Standard kind as specified (JoyVASA, then LivePortrait, on ONNX Runtime through Windows ML) cannot be built as it stands.** JoyVASA has no ONNX form, so it cannot go through Windows ML; it would have to run in PyTorch, which is what the specification keeps for the Studio pack (an embedded Python with CUDA, 4 to 8 GB), and it still needs an InsightFace replacement, FFmpeg replaced by something else, and an answer on where its motion model comes from (DiffPoseTalk).
2. **LivePortrait's weights need a decision before they go in a catalogue.** They are tagged MIT, but the project itself says part of what it runs on is non-commercial, and the question whether the rest is free is open and unanswered. The specification's rule for catalogue entries ("MIT, Apache 2.0, BSD, CC0, CC-BY; anything unclear needs a decision, the default is to leave it out") makes this the owner's call.
3. **LivePortrait can be driven without JoyVASA.** The ONNX files include eye and lip retargeting (stitching) models: they take a number for how open the lips are and move the picture's keypoints to match. The mouth shapes the add-on already makes (from the speech engine's words, or from the sound) can supply that number for every picture of the clip, and the head's small sway the editor already draws can supply the pose. That needs no JoyVASA, no HuBERT, no PyTorch, no FFmpeg and no InsightFace, only the ONNX files above, a face detector, and a runtime. What it gives up: the lips open and close in time with the speech but do not take the rounded and spread shapes the Lite presenters do, and nothing moves the face by what is said. It has not been tried. **It is a design this record proposes, not one the specification chose.**
4. Neither route is real time on a computer without a good graphics card, and neither is tried on this computer's card yet. This computer has a CUDA graphics card with 8 GB, which is the specification's Phase 0 test machine.

## The trial (2026-11-16, on the computer with the 8 GB card)

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
   (with its several gigabytes of CUDA libraries) or cutting the graph around the two operators; neither was tried.
3. **So a photo presenter does not need to be animated per frame: it can be a set of pictures, made once.** The mouth shapes the add-on already makes are six; six lip numbers and two eye states are twelve pictures of the photo (about 100 seconds on this
   computer with the processor alone, about 1.9 GB of memory at the peak), and a clip is then made like an illustrated presenter's: the editor picks the picture for each moment of the mouth track, crossfades when it changes, and sways the whole picture a
   little. That keeps the per-clip work in the editor's fast encoder, needs no graphics card and no DirectML (whose DLL is not open source), and makes the expensive step a one-time cost for each photo, which an author could leave to run.
4. **Limits seen:** the six shapes come out as about four looks (closed, slightly open, open and a middle one; the rounded and the spread mouth are hard to tell apart); "eyes shut" came out as half shut on all three; where the lips are
   hidden (a moustache) the mouth hardly moves; the head does not turn (the sway would be a movement of the flat picture); the pictures are the 512 by 512 crop LivePortrait works on, not the whole photograph (pasting back was not tried);
   only five photographs were tried at first, and ten in the check below.

Not tried: anything in Rust (ONNX Runtime has to be reached from the add-on, which is Rust: the CPU build of the library loads at run time and is MIT), the CUDA or the graph-cutting routes, paste-back, photographs of faces turned away or
wearing glasses, and a computer with fewer cores (a laptop with 8 would take about three times as long).

## The ten-photo check (2026-11-16)

The same trial was run on ten of the example photographs in the LivePortrait repository (a painted portrait, photographs of adults, a young child), each made into the twelve pictures (six lip openings with the eyes open, and the same six
with the eyes shut), and the pictures compared. The comparison is rough: for each photo, the share of the picture's pixels that changed noticeably (by more than 25 of 255 in any colour) between the closed-mouth picture and another.
Pictures were looked at for four photographs (s0, s1, s11 and s12); the others were judged by these numbers alone.

| Photo | Seconds to make the 12 | Open mouth against closed | Wide against closed | Wide against round | Eyes shut against open |
| --- | --- | --- | --- | --- | --- |
| s0 (painted portrait) | 108 | 3.0% | 1.9% | 0.2% | 0.5% |
| s1 | 102 | 5.1% | 4.5% | 1.0% | 0.8% |
| s2 | 62 | 4.6% | 3.6% | 1.1% | 1.0% |
| s3 | 72 | 4.4% | 3.1% | 0.7% | 2.0% |
| s10 | 107 | 2.7% | 1.7% | 0.3% | 2.0% |
| **s11 (a young child, lips pursed)** | 106 | **0.8%** | **0.0%** | 0.0% | **0.1%** |
| s12 (a moustache) | 95 | 3.0% | 1.5% | 0.5% | 1.6% |
| s22 | 111 | 3.6% | 1.3% | 0.0% | 2.0% |
| s23 | 121 | 2.8% | 1.4% | 0.5% | 0.6% |
| s25 | 137 | 2.4% | 0.6% | 0.0% | 1.7% |

What it showed:

1. **Every photo had exactly one face found** by YuNet and gave twelve pictures, in 62 to 137 seconds on this computer's processor.
2. **Nine of ten photos had a mouth that moves.** Opening the mouth wide changed 2.4% to 5.1% of the picture. **The tenth, s11, hardly moves:** the opening changed 0.8% of the picture and the other mouths none at all. Looked at, the child's lips are pursed, and
   the model keeps them nearly as they were; only the widest opening parts them a little. A clip made from that photo would look like a photograph with a faint twitch. The moustache photo (s12) moved, though less than most.
3. **The wide and the round mouth look the same.** They differ by at most 1.1% of the picture in any photo, and by next to nothing in three. The six mouth shapes the add-on makes come out of this as about four looks: closed, slightly open (small, teeth),
   a middle opening (wide, round), and open. The editor's illustrated presenters show all six; a photo presenter would show four.
4. **The eyes come out half closed, not shut.** The "eyes shut" pictures differ from the open ones by 0.1% to 2.0% of the picture, and where they were looked at (s0, s1, s11, s12) the eyes are narrowed rather than closed (in s11 hardly at all). A blink
   would read as a narrowing of the eyes.
5. **The numbers are a rough guide.** Ten photos is a small sample and the measure is crude, but it separates the one failure from the rest: the lowest of the other nine is 2.4%, and s11 is 0.8%.

What this means for the design: it holds for faces with visible lips and ordinary expressions. Before a photo is accepted as a presenter, the add-on has to be able to say when the mouth will barely move (see the to-do in `ROADMAP.md`), and the editor
should not offer six mouth shapes for a photo when it can draw four. (2026-11-17: the add-on now makes eleven shapes, not six; the trial used six lip openings, and a photo presenter would group the eleven into the same four or so looks.)

## What is needed to go on

- **(answered: route (a).)** ~~Which route for a photo presenter:~~ (a) LivePortrait driven by the add-on's own mouth shapes (3 above), (b) JoyVASA and LivePortrait in PyTorch as the Studio pack, (c) no photo presenters for now, with the effort put into more illustrated ones.
- **(answered: no.)** ~~Whether LivePortrait's weights may be listed~~ in the model manager's catalogue. Which leaves open **how an author gets them**: by putting the files in the models folder themselves (the add-on would check they are the right ones and tell them where they come from and what their licence says), or not at all.
- **(answered: yes, and done.)** ~~Permission to download for a trial~~ on this computer (nothing is downloaded without it): for (a), the human-pipeline ONNX files of FasterLivePortrait (about 653 MB in all, from `huggingface.co/warmshao/FasterLivePortrait`), YuNet (230 KB, from `opencv/opencv_zoo`), and ONNX Runtime with its GPU provider (several hundred MB, from Microsoft or its package index). Each would be checked against the SHA-256 the publisher lists and removed afterwards if the trial is not kept.

## What was built meanwhile

Only what does not depend on the answers: the hardware check of the specification (graphics cards by vendor, name and dedicated memory through DXGI, memory, free space where models are kept, whether a card can run CUDA) and its table of which kinds a computer is capable of. On this computer it says the Standard and Studio kinds are within reach and not offered, because no photo engine is installed.
Not built, because they wait on the decision about the design and about how an author gets the weights: the model manager and its catalogue, the photo check, the `.osavatar` package and its consent record, the render queue, and the photo dialog.

## Second trial: the AI people already in the character packs (2026-11-22)

The owner pointed out that the fifteen AI-made people in `character-packs/openstage-people-1` (credited "AI-generated, Apache License 2.0") are the natural faces for photo presenters: no real person is involved, so no consent step applies to them. The first trial had used LivePortrait's own example photographs, not these.

**The pictures.** The full-size originals are PNGs of 864 by 1152 pixels, one zip for each person, in the owner's OneDrive (`Pictures\eLearning Graphics`), not in this repository. The pack's own pictures are web-sized (560 pixels tall; the head picture is 256 square). In the originals the face is 73 to 84 pixels wide (YuNet's box), and the head-and-shoulders crop the pack tool uses is 294 pixels square, so a presenter made from them is soft at a clip's size.

**What was run** (with the owner's yes, in a scratch folder, nothing in the repository): the same ONNX files as the first trial and YuNet, each checked against the SHA-256 its publisher lists, with ONNX Runtime's CPU build, NumPy, OpenCV (headless) and Pillow in a throwaway environment (283 MB). The warping model has to be `warping_spade.onnx`: the `-fix` variant needs a plugin operator that stock ONNX Runtime does not have. The scripts are a trimmed copy of the LivePortrait steps (landmarks, crop, keypoints, retargeting, stitching, warping) and exist only in the session's scratch folder. Three people were tried: Aisyah (a clear face), Harold (a grey beard) and Daryl (round glasses).

**Method 1, as in the first trial:** twelve pictures from the lip-opening and eye-opening ratios. About 10 seconds a picture on this computer's processor, 122 to 128 seconds a person. An unchanged redraw differs from the original crop by 1.1 to 1.4 of 255. Nothing above the mouth moves (0.0 to 0.03%). Opening wide changed 2.25% (Aisyah), 1.47% (Harold) and 1.9% (Daryl) of the picture, so the beard did not stop the mouth and the glasses stayed intact. The eyes shut properly in all three (the first trial got half shut). But the three widest openings pull the lips into a tense grimace, and the wide and the round mouth are not told apart (0.8 to 1.4%). The owner watched a talking test made from these and judged it not good enough: it looked fake or uncanny.

**Method 2, real mouth expressions put on the face.** A driving picture's expression is read (21 keypoints), and only LivePortrait's lip keypoints (6, 12, 14, 17, 19, 20) take the difference between that picture and the same driver's resting face; the eyes, brows and head stay the person's own. The official lip retargeting model moves mainly keypoints 19, 20 and 14, so the region is the right one. The stand-in drivers were Aisyah's own poses: they cover about six of the looks and have no teeth-on-lip or tongue-between-teeth shape. The shapes look like the person's own face speaking (an "oh", a pursed "oo", smiles with teeth, a relaxed mouth) and there is no grimace. With a matching blink for every mouth (the official eye retargeting on top) and a gentle idle sway and breathing (under one degree of turn, a pixel or two of drift, a third of a percent of scale), the owner judged a talking test made from these "much better".

**Mouth shapes.** Two public mouth-position guides and the product page of a commercial lip-sync add-on for a 3D character program, read on 2026-11-22, put the number of visibly different mouth looks of English at about twelve to fifteen (Windows' own speech system defines 22 visemes, many of which look alike on screen). The add-on's eleven shapes cover the main ones. Refinements for later: split `round` into a partly open mouth ("go") and an open one ("aw"), add `r`, split `tongue` into `th` and `l`, and split `mid` into "cat" and "bed". The pictures on those pages belong to their owners and are not used.

**What this changes.** A photo presenter is a set of pictures made once for a person and shipped with that person in a character pack, so an author never touches a model or its weights (the second decision above no longer applies to the packs' people; it would apply only to an author's own face, which is not planned). The mouth shapes come from one driver sheet: about fifteen mouth pictures, a rest and a blink of one AI-generated person, made by the owner's own picture service. One sheet drives all fifteen people.

**Still open.** (1) The licence of LivePortrait's weights is unchanged (tagged MIT, unconfirmed, issue #548 unanswered): the pictures are made with them but the weights are not shipped, and that is not settled. (2) The driver sheet has to be made. (3) How a presenter set is held in a character pack and used by the Presenter dialog is a format change (`schemaVersion`, a migration, `docs/format-spec.md`) and is not designed. (4) The faces are soft at a clip's size, because the originals are small. (5) The head does not turn.
