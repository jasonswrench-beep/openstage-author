# Real LMS results for the test lesson

Every result cell below is empty on purpose. Nothing here has been tested in a real LMS yet. The only checking so far was against a stand-in LMS on this computer, which is not the same thing. Please fill in what the LMS actually shows, in its own words.

Packages tested: from `dist\lms-test-pack\`, built from commit `4f197bf` on 2026-11-01 (SCORM 1.2, SCORM 2004 and xAPI of the lesson, and the same three of the question-types course).
Start with `LMS-START-HERE.md`. Plan: `LMS-TEST-PLAN.md` (the numbered tests below are the ones in it). Use a **test student**, not instructor preview: most LMSs record nothing in preview.

How to record a result: write **passed**, **failed** or **not run**. In the next column write exactly what the LMS showed, in its words, for the status and the score. Put anything that looked wrong, and screenshots, in the last column. A failure is a result, and it is the point of the exercise.

## What counts as passing the four required tests

These match the four SCORM items in the release gate.

| Test | What to do | What to expect |
| --- | --- | --- |
| 1. Launch and look | Open the lesson as a student. | It opens with no error. |
| 2. A failing attempt | Answer so you get 3 of 5 right. | Failed, score 60. |
| 3. Passing at the edge | Get question 1 wrong, then right on the retry, and the rest right. | Passed, score 80. |
| 4. Resume | Close the lesson while on question 3 and open it again. | It opens on question 3, answers 1 and 2 are kept and locked, the survey answers and extra notes on slide 9 are kept, and finishing gives passed, score 100. |

SCORM 1.2 has one status, so a learner who finishes but fails is reported as failed, never as completed. That is how SCORM 1.2 works, not a fault in the lesson.

## The institution's LMS

LMS version: ______   Date: ______   Tester: ______   Account used (real test student / Preview / Impersonate): ______

Menu paths, settings to pick and where to read the result are in `BRIGHTSPACE-STEPS.md`.

| Test | Result (passed / failed / not run) | What the LMS showed (status words, score) | Problems, screenshots |
| --- | --- | --- | --- |
| 1 Launch and look | | | |
| 2 Failing attempt (expect failed, 60) | | | |
| 3 Passing at the edge (expect passed, 80) | | | |
| 4 Resume (expect Question 3, answers kept, passed 100) | | | |
| 6 Keyboard only, including leaving the frame | | | |
| 7 Screen reader (NVDA) | | | |
| 8 Embedded video | | | |
| 10 Downloads | | | |
| 11 and 12 Timing and animation | | | |
| 13 A narrow window | | | |

## The institution's LMS, SCORM 2004 (`lms-test-lesson-scorm2004.zip`)

LMS version: ______   Date: ______   Tester: ______

| Test | Result (passed / failed / not run) | What the LMS showed (completion words, success words, score) | Problems, screenshots |
| --- | --- | --- | --- |
| 1 Launch and look | | | |
| 2 Failing attempt (a correct LMS: completed, failed, 60) | | | |
| 3 Passing at the edge (completed, passed, 80) | | | |
| 4 Resume (Question 3, answers kept, completed, passed, 100) | | | |

## xAPI (`lms-test-lesson-xapi.zip`), in the institution's LMS or in an online SCORM test service

Where: ______   Version: ______   Date: ______   Tester: ______

| Test | Result (passed / failed / not run) | What it showed (does it open at all? are statements recorded? where can you see them?) | Problems, screenshots |
| --- | --- | --- | --- |
| 1 Opens | | | |
| 3 Passing at the edge (a correct LRS holds `passed`, scaled 0.8) | | | |
| 4 Resume (a `suspended` statement, then `resumed`, opens on Question 3) | | | |

## An online SCORM test service (optional second opinion, free Trial plan)

Version: ______   Date: ______   Tester: ______

| Package | Test | Result | What it showed | Problems |
| --- | --- | --- | --- | --- |
| SCORM 1.2 | 2, 3, 4 | | | |
| SCORM 2004 | 2, 3, 4 | | | |
| xAPI | 3, 4 | | | |

## What the pretend LMS and LRS held (2026-11-01, `player\tools\lms-rehearsal.mjs`, 12 of 12 passed)

This is the answer key for the tables above. It is also in `LMS-TEST-PLAN.md` ("The rehearsal").

| Test | SCORM 1.2 | SCORM 2004 | xAPI |
| --- | --- | --- | --- |
| 2 Failing | failed, 60 | completed, failed, 60 (0.6) | `failed`, scaled 0.6 |
| 3 Edge | passed, 80 | completed, passed, 80 (0.8) | `passed`, scaled 0.8 |
| 4 Resume | Question 3, entry `resume`, passed, 100 | the same, 1 | `suspended`, `resumed`, passed, scaled 1 |

## The second LMS

LMS version: ______   Date: ______   Tester: ______

| Test | Result (passed / failed / not run) | What the LMS showed (status words, score) | Problems, screenshots |
| --- | --- | --- | --- |
| 1 Launch and look | | | |
| 2 Failing attempt (expect failed, 60) | | | |
| 3 Passing at the edge (expect passed, 80) | | | |
| 4 Resume (expect Question 3, answers kept, passed 100) | | | |
| 6 Keyboard only, including leaving the frame | | | |
| 7 Screen reader (NVDA) | | | |
| 8 Embedded video | | | |
| 10 Downloads | | | |
| 11 and 12 Timing and animation | | | |
| 13 A narrow window | | | |

## The third LMS

LMS version: ______   Date: ______   Tester: ______

| Test | Result (passed / failed / not run) | What the LMS showed (status words, score) | Problems, screenshots |
| --- | --- | --- | --- |
| 1 Launch and look | | | |
| 2 Failing attempt (expect failed, 60) | | | |
| 3 Passing at the edge (expect passed, 80) | | | |
| 4 Resume (expect Question 3, answers kept, passed 100) | | | |
| 6 Keyboard only, including leaving the frame | | | |
| 7 Screen reader (NVDA) | | | |
| 8 Embedded video | | | |
| 10 Downloads | | | |
| 11 and 12 Timing and animation | | | |
| 13 A narrow window | | | |

## The question types lesson

A second package, `dist\question-types-scorm12.zip`, has one slide for each kind of question. Its plan is `examples\question-types.osproj\TEST-PLAN.md`. It has not been tried in any LMS.

| LMS | Result | What the LMS showed for the score and each question | Problems |
| --- | --- | --- | --- |
| The institution's LMS | | | |
| The second LMS | | | |
| The third LMS | | | |

## Notes from the first run in the institution's LMS

The first run in the institution's LMS was recorded on video (2026-10-12) and is not in this file as results. What that recording showed: the package launched and worked, narration played with captions, the quiz and its feedback layers worked, the adaptive "Remote tip" note appeared, the flip cards, tabs, table, steps, accordion and glossary worked, and the embedded YouTube video played inside the lesson. It did not show what the institution's LMS recorded for the score and status, because an instructor cannot see a learner's record from there. Please add the real numbers from a test student here.

## Summary

Which LMSs have passed tests 1 to 4: **the institution's LMS, as reported by Jason on 2026-11-01: "All three worked in the institution's LMS"** (read as the SCORM 1.2, SCORM 2004 and xAPI packages of the lesson). He then said he has **instructor access only** (no student account, and he cannot make a test student), so the run was done as the instructor. The LMS maker's own "Preview your course" page says Role Switch creates no learner activity and that Impersonate should not be used to check reporting or completion data, so this shows that the packages launch and play in the institution's LMS's frame, **not what the institution's LMS recorded** (status, score, resume). He gave no status words, scores or screenshots, so the institution's LMS tables above are still blank and the four required tests are not yet passed in any real LMS. It is not recorded which of tests 1 to 4 were run, whether resume landed on Question 3, or whether the institution's LMS showed any xAPI statements. The second LMS, the third LMS and an online SCORM test service have not been run.

Faults found and where they were fixed: ______

## The release gate wording (decided 2026-10-15)

The release gate says "Course completion and assessment success are tracked as separate states". SCORM 1.2 has only one status, so it cannot keep them separate: a course that was finished but failed is reported as failed. SCORM 2004 can keep them apart. How should the gate read for SCORM 1.2? One wording that is true: "Completion and success are both reported as correctly as SCORM 1.2 can express them, and are fully separate in SCORM 2004 (later)." Decided 2026-10-15: the gate now reads that way, and it is changed in `CLAUDE.md`.
