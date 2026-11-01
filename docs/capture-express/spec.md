# OpenStage Capture Express: specification

Status: **Draft 1, written for hand-off.** No code exists yet. Nothing in this document has been built or run.
Written: 2026-10-31, on Jason's Windows 11 ARM64 PC, by Claude (Sonnet 5.5) in the Claude desktop app.
Audience: the Claude that builds this on Jason's other PC or PCs, with no memory of the conversation that produced it.
Branch: `feature/capture-express` (cut from `fix/say-when-saved-edit-misses-new-takes`). Nothing is committed yet.
Icon: [`assets/OpenCapture_Express.svg`](assets/OpenCapture_Express.svg), supplied by Jason.

## Contents

0. Read this first
1. The product in one page
2. Rules that already apply
3. Research: a step-guide program and the other tools
4. Product definition: screens, flows, words
5. Requirements
6. Architecture
7. Data formats
8. The capture engine
9. The editor
10. Export
11. Accessibility
12. Testing and honest status
13. Building and handing the work around
14. Roadmap
15. Risks and unknowns
16. Questions for Jason
- Appendix A: a step-guide program's shortcuts. B: a step-guide program's JSON export. C: Sources. D: Icon and brand. E: Re-running the reverse engineering. F: The kickoff prompt.

---

## 0. Read this first

### 0.1 The job

Build **OpenStage Capture Express** ("Express"): a small Windows desktop program, written in **Rust** and licensed **Apache-2.0**,
that turns what a person does on screen into a clean step-by-step guide (a screenshot per step, automatic step titles, light
annotation) and exports it as HTML, Markdown, JSON, images and an animated GIF first, then PDF, Word and PowerPoint.

