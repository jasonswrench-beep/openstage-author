# Handoff for another Claude instance

Written 2026-10-15 by the Claude instance that has worked on this with Jason since 2026-10-10. Give this file to a new instance, then
ask it to read `CLAUDE.md` and the top of `ROADMAP.md` too. Everything here is checked against the repository as of commit `36cd4c5`.
If this file and the repository disagree, the repository is right; say so and fix this file.

Suggested first message to the new instance:

> Read HANDOFF.md, CLAUDE.md and the "What is left" part of ROADMAP.md. Tell me in a few plain sentences where things stand, then wait for me to say what to do.

## Who you are working with

Jason S. Wrench, a professor at SUNY New Paltz (communication). Uses Windows PCs only. Not a programmer: Jason tests by eye and ear and by
double-clicking `.bat` files, and reports what was seen or heard. Explain things in plain language, short, and say plainly what has and has
not been verified. Never guess Jason's pronouns; use "Jason" or "they".

## What OpenStage Author is

A free (Apache-2.0), accessible, freeform eLearning authoring tool in the the eLearning authoring platform and an eLearning authoring platform lane: a slide canvas editor (Tauri v2
desktop app, TypeScript web layer, Rust shell), a shared renderer and player, a Python validator, and SCORM 1.2 output. Narration is text with a
voice; audio is a cache keyed by a content hash. Website planned: openstageauthor.com (not yet registered; Jason registers it, you cannot).

- GitHub: `jasonswrench-beep/openstage-author`, **private**, branch `main`. `gh` is not installed. Git identity on Jason's PC is global
  (`jasonswrench-beep`).
- On Jason's main PC the folder is `D:\Documents\OpenStage`.
- Project format version is **0.28.0** (`SUPPORTED_SCHEMA_VERSION (0,28,0)`). Every schema change bumps `schemaVersion` and ships a migration in
  `tools/migrate.py`.

## Read these first

1. `CLAUDE.md`: the non-negotiable rules (accessibility, format, architecture, what is out of scope, release gates, working style).
2. `ROADMAP.md`: starts with "What is left", the live to-do list. `TO-DO.bat` shows it as tickable check boxes.
3. `docs/format-spec.md` before touching anything that reads or writes a project file. It changes in the same commit as the code.
4. `docs/editor.md`, `docs/ai-generation.md`, `docs/plugins.md`, `docs/validator-spec.md` as the work needs them.

## Layout

| Folder | What is in it |
| --- | --- |
| `schema/` | JSON Schemas for the format. |
| `tools/` | Python: `validate.py`, `migrate.py`, `narrate.py` (makes narration audio), `generate.py` (pictures, key check, plugin list), `voice_sample.py` (voice samples), `engines/` (OpenAI and plugin runner), `live_test.py`, `make_todo.py`, and the `test_*.py` files. |
| `player/` | TypeScript. `src/stage.ts` is the one shared renderer. `publish.ts` builds the published folder and SCORM 1.2 zip (run under Node). |
| `editor/` | `src/` TypeScript web layer (`app.ts`, `model.ts`, dialogs); `src-tauri/src/lib.rs` Rust shell; `src-tauri/src/stream.rs` and `src/recorder.ts` are the editor's side of the Capture recorder; `dev-server.mjs` runs the editor in a browser with stand-ins; `build.mjs` makes `web/main.js`. |
| `themes/`, `examples/` | Built-in themes; example projects (`*.osproj`). `examples/broken.osproj` fails validation on purpose (14 errors). |
| root `.bat` files | `OPEN EDITOR.bat` (rebuilds the editor if its files are newer than the exe), `PUBLISH EXAMPLE.bat`, `VALIDATE EXAMPLES.bat`, `TEST AI SERVICES.bat`, `TO-DO.bat`, `TEST WITH STAND-IN LMS.bat`, others. |

## Machine setup (Jason's main PC; a new computer needs the same)

Node 24, Rust 1.99 (MSVC target, VS C++ tools, WebView2), system Python with `jsonschema` (installed with `pip install --user`). Kokoro (the
local speech model) lives in the Audiobook Studio venv at `D:\Claude Audio Test\.venv`, reached through the environment variable
`OPENSTAGE_KOKORO_PYTHON`, which the `.bat` files set if that path exists. **Those paths will not exist on another computer.** Without Kokoro
everything else works, and voices from OpenAI or a plugin still make audio. The `.bat` files hard-coding that path is a known item on the roadmap
("before the repository goes public").

