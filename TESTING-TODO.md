# Testing to do by hand

Things that only a person can check, kept as work goes on. Everything else is tested by the suites and by trying the real tools here. Tick a line when you have done it, and write what you saw under it if it was not right.

## Dialogs in the new look, and Find something to add (2026-11-11)

Step 6 of the new look. Built and covered by 10 editor tests, a 44-step check in the browser preview, a tour that opens each of the 37 dialogs the menus open at full size and in a phone-width window, and the editor's own accessibility audit on the new window and eleven others. Not tried in the desktop program's own window or with a screen reader.

- [ ] **The look.** Open a few dialogs (Publish, Themes, Narration, a picker from the Insert menu). Each should be a white panel with rounded corners over a darker page, with an x in the top corner and its buttons at the bottom, the main one in violet. Is anything harder to find than before?
- [ ] **The Close button.** In Edit text, type something and press the x: it should stay open and say you changed the text (Cancel throws the change away), as Escape does. While a publish runs, the x should stop it, as Escape does.
- [ ] **Find something to add.** Insert > Find something to add... (or the first item of the Objects panel's Add). Type "quiz", "picture", "timer", "survey". Add something by keyboard: Down, the arrows, Enter. Is anything missing that you would look for here?
- [ ] **A small window.** Make the editor window narrow, or zoom in with Ctrl and +, and open a long picker (New slide..., Interaction...): Add and Cancel should stay at the bottom while the cards scroll.
- [ ] **With NVDA.** Open Find something to add: NVDA should say "Add to the slide, dialog" and the line under the heading, then the search box. Down then the arrows should read each card's name and its line. Tab should reach the kinds ("All, radio button, checked, 1 of 7") and then Cancel and Close.
- [ ] **Windows high contrast.** The chosen kind and a chosen picker card should be filled in the system's highlight colour; cards and buttons should keep an edge.

## Sections, Go to slide, versions and the publishing style (2026-11-10)

Built from what people who tried Author asked for. Covered by 12 section tests, 8 publishing-style tests, 2 migration tests, 4 Word-document tests and 3 Rust tests, a 40-step check in the browser preview, and a real publish of an example with a style (the files took the styled name; the Word document had Arial, a Heading 1 for each section and "2.1 Numeric" headings). Not tried in the desktop program's own window, in a real LMS or with a screen reader.

- [ ] **Sections in a long course.** Open a long course (or the Question types example), go to slide 6 and use **Slide > New section starting here...**, then make another further down. Close a section, open it, and move one with Alt+Down on its name. Is the list easier to find your way round?
- [ ] **Sorting.** Right-click a section's name and choose **Sort A to Z**, then Ctrl+Z. Is it clear that the course now plays the slides in that order?
- [ ] **Go to slide.** Press Ctrl+J, type part of a slide's name, press Enter.
- [ ] **A new version in the real program.** Give a course a version in Properties (nothing selected, Content, Course details), then **File > Save as new version...**, make a new folder and choose it. The copy should open with the new version beside its title, with its narration audio, and the old folder should be unchanged.
- [ ] **The publishing style in the real program.** Set **File > Publishing style...** to `{code}_{title}_v{version}` with "2.1 Name" headings, then publish. The folder, the zips and the Word document should carry that name; open the Word document and look at its headings and font. Then set it **Back to the usual** and publish again: the names should be the project folder's, as before.
- [ ] **With NVDA.** On a section's name NVDA should say its name, how many slides, "button, expanded" or "collapsed"; Right and Left should open and close it.

## The Properties panel in tabs: Content, Style, Behaviour (2026-11-10)

Step 5 of the new look. Built and covered by 5 editor tests, and driven in the browser preview by a 44-step check (mouse and keyboard); the editor's own accessibility audit finds nothing on any tab of the sample project. Not tried in the desktop program's own window or with a screen reader.

- [ ] **The look.** Choose a text, a button, a question and nothing at all, and look at each tab. Is each thing where you would look for it? Write down anything you would move to another tab (for example, should Narration be under Content, as now?).
- [ ] **Sections that open and close.** Each tab is now a short list of headings with icons (Timing, Animation, Rules...), with only the first one open. Open Rules on a button, then click another button: Rules should still be open. Is it easier to find things? Should a different section start open (for example Rules on a button)?
- [ ] **Labels above the boxes.** Inside a section each label now sits above its box. Is it easier to read?
- [ ] **Keeping the tab.** Choose Behaviour, then click from object to object on the slide: Behaviour should stay. Add a picture: the Content tab should open with the cursor in its Alt text.
- [ ] **With NVDA.** Press F6 until the Properties panel: NVDA should say "Properties, tab list" and the chosen tab ("Content, tab, selected, 1 of 3"). Right should say "Style, tab, selected, 2 of 3". Tab should go into the panel: a section heading should say its name, "button, expanded" or "collapsed", and Enter should open or close it.
- [ ] **Windows high contrast.** The chosen tab should be filled in the system's highlight colour, and the row of tabs should have an edge.

## The welcome page: recent projects and the examples (2026-11-10)

Step 4 of the new look. Built and covered by 10 editor tests and 2 Rust tests, and driven in the browser preview by a 53-step check (mouse and keyboard). Not tried in the desktop program's own window or with a screen reader.

- [ ] **The look.** Start the program with no project open. Is the page clear? Are **New project...** and **Open project...** easy to find, and are the twelve examples worth showing (and in a good order)? The four games are in the second row.
- [ ] **Recent projects in the real program.** Open two or three of your projects, then **File > Close project**. They should be listed, newest first, with the right number of slides. Close the program and start it again: they should still be there. Try **Show in folder** on one.
- [ ] **A project that has moved.** Rename the folder of a project on the list, then click it on the welcome page. It should say it could not open it and offer to take it off the list.
- [ ] **An example in the installed program.** Click an example, make a new empty folder in the folder window, and choose it. The copy should open, and the example in the program's folder should stay as it was (try changing and saving the copy).
- [ ] **The new Order challenge example.** Open a copy and play it with Preview: four rounds of putting steps in order, the score going up, and **Check answer** and **Next round** fully showing on every round.
- [ ] **With NVDA.** Tab through the page: New project, Open project, the list's More button, each recent project (its title, then "6 slides, opened today" and its folder), then the examples (title, "Example, 16 slides", and its line). Escape from a More menu should go back to its button.
- [ ] **Windows high contrast.** The cards, the buttons and the More buttons should all have edges.

## Search for a command (Ctrl+K), and the Keys button (2026-11-10)

Step 3 of the new look. Built and covered by 13 editor tests, and driven in the browser preview by a 46-step check (mouse and keyboard). Not tried in the desktop program's own window or with a screen reader.

- [ ] **The look.** The navy bar has a **Search** box beside Undo. Under the slide, the paragraph of keys is gone; **Snap** and a new **Keys** button are there. Is the slide area tidier, and is **Keys** easy to find?
- [ ] **Finding things.** Press Ctrl+K and type a few words you would use yourself (for example "background", "voice", "quiz", "export", "colour"). Write down any word that should have found something and did not.
- [ ] **In the real program.** Ctrl+K and Ctrl+/ should open the search and the list of keys, not anything of Windows or the program window. In the Edit text window, Ctrl+K should still make a link.
- [ ] **With NVDA.** Press Ctrl+K: NVDA should say "Search for a command, dialog", the line under the heading, then the box. Type "them": after a moment it should say how many were found. Down should read each command with its menu (and "unavailable" for a dimmed one). Enter on **Themes...**, then Escape: you should be back where you started. Tab to the slide: it should read a short line of keys ending "Ctrl+/ lists every key", not the old long paragraph.
- [ ] **Windows high contrast.** The Search box in the navy bar, the chosen line in the search, and the Keys button should still show.

## The panels' Add and ... buttons, and right-click menus (2026-11-10)

Step 2 of the new look. Built and covered by 5 editor tests, and driven in the browser preview by a 47-step check (mouse and keyboard). Not tried in the desktop program's own window or with a screen reader.

- [ ] **The look.** Each panel now has two buttons by its heading: **Add** and **...**. Do you find what used to be the rows of buttons (Duplicate slide, Change layout, Share slides, Copy, Group, Lock and the rest)?
- [ ] **Right-click.** In the real program, right-click a slide in the list, an object in the list, an object on the slide and an empty part of the slide. Each should show our menu (not the browser's menu with Back and Reload). Right-click inside a text box: the usual Cut, Copy and Paste menu should still come up.
- [ ] **The Menu key and Shift+F10.** On a slide in the list, an object in the list and the canvas, each should open the same menu beside it; Escape goes back.
- [ ] **With NVDA.** Tab to the Slides panel's **...** button: NVDA should say "More for this slide, menu button, collapsed" (or similar). Down opens it and reads each item; a dimmed one says "unavailable". Choose **Question banks...**, close it with Escape: you should be back on **...**.
- [ ] **Windows high contrast.** The Add and ... buttons, and an open menu, should still show.

## The new top bar and menus (2026-11-10)

Built and covered by 3 editor tests and 8 tests of `tools/make_ui_icons.py`, and driven by keyboard in the browser preview. Not tried in the desktop program's own window or with a screen reader.

- [ ] **The look.** Open a course in the real program. Is the navy bar with the logo, the course name, Saved, and Undo, Redo, Save, Preview and Publish right? Are the nine menus where you would look for things?
- [ ] **Alt and F10.** Press and let go of Alt: focus should go to File. Press it again: back where you were. F10 does the same. Holding Alt while dragging on the slide must not jump to the menus.
- [ ] **With NVDA.** On File, NVDA should say "File, menu item, collapsed" (or similar) and "menu bar". Down opens it and reads each item with its shortcut; a dimmed one should say "unavailable". Choose Themes, close the window with Escape: you should be back where you started.
- [ ] **Windows high contrast.** The open menu, the item you are on and the buttons in the bar should all still show.

## Get more packs, and the packs page (2026-11-07)

Built and covered by 1 editor test and 16 tests of `tools/pack_for_website.py`; the two dialogs were driven in a test page with a stand-in for the desktop shell, and the page it makes was opened in a browser (all pictures load, no sideways scrolling at phone width). Not tried in the desktop program's own window, and nothing is on the website yet.

- [ ] **The button in the real program.** Open **Characters**, **Choose from the library...**, press **Get more packs...**. Your browser should open `https://openstageauthor.com/apps/openstage/packs` and the dialog should say where to go next. Do the same in the background picker (**Background picture...**). Until the page is uploaded the browser will show an error page, which is expected.
- [ ] **With a screen reader.** Is the button found after **Add a character pack...**, does it say it opens the packs page in the browser, and is the sentence after pressing it read out?
- [ ] **The page.** Run `python tools/pack_for_website.py character-packs/openstage-people-1 --out C:\packs\site --bundled C:\packs\none` (the empty `--bundled` folder is only so the pack that comes with the program can be tried as if it were new), open `C:\packs\site\index.html`, and listen to it with NVDA. Do the headings, the pictures' descriptions and the Download links make sense? Then download the zip from the page and add it with **Add a character pack...**.
- [ ] **Upload.** The packs page lives at `https://openstageauthor.com/apps/openstage/packs` (Jason, 2026-11-07; the address is `PACKS_PAGE_URL` in `editor/src/packs.ts`). Upload the whole folder the tool makes (`index.html`, the zips, the `.sha256.txt` files and `previews/`) so it answers at that address, then open the address in a browser and check the Download links work.

## Captions timed by the quiet gaps in the voice (2026-11-01)

Built and covered by 13 tests with sound made in the test (tones and silences). Never tried on a recording of a real voice, which is the whole point of it.

- [ ] **Try it on a real recording.** Open the captions dialog for a video or audio clip of someone reading a script, make captions from the script, then press **Set the times of my captions by the quiet gaps in the voice**. It needs no model. Play the clip with the captions: does each caption start where its sentence does? The dialog says how many starts are at a pause; where a sentence runs into the next with no pause, the time is a guess, so check those first.
- [ ] **A noisy recording** (a fan, a room): the gate sits 8 decibels over the quiet of the recording, so steady noise should not count as speech, but a recording with a lot of changing noise might. Tell me if pauses are missed or invented.
- [ ] **The marks.** After it runs the captions should be marked as estimates (the Checked button), and a saved .vtt file should say so.

## Order challenge, a fourth game (2026-11-01)

Built and covered by 6 tests, including the real validator and a play-through to a pass and a fail. Not looked at on a screen.

- [ ] **Add one.** In the Slides panel, Add > Game... > Order challenge. Look at an opening slide, a round and the results in the editor and in Preview. Check the four steps fit and the feedback and **Next round** sit below the question, without overlapping.
- [ ] **Play it** in Preview: put a round in the wrong order, then the right order in the next. The feedback says where the right order is; the score at the top of the next round should be the points so far.
- [ ] **Write your own steps** in a round (2 to 8 steps). With more than four, the question's box may need making taller.
- [ ] **With a keyboard and a screen reader:** the Move up and Move down buttons of a sequencing question are the same as everywhere else; check the round reads in a sensible order.

## Text field, a new kind of input (2026-11-01, format 0.48.0)

Built and checked: the player's code in a real headless browser (6 checks: label, hint, text area, when it is told, 250 characters, coming back), the real validator (5 tests), the migration, the editor's model and tests, and the whole suites. Not tried: in the editor itself, with a screen reader, or in a real LMS.

- [ ] **Add one.** In the editor choose Add > Question, input or survey > Text field. It should appear with a prompt, a variable of its own, and Properties for the saved words, the lines, the most characters and a hint. Change each and press Undo. A number outside the limits should be refused in words.
- [ ] **Preview it.** Type in the box. Show the words in a text on the slide (the value of the variable), and make a rule that reacts to it. Leave the slide and come back: your words should be there.
- [ ] **With a screen reader** (NVDA, Narrator): it should say the prompt, then "edit", then the hint. A box of several lines should say it is a multi-line edit.
- [ ] **In an LMS**: turn on Send the answers to the LMS, type a short answer, and look in the LMS report for a fill-in; a long answer is cut at 250 characters.
- Not built: scoring from steps (the other half of this roadmap item), a text field inside a scored question, and an example course using the new field.

## Sound, picture and pointer buttons in this program's recording editor (2026-11-01)

Type-checked and covered by unit tests of the options and the words (4 new tests, the editor's whole suite passes), but the dialog itself has no browser check: nobody has seen these buttons on a screen, so everything below is untried.

- [ ] **Open a recording for editing** (Record > the recording > Edit). Check there are now three buttons beside Save the edit: **Make a video from this edit**, **Make a sound file (WAV) from this edit**, **Save the picture shown in the preview (PNG)**, and a box about the mouse pointer under the motion box.
- [ ] **Make a sound file.** It should be made, say so ("The sound file was made."), and offer **Put the sound file on the current slide**. Put it on a slide: expect an audio clip that asks for a name and captions or a transcript. Listen to it (I have not).
- [ ] **Save a picture.** Move the playhead to a moment, press the button, and **Put the picture on the current slide**: expect an image that asks for alt text. Open the PNG too (it is uncompressed, about 2.8 MB).
- [ ] **The pointer box.** With a recording whose mouse was noted, tick it and make a video and a picture: a soft yellow ring should follow the pointer, a red ring at each click.
- [ ] **While one is being made, the others are refused in words** (you can keep editing). Cancel names what is being made.

## Hiding windows, and picking a window by clicking it (2026-11-01)

Built and checked as far as I could without your screen: Rust tests (438 and one test that makes real windows of its own), the pretend recorder in the browser (56 checks in all for the Recorder app), and two real recordings of a small part of the screen holding only windows I made. What follows is what only you can say.

- [ ] **Hide a window, for real.** In the Recorder, type a word from the title of a window you use (for example the name of a password manager or your mail) in **Hide windows with these words**, record a part of your screen with that window in it, and play the video. Expect a plain dark grey box where the window is, all the time it is there. Then move it, resize it, close it and open it again while recording, and tell me how many pictures it shows before it is covered (I expect none when moved, and a few at most when it opens).
- [ ] **The edges.** The box is the window's visible frame; Windows' shadow round some windows can show as a thin strip. Tell me if that bothers you.
- [ ] **A hidden window with other windows in front of it.** The whole box is covered anyway. Check you are happy with that, because it can hide a window you meant to show.
- [ ] **Pick a window by clicking it.** On the Record screen choose One window, press **Pick a window by clicking it**, and click a window. The Recorder should go to the taskbar, come back, and have that window chosen, and the window you clicked should not have reacted (no button pressed, no text field focused). Try Escape, and a click on the desktop and the taskbar. Only you can say whether this feels right with a mouse and with a screen reader.
- [ ] **Do not use the mouse** while `cargo test -p openstage-capture-windows --lib -- --ignored` runs: its tests watch the mouse buttons for a moment and one clicks a window of its own (I ran them while you were using the computer; one of your clicks may not have registered, and I am sorry for that).

## Zooms suggested from clicks, and noting the mouse (2026-11-01)

Built and tested with the pretend recorder (12 + 5 unit tests, 6 browser checks). Never tried on a recording of your own screen.

- [ ] **Record with the mouse noted.** In the Recorder, tick **Note where the mouse goes and where I click** (under The mouse), record for a minute while you click around a few things (a button, a menu, then somewhere else), and stop. Then open **Edit the recording I just made** and press **Suggest zooms from my clicks**. Expect a short list, one line per stretch of clicking, with when, how long and where. Add one and look at the preview: does the zoom land on what you clicked, and does it feel too close, too far, too long or too short? The numbers are constants at the top of `capture-edit/src/suggest.ts`.
- [ ] **A whole screen.** The picture's size is read from the video; if it says it could not be read, tell me, because that is the one part I could only guess at.
- [ ] **A part of a screen** (the Part of a screen choice): the zooms should be centred on where you clicked inside that part, not shifted by where the part starts.
- [ ] **The wording.** Each suggestion is a sentence; read a few aloud with a screen reader if you can, and say if they are too long.
- [ ] **Privacy.** The notes include the title of the window in front and the name of what you click. Read the words beside the box and tell me if they are clear enough.
- Not built: the same button in this program's own recording editor; asking for step text; letting you change the numbers.

## Quick record in OpenStage Recorder (2026-11-01)

Built and tested with the pretend recorder (11 unit tests, 7 browser checks, 5 Rust tests), and the shell compiles. Never run on Windows: nothing here has recorded your screen, shown an icon, or touched your clipboard. A real recording is screen and (by default) your voice and the computer's sound, so I have not started one.

- [ ] **The button.** In the Recorder, read the sentence beside **Quick record**: it should say your screen, your voice, the computer's sound and the webcam as you have set them, and how to stop. Press the button, do something, press Ctrl+Shift+F11. Expect: a video made, the Record screen showing its path with **Copy the path** focused, and the path on your clipboard (paste it into Notepad). Open the MP4 and look at it and listen to it.
- [ ] **The icon.** Look for the OpenStage Recorder icon in the notification area (it may be under the up arrow). Right-click it: Quick record, Stop recording, Show OpenStage Recorder, Quit. Choose **Quick record**: the window should go to the taskbar and not appear in the video; **Stop recording** should bring it back with the video and its path. Hover the icon: the tooltip should say what is happening. A left click on the icon should show the window.
- [ ] **Quit while recording.** Choose Quit from the icon's menu during a quick recording. It should ask before it stops the recording, the same as closing the window.
- [ ] **Screen reader and keyboard** on Quick record, the path box, Copy the path and Show the video (the browser checks prove only names, roles and focus).
- Choices to change if you want: a key that starts Quick record from any program; closing the window to the icon instead of quitting; a window kept as the target; a quick profile of its own.

## Lower third with a logo (2026-11-01)

Built and tested by the suites (capture-edit 229, capture-timeline 157, the timeline's browser check 77, and the Recorder's copy: app 117 and 41). Nobody has used the button in the real editor with the real file chooser, or looked at the finished video.

- [ ] **Try the button.** In the recording editor (a recording with some time on it), put the playhead where the name should show, press **Lower third with logo** (in the bar of buttons beside the picture, after Zoom and Draw a zoom, with the file buttons) and choose a logo. Expect: two new rows, "Lower third" (the words "Name or caption", white on black) and your logo at the left end of the band; the logo's box for alt text opens first; both last 3 seconds (less near the end). Type the name, give the logo alt text (or mark it decorative), make a video, and look at it.
- [ ] **Look at the logo's shape and place.** It is a square box about 5 percent in from the left and 78 to 92 percent of the way down, and the picture is fitted inside it (not stretched, so a wide logo has empty space above and below). These are constants in `capture-edit/src/callouts.ts` (`LOGO_PLACE`, `LOWER_THIRD_BESIDE_LOGO`); say if you want the logo bigger, on the right, or a different length (3 seconds, the same as every callout).
- [ ] **A zoom during the lower third.** The logo is an imported picture with a place of its own, and those move with the screen in a zoom, while the words stay where they are. So a lower third is best put where no zoom is going on. If you want pictures with a place to stay still in a zoom, say so; it is a change in the video maker and the preview, not in the edit format.
- [ ] **Undo.** One Undo takes away both rows; then Redo brings both back.
- Not in the Recorder yet: it has no file chooser, so the button is not shown there (the code is the same in both).

## Sound-only export, single picture and pointer highlight (2026-11-01)

Built and tested by the suites (exporter 425, render crate 85, command line 18) and tried by me on the real project the MP4 publish makes from the LMS example: a WAV of 284.1 seconds in 3 seconds (peak 62 percent, no clipping), and a 1280 by 720 PNG at 20 seconds that I looked at. Nobody has listened to a WAV or opened a PNG in a viewer, and the pointer has never been drawn from a real recording. The choices I made for you, each easy to change:

- [ ] **Listen to a sound file** made with `openstage-capture render --audio-only --out lesson.wav` (or the Recorder's "Make a sound file (WAV) from this edit") from a recording with your voice and the computer's sound: it should sound like the video's sound, balanced the way the editing screen's Sound balance says, and be as long as the video would be. A WAV is 16-bit, two channels, 48,000 a second, uncompressed (about 11 MB a minute). I chose WAV because it needs no encoder and opens everywhere; say if you want MP3 or M4A (M4A would use Windows' own AAC encoder as the video does).
- [ ] **Open a picture** made with `--frame 20000 --out moment.png` (or "Save the picture shown in the preview (PNG)") in a picture viewer and an editor: it should match what the video shows at that moment, including a zoom in progress and any overlays. A PNG is uncompressed (about 2.8 MB at 1280 by 720); I chose that so it needs nothing to be installed. Say if you want smaller files.
- [ ] **The pointer highlight** (`--highlight-cursor`, or the box in the Recorder's edit screen): record something with "note where the mouse goes" on, then make a video with the option. Check the soft yellow disc follows the pointer, the red ring opens at each click, it does not show where the pointer left the recorded region, a blur or blackout hides it, and with "cuts instead of animated zooms" ticked the ring does not open. It is off unless asked for, and a recording made without noting the mouse says so and is unchanged.
- [ ] **Colours and size of the pointer**: yellow disc, orange ring, red press ring, 3 percent of the picture's height (at least 14 pixels). Look at them on your own screens (a white page and a dark one) and tell me if they are hard to see or too much. They are constants in `capture/crates/openstage-capture-render/src/cursor.rs`.
- [ ] **Screen reader and keyboard** on the Recorder's three new buttons and the pointer box (the unit tests and browser checks only prove the names, roles and focus).

## Essay, choose a word and keyboard shortcut questions (2026-11-01)

Tried in a browser with a real mouse, a real keyboard and the stand-in page (the essay's word count and "write at least 20 words" message, a wrong and a right word, Capture the keys with Ctrl+C and with Escape) and by the suites. Not tried with a screen reader, a phone, or a real LMS. The choices I made for you, each easy to change:

- [ ] An essay is **not marked**: it counts once it has the fewest words (a new one starts at 20, the author can set 0 for any answer), earns all its points, and has one try. Too few words is "Write at least N words first" and does not use a try. If you would rather an essay earn nothing until an instructor marks it, that is a bigger change (the LMS has to mark it), so say so.
- [ ] A learner's essay goes to the LMS as a long fill-in, cut to 255 characters in SCORM 1.2. Try it in a real LMS (SCORM Cloud) and look at what the LMS shows for the answer: does it show the words, and does it cut them?
- [ ] An essay of more than 200 characters is not put back when a learner leaves and returns (SCORM 1.2 has too little room), though the question stays finished. Say if that matters.
- [ ] With NVDA or Narrator on the essay: the box should be read with its label, the "Write at least 20 words." line and "0 words" (as the box's description, once, when it is focused, not on every word typed).
- [ ] Choose a word: the learner clicks a word or uses the list. A **mouse and touch** click on a word worked in the browser; try it on a phone or tablet, where the words are small.
- [ ] With NVDA or Narrator on the choose-a-word question: the passage should read as plain text, the list should be "Choose a word" with every word in it, and a word that comes twice should say its place ("the (word 5)"). Say whether that is enough to answer without the picture of the passage.
- [ ] More than one word may be marked right, and any of them is right (only one is chosen). If you want "choose every right word" that is a different question.
- [ ] Keyboard shortcut: Capture the keys listens for one key and cannot trap (Tab is an answer and the next Tab moves on; Escape alone stops it; leaving it stops it). To answer Escape, type it. Try it with a screen reader running: NVDA may take some keys for itself (the NVDA key, Insert), which a page cannot see.
- [ ] Try the shortcuts a browser or Windows keeps (Ctrl+W, Alt+F4, Win+D, Ctrl+Alt+Delete) with Capture: the page cannot see them, so the validator warns when an author makes one the right answer. Check the warning reads well in the Problems list.
- [ ] A Mac: Cmd is Meta. Try Capture on a Mac with Cmd+C and check it is recorded as `Meta+C` and counts as right when the author wrote `Cmd+C`.
- [ ] The editor's Properties for the three kinds (Written answer, Passage, Shortcuts that are right) in the desktop app: the passage box refusing a stray bracket, and the shortcut box rewriting `ctrl + s` as `Ctrl+S` when you leave it. Tried in the test suite, not in the app.
- [ ] `examples/question-types.osproj` has three new slides (13 to 15); `TEST-PLAN.md` there has the steps for Brightspace.

## MCP access: an AI assistant using the program (2026-11-01)

- [ ] Connect a real assistant. In the desktop app press **MCP access**, tick the box, choose a folder (a new empty one is best), Save, and copy the Claude Desktop block into `claude_desktop_config.json` (or run the Claude Code command). Restart the assistant, then ask it to make a short course with a few slides, a picture, a question and some narration, check it, and publish it. Look at what it made by opening the project in the editor (close the assistant's work first, or open a copy). The server has been tried with the official MCP client library and with a test client, but never with Claude itself.
- [ ] Try the safety on purpose: with MCP access off, connect (it should say how to turn it on); turn it on, then off while the assistant is connected and ask for something (it should be stopped); ask it to open or write something outside the folder (it should refuse).
- [ ] Read `OpenStage MCP log.txt` in the folder after a session. It should say what was done, in order, without the words written on the slides.
- [ ] In the desktop app, check the MCP access dialog end to end: the native folder dialog, Save, Copy (paste somewhere to see the lines), Escape, and that focus returns to the MCP access button. It was tried in a web browser, not in the app. The lines name the program's Node, `mcp\openstage-mcp.mjs` and the settings file: after an installer build, check that those three paths exist on the installed computer (`BUILD INSTALLER.bat` now builds the server into the payload; that step has not been run).
- [ ] With NVDA or Narrator on the dialog: the checkbox should be read with its label and the note about the folder, the two blocks of lines as text boxes with their labels, and the results of Save and Copy from the status line.
- [ ] If a narration voice is installed, ask the assistant to make the audio (`make_audio`) and then publish; the voice needs the lines to include its settings, which the dialog adds only when the voice is installed.
- [ ] Ask the assistant for a course that uses the larger tools: a flip-card or tabs slide, a labeled picture, a branching scenario with two people speaking, a button that shows a layer and adds to a score, and a new theme. Open it in the editor and play it with **Preview**: does each work as asked? Does the scenario read well aloud once the audio is made? Do the rules do what their sentences say?
- [ ] The scenario tool builds a scenario whole, outside the editor's own step-by-step edits (the shape is checked against the format, and the problem check passes). Open one in the editor's scenario panel and change a line, a choice and an effect, to see that the panel reads it as one it made itself.
- [ ] Ask the assistant to make a course and then look at it for accessibility the way a person would (headings, reading order, alt text it wrote for pictures): the tools make what is asked for, and whether its words are good is for you to judge.

## MP4 video of a course (2026-10-31)

- [ ] Watch a real video with the sound on. Publish `examples/lms-test-lesson.osproj` with **Also make a video (MP4)** ticked (or `node player/publish.ts examples/lms-test-lesson.osproj "C:\Temp\lms" --targets=mp4`) and play `lms.mp4` in an ordinary player (Media Player, VLC, Edge). Check that the voice fits the picture (the slide changes when its words change), that nothing is cut off at the start or end of a slide, and whether the pace of the slides is comfortable. The video has been checked as pictures, and by reading its length, size and sound track back, but nobody has listened to it.
- [ ] Put `lms.vtt` beside the video, with the same name, and turn captions on in the player. They should be the narration's sentences, in time with the voice.
- [ ] Try it in the desktop app: Publish with the box ticked, watch the status line, and press Cancel part way through. Then check Task Manager: no extra Microsoft Edge should be left running. Publish again and let it finish. (A cancel leaves a folder of pictures in `%TEMP%` called `openstage-video-work-...`; it is safe to delete.)
- [ ] Look at the video of a course with real effects (`examples/looks.osproj`, or a PowerPoint import with fades and wipes). The motion is pictures a tenth of a second apart, so say whether it looks smooth enough or flickers, and whether the half second cross-fade between slides looks right.
- [ ] The video of `lms-test-lesson` is 33 MB for 4 minutes 44 seconds of mostly still slides (about 0.9 megabits a second), larger than such slides need. Say whether the size matters for how you share it; a choice of quality could be added.
- [ ] If Chrome is installed, set `OPENSTAGE_BROWSER` to its `chrome.exe` and make a video with that.
- [ ] With NVDA or Narrator on the Publish dialog: the new box should be read with its label and its note, and the sentences after a publish (the video's name, what it cannot do, the slides with words nobody reads aloud) should be read once from the status line.
- [ ] A long course (100 slides or more): how long it takes, and whether the status lines keep moving.

## Word review document (2026-10-31)

- [ ] Open a review document in Word. Publish `examples/question-types.osproj` to generate a sample. Publishing writes `<name>-review.docx` beside the packages. It should open without a repair message. If Word says it found unreadable content, say so: that is the one thing the structure checks cannot rule out.
- [ ] In Word, open the Navigation pane (View, Navigation Pane). It should list "How to read this document", "Problems the checker found", "Slides", and under Slides one heading for each slide.
- [ ] Read the first page with NVDA or Narrator. It should read the title, the "How to read this document" paragraphs, and the problems table as a table with a header row (Kind, Where, Problem, Detail).
- [ ] Check a quiz question: each choice is on its own line and the right one ends with "(correct answer)".

## Translation files and the Translate dialog (2026-10-31)

- [ ] Open a translation file in a real tool. Make one with the Translate dialog (or `python tools/xliff.py export examples/minimal.osproj minimal-fr.xlf --to fr-FR`) and open it in OmegaT (free) or Weblate. Check that each paragraph is one segment, that bold and links show as tags you can move, and that the notes say where each piece of text is.
- [ ] Translate a few segments by hand (move a tag, keep a `{1}`), save, and bring the file back with **Bring in a translated file...**. Check that the new course opens and that your words are where they should be.
- [ ] In the desktop app, try the Translate dialog end to end: the language list, the two native file dialogs (the save one should offer `.xlf`, the open one `.xlf` and `.xliff`), Escape, and that focus returns to the Translate button. The dialog was tried in a web browser against the real tool, but not in the app, where the file dialogs are native.
- [ ] With NVDA or Narrator, move through the Translate dialog: the language field should be read with its label and its help line, the list of languages should be announced as suggestions, the checkbox as a checkbox, and the result sentences should be read once from the status line.
- [ ] Look at a pseudo-translated course (the box in the dialog, then Bring in) in the player. Text that is cut off, overflows its box or wraps badly is where a real, longer translation will do the same. (Every page of twelve examples was scanned by a program for English that did not change, but nobody has looked at the layout.)
- [ ] Hear a translated course read by a screen reader that speaks the language (NVDA with a French voice, say). The player's phrases such as "Slide 2 of 9" should be in the language, and the page's language should be set so the right voice is chosen.
- [ ] Choose a voice for the translated narration: the scripts are marked as the new language, but the voice is still the English one until the author chooses another.

## Earlier, not yet checked by a person

- [ ] A real LMS test of the SCORM 1.2, SCORM 2004 and xAPI packages. **Jason reported on 2026-11-01 that all three worked in Brightspace**, but he has instructor access only (no student or test student), so that shows launch and play, not what Brightspace recorded. Left open until the scores, resume and xAPI statements are on record in `LMS-RESULTS.md`; SCORM Cloud is the free way to get them. Everything is ready (2026-11-01): open `dist/lms-test-pack/LMS-START-HERE.md` (rebuild the folder with `PUBLISH LMS TEST LESSON.bat`). Brightspace first; a SCORM Cloud free Trial is the free second opinion and the way to see xAPI statements. `player/tools/lms-rehearsal.mjs` is the answer key played through the pretend LMS and LRS.
- [ ] NVDA or VoiceOver on the sliders and dials, the enlarge button and its dialog, the labeled graphic (markers as tabs) and the guided Previous and Next step buttons with their "Step 2 of 5" line.
