# Brightspace test plan: "Choosing the Right Channel at Work"

Package to upload: `dist\lms-test-lesson-scorm12.zip` (SCORM 1.2, 14.5 MB, most of it voice). Parts of this plan were run once in a real Brightspace
(what was found is in `LMS-RESULTS.md`), and the rest has not been run. Everything under "What the stand-in LMS showed" is
from the project's own pretend LMS (`TEST WITH STAND-IN LMS.bat`), which is the point of the test: to find out where a real LMS differs.

## What is in the lesson

24 slides, about 15 minutes, 30 narrated objects (with captions and a transcript), and 21 more narrations inside the
interactions: every flip card, tab, step, accordion heading and glossary term has its own voice. One original diagram with
a credit, one embedded YouTube video, a results page, a certificate and two files to download (a PDF and a Word document). Every slide opens with a voice except slide 12,
which is silent on purpose so it does not talk over the video. The course counts as complete when the learner has seen **every
slide** and finished every quiz (that is the lesson's "Complete when" course setting).

| Slide | What it is | What it tests |
| --- | --- | --- |
| 1 Welcome | Title, narrated | Launch, narration, autoplay |
| 2 Learning objectives | List, narrated | Text, narration |
| 3 How this lesson works | Instructions, narrated | Text, narration |
| 4 A quick question first | Narrated. A 1 to 5 agreement question and a "where do you work" choice | Survey answers saved, sent to the LMS, and remembered on resume |
| 5 What is a channel | Four flip cards, each with its own voice | Interaction by keyboard, item audio |
| 6 Channel richness | Four tabs, each with its own voice | Interaction by keyboard (arrow keys), item audio |
| 7 The richness ladder | A diagram with alt text | Image, Credits button |
| 8 Comparing channels | A table with header row and column | Table |
| 9 Choosing a channel | Four steps, each with its own voice. **Adaptive:** extra layers appear from your slide 4 answers | Variables and rules, and that they survive resume, item audio |
| 10 Common mistakes | Three accordion headings, each with its own voice | Interaction, item audio |
| 11 Key terms | A glossary of six terms, narrated with a taught pronunciation; each term is read aloud when you choose it | Glossary, search, item audio |
| 12 Embedded video test | A YouTube video, with a text alternative under it. No narration | An embed inside the LMS frame |
| 13 Knowledge check | Section slide, narrated | Narration |
| 14 to 18 Questions 1 to 5 | Graded questions with feedback | Scoring, attempts, feedback layers |
| 19 Your results | Narrated. Your score, passed or not, and each question | The results box |
| 20 Your certificate | Narrated. For learners who pass: type your name, then print or save a PDF | The certificate and printing |
| 21 Your feedback | Narrated. Rate three pairs of words, tick topics | More survey data sent to the LMS |
| 22 Take-home guides | Narrated. Two files to download: a PDF checklist and a Word guide, each with a description | Files to download, saving to the learner's computer |
| 23 A timed slide | Narrated. Three steps that each slide in from the left as their narration starts, and a tip that fades in after 4 seconds | Timing, animation, pausing, show everything |
| 24 Summary | Key points and a scrolling recap | Scrolling text, last slide |

## Answer key

Each question is worth 10 points, 50 in all. The pass mark is **80 percent**, so you need **4 of 5**.
A right answer earns the full 10 points on any attempt. A wrong answer with no attempts left earns 0.

| Question | Right answer | Attempts |
| --- | --- | --- |
| 1 | **B** A group chat message | 2 (this one lets you try again) |
| 2 | **True** | 1 |
| 3 | **C** A private conversation, in person or on video | 1 |
| 4 | **A** An email that summarizes the decision | 1 |
| 5 | **B** Channel overload | 1 |

Answer by choosing an option and pressing **Check answer**.

## Before you start

* Upload the zip to your Brightspace course as a SCORM package. The menu names differ between Brightspace versions
  (look under Content, or under Course Admin and Import). If you cannot find it, ask whoever manages the LMS, or look in its help.
* **Use a test student, not instructor preview.** Most LMSs record nothing in preview, so a missing score may just be that.
* Each test below needs a fresh attempt. How you get one depends on how Brightspace is set up: a second test student is
  easiest, or ask whoever manages the course to clear the attempt. Three attempts in all cover everything: tests 2, 3 and 4.
* The video on slide 12 needs the computer to be online, and the school network has to allow YouTube.
* Write down what Brightspace shows after each test. Screenshots of the learner's result are the most useful thing you can send.

## The tests

### Test 1. Launch and look (no score needed, do this first)

1. Open the lesson. **Expect:** it opens with no error, in a frame or window you can read. If it opens small, note it.
2. Press **Play narration** if the sound has not started. **Expect:** a voice reads the title. Browsers often block sound
   until you click something, so needing to press Play is normal.
3. Turn **Captions** and **Transcript** on and off. **Expect:** the caption line follows the voice, and the transcript shows the words.
4. Use **Next** and **Back** through slides 1 to 11. Open every flip card and tab on slides 5 and 6. **Expect:** slides 3
   and 4 now have a voice as well, and each flip card and tab speaks when you open it (Test 9 looks at that closely).
5. Press **Credits**. **Expect:** it names the diagram on slide 7.

### Test 2. A failing attempt (about 5 minutes)

1. On slide 4, choose any agreement answer and any workplace.
2. Go through the slides to the questions. Answer **1 right, 2 right, 3 right, 4 wrong, 5 wrong.**
   Wrong answers: Q4 B or C, Q5 A or C.
3. On slide 19, read the results. **Expect:** "You scored 30 of 50 points (60%). You did not reach the pass mark.", the
   pass mark of 80%, and a line for each question: 1 to 3 "correct, 10 of 10 points", 4 and 5 "not correct, 0 of 10 points".
4. On slide 20. **Expect:** no way to make a certificate, and a sentence saying it is for learners who pass.
5. Go on to the end, slide 24, so every slide has been seen.

**Expect in Brightspace:** the attempt is **failed**, the score is **60** (30 of 50 points). Write down exactly how
Brightspace words completion, success and the score. SCORM 1.2 has only one status, so a learner who finishes but fails
is reported as *failed*, never as *completed*. That is how SCORM 1.2 works, not a fault.

### Test 3. A passing attempt at the edge, and the certificate (about 8 minutes)

1. Answer slide 4 however you like.
2. On Question 1, choose **A** first (wrong), then **B** (right) after the "try again" message.
3. Answer Questions 2, 3 and 4 right, and **Question 5 wrong.**
4. On slide 19. **Expect:** "You scored 40 of 50 points (80%). You passed. Well done."
5. On slide 20, press **Make my certificate** with the name box empty. **Expect:** "Type your name first." and your
   cursor in the box. Then type your name and press it again. **Expect:** a certificate with the title, "This certifies
   that", your name, the course title, "Score: 80%", today's date and "OpenStage Author sample lesson".
6. Press **Print or save as PDF**. **Expect:** the print window opens and shows **only the certificate**, in black on
   white, across the page. Choose "Save as PDF" and open the file. If **nothing happens** when you press it, say so:
   some LMS frames block printing, and the lesson would need another way to save it.
7. Go on to slide 24.

**Expect:** **passed** with a score of **80** (4 of 5), because Question 1 earned full points on its second try.
If Brightspace shows something else for 80 percent exactly, that is an important finding: say so.

### Test 4. Resume (the one most likely to go wrong)

1. Start a fresh attempt. On slide 4 choose **Strongly disagree** and **Remotely.**
2. Go to slide 9. **Expect:** two extra notes appear under the steps, "Extra help" and "Remote tip".
3. Go on to the questions. Answer Question 1 right (choose B), Question 2 right (True), then go **Next** to Question 3 and stop there, unanswered.
4. Close the lesson window without finishing, then open it again.

**Expect:**

* It opens on **Question 3**, not at the start.
* Press **Back**: Question 2 and Question 1 show your answers, locked.
* Press **Back** to slide 9: both extra notes are still there. Back at slide 4, your two answers are still chosen.
* Finish: answer 3, 4 and 5 right and go to slide 24. **Expect passed, score 100**, and slide 19 shows 50 of 50.

### Test 5. The adaptive slide

Only if you have attempts to spare. On slide 4, **Agree** and **In an office** should give **no** extra notes on slide 9.
**Neutral** and **Remotely** should give only the Remote tip. **Disagree** and **A mix of both** should give only Extra help.

### Test 6. Keyboard only

Do Test 1 again without the mouse. Tab to move, Enter or Space to choose, arrow keys inside the tabs, and Check answer
by keyboard. Also type your name and make the certificate by keyboard. **Expect:** you can reach and use everything, you
always see where you are, and focus never gets stuck. Brightspace puts the lesson in a frame, so note whether Tab can
get **out** of the lesson and back into the page.

### Test 7. Screen reader (optional, if you have NVDA)

Slide titles should be announced when you move. Questions should read as a group with their options. Feedback should
be announced after Check answer. The transcript should be readable text. On slide 19 the results should read as a
region with the score first. On slide 20 the name box should be labelled, and "Your certificate is ready" should be announced.

### Test 8. The embedded video (slide 12)

This slide is only here to test an embed. The video has nothing to do with channels. In your first run it loaded and played.

1. Go to slide 12. **Expect:** a YouTube player with a picture of the video's title ("The New Claude Motion Is Awesome"),
   and a **Transcript** line under it that opens a short text description.
2. If you see a grey or blank box, or a message such as "Video unavailable" or "Error 153" or "refused to connect", **write
   down exactly what it says.** That is a real result: some LMSs and school networks block videos from other sites.
3. Press play. **Expect:** it plays inside the lesson, with sound. Press **CC** in the player. **Expect:** English captions
   (these are YouTube's automatic captions, nobody has checked them).
4. Use the keyboard: press Tab until focus is inside the video, use the player's own controls, then Tab out again.
   **Expect:** you can get out of the video again, and on to the Back and Next buttons.
5. Press **Next** while it is playing. **Expect:** the video stops.
6. Note whether the learner's score or status changes because of the video. **Expect:** it does not. Videos from
   YouTube are not tracked, so watching one never counts as completing anything.

### Test 9. Audio for each item (slides 5, 6, 9, 10 and 11)

Text should have audio available, so the items inside the interactions speak too. Try each, listening and watching.

1. **Slide 5, flip cards.** Turn a card over. **Expect:** a voice reads that card's name and its text, and the caption bar
   shows the same words. Turn another card: the first voice stops and the second starts. **Flip back** does not start any sound.
   On the back of the card there is a **Listen** button: press it, and the same card is read again.
2. **Slide 6, tabs.** Click the second tab. **Expect:** that tab is read. Now click into the tab row and use the **Left and
   Right arrow keys**. **Expect:** the tab changes, and **nothing is read** (this is on purpose, so a screen reader can say
   each tab's name without a voice talking over it). Press **Enter** on a tab, or its **Listen** button, to hear it.
3. **Slide 9, steps.** Press **Next step**. **Expect:** the new step is read. **Previous step** and a step's own button do the same.
4. **Slide 10, accordion.** Open a heading. **Expect:** it is read. Close it: silence. Open two headings one after the
   other: the second voice replaces the first.
5. **Slide 11, glossary.** When the slide opens, the slide's own voice reads the introduction and the first term is showing but
   not read. Press its **Listen** button. **Expect:** "Asynchronous" is read, with the taught pronunciation ("ay-SING-kruh-nus"
   and not "a-sink-ron-us"). Choose other terms from the list: each one is read when you choose it.
6. **The transcript.** Open **Transcript**. **Expect:** it lists each item that has been read, in the order you opened them.
7. **Turn the sound off** (the narration bar's Pause, or the computer's mute) and use the items again. **Expect:** everything
   still works and every word is on the screen, as a caption and in the transcript.
8. **Keyboard only.** Tab to a **Listen** button and press Enter. **Expect:** it works, and focus stays where it was.

### Test 10. Files to download (slide 22)

Learners are told what a file is before they download it, and nothing opens in a pop-up.

1. Go to slide 22. **Expect:** a voice introduces the slide, then reads each file's name, what it is, its kind and how to
   save it, with captions. Two boxes show the same: a name, a description, the kind of file and its size ("PDF document,
   60 KB" and "Word document, 4 KB"), a **Download** button, and one sentence about saving the file.
2. Press **Download Channel checklist**. **Expect:** the PDF is **saved** to your computer (look in your Downloads folder, or
   wherever the browser keeps files). **Expect no pop-up window**, and the lesson stays where it is. If instead the PDF opens
   inside the lesson frame, or a blocked-pop-up message appears, **write down exactly what happened.**
3. Press **Download Channel guide**. **Expect:** the Word file is saved. Open it. **Expect:** a titled page with three headings, a
   numbered list and a table. Open the PDF too: it should read in order.
4. **Keyboard only.** Tab to a Download button and press Enter. **Expect:** the same as with a click.
5. **Screen reader (optional).** Each box is a group named "Channel checklist, a PDF to download". On the button the reader
   should say what the file is and its kind after the button's name.
6. Note whether Brightspace asks anything before saving, and whether it saves with the same file name.

These two files were made for this test. The PDF was checked for a tagged structure, a language and a title, and the
Word file for real heading styles, a numbered list and a table with a header row. The Word file was written by hand and has not
been opened in Word, and nobody has read either file with a screen reader. If Word complains, or you do read them aloud, note what happened.
Do not reuse them as real course material: they were made only to test the download.

### Test 11. Timing (slide 23)

Things that appear by themselves can leave someone behind, so the learner is always in charge. Try it all.

1. Go to slide 23. **Expect:** above the slide there are two buttons, **Pause timing** and **Show everything now**. The title is
   spoken, and the three steps are **not showing yet**. Each step appears **as its own narration starts**: "Step 1" when the voice
   says "Step one", then step 2, then step 3. A tip appears 4 seconds after the slide opened.
2. Go to another slide and back. **Expect:** the timing starts again from the beginning. On a slide with no timing (slide 22,
   say) the two buttons are not there.
3. Press **Pause timing** early. **Expect:** the button now says **Resume timing**, a screen reader says "Timing paused", and the
   tip does not appear however long you wait. Press **Resume timing**. **Expect:** the tip appears after the time that was left.
4. Open the slide again and press **Show everything now** at once. **Expect:** the steps and the tip all show, and the button
   goes grey. It does not move you on.
5. **Sound blocked.** If your browser refused to start the sound (you have not clicked anything yet), the steps are not left
   hidden: they all appear when the browser refuses. Note whether that happened to you, and whether pressing Play then still works.
6. **Keyboard.** Tab to the two buttons and use Enter. **Expect:** the same. Hidden steps are not reachable by Tab until they show.
7. **Screen reader (optional).** The steps should be read in their place in the page once they appear, and not before.

There is no automatic advance in this lesson, because it would get in the way of the other tests. The editor and the player both
support it, and it was tried on a small separate course: the slide moved on after its time, and pausing stopped it.

### Test 12. Animation (slide 23)

Motion is a barrier for some learners, so it is small, short and optional. Try it on the same slide as Test 11.

1. Go to slide 23. **Expect:** each step **slides in from the left** over about half a second as it appears, and the tip **fades in**.
   Nothing repeats, flashes or bounces.
2. Look at the buttons above the slide. **Expect:** a third one, **Turn off animation**. Press it. **Expect:** it now says **Turn on
   animation**, a screen reader says "Animation turned off", and the next time you open the slide the steps and the tip simply appear.
   Press it again to turn animation back on.
3. **Reduced motion.** Turn on your computer's setting for less motion (Windows: Settings, Accessibility, Visual effects, Animation
   effects off; Mac: Accessibility, Display, Reduce motion), reload the lesson and open slide 23. **Expect:** nothing moves, the steps and
   tip still appear at the same times, and **there is no Turn off animation button**, because there is nothing to turn off.
4. **Show everything now.** Open the slide again and press it at once. **Expect:** everything shows immediately, without waiting for effects.
5. Note whether any text ever flickers, jumps, or is hard to read while it arrives.

### Test 13. A narrow window and a zoomed page (any slide)

Learners use phones, small windows and zoom. When the room is narrow the lesson should become one column, in reading order, and
never need sideways scrolling.

1. Open the lesson in Brightspace on a computer and **zoom the page in** with Ctrl and the plus key until it reads 300 or 400
   percent (or drag the window narrow, to about 400 pixels wide). **Expect:** each slide becomes one column, text wraps and is
   larger than a shrunken picture of the slide would be, and **there is no sideways scroll bar** on the page. Back and Next are still
   there. Brightspace shows the lesson in a frame, so also try making that frame narrow if you can.
2. Go through slides 1 to 11 and 22 to 24. **Expect:** slide 1's title and sub-title sit in their dark panel; slide 5's flip cards stand
   one under another; slide 6's tabs and slide 9's steps still work; slide 11's glossary shows its list above the definition.
3. Zoom back to 100 percent. **Expect:** the fixed slide comes back, as it was.
4. **A phone, if you have one.** Open the lesson from Brightspace in a mobile browser, held upright. **Expect:** the same one-column
   layout, buttons big enough to press, and the sound controls still reachable.
5. **A screen reader or the keyboard** (optional). **Expect:** Tab and the reading order are the same in one column as at full size.
6. Note anything that is cut off, overlaps, or is hard to read at the large sizes.

## What the stand-in LMS showed

The published package was run through the project's stand-in SCORM 1.2 system. A real LMS should match these:

| Run | Result in the stand-in LMS |
| --- | --- |
| All 5 right | passed, score 100, and only after reaching slide 24 |
| 4 right, Question 5 wrong | passed, score 80 |
| 3 right, Questions 4 and 5 wrong | failed, score 60 |
| Question 1 wrong then right, the rest right | passed, score 100 |
| Stopped on Question 3 and relaunched | opened on Question 3, entry mode "resume", answers 1 and 2 locked, survey answers and extra notes restored, finished as passed 100 |
| Status after Question 5, before the last slides | still "incomplete" (a course counts as complete only when every slide has been seen) |
| Slide 4 answers | 1 and Remotely: both extra notes. 3 and Remotely: Remote tip only. 2 and a mix: Extra help only. 4 and in an office: neither |
| Slide 19, all right | "You scored 50 of 50 points (100%). You passed. Well done.", the pass mark, five "correct" lines |
| Slide 19, 3 right | "You scored 30 of 50 points (60%). You did not reach the pass mark.", and Questions 4 and 5 "not correct" |
| Slide 19 before any question | "You have finished 0 of 5 questions so far. Finish every question to see whether you passed." |
| Slide 20, passed | name box; empty name refused; certificate appears; Print button |
| Slide 20, failed or not finished | no name box, only a sentence saying why |
| Slide 12 in an ordinary browser | the YouTube player appeared with its picture. It was not played |
| Slide 23 effects, in an ordinary browser | each step slid in over 0.6 seconds from 40 pixels to the left of its place and the tip faded in over 0.8; nothing was left running afterwards; Turn off animation stopped the effects on the next visit and announced itself; with the device set to reduced motion no effect ran and the button was not offered |
| Slide 23 in an ordinary browser | steps hidden at first and shown as their narration started (at the moments their sounds began); the tip at 4 seconds; Pause froze it for as long as it was left and Resume finished the time that was left; Show everything showed all and greyed its button; the buttons were gone on the next slide; with the sound refused, the three steps showed at once |
| Reflow, in an ordinary browser 320 pixels wide | all 24 slides of this lesson, and all 23 slides of the interactions example, show as one column; none needed sideways scrolling; widening the window to 1280 brought the fixed slide back with no leftover changes. The title slide, flip cards, glossary, timeline, process circle, pyramid, Likert and semantic differential slides and the embedded video were looked at. A real phone and Brightspace's frame were not tried |
| Slide 22 in an ordinary browser | both files listed with their kind and size, links to `assets/documents/...` with a `download` name and no new window; both files fetch with the right type. Download was not pressed |
| Items on slides 5, 6, 9, 10, 11 (an ordinary browser, with the real audio) | opening an item played its file; Listen played it again; closing an accordion heading, Flip back, and arrow keys between tabs played nothing; the transcript gained each item's words |

(Every row was run on the finished 22 slide package except the Question 1 retry and the four combinations of slide 4
answers. Those were run just before the results and certificate slides were added, and those slides come after them and
change nothing about them.)

The certificate was also taken through a headless Edge: the page, then the print view, then a PDF. The print view shows only
the certificate in black on white, and the PDF is one landscape page. That is Edge, not Brightspace's frame.

## What to send back

For each test: the result Brightspace shows (status, score), anything that looked wrong, and a screenshot if you can.
The questions that matter most: **(1)** does Brightspace record the score and a passed or failed result correctly,
**(2)** does resume land on the right slide with the answers kept, **(3)** is the lesson readable in the frame,
**(4)** does the sound start without a click, **(5)** does the YouTube video show and play inside Brightspace, and
**(6)** does Print or save as PDF work from the certificate inside Brightspace, **(7)** does an item's voice start
when you open it inside Brightspace (Test 9), or only after you press its Listen button, and **(8)** do the Download
buttons on slide 22 save the files without a pop-up (Test 10), and **(9)** on slide 23 do the steps appear as they are spoken, and
do the two timing buttons work (Test 11), and **(10)** do the steps slide in, does Turn off animation work, and does a computer set to
reduced motion see none (Test 12), and **(11)** at 300 or 400 percent zoom, or in a narrow window or a phone, does every slide become
one column that reads in order with no sideways scrolling (Test 13)?

## Things that are expected, not faults

* No table of contents or menu: the lesson is a straight line, with Back and Next.
* The lesson reports each question, and the survey answers on slides 4 and 21, to the LMS as interactions.
  Most LMSs, Brightspace included as far as is known, do not show these anywhere a learner or instructor can see.
* Sound that does not start by itself, until you press Play narration.
* Arrow keys between tabs that change the tab but make no sound. Click, Enter or Listen plays it.
* The item that is showing when a slide opens (the first tab, the first step, the first glossary term) is not read by
  itself, because the slide's own voice is talking. Its **Listen** button reads it.
* The video needs the internet. The lesson's own checker lists that as a warning for exactly this reason.
* A video that someone else made is not under the lesson's control: it can be taken down, or blocked by a network.
* The certificate asks for the name every time and does not remember it. Nothing about the learner is stored, and the
  name is not taken from Brightspace.

## Rebuilding

Double-click `PUBLISH LMS TEST LESSON.bat`, or open `examples\lms-test-lesson.osproj` in the editor and press Publish.
To change what counts as completing the course, click an empty part of the canvas so nothing is selected: the
Properties panel has a **Course** section with **Complete when**. The results box and the certificate are on the
slide after the last question, and each has its own section in the Properties panel.
