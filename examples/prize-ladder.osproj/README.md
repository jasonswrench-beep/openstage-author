# Prize ladder: general knowledge

A short example made with the editor itself: the ready-made **Prize ladder** game (Add slide, then Games, ready-made) with its placeholders replaced by eight real questions that get harder up the ladder. It shows what the game makes and gives something to play at once. It has no purpose beyond that.

| Slide | What it shows |
| --- | --- |
| Title slide | An ordinary opening slide. |
| Prize ladder | The game's opening slide: what the game is, and the whole ladder (eight rungs, 100 points for the first and 100 more for each one after). **Start** goes to the first question. |
| Question 1: 100 to Question 8: 800 | One multiple choice question each, with one try, worth its rung's points. The rung the learner is on is bold and blue, rungs already answered are faded, and rungs still to come are in grey boxes. After an answer its feedback shows, with **Next question** (**See my results** on the last). |
| Game results | The results box (the score, and each question). |

How it works, with nothing outside the editor's own parts:

- The ladder is a column of text boxes with fills of their own, grouped so they can be moved together, and marked **decorative**: a screen reader skips it. The same facts are in real words, "Question 3 of 8, worth 300 points" at the top of each question, and in the opening slide's text.
- **Next question** is in each question's feedback layers (right and wrong), so it appears only once an answer has been given. The rules are ordinary jumps to the next slide, so the game needs no variables and does not change the course's completion setting.
- Each question is worth its rung's points, which is what reaches the score in the results box and the LMS.
- **A wrong answer does not end the game.** It shows the right answer and the learner climbs on. A course is complete only when every question has been answered, so a game that stopped at the first wrong answer would leave the course incomplete for good.

A learner who leaves part way through comes back to the same question, with the feedback they were reading and the way on still showing.

Nothing here has narration. To make it, open the project in the editor and use the Narration button.
