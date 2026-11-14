# Addendum to HANDOFF.md (2026-10-15, afternoon)

Written by the AI assistant session that worked with Jason on a second PC (the university work PC) after `HANDOFF.md` was written. Give a new instance `HANDOFF.md` first, then this file. Where they differ, this file wins, and the repository wins over both. Everything here is checked against GitHub `main` at commit `da2121c`. Nothing from the work PC is unpushed or uncommitted.

Suggested first message to the new instance:

> Read HANDOFF.md, then HANDOFF-ADDENDUM-2026-10-15.md, CLAUDE.md and the "What is left" part of ROADMAP.md. Tell me in a few plain sentences where things stand, then wait for me to say what to do.

## Pull first

On the main PC (`D:\Documents\OpenStage`) run `git pull`. Three commits were pushed to `main` after `36cd4c5`:

- `1a30b08` Roadmap: an editor-built package imported into the institution's LMS.
- `2e9f647` Publish: the empty `.gitkeep` files are left out of the package's `source/` copy (`player/publish.ts`, a new test in `player/src/publish-cli.test.ts`, a line in `docs/format-spec.md`).
- `da2121c` The release gate reworded (below), the results sheet and roadmap brought up to date, the `TEST AI SERVICES.bat` item ticked.

## Decided by Jason today

- **Release gate wording** (now in `CLAUDE.md`): "Course completion and assessment success are both reported as correctly as SCORM 1.2 can express them, and are fully separate in SCORM 2004 (later)." SCORM 2004 output is not built. The roadmap's held "real LMS test" item no longer waits on this question. It still waits for Jason to say everything is ready, and the packages in `dist` must be rebuilt first (`PUBLISH LMS TEST LESSON.bat`).

## Seen working today

- `TEST AI SERVICES.bat` on the work PC: the key, an OpenAI voice and an OpenAI picture all passed. The picture was a genuine, complete WebP of a red circle (32 KB). That ticks the WebP item on the roadmap's "Try in the desktop app" list.
- A new project made in the editor on the work PC ("Test Project": a title slide and a slide with a pyramid stack) was published, and the zip imported into the institution's LMS without error. Whether it was launched was not reported, so score, status and resume are still unconfirmed. That package carried three empty `.gitkeep` files and no schema files, so neither stopped the import (the `.gitkeep` files are now left out).
- The editor was built and ran on the work PC.

## Test counts at `da2121c` (work PC, fresh clone)

Python 278, 16, 87, 12, 38 all pass. Player 279 pass (0 skipped with `OPENSTAGE_PYTHON` set; the new test is the 279th). Editor `tsc` clean. Editor tests 803 with 1 expected failure, and Rust tests 82 with 1 expected failure. Both failures are the same cause: they need narration audio made by Kokoro in the git-ignored `examples/minimal.osproj/.cache/`, which a fresh clone lacks. On the main PC, where that audio exists, expect everything to pass (editor 803 with 1 skip, Rust 82).

## The second PC (does not matter on the main PC)

Jason is not an administrator there, so nothing needing administrator rights was installed. The clone is at `C:\Dev\OpenStage` (kept out of OneDrive). Tools are in `C:\Dev\tools`: Node (an unzipped copy), Rust 1.99.0 per user with rustup, a portable Microsoft C++ compiler and Windows SDK unpacked by the community script `portable-msvc.py` (Jason read it with me and accepted Microsoft's licence himself), Python 3.13 with `jsonschema`, and Git per user. Because none of it is on the system PATH, the AI assistant must load `C:\Dev\tools\rust-env.ps1` at the start of every PowerShell command, and Jason double-clicks `C:\Dev\tools\OPEN EDITOR (this PC).bat` instead of the repository's `OPEN EDITOR.bat`. `C:\Dev\tools\RUST-ON-THIS-PC.md` explains all of it. Kokoro is not on that PC. Do not copy any of this into the repository.

## Things I noticed and left alone

- `CLAUDE.md` "Current phase" still says the editor's "first slice" has started and that anything beyond it is agreed first. That is stale; the editor has far more than that. Fix it in a small change.
- The next time the editor is opened on the work PC it rebuilds first (the new test file under `player/src` is newer than the program).
- The roadmap's "Try in the desktop app" list still has seven items to try in the window (Hear this voice, Clear unused audio, Make with AI, Preview and Publish opening in Chrome, `OPEN EDITOR.bat` rebuilding, a real Freesound search, and the features of recent weeks). Two cost a little money on Jason's OpenAI account.
- Small follow-ups still open: reuse OpenAI audio when only the language changes; the `.bat` files' hard-coded a folder on the main computer path (a "before the repository goes public" item).

## Working notes that held today

- Jason's standing rules in `HANDOFF.md` all still apply: no commit or push without a yes each time (message in a file, `git commit -F`), downloads need permission, plain short reports, no em dashes.
- Pushing to the private repository from the work PC needs no new sign-in; Git Credential Manager saved Jason's GitHub login when Jason first cloned.
- When the AI assistant downloads code from outside (a script, an installer), the permission check may block it until Jason says yes in chat. Read the code first and tell Jason what it does.