It must be as easy to use as **a step-guide program** (the vendor's site), which Jason has on his desktop and likes. Jason's words about the program it
replaces: OpenStage Capture "is not as clean and the UI is more complicated. a step-guide program is easy to use." Simplicity is the product.

### 0.2 What Jason said, in order

1. Make a tool "just like" a step-guide program called **openstage capture express**, "a bit more to the point" than OpenStage Capture.
2. Use the **reverse engineer anything** MCP (REA) on a step-guide program, plus "the general design of openstage capture".
3. "Our goal will be an **Apache 2 license** and write in **rust**."
4. OpenStage Capture is "not as clean and the UI is more complicated. a step-guide program is easy to use."
5. "Most of this will **not be written on this computer**, so keep that in mind." (The code is built and run on other PCs. This
   PC is Windows 11 on ARM64, which is an unusual target. Write for x64 and ARM64 and never depend on this PC.)
6. "Your job here is really to write the spec document and be ready to hand it off to Claude on my PC."
7. Supplied the icon (an indigo viewfinder with a rounded E, on a navy tile).

### 0.3 How to start (for the Claude that builds it)

1. Read, in this order: `CLAUDE.md` (repo root), `docs/decisions/0001-screen-capture.md`, `docs/decisions/0003-steps-and-practice.md`,
   `capture/README.md`, then this document. The repo rules in `CLAUDE.md` bind this project too (section 2 lists them).
2. Put the three open decisions in section 16 to Jason in **one short message**, each with its default. If he says "your call",
   use the defaults. Do not start building on a guess about them.
3. `ROADMAP.md` is where OpenStage work is agreed. Express is not on it. Ask Jason to approve adding it, then add it.
4. Follow the milestones in section 14 in order. Milestones M1 to M4 need no Windows desktop and are verified by tests that run
   on any computer. Say so in every status report.
5. Anything Jason has to run must be a **double-clickable `.bat`** that follows the existing script rules (section 13).
6. Report like `capture/README.md` does: a table of what was run on a real Windows PC, what is written but not yet run, and what is
   not built. Never write "works" for something that only compiled.

### 0.4 Decisions: made, and proposed

| # | Decision | State |
|---|---|---|
| D1 | Apache-2.0, Rust, Windows first | **Made by Jason.** |
| D2 | Simpler and cleaner than OpenStage Capture; a step-guide program-easy | **Made by Jason.** |
| D3 | Reuse OpenStage Capture's design and crates | **Made by Jason** ("the general design"). |
| D4 | Lives in `capture-express/`, its own Cargo workspace beside `capture/`, reusing Capture's crates by path | **Proposed, not answered.** |
| D5 | Window toolkit: egui with AccessKit (pure Rust) | **Proposed, not answered.** Fallback: Tauri, as the editor uses. |
| D6 | First slice: capture, edit, export HTML, Markdown, JSON, images, GIF | **Proposed, not answered.** |
| D7 | Guide file: a folder `<name>.osguide/` | **Proposed.** |
| D8 | Typed text is read from the field, never logged key by key | **Proposed** (section 8.4). |
| D9 | Display name "OpenStage Capture Express", short "Express" | **Proposed.** The icon's title says "Open Capture Express". |

Jason was asked D4 to D6 in the Claude app and did not pick; he sent other messages instead. Ask once, as 0.3 step 2 says.

### 0.5 The evidence, and its limits

| Evidence | How it was obtained | Confidence |
|---|---|---|
| a step-guide program user manual (about 35 pages and the sitemap) | Read in a browser, 2026-10-31. The long pages were read only in part (the first 2,000 to 2,600 characters), so details deep in the GIF, PDF cover page, custom CSS and AI pages are missing. | High for documented behaviour; incomplete for the long pages. |
| "Best a step-guide program alternatives" page by a step-guide program | Read in a browser | Low to medium. A competitor's sales page; used only to find gaps. |
| a step-guide program 1.40.6 installed on this PC | Table of contents of `app.asar`, `package.json`, string search in the main bundle, string scan of the native capture addon. A small read-only script, nothing run or unpacked. | Medium. Some strings are obfuscated. No code was decompiled or copied. |
| **REA (the MCP)** | Three calls made. **None returned.** A full-asar analysis ran for a long time and was stopped by hand. An Electron-fuse check and a narrowed analysis each ended with "no response for 1800 s". The server looks wedged. Not retried, as REA's own guidance says. | The REA research is **not done**. Appendix E says what to rerun. |
| OpenStage code | Read the file lists, headers, public item names and several modules. Not built or run on this PC. | High for what the code says, none for whether it runs here. |
| Licences of candidate crates | From memory | **Unverified.** Check each with `tools/check_rules.py` before adopting it. |

The REA gap matters. This document's description of a step-guide program's internals comes from the manual and a string scan. Confirm the open
questions in Appendix E with REA once its server has been restarted, and update section 3.

---

## 1. The product in one page

**Pitch.** Click through a task as you normally would. Express writes the guide.

**The whole flow, which must stay this short:**

1. **Start.** One big button on the home screen. A small bar appears and a 3, 2, 1 counts down.
2. **Do the task.** Every click becomes a step: a picture with a marker where you clicked and a title already written, such as
   `Click "Save"`. Typing becomes one step, such as `Type "jason@example.com"`. Nothing to press between steps.
3. **Finish.** The editor opens with the steps in order.
4. **Fix what you like.** Reword a title, draw an arrow, blur a name, delete a step. All optional.
5. **Export.** Pick a format. A folder opens with the result.

**Principles (these are the "easy" in a step-guide program-easy, and they are tested in section 12):**

- P1. One obvious next action on every screen.
- P2. Good defaults. A person can use Express for a year without opening Settings.
- P3. Capture is automatic. Editing is optional.
- P4. Work is never lost. Every step is on disk the moment it exists.
- P5. Everything stays on this computer. No account, no upload, no telemetry.
- P6. Everything works by keyboard and with a screen reader.
- P7. Plain words in every message and label.

**Simplicity budget (proposed numbers; Jason to confirm):**

- Launch to capturing: at most 2 clicks.
- Finish to first export: at most 5 clicks.
- Home screen: 1 primary button, a search box, the list, a settings button.
- Capture bar: at most 3 buttons (Pause or Resume, Finish, Cancel).
- Editor top bar: Back, the title, Undo, Redo, Export.
- Export dialog: the format list plus at most 6 visible options per format; the rest sit under "More options".
- Settings, first page: at most 10 items; the rest under "Advanced".

---

## 2. Rules that already apply

These come from `CLAUDE.md` and `capture/`. They are not up for debate in this project.

**Licence and dependencies**
- Apache-2.0. Every source file starts with `// SPDX-License-Identifier: Apache-2.0` (or `#` in Python).
- Allowed dependency licences: Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause, ISC, Zlib, Unlicense, CC0-1.0, 0BSD, BSL-1.0,
  Unicode-3.0, Unicode-DFS-2016. **No GPL, no AGPL.** `CLAUDE.md` allows LGPL only when dynamically linked, but the checker's list does not include it, so treat LGPL as a stop unless Jason agrees. `tools/check_rules.py`
  enforces this from `cargo metadata` and fails the build otherwise.
- **No FFmpeg.** If it were ever needed it would be an LGPL build, dynamically linked, with the source shipped (ADR 0001).
- A new dependency needs its licence checked first and a line in `NOTICE` and in the generated `THIRD-PARTY.md`.
- **Bundled fonts and other assets are checked by hand** (the checker only reads crates). Prefer Apache-2.0 fonts (Roboto).
  egui's default bundled fonts carry OFL and Ubuntu licences that the checker would reject, so switch them off (section 6.3).

**Behaviour**
- Accessibility: ATAG applies to Express itself. Every feature is fully keyboard operable and usable with a screen reader, and no
  keyboard trap exists anywhere, including the capture bar. A feature that is not accessible is not finished. Say in each summary
  when a change could affect keyboard access, focus order or screen reader output.
- Privacy: keys are never written unless the field is known to be an ordinary text field, never for a password field. Nothing is
  noted unless the person is visibly capturing. Window titles and typed text are private (ADR 0003, decision 9).
- Nothing is erased by the software. Delete means "to the trash folder", and the person can restore it.
- The file format is the source of truth. Change `docs/capture-express/guide-format.md` (created in M1) in the same commit as the
  code that reads or writes the format. Every schema change bumps `schemaVersion` and ships a migration.
- Windows first. Other systems say plainly that they are not supported.

**Writing and delivery**
- No em dashes in prose written for the project (the checker scans for them). Plain words; explain changes in plain language.
- Anything that needs running is a double-clickable `.bat`, not a command to copy.
- When a decision could reasonably go either way, say so and ask.
- Do not describe unrun code as working. Use the status vocabulary of section 12.4.

**Express-specific**
- **No network access in version 1.** No update check, no telemetry, no crash upload, no HTTP client crate in the dependency tree.
- **Clean-room with respect to a step-guide program.** a step-guide program is commercial and proprietary. Use only behaviour and facts, never its code,
  templates, translations, artwork, icons, or file format. Do not read or write `.flgg` files. Do not use the name or look of a step-guide program.

---

## 3. Research: a step-guide program and the other tools

### 3.1 What a step-guide program is (facts, with where each came from)

- A desktop program for Windows and macOS. Version **1.40.6** is installed at `C:\Program Files\a step-guide program`. [install]
- Built with **Electron**, with a Vue 2 interface (Vue, Vuex, bootstrap-vue), TinyMCE for rich text, Handlebars templates for
  exports, a built-in tour (driver.js) and fuzzy search for Quick Actions. [asar package list]
- The program's own code is only about 19 MB (`dist/`, 276 files); the other 386 MB (41,746 files) is third-party libraries. [asar]
- **Capture is a native Rust module** (`capture.win32-x64-msvc.node`, napi-rs). Its panic paths name these crates:
  `screenshots 0.8.10`, `uiautomation 0.3.10`, `active-win-pos-rs 0.9.1`, `windows 0.48`, `image 0.24`, `png 0.17`, `napi 2.16`.
  Exported function names: `getCoordinates`, `getActiveWindow`, `getMetadataAtCursor` (and an async form),
  `getUiElementMetadata`, `getFocusedElementText` (and an async form), `isImeInputActive`, `isCursorOnImeWindow`,
  `isImeComposingLikely`. [addon string scan]
- Only an **x64** Windows build of that module is in the package (plus a macOS one). No ARM64 build was seen. On an ARM64 PC it
  would run under emulation (an inference). Express can be a native ARM64 program.
- **Global mouse and keyboard hooks** come from `libuiohook-node`; global hotkeys from Electron's `globalShortcut`.
  `libuiohook` is under an LGPL licence (believed), so do not use it. OpenStage Capture already has Windows hooks of its own.
- **Hiding a step-guide program's own windows from screenshots** uses Electron's `setContentProtection` (on Windows this is
  `SetWindowDisplayAffinity`). There is also a setting called "legacy capture mode".
- A **guide file is `.flgg`**: a zip (adm-zip) holding `data.json`. A shared guide has a `.lock-flgg` lock file beside it. Local
  storage also uses a database (sequelize with sqlite, migrations through umzug) and lokijs. [main bundle strings]
- **OCR** is tesseract.js, downloading language data from a CDN when first used. **Telemetry**: Sentry and Google Analytics are
  present. **Licence** binding uses a machine id. Express does none of these.
- Export libraries: `pdfmake` and `html-to-pdfmake`, `docx` (Word), `pptxgenjs` (PowerPoint), `gif-encoder-2`, `sharp` (images),
  `turndown` (Markdown), a Notion client and a WordPress client. Templates in the package: `guide.html`, `simple_guide.html`,
  `pdf.html`, `confluence.html`, `hudu.html`, `hudu-process-task.html`, `wordpress.html`, `wordpress-blocks.html`.
- Its **manual** says the interface is available in English, German and French. The bundle holds more locale strings (Danish was
  seen); treat the manual as the supported list.
- A setting named "typing smart detection" exists in the bundle but not in the manual. Unexplained.
- The Windows `resources` folder also holds `elevate.exe`. Its purpose is not confirmed (see risk K6).

### 3.2 a step-guide program's features, by area (from its manual)

**Capturing**

| Feature | What the manual says | Default |
|---|---|---|
| Start and finish | A Start button; a floating capture window with Pause and Finish; a "capturing area" (a dotted rectangle you resize before starting). | n/a |
| Mode | Capture on mouse click; capture only when a chosen key (Cmd, Alt, Control, Shift) is held with the click; capture every click except with that key held; no click capture (hotkeys only). | Capture on mouse click |
| Capture outside clicks | Also capture clicks outside the capturing area. | Off |
| Screenshot delay | Milliseconds between click and screenshot, for slow animations. | 0 ms |
| Show cursor | Overlay a cursor image at the click: None, Windows pointer, Windows hand, Mac pointer, text, Mac hand; sizes XS to XL. | Windows pointer |
| Mark clicked area | A circle around the click; size XS to XL; fill and border colours; border width. | Circle |
| Hotkey captures cursor | Hotkey captures also mark the cursor position. | Off |
| Automated annotations | Reads the clicked control's name and fills the step title. Picks the verb by control type. Works on Windows and Mac. The manual claims it parses 70 to 80 percent of elements and depends on the target app's accessibility information. | On |
| Guide language | The language of those prefilled titles, independent of the app's language. | App language |
| Capture typing | One `Type "..."` step per field; the click on the field and the typing merge into one step. Passwords and secure fields are never recorded. | On |
| Typing capture delay | Wait after the last keystroke before making the step. | 1000 ms (500 to 5000) |
| Hotkeys | Start and complete; pause and resume; capture a screenshot; take a simple screenshot (while editing); quick guide capture. | Quick guide: Ctrl+Shift+2 |
| Simple capture confirmation | A region screenshot is confirmed with OK; can be set to capture on release. | On |
| Compatibility capturing mode | An alternative capture method for virtual machines, older Windows and screen-sharing software. | Off |

Smart step titles: dropdowns, combo boxes and radio buttons give `Select "Country"`; a text field you type into gives
`Type "john@acme.com"`; everything else, including checkboxes, gives `Click "Save"`. It is deliberately conservative: it only
changes the verb when sure. Checkboxes stay `Click` because the on or off state cannot be read reliably in native apps. There is
no `Enter` verb, because `Enter "Email"` reads as "type the word Email", which is ambiguous in several languages. If nothing can
be identified the title is `Click here`, in the guide language.

Capture typing: when you pause, a step is made; more typing in the same field updates that step. Tab, Enter, or a click elsewhere
finishes it. The step shows the **final text as it appears in the field**, not the editing history, so corrections, paste,
accents and Japanese, Chinese and Korean input come out right.

**Quick guides.** A separate fast path: a global hotkey freezes the screen exactly as it is (open menus stay open), you drag a
region, release, and that is a step. Press again for the next. A small floating card shows the latest step and the count and stays
out of the screenshots. Edit opens a compact editor (caption, reorder by dragging, delete with undo, annotate). Copy as one
image (steps stacked), a wide image (side by side), HTML, or save as PNG. History keeps old quick guides for a chosen time.
"Convert to guide" turns one into a full guide. Free copies carry a small "Made with a step-guide program" line.

**Editor**

- Three step types: step with image, empty step, content block (always plain text, not in the table of contents).
- Steps list on the left: drag to reorder, nest as **substeps**, collapse and expand, multi-select with Ctrl or Cmd click. Right-click:
  add step, import steps from another guide, duplicate, skip (excluded from export), delete (to a trash bin), bulk crop, change
  status, change parent step, move to position N.
- **Multi image step**: substeps shown as extra images inside the parent step on export.
- **Annotation tools** (single-letter keys, active when the canvas has focus): selection, rectangle, oval, line, arrow (straight or
  curved), brush, text (optional outline), tooltip callout, cursor, step number badges, blur, highlight, magnifying glass,
  spotlight, OCR, crop, add asset (logo or icon). An Object Properties panel sets fill, border, font, corner radius.
- **Focused view** (on by default): every step image is cropped and scaled around the cursor so all steps export at the same width
  and a sensible height. Never modifies the original image. Toggle per step, per guide, or as the default for new steps. Drag with
  Space held to pan; zoom controls.
- **Automatic bulk blur**: select one blur area and a step-guide program finds similar areas across all steps (for example a browser address bar)
  and offers them in a review dialog.
- **Placeholders**: `[[Author]]`-style variables, global or per guide, plus system ones such as `[[Guide_Title]]`, `[[Date]]`,
  `[[Page_Number]]`, used in titles, descriptions, headers, footers and the cover.
- **Text blocks**: informational boxes before or after a step description, with an icon (error, info, success, warning), a title and text.
- **Step links** between steps (not supported in Word or PowerPoint export).
- Rich-text descriptions (TinyMCE), spellcheck, AI Helper (expand, rewrite, shorten, improve, simplify; AI-written step
  descriptions from the screenshot). The AI is **bring your own key** for OpenAI, Anthropic, OpenRouter or any OpenAI-compatible
  host; a step-guide program talks to the provider directly. Voice input is mentioned.
- Quick Actions (Ctrl or Cmd + /): search your guides by title and jump.

**Guides list.** The home screen. Create guide, create folder, restore and back up, search, favourites (star), step counts.
Automated backups (paid): timestamped folders or an "overwrite" mode for synced folders. Shared guides are `.flgg` files on a
network drive with lock files.

**Export** (formats: PDF, Word, PowerPoint, HTML simple and rich, Markdown, JSON, animated GIF, image bundle, SCORM 1.2
(beta), plus WordPress, Notion, Confluence, Hudu on paid tiers)

| Format | What the manual says |
|---|---|
| PDF | Built from HTML and CSS, with a custom CSS box. Cover page (simple, or a drawn custom one), table of contents, page sizes A3, A4, A5, letter, legal; portrait or landscape; default margins A4 5mm by 10mm; header and footer with page numbers; "force step to a new page". |
| Word | Like PDF. |
| PowerPoint | One 16:9 slide per step: title, screenshot, description; the description also goes in the speaker notes. Optional cover, agenda, footer with logo; fonts and colours tab. |
| HTML | Simple and rich variants. In HTML, clicking an image opens it at full resolution. |
| Markdown | Markdown Extra, images in a `steps-<title>` folder, an Azure DevOps wiki option. |
| JSON | Guide and steps with ids, parent ids, index strings, text blocks, image paths. Appendix B. |
| GIF | One frame per step. Duration 1, 2, 3, 5 or 8 s (default 3). Loop (default on). Max width 320 to 1920 (default 800). Background colour for padding (white). Progress bar. Title card. |
| Images | Image bundle. |
| SCORM 1.2 | A zip for any LMS: one step per screen, Back and Next and arrow keys, progress bar and "Step X of Y", contents drawer, "Course complete" screen reports completion. Self-contained, works offline. |
| Shared options | Image format and quality (PNG, four JPG presets 100/90/70/50, custom JPG 1 to 100, WebP for HTML and SCORM only), custom watermark (9 positions, opacity 10 to 100 percent, scale, padding), export settings saved as templates and shared as files, a "preview first N steps" (default 5). |

**Application**: appearance (System, Light, Dark), App language (English, German, French), date format, "open folder after export"
(on), spellcheck. Free plan limits: 5 guides, 2 export formats, hosted guides capped at 20. Pricing in the a step-guide program page: $89
Personal one-time, $155 per seat Business. Express has no plans or limits.

### 3.3 Why a step-guide program feels easy (my reading, to preserve)

- It asks for almost nothing before it works: no project setup, no templates, no login to start (a login only checks the licence).
- Capture is a loop of one gesture (click). The result already reads as a guide because titles are filled in.
- The editor is three panes (steps, picture, details) and the common actions are one click away.
- Export is a list of formats; the settings sit in tabs and are remembered per format as templates.
- It stays out of the way: the capture window hides itself from screenshots; a quick guide costs about a minute.

### 3.4 Where a step-guide program is weak, and what Express can do about it

From the a step-guide program page (treat as claims) and from the install:

| Gap | Express answer |
|---|---|
| Capture is by click only; no automatic or video capture | Click capture plus a hotkey now; an optional video take through OpenStage Capture later (section 14, S3) |
| Output is screenshots and text only; no video | Animated GIF in S1; video is OpenStage Capture's job |
| No team editing; shared guides are files on a drive | Out of scope. Single-file sharing in S2 |
| Free tier caps guides and formats; per-platform licences | None. Free and open |
| AI needs your own key; telemetry present | No network in v1. Optional local or bring-your-own-key AI is S3 |
| Windows capture module is x64 only | Native ARM64 build |
| Title parsing succeeds "70 to 80 percent" | Same limit applies to anyone reading UI Automation. Make fixing a bad title a one-keystroke act (section 9) |
| Checkbox state not read | Read the toggle state through UI Automation `TogglePattern` for `Check` and `Uncheck` titles (S2; verify it is reliable) |
| Accessibility of exports not a stated feature | WCAG 2.2 AA exports with real alt text, headings, language, reading order (section 10.1) |
| Bundled OCR downloads language data from a CDN | Use Windows' built-in OCR (`Windows.Media.Ocr`), local, nothing downloaded (S2) |

### 3.5 The other tools (a step-guide program comparison page)

| Tool | Notable | Borrow | Do not |
|---|---|---|---|
| a step-guide program | Browser extension; cloud workspace; guide plus video from one recording; "Magic Copy" paste into Notion, Confluence, Docs; auto-zoom; blur before recording | Copy as rich text or Markdown to the clipboard (S2); blur sensitive areas before capturing (S3) | Cloud, accounts |
| a step-guide program | Browser extension; cloud library; AI titles; PII redaction | Automatic detection of sensitive text for blur suggestions (S3) | Subscriptions, cloud |
| a step-guide program | Windows desktop; 10+ formats incl. SCORM and xAPI; local-first | SCORM (S3) | Per-device pricing |
| a step-guide program | Interactive "Try it / Do it" simulation; video and GIF | The interactive lesson idea, which OpenStage Author already plans (ADR 0003) | Cost |

---

## 4. Product definition: screens, flows, words

### 4.1 Where Express sits

| | OpenStage Capture | OpenStage Capture Express | OpenStage Author |
|---|---|---|---|
| Job | Record screen, voice, webcam; crash-safe takes; a recording editor | Make a step-by-step guide from clicks | Build interactive eLearning |
| Window | None; Author drives it | Its own small window | The editor |
| Output | `.capture` folder, MP4 | `.osguide` folder; HTML, Markdown, GIF, and so on | `.osproj`, SCORM |
| Audience feel | Powerful | **Simple** | Authoring studio |

A later link (S3): Express guides become Demo, Practice and Assessment lessons in Author, using the step model of ADR 0003.
Keep the step fields compatible with ADR 0003's list (click, typing, key, program change, marker), so that link is cheap.

### 4.2 Screens

Keep these four. Do not add a fifth without Jason.

**Home**

```
+----------------------------------------------------------------+
| [E] OpenStage Capture Express                          [Settings]|
|                                                                |
|     [   Start capturing   ]        Search  [__________________] |
|                                                                |
|   Your guides                                       Newest v   |
|   +----------------------------------------------------------+ |
|   | [img] How to submit an assignment      12 steps  Oct 31  | |
|   | [img] Set up two-step sign-in           7 steps  Oct 28  | |
|   +----------------------------------------------------------+ |
+----------------------------------------------------------------+
```

Empty state, shown on first run: one sentence ("Click Start, then do the task you want to explain.") and the Start button.

**Capture bar** (a small always-on-top strip, hidden from screenshots; keyboard reachable)

```
Ready:      ( Screen | Window | Area )   [ Start ]   [ Cancel ]
Capturing:  [rec dot] Capturing, step 4      [ Pause ]  [ Finish ]
Paused:     Paused, 4 steps                  [ Resume ] [ Finish ]
```

A screen reader hears: "Capturing. Step 4 captured: Click Save." after each step. A quiet cue sound is optional (setting).
Hotkeys work from any program and are shown in the bar's tooltip text.

**Editor**

```
+-----------------------------------------------------------------------+
| < Guides    How to submit an assignment      Undo  Redo      [Export] |
+----------------+----------------------------------+-------------------+
| 1  Open Canvas |                                  | Title             |
| 2  Click "As.. |       the screenshot with        | [_______________] |
| 3  Type "Wk 3" |       its marker and notes       | Description       |
| ...            |                                  | [_______________] |
|                |  R O L A T N U J C   (tools)     | [x] Focused view  |
| [+ Add step]   |                                  | [ ] Skip in export|
+----------------+----------------------------------+-------------------+
```

The tool row shows the nine most used tools; the rest are under "More". Selecting an object shows its properties in the right panel.

**Export dialog** (a panel or window opened by Export)

```
 Format   ( ) HTML   ( ) Markdown   ( ) JSON   ( ) Images   ( ) GIF
          ( ) PDF   ( ) Word   ( ) PowerPoint            [later slices]
 Options  (the few that matter for the chosen format)
          More options v
                                        [ Cancel ]  [ Export ]
```

Export asks for a folder (or file) once, remembers it, then opens it (setting on by default).

**Settings** (one page, plain list; "Advanced" folds away the rest): Appearance, Language of the app, Language of step titles,
Capture mode, Show cursor, Mark clicked area, Capture typing, Hotkeys, Sounds. Advanced: screenshot delay, capture outside clicks,
typing delay, compatibility mode, date format, preview step count, open folder after export.

### 4.3 Words

Short, plain, active. Buttons are verbs ("Start capturing", "Finish", "Export"). Errors say what happened, what is safe, and what
to do ("The screenshot for step 4 could not be saved. Your other steps are safe. Check that the disk has room, then try again.").
No jargon in the interface: "step", "guide", "picture", "marker". First-run text is one sentence per screen.

### 4.4 Brand

- Name shown to people: **OpenStage Capture Express**, short **Express** (D9).
- Icon: Appendix D. Colours: navy `#0B172A` and `#102037`, indigo `#7D87F2` and `#9CA5FF`.
- The interface follows Windows' light or dark setting by default, with a navy and indigo theme in both. **Contrast rules** (computed
  on 2026-10-31, re-verify with a script): indigo `#7D87F2` on navy `#0B172A` is about 5.6 to 1 and on `#102037` about 5.2 to 1
  (both pass 4.5 to 1 for text). **White text on indigo is only about 3.2 to 1, which fails for normal text.** Put navy text on
  indigo fills, or indigo text and borders on navy. `#9CA5FF` on navy is about 7.9 to 1.

