# Comparing a PowerPoint import with PowerPoint itself

These are developer tools, not part of the product. They answer one question: *does a deck that comes into OpenStage Author look like the deck?* They were made on 2026-10-21 to
find what was "wonky" in a real deck's import, and they are how the text-box, shrink-to-fit and animation work was checked slide by slide.

They need Windows with PowerPoint installed (to draw the deck's own pictures), Node.js, Python (for a local web server) and Microsoft Edge. Nothing here changes the deck.

1. **Pictures from PowerPoint.** `powershell -ExecutionPolicy Bypass -File ppt_export.ps1 DECK.pptx OUT\ppt` opens a copy of the deck in PowerPoint (read-only, no window) and
   writes `slide-001.png` and so on at 1280 by 720, and `info.json` with each slide's speaker notes and animation effects.
2. **Import the deck** with the editor's own code: `node import_deck.ts DECK.pptx OUT\project` writes a project folder and prints the import report. (There is no picture
   of background colours here, because that is worked out in the browser, so the validator may report contrast errors on this project. They are not real.)
3. **Publish and photograph it.** `node ../../player/publish.ts OUT\project OUT\pub --preview`, serve `OUT` with `python -m http.server 8766` (in the background), then
   `node shoot_deck.mjs http://127.0.0.1:8766/pub/index.html OUT\shots SLIDE_COUNT` presses Next through the course and saves the stage for each slide. The course has one more slide
   than the deck (the new project's title slide comes first).
4. **Lay them side by side.** `node sheets.mjs OUT\ppt OUT\shots OUT\sheets 1 45 1` makes a picture for each two slides, PowerPoint on the left and OpenStage on the right
   (the last argument is how many slides the course has before the deck's first).

Look at the sheets. What to look for: where the words start in their box, the room round them, how large the words are, line and paragraph spacing, bullets, anything
that peeks in from outside the slide, and which pictures are showing before anyone presses **Show next item**.
