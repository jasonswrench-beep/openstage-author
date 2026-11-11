# Order challenge: steps at work

A short example made with the editor's own parts: the ready-made **Order challenge** game (in the Slides panel, **Add**, then **Game...**) with four rounds, and its placeholders replaced by four real orders from a working day. It shows what the game makes and gives something to play at once. It has no purpose beyond that.

| Slide | What it shows |
| --- | --- |
| Title slide | An ordinary opening slide. |
| Order challenge | The game's opening slide: how many rounds, what each is worth, and **Start**. |
| Round 1 to Round 4 | One question each: put four steps in the right order (a fire drill, saving a document under a new name, the parts of a short work email, the stages of a team meeting). One try, worth 100 points. The right order is shown whichever way it goes, with feedback that says why, and the way on (**Next round**, or **See my results** after the last). The line at the top says the round and the points so far. |
| Game results | The results box (the score, and each round). |

How it works, with nothing outside the editor's own parts:

- Each round is a sequencing question. Its steps are kept in the right order and shown to the learner in another, so the learner drags them (or moves them with the keyboard) into place.
- The way on is in each feedback, so it appears only once the round is answered, right or wrong. Nobody is stuck on a round, and every round is finished, so the course can be completed.
- It needs no variables and changes no course setting: every way on goes to the next slide.
- Each round is worth 100 points, which is what reaches the score in the results box and the LMS.

It was made by `Model.addGameSet("order-challenge", { rounds: 4 })`, the call the **Game...** window makes, and the words of the rounds and their feedback were then written over the placeholders.

Nothing here has narration. To make it, open the project in the editor and use the Narration button.