---

## 5. Requirements

Slices: **S1** first working version (D6), **S2** Office formats and polish, **S3** OpenStage tie-in and extras.
"Done when" lines are the acceptance checks. IDs are stable; do not renumber.

### 5.1 Capture (CX-C)

| ID | Requirement | Slice | Done when |
|---|---|---|---|
| C1 | Start, pause, resume, finish, cancel from the bar and from global hotkeys | S1 | Each works while another program has focus; a screen reader announces each state change |
| C2 | Capture modes: on click (default); on click while holding a chosen key; on every click except while holding it; hotkey only | S1 | Scenario tests (section 12.1) pass for all four |
| C3 | Capture area: whole screen, one window, or a drawn area; Express's own windows never appear in a screenshot | S1 | Windows test: the bar and editor are absent from steps |
| C4 | A marker (circle) and a cursor image at the click, both optional, both editable annotations afterwards | S1 | Present by default; deleting one leaves the step |
| C5 | Smart titles in English, German and French, by control type (section 8.3) | S1 | Title table tests pass |
| C6 | Typing capture: one `Type` step per field, final text taken from the field, never for passwords | S1 | Scenario tests; Windows self-test with a password box |
| C7 | A "capture now" hotkey that makes a step without a click | S1 | Works in all modes |
| C8 | Screenshot delay setting | S1 | A delay of 500 ms shows the post-animation state |
| C9 | Per-monitor DPI and multi-monitor: coordinates and pictures agree on any display, including negative positions | S1 | Windows test on two displays |
| C10 | Crash safety: each step is saved to disk when it is made; a crash loses at most the step in flight | S1 | Kill test: all earlier steps open after restart |
| C11 | Compatibility capture mode (a slower, more tolerant capture path for virtual machines and remote sessions) | S2 | Documented trigger and fallback |
| C12 | Quick guide: hotkey freeze, drag a region, repeat, floating card, copy as image, wide image, HTML, or save as PNG | S2 | A 3-step quick guide in under a minute |
| C13 | Re-shoot a single step (replace its picture with a fresh capture of the same place) | S2 | Annotations stay |
| C14 | `Check` and `Uncheck` titles from the toggle state | S2 | Verified against real controls |
| C15 | Optional video take beside the guide, through OpenStage Capture | S3 | Separate decision |

