# Game templates: design note (stage 1 started)

Written 2026-10-21. The author approved stage 1 the same day, and agreed the reading of "gamification economies" below; "Built so far" says what exists. The rest is still a proposal. It proposes ready-made **game slide sets** an author
can insert into a project, in the manner of the ready-made lesson slides, and says plainly which games the editor can make today and which need
something new first.

## What was asked, and what was not seen

The request: gamified eLearning templates that people can insert into OpenStage, in the style of five example videos (a an eLearning authoring platform callout game,
the eLearning authoring platform game shows, a Millionaire-style game and a Categories game), plus these genres: trivia and game shows, branching scenarios, escape rooms,
memory and matching, word and language games, and simulations and problem solving.

**The five videos were not on the computer this was written on** (no file with those names in Downloads or anywhere in the user profile), so this
note works from the genre list alone. Nothing here copies a vendor's design. Templates are built from the genres, with original layouts and
generic names (no "Jeopardy", "Millionaire" or "Monopoly", which are trademarks).

## What the editor can already do (read from `docs/format-spec.md` and `editor/src/templates.ts`, not run)

- **Ready-made lesson slides** are built into the editor (`editor/src/templates.ts`). A template builds **one slide**: objects and layers. It cannot add
  more than one slide and cannot add a variable. The slide it makes is ordinary and not tied to the template. No format change was needed.
- **Rules** (when / do / only if): actions `jumpToSlide`, `showLayer`, `hideLayer`, `setVariable` (set or add), `changeState` (a look), `nextSlide`,
  `previousSlide`, `replaySlide`. Events `click`, `keyActivate`, `slideStart`, `slideEnd`, `variableChange`. Conditions compare **a variable to a fixed
  value**, not to another variable.
- **Variables** are declared in `project.json` (number, and others). They keep their value for the whole course. **A look does not**: it lasts until
  the slide closes, so a "used" tile must be a variable that a `slideStart` rule turns back into the Disabled look.
- **Quiz questions** in twelve kinds (multiple choice, true or false, multiple response, short answer, number, three fill-in-the-blanks forms,
  matching, drag and drop, sequencing, hotspot), with points, attempts and feedback layers. Points add to the SCORM score and the results box.
- **Branching scenarios** with a shared cast and **meters** (a number variable shown as a bar). Done in format 0.21.0.
- **Hotspots**, **inputs** (checkbox, radio, drop-down, text), **layers**, **timing** (objects appear after a delay, a slide can move on by itself),
  **animation** (a short fade, slide or grow, never repeating or flashing, off when the device asks for reduced motion).

## What it cannot do yet (searched for and not found)

