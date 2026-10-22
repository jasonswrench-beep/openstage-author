# Questions from a spreadsheet

Writing questions one at a time in the editor is slow when you already have fifty of them. **Questions from a file...** (in the Slides panel) reads a table of questions saved as a CSV file and makes a slide for each one, with its feedback layers, in one step. It was asked for on 2026-10-21, to make a question bank easy to fill.

It changes no part of the course format. Each row becomes what **Add > Question** makes: a slide with the question as its heading, the question itself, and a layer of feedback for a right answer and one for a wrong answer.

## How to use it

1. In the Slides panel, press **Questions from a file...**.
2. Press **Save a blank table to start from...** if you need a table to begin with. It is a CSV file with the columns named and one example of each kind of question (`examples/questions-template.csv` is the same file).
3. Fill the table in Excel, Google Sheets or any spreadsheet program. Save it as **CSV**. In Excel choose **Save As, then CSV UTF-8 (Comma delimited)**; plain "CSV (Comma delimited)" works too.
4. Press **Choose a table of questions...** and choose the file. The dialog says how many questions can be added and lists every row that has a problem, with the row number, in words.
5. Choose how to add them (below) and press **Add**. One Undo takes all the slides away.

## The columns

The first row names the columns. They can be in any order, and the optional ones can be left out. Capital letters do not matter.

| Column | What goes in it |
| --- | --- |
| **Type** | `MC` multiple choice (one right answer), `MR` multiple response (several right), `TF` true or false, `SA` short answer. Left empty, it is `MC`. |
| **Question** | The words of the question. Required. |
| **A** to **H** | The answers to choose from, up to eight. For `SA`, the answers that are accepted. Leave an answer empty to skip it. |
| **Correct** | `MC`: the letter of the right answer, such as `B`. `MR`: the letters, such as `A, C`. `TF`: `True` or `False`. `SA`: not needed. |
| **Points** | Optional. How many points it is worth. Without it, 10. |
| **Attempts** | Optional. How many tries a learner gets. Without it, 2 (1 for true or false). |
| **Feedback if right** | Optional. What a learner reads after a right answer. Without it, "Correct." |
| **Feedback if wrong** | Optional. What a learner reads after a wrong answer. Without it, "Not quite. Try again." (or "Not quite." when there is one try). |

Other names are understood for the same columns (for example **Answer Choice A**, **Prompt**, **Key**, **Weight**, **Tries**, **If right**). A column whose name is not understood is left out, and the dialog says which.

**Without a first row of names**, the columns are taken in the template's order: Type, Question, A to E, Correct, Points, Feedback if right, Feedback if wrong.

**What can be written in Correct.** For a multiple choice or multiple response question the letter of an answer that is filled in (a letter or the words of the answer both work), several letters separated by commas, bars, slashes, spaces or "and". A letter that names an empty answer is a mistake. For a short answer, if columns A to H are empty, the Correct column may hold the accepted answers separated by `|`.

## What is left out, and what is only mentioned

A row with a **mistake** is left out, and the dialog says which row and why. The rows without mistakes are still added. The mistakes are: no question; a type that is not one of the four; a multiple choice or multiple response question with fewer than two answers; a Correct column that is empty or names something that is not an answer; two right answers in a multiple choice question (use `MR`); every answer right in a multiple response question; a true or false question without True or False in Correct; a short answer with nothing accepted; more than 200 questions in one file.

Things that are only **mentioned**, with the row still added: an empty answer between two filled ones (it is skipped), two answers that read the same, the same question twice, and a Points or Attempts that is not a number.

## How the questions are added

* **Where:** straight after the slide you are on, in the order of the table. The first new slide is shown.
* **Names:** the slides are called Question 1, Question 2 and so on. The name a screen reader gives a question's answers (its Alt text) is the question itself, which you can change.
* **A question bank:** tick **Make them a question bank** and each learner is shown some of them, picked at random (see Question banks in `docs/editor.md`). Choose how many to show and whether to mix the order.
* **Mixing the answers:** tick **Show the answers of each multiple choice question in a different order to each learner**. True or false keeps True before False, and a short answer has nothing to mix.
* **The words:** a question or feedback is plain text. Angle brackets and ampersands are kept as written. A line break inside a feedback cell starts a new paragraph. There are no pictures, bold or links: add them afterwards in the editor.

## Tables for games

A quiz board and a prize ladder can also be made from a table, and their size dialog offers it (see `docs/game-templates.md`, "Filled from a spreadsheet"). The columns are the same, and a quiz board adds **Category** and **Value**. Here, in Add questions from a spreadsheet, those two columns are not used and are named as columns that were not used. The sample files for the games are `examples/quiz-board-questions.csv` and `examples/prize-ladder-questions.csv`.

## Files it can read

A `.csv` file, or a `.tsv` or `.txt` table. It works out the separator (commas, semicolons, which some countries' Excel uses, or tabs) and the way the text was saved: UTF-8, UTF-16 (Excel's "Unicode Text"), or the Windows Western code page that Excel's plain CSV uses. An Excel file (`.xlsx`) is not read: open it and save it as CSV. A file larger than 2 MB is refused.

## Not built

Questions of the other kinds (matching, putting things in order, filling blanks, a hotspot) cannot be written in a table and are made in the editor. Pictures for questions, a column for which feedback layer to use, and updating questions already in the course from a changed file are not built: a table adds new slides each time.

The code is `editor/src/questionimport.ts` (reading, with 19 tests), `Model.addQuestionSlides` (the slides, tested in `questionslides.test.ts`), `questiondialog.ts` and, in the Rust side of the editor, `question_file_read` and `question_template_write`.
