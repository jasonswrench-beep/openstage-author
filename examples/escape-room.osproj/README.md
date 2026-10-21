# Escape room: your first day

A short example made with the editor itself: the ready-made **Escape room** game (Add slide, then Games, ready-made) with its placeholders replaced by three rooms of a made-up first day at work. It shows what the game makes and gives something to play at once. It has no purpose beyond that.

| Slide | What it shows |
| --- | --- |
| Title slide | An ordinary opening slide. |
| Escape room | The game's opening slide: the story, how many rooms, how many tries at each lock, and **Start**. |
| Reception, The meeting room, The server cupboard | A room: three places to search (buttons) and **Go to the door**. A place opens its clue, and only that one, and is marked as searched (it turns grey) from then on, including after the learner leaves the room and comes back. Each clue gives part of the door's code. |
| Reception: the door, and the same for each room | The lock: a typed code with three tries. A right answer shows **Next room**. A wrong one shows its own **Next room**, dimmed until the third try has been used, and then the code is shown. **Back to the room** is always there. |
| Game results | The results box (the score, and each lock). |

The codes are 4271, 6153 and 8394. Each room's three clues end in the same words ("the first digit is 4", "the second digit is 2", "the last two digits are 71"), so a test can solve every room from its clues alone.

How it works, with nothing outside the editor's own parts:

- Each place is a button. Its rules close the other two clues, set that place's "searched" variable, apply the Searched look, and open its own clue. A rule that runs each time the room opens (and again after a resume) applies the look again while the variable is true, because a look is not saved but a variable is. Open **Variables** to see the twelve variables (four for each room), and select a place and look at **Rules** in Properties.
- A lock counts its tries in a variable. The question's own rules run once for each answer that is accepted: they add 1 to the count and, when the count has reached the number of tries, show the layer with the code. The way on after a wrong answer is dimmed by a rule that runs when the slide opens and opened by a rule that runs when the count changes.
- **Every lock can be finished.** A rule cannot tell a right answer from a wrong one, and a course is complete only when every question has been finished, so the way on is open as soon as a lock is finished, whether it was solved or not: after a right answer, or after the last try. Nobody is left in front of a door they cannot open, and a course cannot be left incomplete by a lock.
- Every way on goes to the next slide, so the game needs no change to the course's completion setting.
- Each lock is worth 100 points, which is what reaches the score in the results box and the LMS. A lock that was not solved scores nothing, but does not stop the learner.

A learner who leaves part way through comes back to the same place: the places they searched look searched, a lock with tries left still has its feedback showing and its way on dimmed, and a lock that was finished still shows the code and has its way on open.

Nothing here has narration. To make it, open the project in the editor and use the Narration button.