1. **Show a variable's value as text.** ~~There is no live score, lives, level or coins readout outside a scenario's meters and the results box.~~ Built 2026-10-21 (format 0.31.0): a text can hold `{{$score}}` or `{{Name}}`, and the games now show a running score (see "A running score" under Built so far).
2. **A countdown timer.** Timed questions are listed as not built. A timer must let the learner extend it or turn it off (WCAG 2.2.1).
3. **Shuffling and randomness** (beyond the quiz's fixed, seeded shuffle), and question banks.
4. **A look that swaps words or a picture**, so a card cannot turn over to show its face with a look.
5. **Comparing two variables**, which a memory game needs to ask "do the two cards match?".
6. **Letter and grid objects** for word search, hangman and Codenames-style boards.
7. **A way for people to share a template.** Saving your own slide as a template and reusable components (linked or copied) are both on the roadmap
   as not built.

## Which games, in what order

| Game (generic name) | Genre | Makeable today? | What it needs |
| --- | --- | --- | --- |
| **Quiz board** (rows of values, columns of categories, pick a tile) | Trivia, game show | Yes, without a running score | A board slide of buttons, one question slide each, a "used" variable per tile and a `slideStart` rule to disable it. Gap 1 for a visible score. |
| **Prize ladder** (questions in order, the ladder shows where you are) | Trivia, game show | Built, without lifelines or elimination | One question per slide and a ladder picture drawn for that rung. A wrong answer cannot end the game, because the course could then never be completed (see "What the build found"). Lifelines such as 50:50 would need a look that removes choices. |
| **Escape room** (rooms, hotspots, a code lock, items you collect) | Escape room | Built, with buttons for places (there are no pictures to put hotspots on) and no collected items | A true or false variable per place, layers for clues, and a typed-code question with a few tries. The lock is built so it can always be finished (see "What the build found"). |
| **Order challenge** (rounds of putting steps in the right order, a running score) | Sequencing, process | Built 2026-11-01 | The prize ladder's way of playing without the ladder: a sequencing question for each round, one try, the right order shown whichever way it goes. Its steps are placeholders, with no table to fill them from. |
| **Choose your path**, **Decisions at work** | Branching | Already built | The scenario object. A picker entry that starts a themed scenario would be enough. |
| **Process sorter**, **Match the concepts**, **Fill in the blanks** | Simulation, matching, language | Already built as quiz kinds | Could be offered as named starting slides. |
| **Inbox simulator** (messages as buttons that open a layer, sort or reply) | Simulation | Mostly | Buttons, layers, a sequencing or multiple choice question per message. |
| **Countdown quiz** | Trivia | No | Gaps 1 and 2. |
| **Memory pairs** | Memory | No | Gaps 4 and 5, or a new object that carries its own logic (cleaner, and needs a keyboard and screen reader design of its own). |
| **Word search, hangman, Codenames-style** | Word games | No | Gap 6: new object types. |

## How a game set would be inserted

- A new **game set** sits beside `SlideTemplate`: `build(alloc)` returns **slides** (each with its objects and layers) **and variables**, and the
  editor adds them after the current slide as one Undo step. Slide ids come from the project, so rules that jump to a slide can be written when the
  set is built. This is editor work only, with no format change, if the first sets use existing parts.
- Reached from the **Games...** button in the Slides panel (the picker with only the games), or from the **Games, ready-made** group in the Add slide picker (a row of buttons at the top of that picker goes straight to it), with a preview and a short description, the same as the lesson slides. A small
  dialog asks the size first (for the quiz board: how many categories and how many values), because a 5 by 4 board is twenty question slides.
- Every placeholder is written for the author to replace. Nothing a screen reader depends on is filled in silently: alt text, roles and tab order
  follow the `CLAUDE.md` rule.
- The set is ordinary slides afterwards. There is no link back to the template.

## Accessibility that every set has to meet

- Every tile, card, door and answer is a real button or hotspot in reading order, reachable and usable by keyboard, with a name a screen reader says.
- Anything a learner must read (a tile's category, a clue, a ladder level) has a way to be narrated, or the summary says it has none yet.
- No flashing, no looping motion. Celebration effects use the existing short animations and stop when the device asks for reduced motion.
- A timer, when there is one, can be turned off or extended.
- Colour is never the only way to tell a used tile, a right answer or a locked door apart: the Disabled look and the words say it too.

## Scope against `CLAUDE.md` (needs the author's say)

- "Not a template tool" describes the authoring approach: a freeform canvas, not a fixed form. Ready-made starting slides sit inside that, as the lesson
  slides already do. No change proposed, but worth saying so in one line.
- "VR, AR, avatar systems, gamification economies" is out of scope. This note reads that as: no points shop, badges, coins, levelling or
  leaderboards that outlast one activity, and nothing that needs a server. A score within one game, and the results box and certificate that already
  exist, stay in. **A leaderboard cannot be built without a server and is not proposed.** Please confirm that reading, or say where the line is.
- "Unrestricted custom scripting" stays out: games are built from rules and existing objects, never from the author's own code.

## Proposed order

1. **Stage 1, no format change:** the game-set mechanism in the editor, then **Quiz board**, **Prize ladder** and **Escape room**, each with an example
   project, tests, and a validator pass. A Games group also lists the scenario and quiz starting slides that already work.
2. **Stage 2, one format change at a time, each with your yes:** show a variable as text with a polite screen reader announcement (gap 1), then a
   timer that can be extended or turned off (gap 2), then shuffle and question banks (gap 3).
3. **Stage 3:** memory pairs, then word games, as new objects, only after stage 2 shows what the format now lets a rule do.
4. **Sharing:** a file people can pass around and insert (a "template file": slides, variables and the assets they need) belongs with the roadmap's
   reusable components and should be designed with it, not before.

## Built so far (2026-10-21)

The author approved stage 1 and the reading of "gamification economies" above (a score within one game is fine; no leaderboards or persistent points).

- **The game-set mechanism** (`editor/src/gamesets.ts`, `gamedialog.ts`, `Model.addGameSet`). A game set builds slides, variables and rules from the editor's own parts. The Add slide
  picker has a **Games, ready-made** group, a game asks how big it should be, and everything is added after the current slide as one Undo step. No format change.
- **Quiz board**, 2 to 6 categories by 2 to 5 tiles. Per tile: a button that jumps to its question; a question slide (multiple choice, one try, worth the tile's points) whose own rules mark the tile used
  and count it when an answer is accepted; a "Back to the board" button in each of the question's two feedback layers, so it appears once the question is answered and not before. On the board each tile has a look called Disabled and a rule, run each time the board opens, that applies it while
  the tile's variable is true. Finish is dimmed until "Tiles played" reaches the number of tiles, then goes to a results slide. `examples/quiz-board.osproj` is a finished board of nine questions.
- **Back and Next are left out of every slide of a game but the last** (format 0.34.0, a slide's `hideNavigation`; added 2026-10-21 at the author's request): a player goes on only by playing, and the score slide keeps Back and Next. A player cannot page through the game or step past a question. The validator checks that each such slide has a way on of its own.
- **Prize ladder** (added the same day), 5 to 15 questions, default 8. An opening slide (what the game is, the whole ladder, **Start**), one question slide per rung, and a results slide. Each question is multiple
  choice, one try, worth 100 points for the first rung and 100 more for each one after. The ladder is a column of text boxes with fills of their own, grouped, and marked **decorative**, so a screen reader skips
  it; the same facts are in real words ("Question 3 of 8, worth 300 points" at the top of each question, and the opening slide's text). The rung the learner is on is bold and filled with the strong colour,
  rungs still to come are grey boxes, and rungs already answered are plain faded text, so they differ by more than colour. After an answer its feedback shows with **Next question** (**See my results** on the last),
  so the way on appears only when it can be used. It adds no variables and no rules beyond jumps to the next slide, so it changes no course setting. `examples/prize-ladder.osproj` is a finished ladder of eight questions.
- **Escape room** (added the same day), 2 to 5 rooms and 1 to 3 tries at each lock, default 3 and 3. An opening slide, then for each room a **room** and a **door**, then a results slide. A room has three places to
  search (buttons) and **Go to the door**. A place opens its clue (one at a time), is marked **Searched** from then on, and stays marked when the learner leaves and comes back, because a rule that runs each time the room
  opens (and again after a resume) applies the look from the place's variable. A door is a typed code (a short answer question worth 100 points) with the tries asked for. The tries are counted in a variable by the
  question's own rules, and when the count reaches the number of tries a layer shows the code. A right answer's feedback has **Next room**; a wrong answer's has one too, dimmed until the last try has been used.
  **Back to the room** is always there. The clues the game starts with spell out each room's code (4271, 6153, 8394, 5726, 3048), so it can be played as it is made. Each room has four variables (three
  "searched", one "tries"), made together. Every way on goes to the next slide, so no course setting changes. `examples/escape-room.osproj` is a finished escape room of three rooms.
- **Checked** with 57 tests (`editor/src/gamesets.test.ts`) for all three games: every wire; each whole game played on the player's own runtime (board: tile, answer, dimmed tile, Finish, score; ladder: Start, right and
  wrong answers, feedback, the way on, results, and the LMS status the player's own completion logic gives; escape room: searching, the clues, the lock, going on, results); leaving and resuming in all three (the escape
  room at a lock with tries left, at one with none left, and in a room with places searched); the largest board's progress fitting in SCORM 1.2's 4096 characters; every size fitting the slide with no overlap; the real
  validator (no errors, no warnings) on every size that matters, on all eight built-in themes for the ladder and the escape room (their note cards, rungs and places paint their own fills), and on all three examples.
  The escape room's lock is checked on **every way a learner can use the tries** for 1, 2 and 3 tries (right on the first, second or last try, or wrong every time): the way on is closed until the lock is finished,
  then there is exactly one way on and it works. Two deliberate breaks of the lock's rules (a way on that is never dimmed, and one that never opens) each make five tests fail, so the tests can fail.
  Also run in a browser: the picker, the dialogs by keyboard, saved projects published and played in the stand-in LMS (all three games, including a resume with the feedback showing; the escape room played with
  three wrong tries, a resume at a lock with tries left and at one with none left, and room 3 solved from its clues alone), and the published pages' accessibility trees (the board: a region, a heading, then each
  category's heading and its tiles in order, used tiles and Finish as real disabled buttons; the ladder: every rung `aria-hidden`, the words in text, and exactly one way on reachable after an answer; the escape
  room: before an answer no way on, after a wrong answer with tries left a real `disabled` button, after the last try an enabled one, and the code shown).

### A running score (added 2026-10-21, after values in a text were built, format 0.31.0)

A text can now show a value that changes (`{{$score}}`: the points earned so far, read from the same totals as the results box, so a wrong answer adds nothing; see `docs/format-spec.md`). The three game sets use it, with no new variables and no new rules: the **Quiz board** has **Score: {{$score}}** in the top right corner (reading order: title, instructions, score, then the categories), and each of its question slides says **100 points. Score so far: ...** in the line that already named the points; the **Prize ladder** says **Points so far** in the line at the top of each question (so finding 6, that the ladder could not show what the learner has won, no longer holds); the **Escape room** has the score in the top right of each room and in the line at the top of each lock. The text is not a live region (so the score is not read out at every change); a screen reader user hears it when they read the line, and the author can turn on **Say changes aloud** for any of them. The examples carry it too. Because the score is the course's own quiz points, it counts only what the questions count: a lock is worth 100, and a tile is worth its value.

### What the build found

1. **The course must be set to complete at the last slide.** A board jumps forward past slides, so with "every slide seen" the validator warns about every tile (sixteen warnings on the starting 4 by 4 board, measured).
   The game sets "reaches the last slide" if the course was set to every slide, says so in what it tells the author, and Undo puts it back. The author can change it in the course settings. Finish stays closed
   until every tile is used, so reaching the results means the board was played.
2. **A resumed course showed a stale board, and the player was changed to fix it** (the author's yes, 2026-10-21). A look lasts only until the slide closes and is not saved, and the player does not run a slide's
   start rules when a course resumes. So after a learner left and came back to the board, a used tile and Finish looked open until the board was next opened. Nothing broke: the answers and score are kept (the player
   never drops quiz results), a used tile opens a locked question with the learner's answer shown, and Back to the board is always there. The fix is in the player, not in the game: on a resume it runs again the rules that
   apply a look and have a condition (`slideStart` then `variableChange`), against the saved variables, silently. A look rule with no condition is left alone on purpose, because the learner may have changed it since
   the slide opened (a button closed at the start and opened by a later rule would otherwise be closed again). Described under Resume in `docs/format-spec.md`. Not a schema change.
3. **The player has its own Back and Next**, so a learner can reach a question without the board. That is safe for the same reasons: only an accepted answer marks a tile used.
4. **Names go stale.** A tile's name says its category, a variable's name says its category and value, and the board has no way to show a variable as text, so renaming a category means changing the tiles' alt
   text by hand. This is the first thing a "show a variable as text" or a reusable-components feature would improve. The ladder has the same problem in smaller form: the line at the top of each question and the
   rungs say the points, so changing the points means changing both.
5. **A game that ends on a wrong answer cannot be completed.** The first plan for the Prize ladder (this note's table, as written) sent a wrong answer to a "game over" slide. A course is complete only when every
   quiz is finished, so the questions after the wrong one would stay unanswered for good, the LMS would show the course as incomplete for good, and there is no way to reset a quiz. So **a wrong answer does not end the game**: it shows
   the right answer and the learner climbs on, and the wrong answer costs its points. A test pins this down (a ladder left part way is never complete; one played with wrong answers is, and reports `failed` or
   `passed` by the score). If a game with elimination is wanted anyway, it needs something new: a way to finish the quizzes that are left (for example a game-over slide that offers them as practice), or a rule
   that marks a question finished without an answer. That is a format and player decision, so it is left for the author.
6. **The ladder works without any variable**, because each question is its own slide and the ladder on it is drawn for that rung. That keeps it free of the resume and completion issues the board met. It also means the
   ladder cannot show what the learner has won so far, only where they are, which would need a way to show a variable as text.
7. **No lifelines.** A 50:50 needs a look that removes two choices of a question, which looks cannot do (a look changes how an object appears, not what it holds).
8. **A lock with tries has to be built so that it can always be finished.** A course is complete only when every question is finished (answered right, or out of tries), and an escape room is full of things to
   solve, so the question asked before building it was whether any puzzle could leave a learner stuck. Checked against the player: `attemptsAllowed` must be a finite whole number, so a question always finishes;
   a question's own rules run once for each answer that is accepted, and never again once it is finished; but a rule can only compare variables with fixed values, so **it cannot tell a right answer from a wrong
   one, and cannot see that a question is finished.** So the way on cannot simply follow "solved". The escape room opens the way on when the lock is finished by either route: a right answer's feedback layer
   carries **Next room**, and a wrong answer's carries a dimmed one that a pair of rules (dim it when the slide opens while tries are left; open it when the count of tries reaches the number allowed) open on the
   last try, when a third layer shows the code. The code is shown in words only, so after a right answer on the last try (the code layer shows too) there is still exactly one way on. Searching, the clues and the
   places are not questions, so nothing there can block completion, and nothing is gated on having found a clue. A test covers every path through the tries for 1, 2 and 3 tries.
9. **A lock revisited after it was finished has no way on of its own**, because feedback layers are closed when a slide opens again (only a resume restores them). The learner is not stuck: **Back to the room** is
   always there, and the player's own Next and Back are too. A small improvement would be for the room's door button to go straight on once its lock is finished, which needs a variable that says so, and that
   again needs a way to see that a question was answered right.
10. **The "Searched" look speaks.** A rule that applies a look has to give it a spoken message or the validator warns (a change that is only seen is missed by someone who cannot see it), so the look says
    "Searched". A rule that runs when the room opens applies it to every searched place, so a learner entering a room with several searched places hears that one word (the player says the last message). A
    resume applies the looks silently. If this proves noisy, the fix would be to let a look be applied without a message when it is only being restored, which is a format question.
11. **A possible player fault was seen once and not reproduced.** In a test page driven by very fast scripted clicks in a pane the browser was not drawing, a clue's words were read back twice. The player fills a
    layer's live regions a frame after it is shown (`Stage.setLayerVisible`), by appending the words, and only clears them when the layer is hidden, so a layer shown, hidden and shown again inside one frame
    could be filled twice. The runtime does not show a layer that is already showing, a person cannot click that fast, and at one click a second, over three rounds of the places, every clue was exactly one
    paragraph of the same length each time. Left alone. If it is ever wanted, the fix is one line: clear the region before filling it.

## Filled from a spreadsheet (built 2026-10-22, at the author's request)

A **quiz board** and a **prize ladder** can be made with their questions already in them. When one of these games is chosen, its size dialog opens with a box, **Fill it from a spreadsheet**, right under the game's description and before the sizes: **Choose a spreadsheet (CSV)...** and **Save a sample spreadsheet...** (the sample is a whole small game that can be added as it is, then its rows replaced). A table that can make the game sets the sizes (the drop-downs go grey and say so), shows what it found, row by row, in words, lets the author change the game's title (it starts as the file's name), and the game is made with the table's words in it. It is one step to undo, like any game. The escape room is not filled from a table: its clues and codes are wired to its rooms.

* **Columns.** The ones Add questions from a spreadsheet reads (`docs/question-import.md`), and for a **quiz board** a **Category** (the column of the board) and a **Value** (what the tile is worth; Points does the same if there is no Value). A **prize ladder** takes the rows in order as the rungs and needs no more.
* **Quiz board rules.** 2 to 6 categories (in the order they first appear), 2 to 5 questions in each, the same number in every category. A board is a grid, so when the categories are uneven the **biggest grid the table can fill** is made (the most tiles; with a tie, the wider board): a category with more questions than the grid is tall has the extra rows left out and named, and a category with too few is left out and named, with how many to add to bring it in, instead of every column being cut to the shortest (a table of three categories of 4 questions and two of 2 makes 3 x 4 = 12 tiles, not 5 x 2 = 10; 2026-10-23, from a sample table). Tiles go from the smallest value down; with no Value they are worth 100, 200 and so on, and each row says so. A tile's question has one try and is worth the tile's value (Attempts is not used, and neither is Points when there is a Value).
* **Prize ladder rules.** 5 to 15 questions; a longer table has the last rows left out and named. Each question has one try and the rung sets the points (100, then 200, and so on).
* **Questions** can be multiple choice, several right, true or false or short answer, with up to 5 answers (a row with more is left out and named). A wrong answer is told the table's own feedback, or, if there is none, where the right answer is, in words, because with one try there is no second go. A question's heading shrinks to fit if it is long. On a ladder the feedback and the **Next question** button sit below the answers, however many there are.
* **What it says when it cannot.** A table with too few categories or questions, or no Category on any row, makes nothing and says why in a sentence; the game can then still be added with the sizes and written in by hand.
* **Code.** `editor/src/gameimport.ts` (reading the tables, the two sample tables, with 24 tests in `gametable.test.ts` including the real validator on boards and a ladder added to one project), `questionfill.ts` (putting a question into the objects the editor makes, shared with Add questions from a spreadsheet), `gamesets.ts` (`build(ctx, options, content)`), `gamedialog.ts`. The sample files in `examples/` (`quiz-board-questions.csv`, `prize-ladder-questions.csv`) are the ones the editor writes, and a test checks that.

## Open questions

- Stage 1 is built: the mechanism, the Quiz board, the Prize ladder and the Escape room. Stage 2 is next, each with your yes because each is a format change: show a variable as text (which would also give the
  games a running score and fix the names that go stale), a timer that can be extended or turned off, and shuffling with question banks. Say which first, or whether to commit what is here before going on.
- **Order challenge (built 2026-11-01, with the author's yes to all builds).** The "order game" of the earlier lists: 3 to 10 rounds (the drop-down in the dialog, 5 to start), each one sequencing question of four steps written in the right order for the author to write over (the learner is shown them in another), worth 100 points with one try, and an opening slide and a results slide. Like the ladder, a wrong answer does not end the game and shows where the right order is, so every round is finished and the course can be completed. The line at the top of each round says where the learner is and the points so far (`{{$score}}`). It needs no variables and no format change. Chosen simply, each reversible: all rounds worth the same, four steps, no table to fill it from (a table of steps in order is a different shape from a table of questions), no ladder picture. 6 tests, including the real validator and a play-through. **Elimination stays unbuilt**, as decided on 2026-10-21.
- **Decided by the author, 2026-10-21: no elimination.** People should be able to go to the end of any game, and there is a score total and feedback slide at the end (the results slide every game already ends with). So finding 5 stands as built, and nothing needs designing for a game over.
- ~~Where the videos are.~~ Four arrived on 2026-10-21 (see the next section).
- **Decided by the author, 2026-10-21: yes, a game (or any set of slides) can be shared as a file** with another person who uses OpenStage Author, because it is all open and sharing is best. This is built as its own feature, not as reusable components: see `docs/slide-sets.md` (built 2026-10-21: **Share slides...** and **Add slides from a file...**).

## What the four example videos show (looked at 2026-10-21)

The author sent four short screen recordings of an eLearning authoring platform game demos, about a minute each, 1024 by 720, **with no sound** (so this is from frames; nothing was heard): **Millionaire Challenge** (two takes of the same game), **Categories** and **Gameshow**. They are examples of how the genres look, not designs to copy: nothing here copies a vendor's pictures, words or names.

What all of them have, and what the games built so far have too: a title slide with a Start button and instructions; a question slide; feedback that says right or wrong with a short explanation and a Continue button; a results slide with a percentage and a pass or fail word.

What they have that the built games do not, and what each needs:

1. **A running score on every slide** (a prize in dollars with "3/10" in Millionaire, points in the other two). Built 2026-10-21 with values in a text; the games now show one. The "3/10" counter is `{{$answered}}` of `{{$questions}}`.
2. **Play again** on the results slide, which starts the game over. Needs a way to **reset**: variables are easy, but a quiz that has been answered cannot be answered again today (finding 5 shows the same limit). This is a new item, not on the earlier list, and needs designing.
3. **Right and wrong told apart.** Categories rings a used tile in yellow when it was answered right and red when wrong; Gameshow fades used tiles. A rule cannot tell a right answer from a wrong one today (finding 8), so the board can only mark a tile "used". Needs an event such as "the answer was right" and "the answer was wrong" on a question. Another new item.
4. **Hints** (Millionaire: three "!" tokens that each open a hint panel and are used up) in place of lifelines. A hint is a layer the learner opens, so it needs only a counter that runs out (a variable, a condition and a look), and show-a-variable-as-text to say how many are left.
5. **A picture that changes with progress** (Millionaire's suitcase fills with money). The ladder already draws a picture per rung; a suitcase would be one picture per question slide.
6. **A feedback face** (Categories shows a character with the feedback). The people from the library on a slide (built 2026-10-21) cover it.
7. **A "Submit" step** (choose an answer, then press Submit). The quiz questions already have Check answer.
8. **Elimination** (Millionaire: a wrong answer shows "You lose"). **Not wanted**: decided 2026-10-21, every game goes to the end.

The author also asked for a timer and for shuffling with question banks; neither appears in these four videos. The timer was built 2026-10-21 (format 0.32.0, `docs/format-spec.md` under Timers): a game can put one on a question slide, send the learner to a "time is up" layer or the next question when it runs out, and stop it when the question is answered. Shuffling and question banks are still planned.
