# Check for updates

OpenStage Author has **Check for updates...** in the Help menu, and a **Check for updates** button in the About window. It works the
same way as in the other tools of the suite.

## What it does

* **Only when asked.** Nothing is checked when the program starts or on a timer, and nothing runs in the background.
* **Notify only.** It says whether a newer version is published and, if so, offers that release's page (what changed, the checksum and
  the signed setup). It downloads and installs nothing. Running the new setup updates the copy in place and keeps courses, settings,
  the narration voice and the character packs.
* **Where it looks.** One HTTPS request from the program to
  `https://api.github.com/repos/jasonswrench-beep/openstage-author/releases?per_page=30` (no redirects followed, at most 2 MB,
  15-second timeout). Pre-releases count, because every release so far is one; drafts never do. The request carries only a plain
  name for the program (`OpenStageAuthor-update-check`); nothing about the author or their courses is sent.
* **What it compares.** The exact release this copy was built as, which the installer build records in the program (`RELEASE` in
  `tools/build_installer.py`, passed as `OPENSTAGE_RELEASE`; raise it for every release), with the highest published tag
  (`vMAJOR.MINOR.PATCH`, or `-alpha.N`, `-beta.N` or `-rc.N` after it; a final release sorts after its pre-releases). The About window
  shows the same release. A copy run from the source folder is told the newest published version instead.
* **Links.** Only a release page of this repository (`https://github.com/jasonswrench-beep/openstage-author/releases/tag/v...`) or the
  list of releases is ever offered, and it opens in the author's own browser.
* **Turning it off.** Whoever looks after the computer can set the environment variable `OPENSTAGE_UPDATE_CHECK=off`, or put a file
  called `update-check.txt` containing `off` in the program's folder. The window then says that checking is turned off on this computer
  and asks nothing.
* **Signing.** No separate update key is needed, because nothing is installed automatically. The setup itself is signed with the
  publisher's code-signing certificate, and the release page carries its SHA-256.

## Code and tests

* `editor/src-tauri/src/updates.rs` (the versions, the request, the answers, the switch) and its `check_for_updates` command in `lib.rs`;
  `editor/src/updates.ts` (reading the answer, and which pages may be opened) and the button in `editor/src/aboutdialog.ts`.
* Tests: `updates.rs` (sorting, the answers, drafts, the release pages, the switch) and `editor/src/updates.test.ts`. No test reaches the
  network.
