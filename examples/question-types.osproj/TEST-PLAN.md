# Question types: test plan

This course has one slide for each kind of question, and a results slide. Upload `question-types-scorm12.zip` to Brightspace as a SCORM 1.2 package,
the way you did the lesson. What I most need to know is what **Brightspace** does with it (see the end for what I have already checked).

For each slide, do the steps and compare with **Expect**. Partial credit is on: a question with several parts earns a share of its 10 points for the
parts that are right, the best attempt counts, and every question in this course has two attempts.

## With the mouse

| Slide | Do this | Expect |
| --- | --- | --- |
| 1 Multiple choice | Choose "An email" and press Check answer | Right feedback appears, the choices lock |
| 2 True or false | Choose False, Check, then True, Check | The first is wrong with a second try, the second is right |
| 3 Multiple response | Tick Email and Text message only, Check. Then also tick Letter, Check | The first is partly right (two of three, so 6.67 of 10 points) and shows the "not quite" feedback with a try left. The second is fully right, 10 points |
| 4 Short answer | Type ` everest ` (capitals and spaces do not matter) and Check | Right |
| 5 Numeric | Type `150` and Check | Right. `150.0` is right too |
| 6 Fill in the blanks | Type `channel` in blank 1 and `wrong` in blank 2, Check. Then fix blank 2 to `SENDER` | The first is partly right (half the points), the second is right |
| 7 Choose the words | Choose words from the two drop-downs, one wrong then right | Same, with half the points for the first |
| 8 Drag the words | Drag **sender** onto blank 1 and **receiver** onto blank 2 | Each word appears in its blank's list, and the word in the bank fades. Check: right |
| 9 Matching | Match the three channels from the lists | Right when all three are matched rightly |
| 10 Drag and drop | Drag each match onto its item | The match appears in the item's list. Check: right |
| 11 Sequencing | Drag the grips (the dots at the left) to put the steps in order, or use Move up and Move down | The order changes, and each move is announced. Check: right when in order |
| 12 Hotspot | Click the cafe on the picture, Check (wrong). Then choose "Library, top left" from the list under the picture, Check | The first is wrong, the second right |
| 13 Essay | Type a few words (fewer than 20) and Check. Then keep writing to 20 words or more and Check | With fewer than 20 it says "Write at least 20 words first" and no try is used. With 20 or more it is accepted (full points), and the box can still be read but not changed. The count under the box follows what you type, and it does not announce itself on every word |
| 14 Choose a word | Click "sender" in the passage and Check (wrong). Then choose "channel" from the list under the passage and Check | The first is wrong, the second right. Choosing from the list marks the word in the passage |
| 15 Keyboard shortcut | Type `ctrl + x` and Check (wrong). Then press Capture the keys, press Ctrl and C together, and Check | The first is wrong. Capture writes `Ctrl+C` in the box and the second is right (Cmd+C is accepted too) |
| 16 Your results | Look at the box | "partly correct" lines for any question you left partly right, and the score |

## With the keyboard only (no mouse)

Every question must be answerable with Tab, Shift+Tab, the arrow keys, Space and Enter.

1. On each slide, Tab to the first control and answer the question without touching the mouse. Check answer is the last stop.
2. Slides 8, 10 and 11 can be dragged, but you should not need to: use the drop-down in each blank or item (slides 8 and 10) and the Move up and Move down
   buttons (slide 11). **Expect:** nothing important is missing, and the words that can be dragged are not announced twice.
3. Slide 12: the areas on the picture cannot be reached with Tab, on purpose. The list under the picture is the way. **Expect:** choosing from it works.
4. Slide 14: the words of the passage cannot be reached with Tab, on purpose. The list under the passage is the way. **Expect:** choosing from it works.
5. Slide 15: Tab to Capture the keys, press Enter, then press the keys. **Expect:** it writes them in the box and goes back to being a button. Escape on its own
   stops it. Pressing Tab while it listens counts as the answer "Tab", and the next Tab moves on: it must never hold you.

## A screen reader (optional)

On slide 6 each blank is read as "Blank 1 of 2", and on slide 9 each drop-down is named by its item. On slide 12 the picture's description is read and the
areas are listed by label. On slide 11 each move says where the item now is.

## Narrow windows and zoom

Make the window narrow or zoom to 300 or 400 percent. **Expect:** each question stays in one column with no sideways scrolling, the drop-downs are easy to use, and
the hotspot picture shrinks to fit.

## What to send back

For each slide: the result Brightspace shows. The questions I most want answered: **(1)** what score and status does Brightspace show after you finish, and does
it match the results slide, **(2)** does Brightspace's own report list the questions, and with the right answers for each kind (it should show fill-in,
matching, sequencing and numeric answers), **(3)** can you drag on a touch screen or tablet, and **(4)** is anything cut off or hard to use in the frame?

## What I have already checked

I answered every kind of question wrongly, partly rightly and rightly in a browser, with mouse events and with the keyboard-style controls (the drop-downs,
the check boxes and the Move up and Move down buttons), and checked the drag on slides 8, 10 and 11, including that Escape cancels it. At 320 pixels wide no
slide scrolled sideways. In automated tests with a fake LMS, the SCORM data written for each kind of question was the right type (choice, fill-in, numeric,
matching, sequencing), the learner's answer, what is right and whether it counted, and the score was the total of the shares. I have **not** run this package
through the stand-in LMS page, tried a touch screen, or used a screen reader on it.
