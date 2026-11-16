# OpenStage Author Presenter Avatar Add-on Spec

Nov 15, 2026 · Jason Wrench

*Saved into the repository on 2026-11-16 from the Word document "OpenStage Author Presenter Avatar Add-on Spec". The words, tables and links are the document's own. The Word original also has a small diagram (the editor, the engine host and the four engines); its caption is kept below and the diagram is not reproduced. Where this specification meets a rule in `CLAUDE.md`, the build plan in `ROADMAP.md` says so.*

## Purpose and scope

The Presenter Avatar add-on lets an OpenStage Author user turn a script and one photo into a talking presenter clip that drops onto a slide as an ordinary video object. It is a separate, optional download, so the core program stays small and fast for people who never use it.

What it does:

- Builds a presenter from a single front-facing photo, or from a short reference video.
- Turns slide narration text into speech with a chosen voice.
- Renders the presenter speaking that audio, matched to the lips.
- Places the result on the slide as a video with captions, ready for the player and SCORM export.

What it does not do in version 1: live, real-time avatars in the published course, full-body animation, or gestures beyond natural head movement. The published course only ever plays ordinary video, so learners need no special hardware.

Why an add-on: the AI models run from about 300 MB to several GB and some need a graphics card. Keeping them out of the core installer protects the program's install size, start time and license simplicity, and lets the add-on update on its own schedule as the open source models improve. In this spec, "commercial avatar-video services" means the paid hosted tools that offer this today; the add-on aims for comparable presenter clips on the user's own computer, for free.

## Research summary: talking-head models

The safest strong pick for an 8 GB graphics card is JoyVASA for head and face motion feeding LivePortrait as the renderer, both MIT licensed, with an optional MuseTalk 1.5 pass to sharpen the mouth. Licenses were read from each project's LICENSE file, README and Hugging Face model card on 2026-11-15; exact last-commit dates could not be read, so activity is the latest dated entry in each README.

