# Quiz board: accessibility basics

A short example made with the editor itself: the ready-made **Quiz board** game (Add slide, then Games, ready-made) with its placeholders replaced by nine real questions. It shows what the game makes and gives something to play at once. It has no purpose beyond that.

| Slide | What it shows |
| --- | --- |
| Title slide | An ordinary opening slide. |
| The board | Three categories (Colour, Keyboard, Words) with three tiles each, worth 100, 200 and 300 points. A tile opens its question. A tile already used is dimmed when the board opens again, and **Finish** is dimmed until all nine have been used. |
| Colour: 100 to Words: 300 | One multiple choice question each, with one try. Answering marks its tile as used. **Back to the board** is always there, so nobody is stuck on a question. |
| Game results | The results box (the score, and each question) and a way back to the board. |

How it works, with nothing outside the editor's own parts:

- Each tile is a button whose rules go to its question's slide. The question's own rules set that tile's "Used" variable and add 1 to "Tiles played" when an answer is accepted.
- The board's rules, run each time it opens, dim a tile whose "Used" variable is true, and dim Finish while "Tiles played" is below 9. Open **Variables** to see the ten variables, and select a tile and look at **Rules** in Properties.
- Each question is worth its tile's points, which is what reaches the score in the results box and the LMS.
- The course is set to complete when the learner **reaches the last slide**, because learners visit the questions in any order. With "every slide seen" the validator would warn about every tile.

A learner who leaves part way through and comes back to the board finds it as they left it: a look is not saved, but the board's rules that dim a used tile and close Finish depend on variables, which are, so a resume works them out again. Their answers and score are kept too, and a used question opens locked, with its answer shown.

Nothing here has narration. To make it, open the project in the editor and use the Narration button.
