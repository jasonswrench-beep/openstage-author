# 0004: Packaging OpenStage Author, and the speech parts that are under the GPL

Status: **proposed, 2026-10-18. Nothing here has been built or decided. Section 6 lists what is needed from Jason.**

Two questions that cannot be separated: what an installer would carry, and whether the narration engine (Kokoro) can be part of it. The first is a
plan. The second is a choice with a licence at the bottom of it, so it is set out as options.

What is known for certain is marked **(checked)**: it was read from this repository, from the program, or from the installed packages on the main
computer on 2026-10-18. What is general knowledge about Windows, Tauri or licences, and was not re-checked today, is marked **(from general knowledge)**.
A trial installer has not been built, because building one downloads the bundler's tools and that needs a yes (section 6).

## 1. Where things stand

Today OpenStage Author runs from source. `OPEN EDITOR.bat` builds the editor the first time, which needs on the computer **(checked)**:

* Node.js (24 on the main computer; the publishing tool runs `.ts` files directly, which needs 22.6 or later) and `npm install` in `editor/` and `player/`.
* Rust and Microsoft's C++ build tools (for the editor, the recorder and the speech recogniser).
* Python 3 with `jsonschema` (3.11 on the main computer) for the checker, the migrations and the narration tool.
* Kokoro, in a Python of its own, found through `OPENSTAGE_KOKORO_PYTHON` (see `docs/narration-setup.md`).

That is fine for the people who will test it and impossible for a professor who wants to make a course. An installer is what removes it.

The editor finds its helpers by looking, in order, at an environment variable and then upward from its own `.exe` **(checked, `editor/src-tauri/src/lib.rs`)**:

| Helper | Looked for | Setting |
|---|---|---|
| Course checker, migrations, narration tool (`tools/*.py`), schema, themes, the player (`player/publish.ts`) | in the folders above the editor program | `OPENSTAGE_REPO` |
| Python | `python` on the PATH | `OPENSTAGE_PYTHON` |
| Node | `node` on the PATH | `OPENSTAGE_NODE` |
| The recorder | beside the editor, or in the repository's build folder | `OPENSTAGE_CAPTURE` |
| The speech recogniser | the `speech` folder beside the editor, or in the repository | `OPENSTAGE_WHISPER` |
| Kokoro's Python | only the setting | `OPENSTAGE_KOKORO_PYTHON` |

The consequence: **an install folder laid out like the repository (the `.exe` at the top, with `tools`, `schema`, `player`, `themes`, `speech` beside it) should work
with no change to the program.** That is an expectation, not a result; it is the first thing a trial installer would settle.

## 2. What an installer would carry

Sizes are measured on the main computer where they say so **(checked)**; the others are estimates **(from general knowledge)** to be replaced by measured ones.

| Part | Size | Licence | Plan |
|---|---|---|---|
| The editor program | 13.5 MB | Apache-2.0, with the crates in `editor/THIRD-PARTY.md` | Carry it. |
| The recorder (`openstage-capture.exe`) | 3.7 MB | Apache-2.0, crates in `capture/THIRD-PARTY.md` | Carry it. |
| `tools/`, `schema/`, `themes/`, `third-party/`, the examples | small | Apache-2.0 (Lucide: ISC) | Carry them. |
| The player and the publishing tool (`player/`) | about 15 MB without the test files; `esbuild`'s program is 11 MB of it | Apache-2.0; fflate and esbuild are MIT | Carry the player's source and only the packages publishing needs. |
| Python | about 10 MB for the embeddable zip, plus `jsonschema` and its four dependencies | Python Software Foundation licence; the packages are MIT **(checked: jsonschema, attrs, referencing, rpds-py, jsonschema-specifications)** | Carry it, so no one has to install Python. Point `OPENSTAGE_PYTHON` at it. |
| Node | tens of MB (`node.exe` alone is probably enough) | MIT | Carry it, for the same reason. |
| The speech recogniser (`whisper-cli.exe` and its DLLs) | 0.8 MB, plus about 13 MB of DLLs **(checked)** | MIT | Build it once on the build computer and carry the result. It is built today by `BUILD SPEECH RECOGNISER.bat`. |
| A Whisper model | 148 MB or 488 MB | MIT | **Not carried.** Downloaded when the author chooses, with the question and the checksum that already exist. |
| Kokoro and its model | PyTorch alone is hundreds of MB | Kokoro: Apache-2.0; see section 5 | **Not carried** (section 5). |
| WebView2 | | Microsoft | Not carried. Windows 11 has it. For older Windows the installer can fetch Microsoft's small bootstrapper **(from general knowledge)**. |

Estimated total: about 100 to 150 MB, mostly Node. The reply to "why is it that big" is that it carries its own Node and Python so that nothing else needs installing.

## 3. The installer itself

Tauri's bundler makes two kinds **(from general knowledge)**: an `.exe` setup built with NSIS, which can install for one user with no administrator
password, and a `.msi` built with WiX, which IT departments like for managed computers. It needs its tools downloaded the first time it runs.

**Recommendation:** NSIS, installing for the current user, first. Add the `.msi` only if SUNY IT asks for it. Resources (the folders in the table) are listed in the
bundle settings and land beside the program. Nothing else in the program needs to know it is installed.

Things to settle in the trial, not now: that the program finds its helpers in the install folder; that Publish and Preview work from an install folder with no Node or
Python on the PATH; that the recorder and the speech recogniser start; that a project made by the installed program opens in the one built from source.

## 4. Signing, updates, data, uninstalling

