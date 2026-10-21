# Question bank and timer example

A short course that shows two things added in format 0.32.0 and 0.33.0:

* **A question bank.** Slides 3 to 8 are six questions in the bank "Channel questions". Each learner is shown three of them, picked at random when they begin and kept if they come back, so the course is "Slide 1 of 6" (the two first slides, three questions, and the results), not nine. The answers of every question in the bank are shown in a different order to each learner.
* **A timer.** Each question in the bank has a one minute timer. Answering the question stops it (a rule on the question), and when it runs out the "Not quite" layer shows (a rule on the timer). The learner can add 30 seconds or turn the timer off, and can pause the timing at any time.

The results slide adds up only the questions that learner was shown, and the score sent to an LMS is out of those.

To try it: open `question-bank.osproj` in OpenStage Author and press Preview, or publish it. Start the course several times (close the page and open it again) to see different questions. In an LMS, leave halfway and come back: the same questions are there.