### 5.2 Editor (CX-E)

| ID | Requirement | Slice | Done when |
|---|---|---|---|
| E1 | Steps list: select, multi-select, reorder by drag **and** by keyboard (Alt+Up, Alt+Down), delete, duplicate, skip | S1 | All by keyboard alone |
| E2 | Edit title and description. Description is plain text with a small Markdown subset (bold, italic, links, bullet and numbered lists) | S1 | Round-trips through save, HTML and Markdown |
| E3 | Add an empty step | S1 | |
| E4 | Annotations: rectangle, oval, line, arrow, text, step number, highlight, blur, spotlight, cursor, click marker; select, move, resize, delete, change colour and width | S1 | Rendering is pixel-tested (section 12.1) |
| E5 | Focused view: automatic crop and zoom around the click; toggle per step, per guide, and as the default; pan and zoom | S1 | Never changes the original image |
| E6 | Undo and redo without a fixed limit within a session | S1 | A random walk test restores any earlier state |
| E7 | Autosave after every change | S1 | Same as C10 |
| E8 | Trash: deleted steps can be restored | S1 | |
| E9 | Substeps (nest, collapse), content block, move to position N | S2 | |
| E10 | Multi image step | S2 | |
| E11 | Text blocks (icon, title, text, before or after the description) | S2 | |
| E12 | Placeholders (global, guide, system) | S2 | |
| E13 | Bulk blur, bulk crop, apply style across steps | S2 | |
| E14 | Create a step from an image on the clipboard; import steps from another guide | S2 | |
| E15 | Brush, magnifier, add asset (logo) tools; OCR to copy text from a picture (Windows built-in OCR) | S2 | |
| E16 | Step links | S3 | HTML only |
| E17 | Spellcheck through Windows' spell checker | S3 | |

### 5.3 Export (CX-X)

| ID | Requirement | Slice | Done when |
|---|---|---|---|
| X1 | HTML: one self-contained, accessible file (section 10.1) | S1 | Passes the HTML checks in section 12.1 and a screen reader pass |
| X2 | Markdown with an images folder | S1 | Golden file test |
| X3 | JSON with an images folder (Appendix B shape) | S1 | Golden file test |
| X4 | Images: every step as a flattened PNG or JPG | S1 | |
| X5 | Animated GIF with the options in 3.2 | S1 | Decoding it back gives the right frame count and delays |
| X6 | Image format and quality: PNG, JPG presets, custom JPG | S1 | |
| X7 | Open the folder afterwards (default on) | S1 | |
| X8 | PDF, Word, PowerPoint | S2 | Section 10.2 |
| X9 | Watermark, export templates saved and shared as files, preview of the first N steps | S2 | |
| X10 | WebP for HTML | S3 | |
| X11 | SCORM 1.2 package | S3 | Launches in Moodle, Canvas, Brightspace; resume and completion tested as `CLAUDE.md` demands |
| X12 | Not planned: WordPress, Notion, Confluence, Hudu, any upload | n/a | They need accounts and a network |

Exports always contain **flattened pixels** (annotations and blur burned in). A blurred area in an export can never be undone.

### 5.4 Application (CX-A)

| ID | Requirement | Slice |
|---|---|---|
| A1 | Guides list: create, open, rename, delete to trash, search, sort, remember the last folder | S1 |
| A2 | Settings page (4.2) with the defaults in 8.9 | S1 |
| A3 | Appearance: System, Light, Dark | S1 |
| A4 | Interface language: English first; German and French | S2 |
| A5 | About box listing every third-party component and licence | S1 |
| A6 | Portable zip as the first distribution; no installer, no auto-update | S1 |
| A7 | Folders for guides; favourites; Quick Actions (Ctrl+/) | S2 |
| A8 | "Save a copy as one file" (`.osguide.zip`) with a choice to include or drop the original, unblurred pictures (default: drop) | S2 |
| A9 | Automated backups | S3 |
| A10 | Signed installer | S3 |

### 5.5 Accessibility (CX-Y), privacy (CX-P), quality (CX-Q)

| ID | Requirement |
|---|---|
| Y1 | Every control reachable and operable by keyboard; visible focus; no trap (the capture bar can be left and closed by keyboard) |
| Y2 | Every control has an accessible name and role; the canvas objects are listed in a navigable list as well |
| Y3 | State changes are announced: step captured, step deleted, undo, export finished, error |
| Y4 | Works at 200 percent Windows text scaling and in Windows high contrast |
| Y5 | Nothing depends on colour alone; no flashing; honours reduced motion |
| Y6 | Exports meet WCAG 2.2 AA (section 10.1) |
| P1 | No network access in v1; no HTTP client in the dependency tree |
| P2 | Characters typed are never logged key by key (D8); passwords never |
| P3 | A visible bar (and optional cue sound) whenever capture is on; nothing is noted while paused |
| P4 | Window titles are not stored in a guide; only the program name |
| P5 | A shared copy defaults to flattened pictures only (A8) |
| Q1 | All pure logic is tested on any computer; Windows-only parts have double-clickable self-tests |
| Q2 | `tools/check_rules.py` passes on every change |
| Q3 | Visible feedback within 300 ms of a click; no dropped frames in capture on a busy screen; the hook never waits on UI Automation |
| Q4 | A second copy of Express opening the same guide is told, and opens it read-only (lock file) |

---

## 6. Architecture

### 6.1 Layout (proposed, D4)

```
capture-express/
  Cargo.toml                       workspace, resolver 2, Apache-2.0
  crates/
    openstage-express-core/        pure Rust: guide model, edit operations, undo history, smart titles,
                                   the step builder, annotation drawing, focused view, saving. No Windows code.
    openstage-express-export/      pure Rust: HTML, Markdown, JSON, images, GIF (S1); PDF, Word, PowerPoint (S2); SCORM (S3)
    openstage-express-windows/     Windows only: hooks, UI Automation, screenshots, hotkeys, clipboard, OCR, fonts
    openstage-express-app/         the program openstage-capture-express.exe (egui)
  rust-setup.bat  cargo-run.bat    copies of capture/'s helpers
  BUILD EXPRESS.bat  TEST EXPRESS.bat  OPEN EXPRESS.bat  CHECK EXPRESS COMPUTER.bat
  TEST EXPRESS CLICKS.bat  EXPORT DEMO.bat
  README.md  THIRD-PARTY.md
docs/capture-express/              this spec, guide-format.md (M1), status notes
```

`openstage-express-core` and `-export` must compile and test on Linux. `-windows` and `-app` are `cfg(windows)` for their
substance, with stubs elsewhere so `cargo test --workspace` still runs on any computer.

### 6.2 What to reuse from OpenStage Capture (read, not built, by this spec's author)

| Need | Existing code | Notes |
|---|---|---|
| Mouse hook, keyboard hook, and the rule "hooks only stamp events; a second thread asks UI Automation" | `capture/crates/openstage-capture-windows/src/win_interactions.rs` and `interactions.rs` | Has a bounded queue (8192) that drops and counts rather than blocking. `Lookups::element_at(x, y)` returns the control's name and role; `Lookups::focus()` returns `FocusKind::{Password, Text, Other, Unknown}`; `role_name()` maps control types to English names. **Reuse these. Extend with a "focused element text" read (8.4).** |
| Password and text-field safety | `classify_focus`, the rule that characters are written only when the field is known to be ordinary text | Express goes further (D8): it never needs the characters |
| Drawing: rectangles, ellipses, lines, arrows, blur, picture placement, deterministic whole-number arithmetic | `capture/crates/openstage-capture-render/src/canvas.rs` (`Canvas`, BGRA, `blur`, `ellipse`, `arrow`, `stroke_rect`, `draw_picture`), `compose.rs`, `zoom.rs` | The annotation renderer should build on `Canvas`, so output bytes are the same on every computer and tests are pixel-exact |
| Drawing text | `capture/crates/openstage-capture-render/src/text.rs` (`TextRenderer` trait, `wrap_lines`) and `WindowsText` in `openstage-capture-windows` | Windows draws the text (it knows every script); a fake renderer is used in tests |
| Screen pictures | `openstage-capture-windows/src/lib.rs`: `Platform`, `FrameSource`, `DisplayInfo`, `Frame` (Windows Graphics Capture); `write_bmp` | WGC frames exclude the cursor by default, which suits drawing our own cursor |
| Picking a region, keyboard and screen reader friendly | `region.rs`, `region_editor.rs` (`RegionEditor`: handles, nudge, type four numbers), `win_region.rs` (`pick_region`), `pick.rs` | Reuse for "Area" mode |
| Listing and choosing windows | `window.rs`, `win_windows.rs` (`choose_window`, `WindowInfo`) | For "Window" mode |
| Crash-safe file writes | `openstage-capture-project/src/fsutil.rs`: `write_atomic` (write a temp file, sync, rename) | Use for `guide.json` |
| Cue sounds | `cues.rs`, `win_cues.rs`, `cue_player.rs` | Optional start, step, error sounds |
| "Is this PC ready" check | `setup.rs`, `win_setup.rs`, `CHECK MY COMPUTER.bat` | Model for `CHECK EXPRESS COMPUTER.bat` |
| Licence, header, style and batch-file checker | `capture/tools/check_rules.py` | Extend it to cover `capture-express/` (13.2) |
| Script helpers | `rust-setup.bat`, `cargo-run.bat` | Copy; they handle PCs where Rust is not on the PATH |

`openstage-capture-windows` also contains video, audio and webcam code Express does not need. Start with a path dependency and
measure build time. If it hurts, extract the input, window and region modules into a small shared crate (`openstage-capture-input`).
That is a change to Capture, so ask Jason first.

### 6.3 Dependencies (candidates; verify every licence)

