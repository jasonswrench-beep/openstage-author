# Accessibility pass on the editor, without a screen reader

Done 2026-10-13. **This is not the screen reader pass.** Nobody could run NVDA or VoiceOver, so nothing here says what a screen reader *speaks*. This pass checks what a screen
reader is *given*: names, roles, structure, focus and keyboard behaviour, sizes, contrast and how the layout behaves when the window is narrow or the page is zoomed. The
script for a person with a screen reader, `docs/screen-reader-pass.md`, is still the way to find out what it says, and it is still unrun.

## How it was done

1. **The accessibility tree.** Chromium's accessibility tree, which is what NVDA reads on Windows (the app's window is Chromium), was read for the whole screen, a dialog and the
   Properties panel of a question. VoiceOver reads WebKit's tree, which was not looked at, and the macOS app has not been built.
2. **A script** (`editor/audit/a11y-audit.js`, see below) that checks every control on screen: it has a name, the name contains the words that can be seen on it (WCAG 2.5.3), nothing
   points at an id that is not there, no id is used twice, no tab index is above 0, nothing focusable is hidden from assistive technology, headings do not skip, landmarks have names,
   text meets its contrast, controls are at least 24 by 24 pixels (WCAG 2.2, 2.5.8), and the table, slider and dialog rules. It visited **every slide and every object** of seven
   example projects (all object types except hotspot), and each look of an object that has looks. A deliberately broken test panel was used to be sure it can fail.
3. **Real key presses** through the whole tab order (77 stops with a project open), the arrow keys, Home and End in the lists, Escape in nine dialogs (each is named, takes focus
   in, and gives it back), and Tab through a long dialog to see whether a fixed bar of buttons hides what has the focus.
4. **What is announced.** The status area was watched while 24 common actions were done.
5. **Narrow windows.** The editor was loaded at 1500, 1100, 1000, 901, 900, 640 and 320 pixels wide, with every slide and object of the biggest example visited, and every dialog
   opened at 320 and 640, looking for sideways scrolling and clipped content. Text spacing (WCAG 1.4.12) was changed and looked for clipped text.

## What was already right

Every control has a name; no contrast failure; no broken reference; one `h1` and sensible headings; named landmarks (banner, navigation, main, complementary, regions, contentinfo);
every dialog is named, traps and returns focus, and closes with Escape; the tab widget (Assets) follows the standard pattern; the timeline sliders have names, values and spoken
values ("3 seconds after the slide opens"); almost every action says what it did, with how to undo it; everything done with the pointer has a keyboard route (the canvas keys, the
Properties boxes, the Timing list). The slide canvas is hidden from assistive technology on purpose, and the Objects list and Properties panel are the route.

## What was found, and what was done