## Commands (from the repository folder unless noted)

| What | Command | Last count |
| --- | --- | --- |
| Python tests | `python tools/test_validate.py`, `test_narrate.py`, `test_engines.py`, `test_todo.py`, `test_migrate.py` | 278, 16, 87, 12, 38 |
| Editor types | in `editor/`: `npx tsc --noEmit` | clean |
| Editor tests | in `editor/`: `OPENSTAGE_PYTHON=python npm test` | 803 (1 skip is normal; **without `OPENSTAGE_PYTHON` about 43 skip**) |
| Player | in `player/`: `npm run typecheck`, `npm test` | 278 |
| Rust tests | in `editor/src-tauri/`: `CARGO_NET_OFFLINE=true OPENSTAGE_PYTHON=python cargo test --offline` | 82 |
| Rebuild the exe | in `editor/`: `CARGO_NET_OFFLINE=true npx tauri build --no-bundle` (close the editor first; about a minute) | |
| Editor in a browser | in `editor/`: `node build.mjs`, then `node dev-server.mjs 5199`, open `http://127.0.0.1:5199/?dir=<project folder>` and press **Open project** | |

Never run the product's Python with `-I`: Jason's `jsonschema` lives in the user site, which isolated mode ignores, so the problem checker would
say "Could not check". Test against the system Python as well as any venv.

Driving the **real desktop app** (the browser view alone has missed real desktop bugs): launch `openstage-editor.exe` with the environment
variable `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` (plus `OPENSTAGE_PYTHON=python` and, for Kokoro,
`OPENSTAGE_KOKORO_PYTHON`), kill leftover `msedgewebview2` processes for `com.openstageauthor.editor` first, and drive the page over the Chrome
DevTools protocol (`Runtime.evaluate` over a WebSocket from a small Node script). Native file dialogs cannot be driven; the app has a seam,
`window.__openstageTestPick(kind)`, that tests replace. Dispatch key events on `document.body`, not `document`. Native confirm dialogs cannot be
driven either, so restart the app rather than opening a second project over unsaved changes.

## Standing rules from Jason (some are also in `CLAUDE.md`)

