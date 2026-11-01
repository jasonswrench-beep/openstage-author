# The real LMS test: start here

Everything that can be done without your LMS has been done. This page says what is left, in the order to do it, and what to send back.
It costs nothing. It needs about 90 minutes in all, and you can stop after any round.

## What has already been done (2026-11-01)

* The lesson and the question-types course were rebuilt from the current program (commit `4f197bf`) as **six packages**: SCORM 1.2, SCORM 2004
  and xAPI for each. They are in `dist\lms-test-pack\`. Their manifests are well-formed, and every file they name is in the zip.
* A **rehearsal** played the four required tests (launch, a failing attempt, a pass at the edge, resume) through the project's own pretend LMS
  and pretend LRS, in a real browser, on all three standards: **12 of 12 passed**, and it was repeated several times. `LMS-RESULTS.md`
  has what each pretend system held at the end. That is what a correct LMS should show. The rehearsal is `player\tools\lms-rehearsal.mjs`
  and does not play any sound. It also notices when I break resume on purpose (I tried that).
* What that cannot tell us is how a **real** LMS behaves. That is the whole point of this test.

## What you need

* **Brightspace**, with a course where you can add content, and a **test student** account you can log in as. Preview and Impersonate may
  record nothing, so they are not a stand-in. With instructor access only, Brightspace cannot show what it records: use SCORM Cloud (`SCORM-CLOUD-STEPS.md`) for that. Nothing to buy. **Read `BRIGHTSPACE-STEPS.md` first:** the menu paths, the settings to pick
  when adding a package, why each fresh attempt needs its own copy of the zip, and where to read the result.
* **SCORM Cloud** (Rustici), the route if you have instructor access only, and the way to see xAPI statements (`SCORM-CLOUD-STEPS.md`). It has a **free Trial plan with no time limit**, limited to 10
  registrations at a time (one third-party listing also says 3 courses and 5 GB; I could not confirm that on Rustici's own page). A paid
  plan exists (about $40 a month on listings), and **you never need it for this test**. Signing up is your sign-in, not mine.
* The files, in the `dist\lms-test-pack` folder of the project (double-click `PUBLISH LMS TEST LESSON.bat` to rebuild it). Nothing is uploaded anywhere until you do it.

## The rounds

Write what you see in `LMS-RESULTS.md` as you go (the status words and the score, in the LMS's own words), or just send screenshots of the
learner's result and the instructor's report.

**Round 1: SCORM 1.2 in Brightspace (about 30 minutes). The one that matters most.**
Upload `lms-test-lesson-scorm12.zip`. Do tests 1 to 4 of `LMS-TEST-PLAN.md`. You need a fresh attempt for each of tests 2, 3 and 4, and Brightspace cannot reset
SCORM statistics, so upload the zip three times under different names (see `BRIGHTSPACE-STEPS.md`) or use three test students.
What a correct LMS shows: test 2 **failed, 60**; test 3 **passed, 80**; test 4 opens on **Question 3** with answers 1 and 2 kept and locked, and ends
**passed, 100**. If it differs, that is a finding.

**Round 2: SCORM 2004 in Brightspace (about 20 minutes).**
Upload `lms-test-lesson-scorm2004.zip` as a second item. Repeat tests 2, 3 and 4 (shorter: the answers are the same).
SCORM 2004 keeps *finished* and *passed* apart, so a correct LMS shows test 2 as **completed and failed, 60%**, test 3 as **completed and passed, 80%**,
and test 4 as above. If Brightspace shows one word only, write down which.

**Round 3: xAPI (about 15 minutes).**
Brightspace's upload menu says "New SCORM/xAPI Object", so try `lms-test-lesson-xapi.zip` there first. I do not know whether Brightspace records xAPI
or only launches it. Open it, do test 3, and see whether anything is recorded. If Brightspace shows nothing, that is expected for some setups: use
SCORM Cloud (it has an LRS and lists the statements). What a correct LRS holds after test 3: one `initialized`, a stream of `experienced`, an
`answered` for each answer, one `completed` and one `passed` whose result has score 0.8 (80 of 100).

**Round 4: the question types (about 20 minutes).**
Upload `question-types-scorm12.zip` and follow `..\question-types.osproj\TEST-PLAN.md`. The thing to look at is **how the LMS shows each answer**
(an essay answer is sent as a long fill-in, cut to 255 characters in SCORM 1.2; a drag-and-drop or sequencing answer is sent as matching or sequencing).

**Round 5: the rest of the plan, if you have the energy.**
Tests 6 to 13 of `LMS-TEST-PLAN.md`: keyboard only, a screen reader (NVDA only when you are away, and only after you tell me), the YouTube embed, the
downloads, the timed slide, a narrow window.

## What to send back

For each round: the status and score the LMS shows (screenshots are best), whether resume landed on Question 3, and anything odd. A failure is a
result: say exactly what the LMS said. Paste or attach it here, and I will work out whether the lesson, the packaging or the LMS is at fault, and fix
what is mine.

## Things I cannot do for you

Sign in to Brightspace or SCORM Cloud, upload to them, or act as a test student. Those are yours. I will not start NVDA or play any sound on your PC.