| # | Found | Standard | Done |
| --- | --- | --- | --- |
| 1 | **The editor did not reflow.** The row of buttons could not wrap, so the page was 1,202 pixels wide at every window size. Zoomed to 200% on a laptop (about 640 pixels) everything scrolled sideways. | WCAG 1.4.10 | The buttons wrap at every width. Below 900 pixels the panels stack in one column in reading order (Slides, Canvas, Timeline, Properties, Objects, Problems); the slide is drawn smaller to fit, and every setting on it is still a box in Properties. Below 640 the dialogs stack their columns. Verified at 320 pixels across 24 slides and every object: no sideways scrolling, nothing clipped. The Timing table scrolls inside its dialog. |
| 2 | **Long dialogs hid what had the focus.** In the Narration dialog, 6 of 100 Tab stops were completely behind the bar of buttons that stays at the bottom. | WCAG 2.2, 2.4.11 | The dialog keeps room above the bar when it scrolls to a focused control. |
| 3 | **Small targets.** Drop-down lists were 19 pixels high, text and number boxes 21, tick boxes 13, and the timeline name buttons just under 24. | WCAG 2.2, 2.5.8 | Every box, list and tick box is at least 24 pixels. (The timeline grips, 10 by 22, are pointer handles; each also has a keyboard slider, and the Timing list is a second route.) |
| 4 | **Button names that did not start with their words.** About 40 buttons showed "Move earlier" but were named "Move rule 1 earlier", so someone who says "click Move earlier" (voice control) was not understood. | WCAG 2.5.3 | The name now starts with what is shown, then says what it acts on: "Move earlier: rule 1". The same for Add condition, Add picture, Use the item's text, Insert row, and the buttons of the cast dialog and the new Looks box. |
| 5 | **A list was a Tab stop for every item.** With 24 slides, a keyboard user pressed Tab 24 times to get past the slide list, and the same for objects and problems. | operability (ATAG A.3) | Each list is one Tab stop (the item last used, else the current one), and the arrow keys, Home and End move between the items, as they already did. Shift and Tab comes back to the item you left. |
| 6 | **Choosing a slide or an object said nothing.** Pressing Enter on one changed the canvas and Properties and a screen reader said nothing. | WCAG 4.1.3 | "Slide 3 of 24: How this lesson works." and "Selected Title, text." |
| 7 | **The first screen had no landmark.** | best practice | "Open a project to begin" is now the page's main landmark. |
| 8 | **A toolbar role without toolbar keys.** The buttons were announced as a tool bar, which promises arrow keys, but each is a Tab stop. | ARIA practice | They are a named group. (A real toolbar would hide most of the buttons from someone who does not know to press the arrow keys.) |
| 9 | **X and Y** were the whole names of the position boxes. | clarity | "Left edge (X)" and "Top edge (Y)". |
| 10 | **The sentence about contrast in Properties was blank** until the first change. | WCAG 1.4.3 help | Filled when the panel is drawn. |
| 11 | **Chosen items could vanish in Windows high contrast**, where the system replaces the colours. | WCAG 1.4.11 | Chosen items, pressed buttons and the canvas selection are marked with system colours. **Added but not tried** (there is no high contrast mode to try it in here). |

## What this pass could not check, for the person with a screen reader

- **The slide canvas and NVDA's browse mode.** It is a focusable group that handles arrow keys. NVDA may keep arrow keys for itself (browse mode) instead of passing them to it. The Objects list and the Properties boxes do the same jobs, so nothing depends on it, but pattern 3 should say whether the canvas keys work.
- **Sections of Properties are not headings.** They are fieldsets with legends, which a screen reader announces on entering a group, but a heading would add a quick key to jump between Timing, Rules and Accessibility. Worth asking someone who uses a screen reader every day.
- **The long descriptions** (`title`) on the buttons are read as descriptions after the name. Too wordy, or helpful? Only listening can say.
- **Keyboard shortcuts** are only in the descriptions and `docs/editor.md`. An in-app list (a Keyboard help dialog) would help someone who does not know them; not built, because it is a new feature.
- **The recorded patterns 1 to 10** in `docs/screen-reader-pass.md`, with the expected results updated for this pass.
- **VoiceOver / macOS**, and **touch**.

## The learner's accessibility panel (2026-10-18)

The published player gained a learner accessibility panel (`docs/learner-accessibility.md`). Checked in a real browser, without a screen reader: it is reached with Tab and opened with Enter; focus moves to the panel, then through labelled controls; Escape closes it and focus goes back to its button; every control is a native one with a label
and the notes are tied to them; every change is announced in words; the panel's text is at least 9.7 to 1 against its background, and the dark, high contrast and yellow modes are 8.2 to 1 or better for every pair (most above 11 to 1); on a phone-sized window it is a sheet no taller than 62 percent of the screen; larger text and wider spacing put the slide in one column so nothing is cut off (WCAG 1.4.4, 1.4.10, 1.4.12);
nothing speaks without being asked, and reading aloud refuses while narration plays. Not checked: a screen reader (`docs/screen-reader-pass.md`, patterns 12 and 13).

## Running the audit again

For any new panel or dialog, run the script. It is a developer tool and is not packaged.

1. `node editor\dev-server.mjs 5173` (the dev server also serves the script).
2. Open `http://127.0.0.1:5173/?dir=` followed by a project folder, choose Open project.
3. In the browser's console: `await import("/__audit.js")`, then `window.__audit()` for the screen as it is, or `await window.__crawl()` to visit every slide and object.
   `await window.__frameAt(320)` loads the editor in a 320 pixel wide frame; `window.__overflow(frame)` and `window.__dialogOverflow(frame)` look for sideways scrolling.

The script is a checklist of things a program can see. It does not replace listening.