| Crate or API | For | Notes |
|---|---|---|
| `eframe` and `egui` with AccessKit | The window (D5) | MIT or Apache-2.0 (believed). Use the **wgpu** backend, not glow: Windows on ARM64 may lack OpenGL. **Turn off the default bundled fonts** and load Segoe UI from `C:\Windows\Fonts` at runtime (fall back to Tahoma, then Arial). Needs a custom theme (4.4); egui's default look is a developer tool. |
| `png` | Read and write PNG | MIT or Apache-2.0 (believed) |
| `gif` | Animated GIF, with its own colour quantizer | MIT or Apache-2.0 (believed) |
| `zip` | `.osguide.zip` (S2); Office files (S2) | MIT (believed) |
| `serde`, `serde_json`, `thiserror`, `time`, `crc32fast`, `tempfile`, `clap` | As in Capture | Already vetted |
| `windows` 0.62 | All Windows calls (`RegisterHotKey`, `SetWindowDisplayAffinity`, UI Automation, WIC, DirectWrite, `Windows.Media.Ocr`, clipboard, shell) | Already in Capture |
| `rfd` or `IFileDialog` through `windows` | Native file and folder dialogs | `rfd` is MIT (believed). Native dialogs are accessible |
| PDF | Option A (recommended for S2): render the HTML export to PDF with the **WebView2** runtime that Windows 11 ships (`PrintToPdf`), through `webview2-com` (MIT, believed). Best layout and fonts for little code; Windows only. Option B: a pure-Rust PDF writer (`pdf-writer`, `krilla`, `printpdf`; check licences). Portable, more work. | Ask Jason in S2 |
| Word, PowerPoint | Write the Office Open XML ourselves on `zip`; evaluate `docx-rs` (MIT, believed) | |
| Fonts for PDF, Word, PowerPoint | **Roboto (Apache-2.0)** embedded; Segoe UI and other Windows fonts cannot be embedded | Record in `NOTICE`. Roboto has no CJK; plan a fallback |
| **Do not use** | `libuiohook` (LGPL), FFmpeg, any telemetry or crash-reporting crate, any HTTP client, Tesseract and other OCR that downloads data | |

### 6.4 Threads in the capture path

```
hook thread (mouse, keyboard)        stamps each event with time; try_send into a bounded queue; never waits
   -> noting thread                  asks UI Automation (name, role, password?, field text); runs the step builder
        -> frame ring                keeps the last ~250 ms of screen frames (bounded to 64 MB) from Windows Graphics Capture
        -> encode worker             PNG-encodes the chosen frame, writes it, then writes guide.json atomically
   -> UI thread (egui)               receives "step added" messages; never blocks on any of the above
```

If the noting thread falls behind, events are dropped and counted, and the bar says so (as Capture does).

---

## 7. Data formats

Create `docs/capture-express/guide-format.md` in M1 and keep it equal to the code.

### 7.1 A guide is a folder

```
How to submit an assignment.osguide/
  guide.json            the guide (atomic writes)
  images/step-0001.png  originals, never modified
  images/step-0002.png
  trash/                deleted steps' pictures and trash.json (restorable)
  guide.lock            present while open (process id, start time)
```

Thumbnails and rendered previews are caches, not part of the format; they may be deleted at any time.
Default location: `Documents\OpenStage Express\Guides\`. The folder name is the title; the title in `guide.json` wins.

### 7.2 `guide.json` (schema version 0.1.0)

```json
{
  "schemaVersion": "0.1.0",
  "id": "g-2026-10-31-1432-a1b2",
  "title": "How to submit an assignment",
  "description": "",
  "language": "en",
  "createdAt": "2026-10-31T14:32:05Z",
  "updatedAt": "2026-10-31T14:40:11Z",
  "focusedView": true,
  "nextStepNumber": 4,
  "steps": [
    {
      "id": "step-1",
      "kind": "image",
      "title": "Click \"Assignments\"",
      "description": "",
      "image": { "file": "images/step-0001.png", "width": 1920, "height": 1080 },
      "imageDescription": "",
      "parent": null,
      "skipped": false,
      "click": { "x": 312, "y": 188, "button": "left" },
      "control": { "name": "Assignments", "role": "link" },
      "typed": null,
      "program": "chrome.exe",
      "focus": { "x": 0, "y": 0, "width": 1280, "height": 720 },
      "annotations": [
        { "id": "a1", "type": "clickMark", "x": 312, "y": 188, "size": 40,
          "fill": "#7D87F233", "stroke": "#7D87F2", "strokeWidth": 4 },
        { "id": "a2", "type": "cursor", "x": 312, "y": 188, "style": "pointer", "size": 28 }
      ],
      "capturedAt": "2026-10-31T14:32:41Z"
    }
  ]
}
```

| Field | Rule |
|---|---|
| `id` | `step-<n>` from `nextStepNumber`. **Never reused**, even after delete or undo. |
| `kind` | `image` (picture, title, description), `empty` (no picture), `block` (plain text content block, S2). |
| `image` | Pixels of the original. Coordinates everywhere are in these pixels, top left origin. |
| `imageDescription` | Alt text the author wrote. If empty, exports use the title. The editor lists steps whose alt text is only the title as "could be better", never as errors. |
| `parent` | Id of the parent step, or null. A child always appears after its parent in `steps` (the operations keep this true). |
| `skipped` | Excluded from every export. |
| `click` | Where the click happened, in image pixels; null for hotkey steps. |
| `control` | From UI Automation; null if unknown. Roles use Capture's English role names (`button`, `link`, `edit`, ...). |
| `typed` | The text of a `Type` step; null otherwise. **Private**: shown to the author, included in exports only as the step title. |
| `program` | The program's file name only. Window titles are not stored (P4). |
| `focus` | The Focused view crop, in image pixels; null means the whole picture. |
| `annotations` | Drawn in list order. Types: `rect`, `oval`, `line`, `arrow`, `text`, `number`, `highlight`, `blur`, `spotlight`, `cursor`, `clickMark`. Colours are `#RRGGBB` or `#RRGGBBAA`. |

A reader must reject a `schemaVersion` newer than it knows with a plain message ("This guide was made by a newer Express.") and
open older ones through migrations. Unknown fields are kept and written back.

### 7.3 Settings and other files

- `%APPDATA%\OpenStage Capture Express\settings.json`, written atomically, with its own `schemaVersion`.
- No registry use except the standard per-user "open with" entry written by an installer (S3).

### 7.4 JSON export

Not the same as `guide.json`. It is for other programs, so it is flatter. Field names follow a step-guide program's *publicly documented* JSON
export where the meaning is the same (`guide.title`, `steps[].parentId`, `indexString`, `screenshotRelativePath`, `textBlocks[]`,
`multiImageSubSteps[]`; Appendix B), to ease migrating a consumer. Document it in `guide-format.md` and test it with a golden file.

---

## 8. The capture engine

### 8.1 Pipeline

hook events -> noting thread (UI Automation lookups) -> **step builder** (pure, in `core`) -> drafts -> encode worker -> `guide.json`.
The step builder is the heart and the most testable part. It takes timestamped inputs and a callback that supplies a screenshot
when it needs one, and returns drafts. It contains **no Windows code**, so the whole behaviour is covered by tests that run anywhere.

### 8.2 Step builder rules

Inputs: `Click{button, point, control?, mods, inside_area}`, `TypingActivity{t}` (a key went down; **no key identity**),
`SpecialKey{Enter|Tab|Escape}`, `CaptureNow{cursor?}`, `Tick{t}`, `Finish`.
Output: `Draft{title, kind, shot, click?, control?, typed?}`.

