# The OpenStage look: design guide (version 1, 2026-11-10)

This is the one place the suite's look is decided. It covers OpenStage Author, OpenStage Recorder, OpenStage Capture Express, OpenCapture and OpenStage Assess (OpenStage Guide, PDFRemediator and OpenScroll stay as they are). It started from Jason's design specification of 9 November 2026 (the navy, white and violet mockups) and his wish for **fewer buttons, more dropdown menus, and icons**.

The files that go with it:

* `openstage-ui.css`: every colour, size and font below as named values. Each product keeps a copy with the same version line.
* `icons.json`: which icon each command uses, for every product. `tools/make_ui_icons.py` checks the names and writes `ICONS.md`.
* `REVAMP-CHECKLIST.md`: what is done in which product.

## 1. Colours

Every pairing below was measured (WCAG contrast ratio). Words need 4.5:1, the edges of controls need 3:1. Body words are kept above 7:1.

| Name | Colour | Where it goes | Checked against |
|---|---|---|---|
| Shell | `#0D1B30` | The navy bar along the top | white words on it 17.3:1 |
| Shell, hover | `#1C2D49` | A button in the bar under the pointer | white words 13.8:1 |
| Words on the shell | `#FFFFFF` | Titles and buttons in the bar | |
| Quiet words on the shell | `#B9C4D4` | Document name, saved state | 9.8:1 on the shell |
| Page | `#EEF1F5` | Around the slide or the video | |
| Surface | `#FFFFFF` | Panels, dialogs, fields | |
| Subtle surface | `#F7F9FC` | Quiet groups inside a panel | |
| Words | `#192A43` | Almost all text | 14.5:1 on white, 12.8:1 on page |
| Muted words | `#5A6980` | Extra detail only | 5.6:1 on white, 4.9:1 on page |
| Divider | `#DCE3EB` | Lines between areas, decoration only | |
| Control edge | `#7A8699` | The outline of a field, a box, a plain button | 3.7:1 on white, 3.3:1 on page |
| Focus | `#0B3FB3` with a white halo | Keyboard focus, everywhere, the same as the course player | |
| Success | `#1D7454` on `#E3F3EC` | "Saved", "Ready" | 5.0:1 |
| Warning | `#8B5918` on `#FBF0DF` | "Needs a look" | 5.3:1 |
| Danger | `#B44248` on `#FBE7E8` | Errors, Stop, Delete | 4.6:1 |

**Each product has its own colour.** The pale colour of the logo is only for the logo, the navy bar and decoration: it is too faint to read on white (lavender 2.8:1, coral 2.5:1). Anything you press or read uses the deeper colour.

| | Author | Recorder | OpenExplainer (OpenCapture) | Capture Express |
|---|---|---|---|---|
| Buttons you press, links, the chosen tab | `#6656B7` (white words on it 5.9:1) | `#A83653` (6.3:1) | `#7D5E00` (6.1:1) | `#4E57BC` (6.2:1) |
| The same, under the pointer | `#54459E` | `#8E2A45` | `#664C00` | `#3E46A3` |
| Background of a chosen item | `#EEEAFB` (violet words on it 5.0:1) | `#FBEBEF` (5.5:1) | `#FBF4DC` (5.5:1) | `#ECEEFC` (5.3:1) |
| Product colour on the navy bar | `#C9B6FA` (9.5:1) | `#F7A9B6` (9.3:1) | `#FFCD28` (11.5:1) | `#9CA5FF` (7.6:1) |
| Logo only | `#AA88F4` | `#F47F90` | `#FFCD28` (the gold of its icon) | `#9CA5FF` to `#7D87F2` (its icon's indigo) |

OpenExplainer's pair (2026-11-11) comes from its icon, a gold viewfinder on a navy tile named "OpenCapture". Its deeper gold is near the warning colour, so a warning always carries words or a symbol too. It lives in OpenExplainer's own `src/style.css` (as `--oe-*`), not in this file, so the products' copies of version 1 stay the same. Capture Express's pair (2026-11-11) is the indigo of its icon: the light end `#9CA5FF` is light enough to be its name on the navy bar, and a deeper indigo of the same hue is its control colour. Express draws its window in Rust (egui), not a web page, so the suite's colours are written into its `src/ui/theme.rs`, where a test measures every pairing; it also keeps a dark scheme of its own (navy panels, the light indigo for links, navy words on its indigo buttons), which Author does not have. Assess gets its own pair the same way when its turn comes (logo colour for the logo, a deeper, measured colour for controls).

The colours of the programs never change a course. Author's look is the editor around the slide; what a learner sees is the course's own theme.

## 2. Words and spacing

* Type: Segoe UI, which every Windows computer has. Nothing to download or bundle.
* Sizes: 14 px for most words, 12 px for small detail, 15 px for panel headings, 18 px for titles. People can still zoom the whole program.
* Space comes in steps of 4 px (4, 8, 12, 16, 24). Corners are rounded 6 px on small controls, 8 px on panels, 12 px on dialogs.
* Buttons are 32 px tall. A button you can press is never smaller than 24 by 24 px.

## 3. Icons

* **One set only: Lucide**, the outline icons Author already ships for course icons (ISC licence, in `editor/web/icons/lucide.json`). They are drawn as lines in the colour of the words around them, so they stay right in high-contrast mode and dark mode, and they all share one grid and one line weight.
* **Icon and word** on the main buttons (Save, Preview, Publish, Start recording) and in every menu item.
* **Icon alone** only on small buttons that repeat in a list (move up, delete, more). Those always have a spoken name and a tooltip, and the name starts with the words of the tooltip.
* An icon never carries meaning by itself: a state always has a word ("Saved", "Recording", "Paused").
* Icons next to words are hidden from screen readers, so nothing is read twice.
* Pictures that are not buttons (logos, a welcome illustration, an empty-page picture) can be drawn by hand or by an image tool, in the colours above.

## 4. Fewer buttons: the layout

Every program has the same three layers:

1. **The navy bar.** The product's logo and name, the name of what is open, whether it is saved, and **at most five buttons** for the things done all the time (in Author: Undo, Redo, Save, Preview, Publish), plus search.
2. **The menu row.** Words that open dropdown menus (in Author: File, Edit, Insert, Slide, Design, Narration, Review, Tools, Help). **Everything** a program can do is in a menu, with its icon and its keyboard shortcut, even if it is also a button somewhere.
3. **The work.** The slide, the video or the recording is the biggest thing on screen. Panels around it keep **one main button** (such as **+ Add**) and a **...** button that opens the rest.

Right-click on a slide, an object or a clip opens the same menu as its **...** button.

**A panel of properties** is split into tabs, **Content** (what the learner reads, hears and is told, with accessibility), **Style** (how it looks and where it sits) and **Behaviour** (when it comes and goes and what it does), as a row of words in a box with the chosen one filled in the product colour. A tab with nothing in it is left out. The tab chosen is kept from one item to the next. The row stays at the top while the panel scrolls. A badge beside the panel's heading says what is chosen. Inside a tab each group is a section that opens and closes (a full-width heading button with the section's icon, its name and an arrow, expanded or collapsed), so a tab starts as a short list of headings with only its first section open; what the person opens or closes stays so from one item to the next, and a jump to a box opens its section. Inside a section each label sits above its box.