* **Signing.** An installer with no signature makes Windows show "Windows protected your PC" and a warning about an unknown publisher **(from general knowledge)**.
  Signing needs a certificate or a signing service, which costs money every year; I have not looked at current prices. *Recommendation:* ship the first installers unsigned to
  colleagues who are told to expect the warning and how to continue, and decide on signing before it goes to people who were not told.
* **Updates.** None to begin with: a newer installer replaces the older one. A project made by an older version is brought up to date by the program's own migration (that exists).
  A self-updating program is possible later and needs a signing key of its own.
* **Where things live.** Settings (including service keys) are in the program's settings folder; speech models are in `%LOCALAPPDATA%\com.openstageauthor.editor\speech-models` and can be
  hundreds of MB; the author's projects are in folders of their choosing. *Uninstalling* removes the program and asks whether to remove settings and models. It never touches a project.
* **A release gate.** `CLAUDE.md` says what has to pass before a release (the LMS tests, the screen reader pass). The installer is the last step, not an excuse to skip them.

## 5. The GPL speech parts

OpenStage Author is Apache-2.0, and `CLAUDE.md` treats a copyleft licence as a hard stop for anything linked, vendored or copied; running a GPL tool that the user installed,
as a separate process, is a different question. `ROADMAP.md` says the installer must not bundle GPL components such as espeak-ng or phonemizer-fork.

**What was found in the installed packages (checked, 2026-10-18):**

* `kokoro` 0.9.4 and `misaki` 0.9.4 are Apache-2.0. The Kokoro-82M model is Apache-2.0 (as stated in `NOTICE`).
* `misaki[en]`, which is what `kokoro` asks for, pulls in `phonemizer-fork` (GPL-3.0 or later) and `espeakng-loader` (it carries espeak-ng's data and library; espeak-ng is GPL-3.0 **from general knowledge**), as well as `spacy` (MIT) and `num2words` (LGPL).
* `kokoro/pipeline.py` does `from misaki import en, espeak` among its first lines, and `misaki/espeak.py` imports `phonemizer` and `espeakng_loader` without any fallback. So **Kokoro 0.9.4 cannot be loaded at all without the GPL packages being there**, even for English.
* For English, espeak-ng is only used for a word that is not in Kokoro's own dictionary, and the code even expects it to be unavailable at that point (it then logs "OOD words will be skipped"), although the import above stops it before it gets that far. For Spanish, French, Hindi, Italian and Portuguese espeak-ng is used for everything.
* Other local voice engines on the same computer: `piper-tts` 1.4.2 is GPL-3.0 or later; `coqui-tts` is MPL-2.0 (and its own needs were not looked at).

**Options:**

**A. Keep it separate, and make the setup easy.** What `NOTICE` and `README.md` already say. OpenStage includes none of it; the author installs the engine on their own computer
(`docs/narration-setup.md`) and the editor runs it as a separate program. Optionally, a `SET UP NARRATION.bat` that runs `pip` for them after asking, so the author's own computer does
the downloading and OpenStage hands out nothing. *For:* no obligations from the GPL for OpenStage; nothing to change. *Against:* a setup step with a very large download for people who are
not technical; I have not tried an installation from a clean computer.

**B. A Kokoro without the GPL parts, English only.** Kokoro would have to be changed (its imports) or loaded with stand-ins for the two GPL packages, since it will not load without them.
The English voices would then skip any word not in the dictionary, which for a course means names, places and terms such as *SUNY* or *Brightspace*. The pronunciation list in the editor
could cover some. *For:* a bundle with no GPL, if it works. *Against:* a patched Apache program to maintain; quality unknown until tried (a trial like the Whisper one would settle it); English only.

**C. Another local voice with no GPL parts.** Candidates were not looked at in this note; Piper is out (GPL). Needs a search and a trial, as the Whisper choice had.

**D. Carry the GPL parts and meet the GPL.** Possible in law as a separate program shipped beside OpenStage with its licence text and an offer of its source. It reverses the rule in
`ROADMAP.md`, adds obligations, and would still need the 300 MB or more of PyTorch. I would not choose this.

**E. Let online voices be the easy path.** OpenAI voices are already built, need no installation, and cost money per use (and with the 2026-10-18 change, not twice for a new language). Kokoro
stays the free choice for the author who is willing to install it.

**Recommendation:** A for the first installer, with E as the path with nothing to install, and with the setup script only if you want it. Treat B and C as a later trial if installing Kokoro
turns out to be too hard for the people it is for. Nothing in `NOTICE` or `README.md` needs to change for A.

## 6. What is needed from Jason

1. **The GPL choice** (section 5): A (recommended), or ask for a trial of B or C, or something else.
2. **Whether to write `SET UP NARRATION.bat`** (A only). It would download PyTorch and the voice, so each run needs a yes from whoever runs it.
3. **Signing** (section 4): ship unsigned to colleagues first (recommended), or look at what signing costs now.
4. **Per-user NSIS first** (recommended), or an `.msi` as well.
5. **A yes to build a trial installer.** It downloads the bundler's tools (NSIS, and WiX if an `.msi` is wanted), the embeddable Python (about 10 MB) and Node (tens of MB). It would be tried
   on this computer, with the program started in a folder that has no repository above it, which is the real test of section 1.
6. **The name and the domain** (`openstageauthor.com` is not registered; only Jason can register it). The installer's publisher name and the program's identifier
   (`com.openstageauthor.editor`) should be settled before the first installer, because the identifier names the folders in section 4.

Until then the repository is ready for people who build it from source. The things in `ROADMAP.md` "Before the repository goes public" that did not need a decision are done.
