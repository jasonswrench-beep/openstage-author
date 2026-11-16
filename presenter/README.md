# OpenStage Presenter (the add-on's engine host)

This folder holds **OpenStage Presenter**, the optional add-on that gives OpenStage Author illustrated presenters who speak a slide's narration (`docs/presenter.md`
says what it does and how the editor talks to it; `docs/avatar-addon-spec.md` is the specification it is built from). It is a separate download so the editor stays small.

The program is `openstage-presenter`. It has no window. OpenStage Author starts it, writes one request on its standard input, reads the answer from its standard output, and it ends.
Its commands in this version: `presenter.hello`, `presenter.check` (what the computer can do), `presenter.presenters` (the illustrated presenters, as data the editor draws from), and
`presenter.mouthTrack` (the mouth shape at each moment of a WAV file: from the words and phonemes the speech engine said when it is given them, and from the sound alone when it is not). It is Rust, because it is native code that other kinds of presenter (made from a photo, later) will
need, and it has two dependencies of its own, `serde` and `serde_json`, and `windows-sys` to read how much memory the computer has. No FFmpeg.

## Double-click scripts

| Script | What it does |
| --- | --- |
| `TEST PRESENTER HOST.bat` | Runs the program's tests and the rules check. |
| `INSTALL FOR DEVELOPMENT.bat` | Builds the program and copies it with `addon.json` to `%LOCALAPPDATA%\OpenStage\addons\presenter`, where the editor looks. |
| `OPEN EDITOR WITH PRESENTER.bat` | Opens the editor with `OPENSTAGE_DEV_ADDONS=1`, because nothing can sign the add-on yet and an unsigned one is used only with that setting. |

## The rules

`tools/check_rules.py` runs on every change (the test script runs it): every dependency is under a licence that can ship in an Apache 2.0 program (no GPL, no unknown licence), none looks like FFmpeg,
every source file has its Apache 2.0 header, and the prose has no em dashes.

## Try it by hand

```
echo {"id":1,"command":"presenter.check"} | target\release\openstage-presenter.exe
```
