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

* **Signing.** An installer with no signature makes Windows show "Windows protected your PC" and a warning about an unknown publisher **(from general knowledge)**. What it costs, as
  [Microsoft's own page of options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) lists it (updated 2026-08-29, read 2026-10-19):
  * **Azure Artifact Signing** (the new name of Trusted Signing): about $9.99 a month, so about $120 a year. Organizations in the USA, Canada, EU and UK, and individuals in the USA and Canada, can use it. Microsoft checks the identity first (a few business days). No hardware token.
  * **A certificate from a certificate company (OV):** $150 to $300 a year, and the key has to live on a hardware token or a cloud signing service.
  * **An EV certificate:** $400 or more a year. Since 2024 it no longer skips the warning, so it is no longer worth it for that.
  * **SignPath Foundation:** free for open-source projects that qualify ([its terms](https://signpath.org/terms)): an OSI-approved licence for everything, builds from your own source on a build service they can check, two-factor sign-in for the team, a manual approval for each release, a public page with a code signing policy, and "a certain verifiable reputation" for a program (no minimum age or popularity is stated; they decide, with no appeal). Apache-2.0 qualifies on the licence; whether a new project has the reputation is the open question.
  * **The Microsoft Store (MSIX):** free signing, and no warning, but it is a different kind of package, not a simple `.exe`.
  * **Unsigned:** free, with the strongest warning, and some organizations block it altogether.
  **None of the paid options removes the warning at once**: with any certificate, the warning fades as the program is downloaded and run by more people, and it helps to sign every release with the same identity. *Recommendation:* ship the first installers unsigned to colleagues who are told to expect the warning and how to continue; when the repository is public and has a release, apply to SignPath Foundation (free); if that is refused, Azure Artifact Signing at about $120 a year.
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

## 6. Decisions

**Jason's answers, 2026-10-19:**

1. **The GPL choice.** Jason trusts the recommendation (A, with online voices as the path with nothing to install) and added the aim: *the less people have to do extra things to get the tool to work, the better.*
2. **A setup script: no. "Just install the narration engine."** Read as: the author should not have to run a separate script or a separate installer; the program installs the narration engine itself. That is
   consistent with A, and it is how it is done without carrying any GPL file: the engine is fetched from its own publishers (PyPI, Hugging Face) onto the author's computer by a button in the editor, after a question
   that says what it is, how big it is and that parts of it are GPL; OpenStage Author's installer and website carry none of it. See section 7.
3. **Signing costs:** answered in section 4 (below), nothing decided.
4. **A simple `.exe`:** an NSIS setup program, installing for the current user, no administrator password. No `.msi`.
5. **A trial installer: yes.** Built (section 8).
6. **The domain:** openstageauthor.com is already registered.

## 7. The narration engine, installed by the program

**Built and tried on 2026-10-19 (in the trial copy, on this computer; results at the end of this section).** A section in the Narration dialog, "Narration voice on this computer", has **Install the narration voice...** and, once installed, **Remove the narration voice...**.
The question it asks says what is fetched and from where, how much, and that part of it is GPL. Then the shell runs three commands with the Python that travels with the editor: `pip install --target` of the pinned list
`tools/narration-requirements.txt` (kokoro 0.9.4, misaki[en], torch 2.5.1 from PyPI, transformers, spaCy and its English model...), a download of the voice model from Hugging Face (`config.json`, `kokoro-v1_0.pth` and the voices),
and a short check that it really speaks. They go into `%LOCALAPPDATA%\<identifier>\narration-engine` (packages, and the model in its own `HF_HOME`), so removing that folder removes everything. `engine.json` is written last; without it
the engine counts as not installed. The author's own `OPENSTAGE_KOKORO_PYTHON` still wins and is never touched. `engine.rs` (where it is, the environment, the commands: tested), `lib.rs` (`engine_status`, `engine_install` with
`engine-progress` events and Cancel through the job slot, `engine_remove`; `run_streaming` reads a command line by line), `engine.ts` (the words and the question: tested), the dialog.
**Measured on 2026-10-19:** the 92 Python packages are 313 MB of files on PyPI (torch 2.5.1 alone 203 MB), the model files 355 MB on Hugging Face, so about 670 MB to download; the finished engine folder is 2.1 GB; and pip builds
in a temporary folder first (1.4 GB seen there), so about 1.5 GB more has to be free while it runs; that folder is now inside the engine's own folder (`tmp`), on the same drive, and cleared after every install, so a stopped or failed install does not leave
1.4 GB behind in the computer's temporary folder (it did on the first run, when the program was stopped). The question the author is asked says all of that.
**First real run (trial copy, this computer, fast network): the packages took 2 minutes and the model 5 seconds; the check then failed:** spaCy needs `click`, and the newest `typer` no longer brings it in, so `import spacy` failed.
With `click` added the engine imports and speaks ("Hello." made 1.35 seconds of sound, 13 s the first time). That is why `tools/narration-requirements.txt` is now a complete lock of all 92 packages at the versions that worked, not a short list.
(`docopt`, only published as source, built without trouble in the bundled Python.) 

**What was tried, in the trial copy (its own settings and folders, so nothing of the author's was touched), with Jason's yes to the download:**

* **The whole thing from the button, from the lock:** the packages went in in about 2 minutes, the model in 5 seconds, the check that it speaks passed, the dialog then said it was installed (2.0 GB); the whole run took about 2 minutes 25 seconds on a fast network.
* **Audio with it:** the editor's own "make audio" command, run with nothing set but the editor's own engine, made audio for all five narrations of the example (6 to 7 seconds each, with exact word timings): the installed engine is found and its packages and model are used.
* **Cancel:** pressing Cancel 20 seconds in stopped it within a few seconds, said so, left nothing in the computer's temporary folder and no marker (so the engine counts as not installed), and the dialog offered to install again.
* **Remove:** on a real 1.9 GB half-finished install it took 73 seconds and said it freed 1940.5 MB. The first attempt, with the plain removal, left 1.6 GB of packages behind (Windows held something); the removal now goes on past such files, clears a read-only mark and tries again, and says which file it could not remove.
* **The question:** says what is fetched and from where, how much, where it goes, the GPL parts, and that nothing from the courses is sent; saying no changes nothing and makes no folder.
* **One run ended early with "stopped" at the start of step 2** while the trial window was on the screen and nobody had sent Cancel from the script; most likely a key press or click on the visible window. Not reproduced.

**Not tried:** a clean Windows (torch may need Microsoft's Visual C++ runtime, which such a computer may lack; neither the editor nor this was tried on a computer that has only had Windows installed), an install on a drive with little room (it needs about 2.1 GB plus 1.5 GB while it works, and the question says so), a slow or filtered network (a school network that blocks pypi.org or huggingface.co would stop it with pip's own message), Publish making audio with the installed engine (only the command the dialog uses was tried), and upgrading the engine later (the lock file changes, and installing again replaces it).

## 8. The trial installer (2026-10-19)

See the end of this note for what was tried.

### What was built and tried

* `tools/build_installer.py` (run by `BUILD INSTALLER.bat`, or `BUILD INSTALLER.bat trial`) gathers the files into `dist/installer-staging/payload`, then has Tauri's bundler make one NSIS setup program,
  `dist/installer/OpenStage Author_<version>_x64-setup.exe`, with its SHA-256 beside it. Settings for the installer are in `editor/src-tauri/tauri.installer.conf.json`; the normal development build is unchanged.
  It downloads, checked: Python 3.11.9 (the embeddable zip, against the MD5 python.org lists), Node 24.21.0 (against nodejs.org's SHA-256 list), `jsonschema` 4.26.0 and what it needs (pip), and, the first time, the bundler's NSIS.
* **Size:** 41 MB for the setup program; 141 MB once installed (Node is 90 of it). It installs for the current user, with no administrator password, and Windows' own uninstall list has it.
* **The program uses the Python and Node that came with it** (`use_bundled_helpers` in `lib.rs`: a `python` and a `node` folder beside the program, unless `OPENSTAGE_PYTHON` or `OPENSTAGE_NODE` says otherwise). Run from the repository nothing changes.
* **Tried with the trial copy** (named "OpenStage Author Trial", with its own identifier, so nothing of the real program's settings, models or shortcuts could be touched), installed silently into a scratch folder, and started with almost nothing on the PATH
  and none of OpenStage's settings: it opened a course; checking the course worked (the Python that came with it); the recorder and the speech recogniser were found beside it; Preview worked (the Node that came with it); Publish made a SCORM package; uninstalling removed the folder,
  the Start menu entry and the entry in the list of installed programs. The author's own settings and speech models were checked afterwards and were untouched.
* **Found and fixed on the way:** a folder listed with a glob in the bundler's resource list loses its folders (everything lands in one folder); a folder named with a trailing slash and a target of "" keeps them.
  The identifier is compiled into the program, so the trial and the real installer are separate compiles.
* **Not tried:** a computer that is not this one (a clean Windows, a computer with no WebView2, SUNY's managed computers); the recorder recording; Windows warning about an unsigned installer (it is unsigned); upgrading over an earlier install; an install into a folder with an unusual path.
  An uninstall while the program is running stops with an error (Tauri's own behaviour): close the program first.

## 9. Before handing an installer to other people (2026-10-19)

Four small things were finished after the first installer, because they would have caught anyone but the author out:

1. **The guides travel with the program.** Some messages say "see `docs/narration-setup.md`". The installer now carries `docs/` (without the internal notes in `docs/handoff` and `docs/capture`), `START-HERE.md` and `README.md`, and the About window can show the folder.
2. **No Microsoft Visual C++ runtime needed to start the programs.** The recorder was the only one of ours that asked for it (`vcruntime140.dll`); it is now built with the C runtime inside (`capture/.cargo/config.toml`; the editor already was, through Tauri, and has the same setting written down).
   `tools/check_imports.py` reads a finished program's import table and the installer build refuses to go on if the editor, the recorder, the speech recogniser or Node asks for the runtime. Node and the speech recogniser were found not to; Python asks for `vcruntime140.dll` but
   carries it. What still needs the runtime is PyTorch, in the narration voice: before installing it the editor looks for `msvcp140.dll` in Windows' System32 and, if it is missing, says so and offers a button that opens Microsoft's own installer page (`https://aka.ms/vs/17/release/vc_redist.x64.exe`). The runtime is not carried by the installer: Microsoft's own download is the way.
   **Not tried on a computer that lacks it** (this computer has it): the check is tested with a folder that has none, and the message and button by their words.
3. **An About window** (the About button in the toolbar): the version, whether this is an installed copy, where the program, Python, Node, the recorder, the speech recogniser, the settings and the data are, whether the narration voice is installed, the web view and Windows versions, as lines and as text to copy into a message (it holds no key and nothing from a course), with buttons to show the guides and the data folder. If the computer will not give the clipboard, the text is selected for Control C instead.
4. **Upgrading and uninstalling, tried.** Installing 0.1.1 over 0.1.0 (a trial pair, silently): one entry in the list of installed programs, at the new version; the program replaced; the author's data kept; one Start menu entry. Interactively, Windows' installer offers "Uninstall before installing" by default for an upgrade; a silent upgrade overwrites in place, so a file that a newer version no longer carries would stay (not tried).
   Uninstalling removed everything the installer put there, including `uninstall.exe`, the Start menu entry and the list entry; a file that was not the installer's (a stand-in I added) was left, as it should be. The author's settings and speech models were kept by a silent uninstall. The uninstall screen's check box (it only shows in an interactive uninstall) now reads "Also delete my settings, models, narration voice and character packs" (the last four words were added on 2026-10-20) instead of "Delete the application data", because that is what it removes:
   the settings file (with any service keys), the speech models and the narration voice, all in the program's data folders. Python's compiled copies of modules now go to the data folder too (`PYTHONPYCACHEPREFIX`), not into the install folder, so nothing is written there that the uninstaller does not know.
   **Slips found on the way:** a custom language file for the installer must not start with a byte order mark (Tauri adds its own, and two make the installer maker stop with "Invalid command"); and my own shell sets `PYTHONDONTWRITEBYTECODE`, which hid whether the compiled copies were written until I cleared it.