The biggest trap is a hidden dependency: the InsightFace face-detection models (buffalo_l, det_10g, 2d106det) are non-commercial. [LivePortrait's license](https://github.com/KwaiVGI/LivePortrait) says so and tells commercial users to replace them. They also ship inside Ditto, JoyVASA, Hallo, MEMO and LatentSync's inference code. Because the add-on is redistributed, every pipeline must swap that detector for MediaPipe or another permissive one, as [FasterLivePortrait](https://github.com/warmshao/FasterLivePortrait) already does with its --mp option.

Candidates that can be redistributed (after the detector swap where noted):

| Model | Code / weights license | Input | Head motion | Min video memory | CPU | Activity | Fit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [JoyVASA](https://github.com/jdh-algo/JoyVASA) | MIT / MIT; swap detector | photo + audio | yes | 8 GB (tested on a Windows 11 RTX 4060 laptop) | no | Dec 2024 | Standard tier motion |
| [LivePortrait](https://github.com/KwaiVGI/LivePortrait) via [FasterLivePortrait](https://github.com/warmshao/FasterLivePortrait) | MIT / MIT; use the MediaPipe option | photo + motion (from JoyVASA) | yes | about 4 to 6 GB (unverified) | runs, "extremely slow" per author | Jun 2025 | Standard tier renderer; ONNX and a Windows bundle exist |
| [MuseTalk 1.5](https://github.com/TMElyralab/MuseTalk) | MIT; README says usable "even commercially" | video or still + audio | no, mouth only | 4 GB (8 s of video took about 5 min on an RTX 3050 Ti laptop) | no | Apr 2025 | optional lip polish pass |
| [Ditto](https://github.com/antgroup/ditto-talkinghead) | Apache 2.0; swap detector | photo + audio | yes | unverified; needs TensorRT, Ampere or newer | no | Nov 2025 | benchmark candidate; real-time on server cards |
| [SoulX-FlashHead](https://github.com/Soul-AILab/SoulX-FlashHead) | Apache 2.0 (Pro); Lite includes an Open-RAIL-M part | photo + audio | yes | unverified | no | Feb 2026 | benchmark candidate; 10.8 fps (Pro) on an RTX 4090 |
| [EchoMimic V3 Flash](https://github.com/antgroup/echomimic_v3) | Apache 2.0 / Apache 2.0 | photo + audio | yes | 12 GB | no | Jan 2026 | Studio tier, better quality |
| [MiniMates](https://github.com/kleinlee/MiniMates) | MIT per README (no LICENSE file; weights unverified) | photo + audio | mostly face | none; about 10 to 11 fps on desktop and laptop CPUs, 18 fps on Intel UHD 770 | yes | Oct 2024 | CPU photo option, if its license checks out |
| [InfiniteTalk / MultiTalk](https://github.com/MeiGen-AI) | Apache 2.0 | photo or video + audio | yes, upper body | 480p on one RTX 4090 in low-memory mode | no | 2025 | Studio tier, long clips, very slow |
| [SadTalker](https://github.com/OpenTalker/SadTalker) | Apache 2.0 / MIT; 3D face model files unverified | photo + audio | yes, stiff | about 4 to 6 GB (unverified) | slow | Jun 2023, stale | not recommended |

Ruled out for a redistributed free tool:

| Model | Why |
| --- | --- |
| [Wav2Lip](https://github.com/Rudrabha/Wav2Lip) original weights | README limits them to personal, research and non-commercial use; low-resolution mouth |
| [LatentSync](https://github.com/bytedance/LatentSync) 1.5 / 1.6 | best open lip sync, but openrail++ weights carry use rules that must be passed on, InsightFace at inference, and 1.6 needs 18 GB |
| [FLOAT](https://github.com/deepbrainai-research/float), [Sonic](https://github.com/jixiaozhong/Sonic), [KDTalker](https://github.com/chaolongy/KDTalker), [AvatarForcing](https://github.com/TaekyungKi/AvatarForcing) | Creative Commons non-commercial licenses |
| HunyuanVideo-Avatar | community license that does not apply in the EU, UK and South Korea |
| Duix-Avatar | extra commercial terms above 1,000 monthly users; needs a container runtime and a large GPU |
| Hallo 1 / 2 / 3, MEMO | 24 to 80 GB class hardware; Hallo3 weights follow CogVideoX terms; InsightFace |
| FantasyTalking, OmniAvatar, Wan2.2-S2V, LiveAvatar | Apache licensed but built on 14-billion-parameter video models; hours per minute on home hardware |

The field moves fast: two of the candidates above were released in 2026. The model catalog in the add-on should be able to add a new model without a new installer.

## Research summary: voices and lightweight avatars

Kokoro-82M should be the default voice: Apache 2.0 for code and weights, small, fast on an ordinary CPU, and able to give phoneme timing for the mouth. A second cross-cutting trap is eSpeak NG, which is GPL-3.0 and sits under Piper and several other engines; any GPL engine must run as its own separate program, never linked into the Apache 2.0 add-on.

| Voice engine | Code / weights license | Bundle? | CPU | Voice cloning | Role |
| --- | --- | --- | --- | --- | --- |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) | Apache 2.0 / Apache 2.0 | yes | yes, about 330 MB | no, 54 preset voices | default voice, 8 languages |
| [Kitten TTS](https://github.com/KittenML/KittenTTS) nano | Apache 2.0 / Apache 2.0 | yes | yes, 8 to 17 MB | no | weakest-laptop voice |
| [Piper](https://github.com/OHF-Voice/piper1-gpl) | GPL-3.0 engine; each voice has its own dataset license | yes, as a separate program, only voices listed as commercial-safe in its own docs | very fast, about 60 MB per voice | no | optional multilingual pack (35 languages) |
| [Chatterbox](https://github.com/resemble-ai/chatterbox) | MIT / MIT; every output carries an inaudible watermark | yes | Nano model yes; larger models want a GPU | yes | optional cloned voice |
| [Pocket TTS](https://github.com/kyutai-labs/pocket-tts) | MIT code; weights CC-BY-4.0 with a no-cloning-without-consent clause | yes, with attribution | yes, faster than real time on 2 cores | yes | alternative cloned voice |
| [MeloTTS](https://github.com/myshell-ai/MeloTTS) / OpenVoice v2 | MIT | yes | yes | OpenVoice yes | fallback option |
| XTTS-v2, F5-TTS, Fish Speech, Higgs Audio, VibeVoice | non-commercial, research-only or revenue-capped weights | no | mixed | yes | do not bundle |

Timing for the mouth: Kokoro's phoneme durations can drive mouth shapes directly. For a recorded human narration, [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) (MIT, Windows command-line tool) turns audio plus the script into timed mouth shapes. Avoid aeneas and whisper-timestamped (both AGPL-3.0) and a headset maker's proprietary lip-sync SDK (licensed only for its own products).

| Lightweight avatar approach | License | Runs on | Role |
| --- | --- | --- | --- |
| 2D mouth-swap sprites on canvas | own artwork | any CPU | Lite tier default |
| [Inochi2D](https://github.com/Inochi2D) puppets rendered by Inox2D (Rust, WebGL) | BSD-2; project branding may not be reused | any computer with WebGL | Lite tier upgrade; fits the Tauri editor |
| [TalkingHead](https://github.com/met4citizen/TalkingHead) 3D heads | MIT; one sample avatar is non-commercial, another is CC0 | modest GPU, WebGL | possible later 3D style |
| VRM through [three-vrm](https://github.com/pixiv/three-vrm) | MIT; each model file carries its own use and redistribution flags | modest GPU | possible later 3D style, check each model's flags |

Could not be checked from a primary source: exact last-commit dates, measured CPU speed for Kokoro and MeloTTS, and the weight license for MiniMates. These go on the Phase 0 checklist.

## Recommended tiered approach

Build three local tiers that share one voice engine and one output format, and leave cloud as an optional remote engine the user points at themselves. Every tier ends as the same video file on the slide, so a course built on a strong desktop plays the same on a learner's phone.

| Tier | Look | Runs on | Pipeline | Speed target |
| --- | --- | --- | --- | --- |
| Lite | illustrated 2D presenter (mouth-swap sprites, later Inochi2D puppets) | any Windows laptop, CPU only | Kokoro or Kitten voice, phoneme timing to mouth shapes, drawn in the editor's own WebView canvas, captured to video | faster than real time |
| Standard | the user's photo, talking with natural head motion | dedicated GPU with 4 to 8 GB, or integrated graphics as a slow batch | Kokoro voice, JoyVASA turns audio into face motion, LivePortrait renders the photo, ONNX Runtime on Windows ML | a few minutes per minute of video on 8 GB (to confirm in Phase 0) |
| Studio | sharper mouth and richer expression | NVIDIA with 8 GB for the lip pass, 12 GB or more for EchoMimic V3 Flash | Standard output plus a MuseTalk 1.5 lip pass, or EchoMimic V3 Flash; InfiniteTalk for long clips | slow; meant for overnight queues |
| Remote (optional) | same as Standard or Studio | any computer with a network connection | the same engine host running on another machine, such as a lab workstation or a rented GPU server, reached over an encrypted link with a key | depends on that machine |

Why this split:

- The Lite tier means nobody is locked out. A friendly illustrated presenter suits many courses and needs no AI video model at all.
- The Standard tier is where most users with a gaming laptop or a desktop graphics card will land, and its whole chain is MIT or Apache licensed.
- The Studio tier holds anything that needs PyTorch and CUDA, so the Standard tier never has to ship a multi-gigabyte Python runtime.
- The Remote engine avoids building against any one hosted company's API. A user who wants cloud speed rents a GPU machine and runs the same engine host on it. Hooks for commercial avatar-video services are left out of version 1 on purpose: they would send faces and voices to third parties and tie the free tool to paid accounts.

If MiniMates' weight license checks out in Phase 0, it becomes a photo option inside the Lite tier, since it reports 10 to 18 frames per second on ordinary CPUs and integrated graphics.

## Install and plug-in architecture

The add-on is its own signed installer that drops a small engine host next to OpenStage Author; no model is downloaded until the user first asks for an avatar. The core program only needs a thin plug-in contract and a "Presenter" button that stays hidden until the add-on is present.

Parts:

- **Plug-in contract in OpenStage Author.** On start, Author looks for %LOCALAPPDATA%\OpenStage\addons\*\addon.json. The manifest names the add-on, its version, the Author versions it supports, the engine host executable, and the commands it offers (presenter.createAvatar, presenter.speak, presenter.render, presenter.cancel). Author shows the Presenter panel only when a valid, signed manifest is found.
- **Engine host (openstage-presenter.exe).** A separate process, so a crash, a long render or a memory spike never takes the editor down. Author starts it on demand and talks to it as JSON messages over standard input and output (the same pattern Tauri uses for sidecars). Progress, cancel and errors stream back as messages.
- **Engines.** The host loads one of three engines, chosen by the hardware check: the Lite engine (2D puppet, CPU), the Standard engine (photo animation through ONNX Runtime, which works on NVIDIA, AMD and Intel graphics on Windows without a separate CUDA install; build on Windows ML, since Microsoft says DirectML "is in sustained engineering" and new work has moved to Windows ML, with DirectML kept as the fallback for older Windows 10 machines), and the optional Studio pack (an embedded Python runtime with PyTorch and CUDA, for the heaviest, best-quality models on NVIDIA cards). Each engine is its own download.
- **Model manager.** Models are fetched on first use from their official Hugging Face repositories, resumable, each checked against a SHA-256 hash pinned in the add-on's model catalog. Before any download the user sees the model's size, its license in plain words, and where it comes from. Models live in %LOCALAPPDATA%\OpenStage\models\ and can be removed from a Manage Models screen.
- **Updates.** The add-on uses the same signed update channel as the rest of the suite, separately from Author. The model catalog is a small signed JSON file, so a better model can be offered without shipping a new installer.

add-on architecture · editor, engine host, four engines

Author only ever talks to the engine host; the host picks the engine the hardware check allows and returns one finished clip.

Install sizes (targets): add-on installer under 60 MB; Lite engine with one voice about 150 MB; Standard engine plus models about 1 to 2 GB; Studio pack 4 to 8 GB.

On Mac, the Lite engine and text-to-speech should work from the start; the Standard engine can follow through ONNX Runtime's CoreML support; the Studio pack stays Windows and NVIDIA only.

## From photo and script to a slide

A user goes from photo to finished slide in four steps, and every step keeps its inputs so the presenter can be re-rendered when the script changes.

- **Create a presenter.**
- Standard and Studio: the user picks one front-facing photo (at least 512 by 512 pixels, face fully visible, neutral mouth) or a 5 to 10 second clip. The add-on checks for exactly one clear face with MediaPipe and warns about glasses glare, a turned head or a mouth already open.
- Lite: the user picks a built-in illustrated presenter, or imports a set of mouth images or an Inochi2D puppet.
- The presenter is saved as a .osavatar package: the source image, the face crop, cached face features, the default voice, and the consent record (see Privacy and consent). Presenters can be reused across courses.
- **Script to speech.**
- The text comes from the slide's existing narration or notes field, so it reuses the narration Author already holds.
- The user picks a voice, speed and pitch, previews a sentence, and can add pauses and pronunciation fixes with a small markup (a pause tag and a "say it as" tag).
- Output is a WAV file plus word and phoneme timings. The user can instead supply their own recorded narration; then timing comes from Rhubarb for the Lite tier, and from the audio itself for the photo tiers.
- **Render.**
- Lite: mouth shapes, blinks and a gentle idle sway are drawn on a canvas and encoded to video.
- Standard: JoyVASA turns the audio into motion, LivePortrait animates the photo, the face is pasted back into the full frame.
- Studio: an optional MuseTalk lip pass, or a full EchoMimic V3 Flash render.
- All tiers render at 512 or 720 pixels tall at 25 frames per second, then encode with an LGPL build of FFmpeg.
- **Place on the slide.**
- The result arrives as a new Presenter object: a video with the audio, WebVTT captions made from the script timing, and a poster frame.
- Framing choices: full rectangle, rounded corner box, or circle crop. A transparent cutout (background removed with a permissively licensed matting model) is an option, exported as WebM with alpha for browsers that support it and an opaque copy as the fallback.
- The object keeps a link to its presenter, voice and script. If the script changes, the object is marked out of date and offers a one-click re-render.
- The published course and SCORM package contain only the video, captions and poster, so learners need nothing extra.

The Presenter object is a normal Author media object with an extra presenter block in the project format, so a course still opens and plays on a computer without the add-on; it just cannot re-render.

## Hardware detection and fallbacks

The add-on checks the computer once at install and again before each render, then offers only the tiers that will finish in reasonable time. The user can always pick a lower tier; a higher one is shown greyed out with the reason.

What it checks:

- Graphics card vendor, model and dedicated video memory (through DXGI on Windows), plus the driver version.
- System memory and free disk space in the models folder.
- Whether an NVIDIA card can run CUDA, for the Studio pack.
- A 10-second benchmark the first time a tier is used, stored so later estimates show real minutes, not guesses.

How it decides (starting thresholds, to be tuned from the benchmark):

| Machine | Tiers offered | Default |
| --- | --- | --- |
| No dedicated GPU, under 8 GB RAM | Lite | Lite |
| Integrated graphics, 8 GB RAM or more | Lite, Standard (slow, overnight batch) | Lite |
| Dedicated GPU with 4 to 6 GB video memory | Lite, Standard | Standard |
| NVIDIA GPU with 8 GB video memory or more | Lite, Standard, Studio | Standard |
| Any machine, cloud enabled by the user | adds Cloud | unchanged |

Fallbacks while rendering:

- Out of video memory: the job retries once at a lower resolution or smaller batch, then offers the next tier down.
- A render longer than the user's time limit (default 30 minutes per clip): the add-on warns before starting and offers to queue it.
- Any engine failure: the slide keeps its audio and captions, and the presenter placeholder shows a still of the photo, so the course still works.

Renders run in a queue, one at a time, and can continue while the user keeps editing. Each finished clip is cached by a hash of its photo, voice, script and settings, so unchanged slides never re-render.

## Licensing obligations

The add-on itself stays Apache 2.0; models are downloaded by the user from their own publishers, never re-hosted, and each one passes a license gate before it enters the catalog. Shipping only a downloader keeps the add-on's own license clean, but the catalog still must only list models that allow free and commercial use, because course authors may sell their courses.

Rules for the model catalog:

- Allowed licenses for code and weights: MIT, Apache 2.0, BSD, CC0 and CC-BY (with attribution shown in the add-on's About screen and in an ATTRIBUTIONS.txt beside each model).
- Not allowed: any non-commercial, research-only, no-derivatives or revenue-capped license, and any community license with regional exclusions.
- OpenRAIL-style licenses (with use restrictions that must be passed on) need a decision before entry; the default is to leave them out.
- Every pipeline's face detector must be MediaPipe or another permissive detector, never the InsightFace pretrained models.
- GPL tools (eSpeak NG, Piper) run only as separate programs, with their source offered, never linked into the add-on.
- FFmpeg ships as an LGPL build, called as a separate program.
- A license check script in the build (like the existing license rule checker) fails the build if a catalog entry's license is not on the allowed list.

## Privacy and consent

Everything runs on the user's computer by default: no photo, voice, script or video leaves the machine unless the user sets up a Remote engine themselves.

- **Consent for a real face.** Creating a photo presenter requires a tick box: "This is me, or I have written permission from this person to create a talking likeness of them." The add-on records the date, the answer and the name typed for the person in the .osavatar file. A presenter made from someone else's photo shows a reminder each time it is used.
- **Consent for a cloned voice.** Voice cloning (optional, Phase 3) needs the same tick box, plus a short consent sentence read aloud by the speaker in the reference recording, which the add-on checks with speech recognition before it accepts the voice.
- **Disclosure.** Each rendered clip carries a small, removable "AI presenter" label in the corner by default, and the course's accessibility notes state that the presenter is synthetic. Cloned voices from Chatterbox also carry its built-in inaudible watermark.
- **No impersonation presets.** The add-on ships no likenesses of real public figures. It cannot technically stop misuse, so its help pages and first-run screen state that making a likeness of someone without consent is not allowed.
- **Storage.** Presenter files stay in the user's project or presenters folder; deleting a presenter deletes its photo and cached face features. No telemetry about faces or voices.
- **Institutional use.** A one-page plain-language note for campuses covers consent forms for faculty and student likenesses and how to remove a presenter later.

## Phased build plan

Build the voice and the Lite tier first, because they prove the whole plug-in path on any computer before any heavy model is involved. Each phase ends at a gate that must pass before the next starts.

- **Phase 0: proof and license check.** Run JoyVASA plus LivePortrait with the MediaPipe detector on an 8 GB NVIDIA card and on a laptop with integrated graphics. Confirm JoyVASA exports to ONNX, measure Kokoro on a plain CPU, and confirm the MiniMates weight license. Gate: a 1-minute clip renders on the 8 GB card with lips in sync, and every model in the plan passes the license rules.
- **Phase 1: plug-in contract, voice and Lite tier.** Add-on manifest and discovery in Author, the engine host, Kokoro and Kitten voices, mouth-swap presenter, Presenter object with captions and re-render. Gate: a full course with a Lite presenter publishes to SCORM from a laptop with no graphics card.
- **Phase 2: Standard tier.** Model manager with license screen and checksums, hardware check and benchmark, Windows ML engine for JoyVASA and LivePortrait, render queue and cache, framing and cutout options. Gate: a non-technical tester creates a photo presenter without help.
- **Phase 3: Studio pack and voices.** Embedded Python and CUDA pack, MuseTalk lip pass, EchoMimic V3 Flash, Piper multilingual pack, voice cloning with consent checks. Gate: the Studio pack installs and uninstalls cleanly beside the Standard tier.
- **Phase 4: reach.** Remote engine, Mac build of the Lite and Standard tiers, Inochi2D puppets, and Presenter support in OpenStage Scroll.

## Open decisions

Each item has a default the build can follow unless you choose otherwise.

| Decision | Default |
| --- | --- |
| Name of the add-on | OpenStage Presenter |
| Which tier ships first | Lite tier and voice first (Phase 1), photo tier second |
| Voice cloning | not in the first release; Phase 3, with spoken consent check |
| Cloud | Remote engine only (the user's own machine or rented GPU); no hooks for hosted avatar services |
| Models under OpenRAIL-style licenses (for example LatentSync) | leave out of the catalog |
| "AI presenter" label on clips | on by default, removable per clip |
| Transparent cutout presenters | Phase 2, with an opaque fallback copy |
| Artwork for Lite presenters | three or four simple illustrated presenters made for the project and released as CC0 |
| Share the engine host with OpenStage Studio | yes, so tutorial videos can use the same presenters and voices |
| OpenStage Scroll support | Phase 4, using the same Presenter object |

## Sources

Read on 2026-11-15. Repositories and model cards are linked in the tables above; these pages set the platform and license points.

- [ONNX Runtime DirectML execution provider](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html)
- [Microsoft DirectML overview](https://learn.microsoft.com/en-us/windows/ai/directml/dml)
- [LivePortrait license and InsightFace note](https://github.com/KwaiVGI/LivePortrait)
- [MuseTalk model card](https://huggingface.co/TMElyralab/MuseTalk)
- [Kokoro-82M model card](https://huggingface.co/hexgrad/Kokoro-82M)
- [Piper (GPL edition)](https://github.com/OHF-Voice/piper1-gpl)
- [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync)