**A dialog** is a white panel with rounded corners (12 px) and a soft shadow over a navy veil, never wider or taller than the window (it scrolls inside). Its heading is at the top, with a **Close** button (an x, named Close) in the corner that does exactly what Escape does. Its last row of buttons is its foot: a line above it, it stays in sight at the bottom while the rest scrolls, and its main button (the first one that is not Cancel or Close) is filled in the product colour; the rest are white with a grey edge. Focus starts on the first thing to fill in or choose, not on Close (which comes last in the order). Choices shown as cards are radio buttons or buttons under the card: a chosen card has a 2 px edge in the product colour, its tint and a tick, never colour alone.

**Adding things** has one window as well as the menus: a search box first, a row of kinds as radio buttons, and a card for each thing (an icon on a tinted square, its name, one line about it). Only one card is a Tab stop; Down goes from the box to the cards and the arrow keys move between them. Choosing one does exactly what its menu does.

**A long list** (the slides of a big course) is grouped into sections that open and close the same way: a section's name with how many it holds, and its items under it; Right and Left open and close it from the keyboard, and **Go to** (Ctrl+J in Author) finds any item by its name.

**The welcome page** (what a program shows with nothing open): its main one or two actions as large buttons (in Author, **New project...** filled in the accent colour and **Open project...**), a card of what was open lately (each one a button, with a quiet **...** that shows its edge only when the pointer or the keyboard reaches it), and the examples as cards that open a copy. The list of what was open lately stays on the computer, and the person can clear it or turn it off (in the **...** beside its heading). **File > Close** comes back to it.

## 5. Menus and the keyboard

Menus are for everyone, including people who never use a mouse:

* **F10** (or pressing and releasing **Alt**) moves to the menu row. **Left** and **Right** move along it, **Down** or **Enter** opens a menu, **Up** and **Down** move in it, **Home** and **End** go to the first and last item, a letter jumps to the next item starting with it, **Escape** closes the menu and goes back where you were.
* A panel's **+ Add** and **...** buttons open their menus with **Down**, **Enter** or **Space** (**Up** opens on the last item). **Shift+F10** or the **Menu** key on a slide, an object or the canvas opens the same menu as a right-click, beside it. **Escape** or **Tab** closes a menu and goes back to the button or item it came from.
* Outside boxes for typing, the browser's own right-click menu (Back, Reload, Print) never shows: Reload would throw away unsaved work.
* Every shortcut the programs have today stays the same.
* An item that cannot be used right now stays in the menu, dimmed, so people learn where things are.
* **Ctrl+K** opens a search box that finds any command by name, so nobody has to remember which menu holds it. It is also a **Search** button in the navy bar (made to look like a box to type in) and an item in the Help menu. Inside a dialog Ctrl+K belongs to the dialog (in Author's Edit text it makes a link).
* **Ctrl+/** (and Help > Keyboard keys) lists every key the program has. Long paragraphs explaining keys do not sit on the work area: a small **Keys** button opens the same list, and a screen reader hears a short line about the keys used most.
* After a menu opens a dialog and the dialog closes, focus goes back to where it was before the menu opened.
* **F6** still moves between the areas of the window.

## 6. States and messages

* Saved, Unsaved, Recording, Paused, Problems: always a word, often an icon and a colour too, never colour alone.
* Short messages in a status line, read out once by screen readers; a timer is never read out every second.

## 7. Not yet decided

* Dark mode (the colours above are for the light look; Windows high-contrast mode already works and must keep working).
* The colours for Assess.