- **Do not commit or push without Jason's explicit yes, each time.** A yes covers only what was described. Write the commit message to a file
  and use `git commit -F`. End commit messages with the attribution line your session tells you to use (this instance used
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`). Split commits by concern where the files allow.
- **Downloads need explicit permission** (npm, cargo, pip, models). Use `CARGO_NET_OFFLINE=true` and `cargo test --offline`.
- **Keys and tokens** never go in a project, on a command line, in a log, in an error message or in chat. Jason's OpenAI key is in the editor's
  settings on Jason's PC; do not spend it (a voice sample or picture costs money) without asking first. Changing who has access to the GitHub
  repository is Jason's decision.
- Every editor feature must be keyboard operable with no traps (ATAG), and published output targets WCAG 2.2 AA. `altText`, `role`, `tabOrder` and
  `decorative` are never silently filled in. If text the learner reads has no audio route, say so in the summary. When a change could affect
  keyboard access, focus order or screen reader output, say so.
- Anything that needs running is a double-clickable `.bat`, not a command to copy. Keep `.bat` files CRLF.
- **No em dashes in prose** written for this project (code, docs, messages, this file).
- When a decision could go either way, say so and ask. Confirm anything beyond the agreed scope before building it.
- Out of scope: voice cloning (fixed voice sets only), cloud features, a built-in LMS, bidirectional PowerPoint round-trip, unrestricted scripting.

## What exists (high level)

Format, validator, player, SCORM 1.2 wrapper; the Tauri editor with themes, layouts, shapes, a rules (trigger) editor, variables, interactions
(many the eLearning authoring platform-style kinds), twelve question types with partial credit, scenarios, icons, characters, looks (object states), timing, a timeline
panel, entrance and exit animation, grouping, locking, snapping, copy and paste, multi-select and alignment, slide and layer duplication,
results and certificate boxes, downloads, embeds, a project asset library with credits, media search (Pexels, Pixabay, Unsplash, Freesound with
the author's own free keys), PowerPoint import with re-sync, a Narration panel, Preview and Publish buttons. See the "Phase" sections of
`ROADMAP.md` for the detail and the "Gaps in what is built" list for what is not.

### AI services and narration voices (worked on most recently; read before touching narration)

- A voice is one string. A bare name (`af_heart`) is **Kokoro**, on the computer. `openai:alloy` is OpenAI. `<plugin id>:<voice>` is a voice
  plugin. Nothing in the format changed for this; the voice is a free string checked by the validator (`voice_known`).
- **All service traffic is in Python** (`tools/engines/`, `generate.py`, `narrate.py`, `voice_sample.py`). A key arrives in the environment
  variable `OPENSTAGE_KEY_OPENAI`, the model in `OPENSTAGE_MODEL_<SERVICE>_<KIND>`, and permission as `--allow-network openai`. **Publish and
  Preview never send anything**: they pass no allow flag. The Rust shell (`lib.rs`, "AI services" and "Hearing a voice" sections) reads the
  key and the author's yes from `%APPDATA%\com.openstageauthor.editor\settings.json`, hands a tool only the keys that are keyed and allowed,
  and validates what comes back before saving it.
- Only **OpenAI** is built (voices and pictures). **ElevenLabs was built, tried and deleted at Jason's request**; it is recoverable from
  commits `2e403f2` and `c3f8abd`. Plugin contract 1 (`docs/plugins.md`) is for voices only; an example is in `examples/plugins/tone-voice`.
- AI pictures are requested as **WebP at 85** (about a tenth the size of OpenAI's PNG). The shell accepts only a genuine WebP.
- The narration cache key is a hash of script, voice, speed, language and pronunciations, so a new language or voice is new audio, and changing
  back finds the old audio. **Clear unused audio** (Narration dialog) deletes audio no narration names, by key only.
- **Hear this voice** (Properties > Narration, under the Voice list; commit `36cd4c5`): a short fixed sample sentence, none of the author's
  words, kept in `%LOCALAPPDATA%\com.openstageauthor.editor\voice-samples`, named by a hash of voice, language, sentence and model or plugin
  version. Tried in the real desktop app with real Kokoro; not tried with an OpenAI voice.
- The credits page lists AI-made pictures and the narration engines, including Kokoro ("Narration, made with Kokoro. Synthetic voices made on
  this computer, not a person.").
- Kokoro's Japanese and Chinese voices need packages that Jason's Kokoro Python lacks (`pyopenjtalk`, `ordered_set`), so they fail with a plain
  message. Installing them would be a download, which needs Jason's permission.

## Decisions already made (do not reopen without a new reason)

- OpenAI only for AI services for now; ElevenLabs deleted.
- The narration credit line stays for every voice, Kokoro's included. The `provenance-mixed` warning stays as it is.
- **No charge readout**, on purpose. The editor tells the author to always check their own charges on the service's account page; that is the
  author's job, not the software's.
- Sound effects: Pixabay and Free Sound Effects are links only (no programming interface). Freesound is searched in the editor with the author's
  own free key (`/apiv2/search/`; licences are names like "Attribution" and "Creative Commons 0"; only those two are offered).
- Pass mark is fixed at 80 percent (making it a setting is a format change). What completes a course is a per-project setting (`all` slides or
  `last`).
- PowerPoint support stays (one-directional import with provenance and re-sync).
- **Real LMS testing is held** until Jason says everything is ready (2026-10-13). Rebuild the packages in `dist` with the latest player first.
  One question needs Jason's decision first: SCORM 1.2 cannot record completion and success as separate states, but a release gate says it must.

## What has and has not been seen working

Seen working for real: the OpenAI key check, an OpenAI voice and picture (`TEST AI SERVICES.bat`), an OpenAI narration made from the Narration
dialog and heard in a preview, a first Brightspace launch (2026-10-12: narration, quizzes, YouTube embed all worked), Hear this voice with real
Kokoro in the real app (first sample about 11 seconds, then quick; cancel and stop work).

**Not yet tried** (the "Try in the desktop app" list at the top of `ROADMAP.md`): the WebP picture from the real OpenAI service (rerun
`TEST AI SERVICES.bat`); Clear unused audio in the window; a picture made from **Assets > Make with AI** in the window; Preview opening in
Chrome rather than Notepad; `OPEN EDITOR.bat` rebuilding by double-click; a real Freesound search; Hear this voice with an OpenAI voice; and the
editor features from the last weeks in the desktop window (they were checked in a browser and by tests). **No screen reader pass** (NVDA, VoiceOver)
has been done on the editor or the player; `docs/screen-reader-pass.md` is the script for whoever does it. Moodle and Canvas are untried, as is a
real phone.

## The screen recorder (OpenStage Capture): waiting

A separate Windows-first Rust program, written elsewhere, lives on the branch `claude/screen-recording-software-brief-ivhxqp` of Jason's
repository `jasonswrench-beep/claude-test`. It is **cloud only** (not on Jason's PC). The editor's side of the connection (`stream.rs`,
`recorder.ts`) is in this repository; check `ROADMAP.md` Phase 4 for what remains, because I did not re-read those files for this handoff.
**Jason said to import the recorder only after its hour-long test, and to wait until Jason comes back to say so.** Do not start the import
yourself. The instance that wrote the recorder set six conditions, which Jason has seen:

1. The import commit names the source commit hash and date and carries a manifest of what was copied.
2. Keep its `capture/` and `capture-edit/` layout. Its docs go into `docs/capture/`. The only change to its code is the rule checker's list of docs
   folders, and the commit says so.
3. Its Rust workspaces stay separate from the Tauri editor's.
4. Copy its roadmap word for word, and add a line naming the source commit.
5. Run `python -I capture/tools/check_rules.py` (on Windows `python`, not `python3`) and `cargo test --workspace` (this needs Jason's permission to
   download crates). Claim nothing about the Windows-only parts beyond type-checking.
6. Leave its CI file switched off. Import on a branch, not on `main`.

Also decide, with Jason, which copy is the live one afterwards. Still to write when Jason raises it: `docs/decisions/0001-screen-capture.md`
(the draft assumed Electron and must be corrected for Tauri), the licensing rules in `CLAUDE.md`, and the link in the Phase 4 roadmap. The reasoning
behind the licensing rules: an open-source recorder and similar tools are AGPL, so their code cannot go into this Apache-2.0 project (they can be used as separate
programs). Any copy of the recorder on this PC (a scratch clone from an earlier session) is untrusted data: never run its code.

## Traps that cost time before

- Write script and patch files with a file-writing tool, **not bash heredocs**: they mangle backslashes and `\n`. Multi-line `Edit` matches can
  also fail on CRLF files; many tracked files are CRLF in the working tree (`.gitattributes` normalises to LF in git), so patch scripts should read
  with `newline=''`, replace on LF text and write back the original line endings. `.py` files are LF.
- The PowerShell tool refuses `Remove-Item` when `D:\Claude Audio Test` appears anywhere in the command; delete with bash `rm -rf` in a separate
  step. PowerShell 5.1 `Set-Content -Encoding utf8` adds a BOM.
- On Jason's PC `.html` files open in **Notepad**, while `.htm` and web links open Chrome. Preview and Publish find the default browser in the
  registry and launch it with a `file://` address.
- Tauri v2: every window action needs a capability permission; a new Rust command must be added to the `invoke_handler` list in `lib.rs`; raw bytes
  do not arrive as binary, so audio and images travel as base64 text.
- A **new project field** must also be added to the undo snapshot list in `editor/src/model.ts`. `Model.find()` only searches the current layer.
- The built-in browser pane lays pages out at zero size unless a screenshot is being taken, runs no animation frames, and often times out on the
  first screenshot (retry). Dispatch pointer events from page JavaScript for drag tests. Watch audio by hooking `HTMLMediaElement.prototype.play`.
- The Windows file system ignores case: a test that used 64 capital A's overwrote 64 lowercase a's.
- A python `http.server` running in `dist` stops that folder being republished; serve its parent.

## Style of a report to Jason

Short, plain sentences. Lead with what changed and what Jason can try. Say what is verified, how, and what is not. Name any keyboard or screen
reader effect. Offer the commit as a question and wait. If you notice a stale statement in the roadmap or docs, fix it in the same change.