| # | Rule |
|---|---|
| R1 | **Mode filter.** Apply the capture mode (C2) to every click before anything else. |
| R2 | **Outside the area.** A click outside the capture area is ignored unless "capture outside clicks" is on. It still ends any typing step in progress. |
| R3 | **Click on an editable field** (control role `edit`, an editable `combo box`, or `document`) with typing capture on becomes a **pending click**: its screenshot is kept and no step is made yet. |
| R4 | **Resolving a pending click.** The first of these wins. Typing activity: start a typing session (R5). Another click, a capture-now, or Finish: emit the pending click as a plain `Click` step with its own screenshot. Timeout (2 s or the typing delay, whichever is longer): same. |
| R5 | **Typing session.** It ends after `typing_delay_ms` without activity, on Enter or Tab, or on any click, capture-now or Finish. At the end, read the focused field's text (8.4). If the text is empty, make no `Type` step (the pending click becomes a `Click` step). Otherwise emit **one** `Type "<text>"` step, with a **new screenshot** taken now (it shows the filled field) and the pending click's point and control. |
| R6 | **Password or unreadable.** If the field is a password field, emit only `Click "<name>"`, never a `Type` step and never any text. If the text cannot be read (no value pattern), emit `Type in "<name>"` with no text. Never guess text. |
| R7 | **Other buttons.** Right click gives `Right-click`, middle click `Middle-click`. Back and forward buttons are ignored. |
| R8 | **Double click** (two left clicks within the system double-click time and a few pixels): one step, `Double-click`. (A proposal; a step-guide program's manual is silent.) |
| R9 | **Express's own windows.** A click on an Express window is never captured. |
| R10 | **Capture now** emits a step titled `Screenshot` (localised), with the cursor position only if "hotkey captures cursor" is on. |
| R11 | **Menus.** The screenshot for a click is taken from the **frame ring at the moment of the click**, not after, so an open menu or tooltip is still in it. With a screenshot delay above 0, take a frame that long after the click instead. |
| R12 | **Order.** Drafts come out in the order the actions happened; resolving a pending click happens before any later step is emitted. |

### 8.3 Smart titles

| Control role (Capture's English name) | Verb | Notes |
|---|---|---|
| `combo box` (selecting), `radio button`, a popup or dropdown button | Select | |
| `edit`, `document` you typed into | Type (R5) | The title shows the text |
| `edit`, `document` you only clicked | Click | |
| `check box` | Click | `Check` and `Uncheck` in S2 (C14) |
| everything else (`button`, `link`, `tab item`, `menu item`, `list item`, `tree item`, ...) | Click | |
| no name, or no control | `Click here` | |

Names are trimmed, whitespace collapsed, control characters removed, and cut at 80 characters with an ellipsis. There is no
"Enter" verb (3.2). Strings (proposals; have a native speaker check German and French before release):

| | English | German | French |
|---|---|---|---|
| Click | `Click "X"` | `Klicken Sie auf "X"` | `Cliquez sur "X"` |
| Right-click | `Right-click "X"` | `Klicken Sie mit der rechten Maustaste auf "X"` | `Faites un clic droit sur "X"` |
| Double-click | `Double-click "X"` | `Doppelklicken Sie auf "X"` | `Double-cliquez sur "X"` |
| Select | `Select "X"` | `Wählen Sie "X"` | `Sélectionnez "X"` |
| Type | `Type "T"` | `Geben Sie "T" ein` | `Saisissez "T"` |
| Type, text unknown | `Type in "X"` | `Geben Sie Text in "X" ein` | `Saisissez du texte dans "X"` |
| No name | `Click here` | `Hier klicken` | `Cliquez ici` |
| Capture now | `Screenshot` | `Bildschirmfoto` | `Capture d'écran` |

These strings live in Rust source and the interface, which are UTF-8, so use the real accented characters. (The `.bat` scripts are
the only files that must stay plain ASCII.)

### 8.4 Typing capture (D8: read the field, do not log keys)

a step-guide program's addon exports a "focused element text" call, which is how its `Type` step shows the final text. Express does the same with
UI Automation, and it is **more private than logging keys**:

- The keyboard hook reports only that **a key went down** (and Enter, Tab, Escape, and modifier state for the key-and-click modes).
  The character is dropped inside the hook and never stored or sent. This is a stronger promise than Capture's `Level::All`.
- When a typing session ends, ask the focused element for its value: UI Automation `ValuePattern` (edit controls) or `TextPattern`
  (documents, rich edits). This gives the text as it appears: corrections, paste, accents and input-method text (Japanese, Chinese,
  Korean) are right with no reconstruction.
- If the element reports `IsPassword`, make no `Type` step at all (R6).
- Ask only while the person is capturing and not paused. Ask on the noting thread, never in a hook (a busy app can take seconds).
- Input-method composition: while a composition is in progress the field's value is incomplete. Wait for it to finish, as a step-guide program's
  addon names suggest it does (`isImeComposingLikely`). Mark this as unverified until tested with a real input method.
- Many apps (some Electron and web apps) expose fields to UI Automation poorly. Then R6 applies and the step says `Type in "X"`.
  The editor offers "add the text" so the author can type it, with a note that it is private.

### 8.5 Screenshots

- **Source:** Windows Graphics Capture of the chosen display, through the existing `Platform`/`FrameSource`. WGC leaves the cursor
  out by default, so Express draws its own cursor image as an annotation (C4).
- **Window mode:** capture the display and **crop to the window's bounds at the time of the click**. Do **not** capture the window
  alone with WGC: menus, drop-downs and tooltips are separate top-level windows and would be missing.
- **Frame ring:** keep about the last 250 ms of frames, bounded to 64 MB, so a click's picture shows what the person saw. A 1080p
  BGRA frame is about 8 MB, so the ring holds a few frames; scale the count to the display. If the ring is empty, grab a frame now.
- **Hiding Express itself:** set `WDA_EXCLUDEFROMCAPTURE` (`SetWindowDisplayAffinity`) on every Express window (bar, editor,
  dialogs, picker overlay) so they never appear in a frame.
- **Coordinates:** physical pixels everywhere; the program declares per-monitor DPI awareness (v2) in its manifest. Displays can
  have negative origins.
- **Encoding:** PNG on a worker with fast compression; target under 150 ms for 1080p. Raw frames are released as soon as written.
- **Known weak spots:** HDR displays (WGC gives 8-bit BGRA; colours may look off), protected content and some games (black
  frames), and windows of a program running as administrator (see risk K6 in section 15).

### 8.6 Marker and cursor

On by default, both created as ordinary annotations on each step so the author can remove or restyle one or all (E4). Defaults:
circle marker size M with a translucent indigo fill and an indigo border; Windows pointer image size M. Marker and cursor sizes
scale with the display's DPI scale so they look the same on any monitor.

### 8.7 Hotkeys (proposed defaults; the user can change them)

| Action | Default |
|---|---|
| Start or finish | Ctrl+Shift+F7 |
| Pause or resume | Ctrl+Shift+F8 |
| Capture now | Ctrl+Shift+F9 |
| Quick guide capture (S2) | Ctrl+Shift+2 |

Registered with `RegisterHotKey`. **Never default to F12**: Windows reserves it for debuggers and documents that it should not be
registered as a hotkey. If one cannot be registered because another program holds it, leave it unassigned and say
which one and how to pick another, as a step-guide program does. Never fail to start because of a hotkey.

### 8.8 Failure and recovery

- Write the picture first, then `guide.json` (atomic). A crash leaves the previous complete guide.
- On start, look for a guide with a stale `guide.lock` and offer to open it ("Express closed unexpectedly. Your steps up to the last
  one are safe.").
- Disk full, picture write failure, or a lost display: tell the person in words, keep capturing if possible, never discard steps.

### 8.9 Settings and defaults

| Setting | Default | Page |
|---|---|---|
| Appearance | System | First |
| Language of the app | System language if supported, else English | First |
| Language of step titles | Same as the app | First |
| Capture mode | On click | First |
| Show cursor | Windows pointer, size M | First |
| Mark clicked area | Circle, size M | First |
| Capture typing | On | First |
| Sounds (start, step, error) | Off | First |
| Hotkeys | 8.7 | First |
| Screenshot delay | 0 ms | Advanced |
| Capture outside clicks | Off | Advanced |
| Typing delay | 1000 ms (500 to 5000) | Advanced |
| Hotkey captures cursor | Off | Advanced |
| Compatibility capture | Off | Advanced |
| Focused view for new steps | On | Advanced |
| Preview step count | 5 (1 to 99) | Advanced |
| Open folder after export | On | Advanced |
| Date format | System | Advanced |

---

## 9. The editor

**Layout:** steps list (left), picture with tool row (centre), details (right). The tool row is below the picture. Sizes are
resizable; the layout holds at 1280 by 720.

**Tools and keys** (single letters work only when the picture has focus, so typing in a text box never triggers a tool):

| Tool | Key | Slice | | Tool | Key | Slice |
|---|---|---|---|---|---|---|
| Select | S | S1 | | Highlight | J | S1 |
| Rectangle | R | S1 | | Crop (Focused view) | C | S1 |
| Oval | O | S1 | | Cursor | G | S1 |
| Line | L | S1 | | Brush | B | S2 |
| Arrow | A | S1 | | Magnifier | M | S2 |
| Text | T | S1 | | OCR | K | S2 |
| Step number | N | S1 | | Spotlight | P | S1 |
| Blur | U | S1 | | Add asset | I | S2 |

(The letters follow a step-guide program's keys for the tools both have; spotlight and add asset have no key in its list, so P and I are
proposals.) Every object is also selectable from a list in the details panel, and every property is a labelled control, so the canvas
is never the only way in.

**Other keys:** Ctrl+Z, Ctrl+Y (undo, redo); Ctrl+Shift+Up and Down (previous, next step); Ctrl+Shift+Delete (delete step); Alt+Up and
Alt+Down (move step); Ctrl plus, minus, 0, 1 (zoom in, out, 100 percent, fit); arrows nudge the selected object (Shift for larger);
Ctrl+C and Ctrl+V copy and paste objects; Ctrl+/ jump to a guide (S2).

**Behaviour**
- **Blur is a heavy mosaic**, not a soft blur, so it cannot be reversed. Reuse `Canvas::blur` and check it is strong enough; if
  not, add a stronger mode. The original image remains in the guide folder (P5, A8).
- **Focused view** is a stored crop rectangle, not an edited image. Annotations are drawn on the full original and then cropped,
  so they stay in place. Export scales every crop to the same width.
- **Undo** is a stack of whole-guide snapshots (the guide JSON is small; pictures are immutable files). Deleted steps' pictures
  move to `trash/` and stay until the person empties it.
- **Title fixes are one keystroke:** F2 on a step edits its title; Enter accepts. The most common edit must be the cheapest.

---

## 10. Export

### 10.1 The HTML export (S1) and accessibility of all exports

One self-contained `.html` file with the pictures embedded (a folder option for large guides). No external requests: no CDN, no web
fonts, no scripts that fetch anything. Requirements, tested in section 12:

- `<html lang>` set to the guide language; one `<h1>` (the guide title); each step an `<h2>` inside an ordered list; a table of
  contents `<nav aria-label="Steps">`; a "Skip to the steps" link; `<main>` landmark.
- Every picture is an `<img>` with `alt` from `imageDescription`, else the step title; step numbers are real text.
- Text contrast of at least 4.5 to 1; layout reflows at 320 px wide and 400 percent zoom; focus visible; no content depends on
  colour alone; honours `prefers-color-scheme` and `prefers-reduced-motion`.
- Clicking a picture opens it at full resolution in a `<dialog>`, closable with Escape, with focus returned (no trap).
- Print stylesheet: one step per page break rule that avoids splitting a picture.
- Annotations are burned into the pictures, so every annotation that carries meaning must also be in the step's text. The editor
  warns when a text annotation's words are not in the description ("Add this to the step's text so a screen reader can read it").
- A `Content-Security-Policy` meta tag that forbids everything but inline styles and data images.

Markdown, JSON and images use the same alt text rules (`![alt](path)`).

### 10.2 S2 formats

- **PDF:** cover page (simple, or a designed one), table of contents, page size A4, Letter, A3, A5, Legal; portrait or landscape;
  margins; header and footer with page numbers; "force step to a new page". Recommended route: render the HTML export with WebView2
  `PrintToPdf` (6.3). A tagged, accessible PDF is a goal: check what WebView2 emits and say honestly what it does and does not tag.
- **Word:** headings, numbered steps, pictures with alt text, a table of contents field. Written as Office Open XML.
- **PowerPoint:** one 16:9 slide per step, title, picture, description; the full description goes in the speaker notes; optional
  cover and agenda slides; footer with page number and optional logo. Pictures carry alt text.
- **Watermark** (image, 9 positions, opacity, scale, padding) on all formats; **export templates** saved per format and shared as files.

### 10.3 GIF (S1)

Each step is a frame. Use the step's flattened Focused-view picture scaled to the max width; pad shorter frames with the
background colour; duration per step (1, 2, 3, 5, 8 s; default 3); loop (default on); optional title card and progress bar. Warn about
file size. A GIF cannot be made accessible; the dialog says so and points to HTML.

### 10.4 Image format and quality

PNG; JPG at 100, 90, 70, 50; custom JPG 1 to 100; WebP in S3. Remembered per export format. Pictures are encoded from the lossless
original so annotations stay crisp. (JPG needs an encoder crate; check its licence, or write JPG through Windows' imaging service.)

### 10.5 SCORM 1.2 (S3)

A zip for an LMS: one step per screen, Back and Next and arrow keys, a progress bar and "Step X of Y", a contents drawer, a "Course
complete" screen that reports completion. Reuse OpenStage's SCORM wrapper if it can carry this player; otherwise write a tiny one.
Honour the gating tests in `CLAUDE.md` (Moodle, Canvas, Brightspace; resume where the learner left off; pass and fail both
report). Do not start this until S1 is in Jason's hands.

---

## 11. Accessibility (the program itself)

- **AccessKit** exposes egui widgets to Windows UI Automation, so Narrator and NVDA can read them. This is the main technical risk of
  choosing egui (15, K1). Prove it in M5 with a Narrator and NVDA pass on the Home screen before building the rest of the interface.
  If it fails, switch to Tauri (the editor already uses it).
- Every control: a visible label or an accessible name; a role; a keyboard route; a visible focus ring (3 px, 3:1 contrast against
  both the control and the background).
- Announce after each capture, delete, undo, export and error through the platform's live-region mechanism.
- The capture bar is reachable with a global hotkey to **focus** it, and Escape returns focus to the previous program. It never traps focus.
- The canvas is never the only way to do anything: objects, their positions and their properties are editable as numbers.
- Support Windows text scaling to 200 percent, high-contrast themes, and reduced motion.
- Provide `docs/capture-express/screen-reader-check.md` (a list of what to listen for), as `capture-timeline/README.md` does.

---

## 12. Testing and honest status

### 12.1 Tests that run on any computer (M1 to M4)

Write these as the code is written, not afterwards.

- **Titles:** every role in 8.3 against every language; empty and very long names; names with quotes and control characters.
- **Step builder:** at least 25 scenario tests: plain click; select from a combo box; click on a field then type (one merged step,
  with the new screenshot); backspace down to empty (no `Type` step; the click survives); Enter and Tab end typing; typing delay
  expiry; click elsewhere ends typing; outside-area click; the four modes with and without the held key; double click; right click;
  capture-now with and without cursor; password field (no text, ever); unreadable field (`Type in`); a pending click timing out;
  ordering under interleaved inputs; Finish flushes everything.
- **Guide operations:** reorder keeps parents before children; substeps reject cycles; delete moves a step's children up one level;
  ids are never reused after delete and undo; duplicate copies annotations and gets a new id; skip and restore.
- **History:** a long random sequence of operations and undos returns to every earlier state exactly.
- **Store:** atomic save; a simulated crash between the picture write and the JSON write leaves a valid guide; a newer
  `schemaVersion` is refused with the plain message; every migration has a fixture; unknown fields survive a round trip.
- **Annotation drawing:** pixel-exact tests on `Canvas` for each tool; blur really destroys the content (check that a known pattern
  is not recoverable from the output); Focused view math stays inside the image for any click position and zoom.
- **Export:** golden files for Markdown and JSON; HTML structure tests (one `h1`, headings in order, every `img` has `alt`, `lang`
  set, no `http` references); GIF decoded back for frame count, delays and size; images match the flattened picture.
- **Rules:** `python -I tools/check_rules.py` passes.

### 12.2 Windows self-tests (double-clickable)

Because most development happens elsewhere, Windows behaviour must be provable by a script that needs no judgment:

- `CHECK EXPRESS COMPUTER.bat`: Windows version; screen capture works; UI Automation reachable; hotkeys can be registered; DPI and
  displays; free disk space; (S2) the WebView2 runtime is present. Writes `check-log.txt`.
- `TEST EXPRESS CLICKS.bat`: opens a small test window that Express's own test creates, containing known controls (a button named
  "Save", a combo box named "Country", an edit named "Email", a **password** edit, a checkbox). It sends **synthetic clicks and typing
  with `SendInput`**, runs the real capture pipeline, and asserts the resulting steps and titles (including that nothing typed in
  the password box appears anywhere). Prints PASS or the list of failures. This is the Windows proof for C2, C5, C6.
- `EXPORT DEMO.bat`: builds a sample guide from fixture pictures (no capture) and runs every export of the current slice into a
  folder, then opens it. This works on any Windows PC and shows the result without a recording.

### 12.3 What Jason (or a person) still has to judge

How it looks and feels; whether titles read well on his real programs; screen reader behaviour (Narrator, NVDA); the German and
French strings; HDR and multi-display on his real hardware.

### 12.4 Status vocabulary (use in README and every report)

- **Run on Windows** (say which PC and date, and what was seen).
- **Written and type-checked, not yet run on Windows.**
- **Tested here on Linux or any computer** (pure logic only).
- **Not built.**

### 12.5 Release gates for S1

1. `TEST EXPRESS CLICKS.bat` passes on at least two different Windows PCs, one x64 and one ARM64.
2. A guide of 30 steps is captured on a real application, edited, and exported to HTML, Markdown, JSON, images and GIF with no error.
3. The HTML export passes the structure tests and a screen reader read-through.
4. A kill during capture loses at most one step; the guide reopens.
5. The whole program is operable by keyboard alone, and usable with Narrator and with NVDA.
6. No network connection is attempted (check with a firewall log or a connection monitor during a full session).
7. `check_rules.py` passes and `THIRD-PARTY.md` is current.
8. A person who has never seen Express makes and exports a guide without help (a short observed trial; note where they hesitate).

---

## 13. Building and handing the work around

### 13.1 Scripts to create (rules from `check_rules.py`)

Plain ASCII, CRLF line ends, every script calls `rust-setup.bat` before first use of cargo and runs cargo only through
`cargo-run.bat`, no `echo` of brackets inside a `( ... )` block, no quoted `"%~dp0"` passed to a program (write `"%~dp0."`).
Copy `rust-setup.bat` and `cargo-run.bat` from `capture/` unchanged. The scripts:

`BUILD EXPRESS.bat` (build release, say SUCCESS or point to `build-log.txt`), `TEST EXPRESS.bat` (all tests plus the rules
checker, writes `test-log.txt`), `OPEN EXPRESS.bat`, `CHECK EXPRESS COMPUTER.bat`, `TEST EXPRESS CLICKS.bat`, `EXPORT DEMO.bat`.
Use `capture/BUILD CAPTURE.bat` as the template for tone and structure.

### 13.2 Extend the rules checker

Edit `capture/tools/check_rules.py` so it also covers `capture-express/`: dependency licences from that workspace's
`cargo metadata`, SPDX headers, the em-dash scan (also over `docs/capture-express/`), batch-file rules, and `THIRD-PARTY.md`
generation for Express. Keep the change small and additive. The checker's file scans use `ROOT = capture/`, so Express needs its
own root entry.

### 13.3 Other computers

- Extract or clone into a folder that **OneDrive does not sync** (such as `C:\Dev`); builds make thousands of files. Extract each
  new ZIP into a **new, empty folder**; over-extracting leaves a mix of old and new code.
- The first build may need crates.io. `cargo-run.bat` tries offline first and asks before downloading, once.
- Build natively for the PC: x64 on x64, ARM64 on ARM64. `windows` 0.62 supports both. Jason's current PC is ARM64.
- On a PC where Rust is installed but not on the PATH, `rust-setup.bat` finds it (`C:\Dev\tools\rust-env.ps1` or
  `OPENSTAGE_RUST_ENV`).
- Express uses its own `target` folder (`capture-express/target`). It is large.
- The repo's remote is `https://github.com/jasonswrench-beep/claude-test`. Nothing from this work has been committed or pushed.

---

## 14. Roadmap

Order matters. Each milestone ends with a status report in the 12.4 vocabulary and a commit Jason can read.

| M | Milestone | Where it can be built and verified | Done when |
|---|---|---|---|
| M0 | Ask section 16 questions; scaffold the workspace, scripts, README status table, extend the checker; add Express to `ROADMAP.md` with Jason's OK | Any computer | `TEST EXPRESS.bat` runs and the checker passes on an empty workspace |
| M1 | `core`: guide model, operations, undo history, store, migrations; `guide-format.md` | Any computer | Tests in 12.1 for guide, history, store pass |
| M2 | `core`: smart titles and the step builder | Any computer | All 25+ scenario tests pass |
| M3 | `core`: annotation drawing on `Canvas`, Focused view | Any computer | Pixel tests pass |
| M4 | `export`: HTML, Markdown, JSON, images, GIF; `EXPORT DEMO.bat` with fixture pictures | Any computer | Golden and structure tests pass; the demo makes every format |
| M5 | `app`: egui shell with the theme, Home and Editor over a **fake** guide; Narrator and NVDA pass on Home | Needs a Windows desktop | Looks like section 4.2; the screen reader pass is done or the Tauri fallback is chosen |
| M6 | `windows`: hooks, UI Automation, frame ring, hotkeys, capture bar; the step builder driven by real input; `TEST EXPRESS CLICKS.bat` | Needs Windows | The self-test passes on x64 and ARM64 |
| M7 | Settings, first-run, errors, About and licences, icon files, portable zip | Needs Windows | Release gates 1 to 7 |
| M8 | Test round with Jason; fix list; gate 8 | Jason's PC | S1 accepted |
| S2 | PDF, Word, PowerPoint, watermark, templates, quick guides, substeps, text blocks, placeholders, bulk blur, re-shoot, OCR, single-file share, German and French | | Per CX table |
| S3 | SCORM, link to Author, optional AI step text, WebP, backups, signed installer | | Per CX table |

---

## 15. Risks and unknowns

| ID | Risk | What to do |
|---|---|---|
| K1 | egui's screen reader support through AccessKit may not meet the accessibility rules | Prove it early (M5). Fallback: Tauri with the editor's web layer |
| K2 | UI Automation names fail on some apps (a step-guide program itself claims 70 to 80 percent) | `Click here` fallback plus F2 to rename; later OCR-assisted suggestions |
| K3 | Low-level hooks can trigger antivirus warnings and SmartScreen on an unsigned program | Expect it on work PCs; S3 signing; document it in the README |
| K4 | Input-method text (Japanese, Chinese, Korean) and field-value reading are unverified | Test with a real input method before claiming support |
| K5 | HDR displays, protected content and some games give wrong or black pictures | Document; do not claim support |
| K6 | Clicks in windows of a program run as administrator may not be seen by a normal program (Windows' integrity-level rule). a step-guide program ships an `elevate.exe` of unconfirmed purpose | Test early; document; consider an "also capture administrator windows" restart-as-admin prompt |
| K7 | The frame ring uses memory; 4K and multi-display setups can be large | Bound it (64 MB) and measure |
| K8 | Window mode with WGC would miss menus | Use display capture and crop (8.5) |
| K9 | Burning blur into exports is irreversible, but the original is in the guide folder | A8, P5, and a clear warning on share |
| K10 | `openstage-capture-windows` brings video and audio code and build time | Measure; extract a small input crate only with Jason's OK |
| K11 | Crate licences listed here are from memory | Verify each with the checker |
| K12 | REA has not been run successfully (0.5) | Appendix E |
| K13 | S1 is large | Keep to the order in 14; cut features before cutting tests |
| K14 | Clean-room: a step-guide program is commercial | Section 2; use facts and behaviour only; never open or reproduce its templates, strings or artwork |

---

## 16. Questions for Jason

Ask the first three together, once. Each has a default.

1. **Where does it live?** Default: `capture-express/`, its own workspace beside `capture/` in the OpenStage repo (D4). Alternative:
   a separate folder or repo.
2. **Window toolkit?** Default: egui with AccessKit, all Rust (D5). Alternative: Tauri with a web interface, as the editor uses
   (best screen reader support, but the interface is not Rust).
3. **First slice?** Default: capture, edit, and export to HTML, Markdown, JSON, images and GIF (D6). Alternative: add PDF, Word and
   PowerPoint to the first version (larger, later).

Then, when convenient:

4. **Name.** "OpenStage Capture Express" (short "Express")? The icon file is called "OpenCapture_Express" and its title says
   "Open Capture Express". Authors see OpenStage Capture as "OpenScreen" inside Author (CLAUDE.md); should Express be known to
   authors as something similar?
5. **Guide file:** a folder named `*.osguide` (D7), with an optional single-file share in S2. Agreed?
6. **Typing capture** by reading the field, never logging keys (D8). Agreed? (It cannot see what is typed into apps that hide
   their fields from Windows; those get `Type in "X"`.)
7. **Descriptions** as plain text with a small Markdown subset (E2), instead of a full rich-text editor. Agreed?
8. **Hotkeys** (8.7). Any that clash with software Jason uses?
9. **Languages** of step titles and the interface: English first, then German and French (as a step-guide program) or others?
10. **Link to Author.** Should Express guides eventually open in OpenStage Author as Demo, Practice and Assessment lessons (S3)?
    If yes, keep ADR 0003's step vocabulary.
11. **REA.** Is the REA server healthy on his PC? Appendix E needs it.
12. **Signing.** Does he have a code-signing certificate, or is unsigned acceptable for now (K3)?

---

## Appendix A: a step-guide program's shortcuts (reference for muscle memory)

Anywhere: Ctrl+Shift+2 quick guide step. Editor: Ctrl+Shift+Up and Down previous and next step; Ctrl+C and Ctrl+V copy and paste canvas
objects; Ctrl+Shift+Delete delete step; Ctrl+Shift+V create a step from the clipboard image; Ctrl plus, minus, 0, 1 zoom; arrows
move a selected shape (Shift for faster); tools: S selection, R rectangle, O oval, L line, A arrow, T text, N step number, U blur,
B brush, J highlight, C crop, G cursor, M magnify, K OCR. Ctrl+/ Quick Actions.

## Appendix B: a step-guide program's documented JSON export (public manual), for field naming only

`guide{title, description}`; `steps[]{id, index, parentId, title, description, screenshotFilename, indexString, textBlocks[{title,
description, type, position}], screenshotRelativePath, multiImageSubSteps[], multiImageSubStepsSettings[]}`. Pictures sit in a
folder `steps-<GUIDE_TITLE>`. `position` is `before-description` or `after-description`. Express's JSON export may reuse these
names where meanings match; it must not claim compatibility.

## Appendix C: Sources

- a step-guide program manual: (vendor page) (pages: quick overview, quick guides, application settings, quick actions, shortcuts,
  capturing/smart-step-titles, capturing/capture-typing, capturing/automated-annotations, editor/step-types, substeps,
  step-management, step-settings, annotations, focused-view, bulk-blur, placeholders, step-links, multi-image-step,
  step-text-blocks, ai, export/json, markdown, gif, image-format, scorm, powerpoint, pdf-cover-page, pdf-margins, watermark,
  guides-list/overview, automated-backups, custom-css, hints/share-export-settings). The sitemaps are at `/sitemap.xml` and
  `/help/sitemap.xml`.
- Alternatives: (vendor page)
- Local: `C:\Program Files\a step-guide program` (1.40.6), read only.
- OpenStage: `CLAUDE.md`, `docs/decisions/0001-screen-capture.md`, `0003-steps-and-practice.md`, `capture/README.md`,
  `capture/tools/check_rules.py`, the crates named in 6.2.

## Appendix D: Icon and brand

File: `docs/capture-express/assets/OpenCapture_Express.svg`, exactly as supplied. 1024 by 1024, a navy rounded tile (corner radius
164, gradient `#102037` to `#0B172A`), and an indigo symbol (gradient `#9CA5FF` to `#7D87F2`): four viewfinder corner brackets
(stroke 52), one extended top-right corner that makes the frame look open, and a rounded capital E at the centre (stroke 60).
The SVG's `<title>` contains an em dash; the checker does not scan `.svg`, so it was left as supplied. Replace it with a colon if
that ever changes.

To do (M7): make `app.ico` (16, 24, 32, 48, 64, 128, 256), PNGs for the window and tray, and a high-contrast variant. **Check small
sizes by eye:** at 16 to 32 px the thick strokes merge, so make a simplified small version (the E and two corners). Render with a
one-off dev tool; do not add an SVG renderer to the program (the usual one, resvg, is MPL-2.0, outside the allowed list).

## Appendix E: Re-running the reverse engineering (when REA works)

First restart the REA MCP server on the PC, then confirm it answers a trivial call. If tools are missing or stay silent, run
`npx -y rea-agents@6.8.0 doctor --client claude_desktop --json` (or the client in use) and read its result. **Do not run the whole
`app.asar` through `analyze_javascript_application`**: it holds 41,746 files and never returned. a step-guide program's own code is `package.json`
and five files in `dist/electron/`.

1. `inspect_electron_fuses` on `C:\Program Files\a step-guide program\a step-guide program.exe` (does it accept the inspector? is the asar integrity checked?).
2. `inspect_artifact` on `app.asar` with `detail: "summary"` for the inventory.
3. `analyze_javascript_application` on `app.asar`, `format: "asar"`, `detail: "summary"`, `analysis_timeout_ms` large, with
   `source_paths` exactly `["package.json","dist/electron/main.js","dist/electron/capture.js","dist/electron/renderer.js","dist/electron/custom.js"]`.
   Then use `inspect_analysis_view` and `trace_application_feature`, not the whole graph.
4. On the native module `app.asar.unpacked\dist\electron\capture.win32-x64-msvc.node`: `inspect_pe_imports`, `inspect_native_exports`
   and `inspect_rust_binary`, to confirm the crates in 3.1 and the exported function list.
5. Do not run a step-guide program under observation (`capture_electron_scenario`, Frida and the like) without Jason's explicit go-ahead.

Questions REA should answer (all feature-level; copy no code):

- What does a step in `data.json` hold (fields, coordinate system, how annotations are stored)? Use this only to inform Express's own
  schema. Do not implement `.flgg` reading or writing.
- How exactly does `getFocusedElementText` get the text (value pattern, text pattern, clipboard)? How does the IME check gate it?
- Is the screenshot taken before or after the click, and from what? What is the capture ring, if any?
- What are the real setting names and defaults (the manual and the bundle disagree in places)?
- What does "typing smart detection" do?
- What does "legacy capture mode" do compared with "compatibility capturing mode"?
- What is `elevate.exe` for?

Update section 3 and the risks with what is found. The bundle's strings are partly obfuscated (a string-array scheme), so expect
gaps; the manual stays the main source.

## Appendix F: The kickoff prompt (paste this to Claude on the other PC)

```
You are building OpenStage Capture Express in the OpenStage repository (branch feature/capture-express).
Read, in order: CLAUDE.md, docs/decisions/0001-screen-capture.md, docs/decisions/0003-steps-and-practice.md,
capture/README.md, then docs/capture-express/spec.md in full. The spec is your brief; section 0.3 says how to start.

Rules that matter most: Apache-2.0, Rust, no GPL and no FFmpeg, accessibility is not optional, no network in v1, no em dashes,
anything Jason runs is a double-clickable .bat, and never call something working that has only compiled. a step-guide program is a commercial
program: use facts and behaviour from the spec only, never its code, templates, strings, artwork or file format.

Your first message to Jason: ask the three questions at the top of section 16 (location, toolkit, first slice), each with its
default, and nothing else. Then follow the milestones in section 14 in order, starting at M0. Report in the status vocabulary of
section 12.4. Ask before changing anything outside capture-express/ and docs/capture-express/ (including ROADMAP.md and
capture/tools/check_rules.py).
```
