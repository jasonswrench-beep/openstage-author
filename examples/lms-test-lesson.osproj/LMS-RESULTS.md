# Real LMS results for the test lesson

Every result cell below is empty on purpose. Nothing here has been tested in a real LMS yet. The only checking so far was against a stand-in LMS on this computer, which is not the same thing. Please fill in what the LMS actually shows, in its own words.

Package tested: `dist\lms-test-lesson-scorm12.zip`, built from commit ______ on ______.
Plan: `LMS-TEST-PLAN.md` (the numbered tests below are the ones in it). Use a **test student**, not instructor preview: most LMSs record nothing in preview.

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

## Brightspace

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

## Moodle

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

## Canvas

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
| Brightspace | | | |
| Moodle | | | |
| Canvas | | | |

## Notes from the first Brightspace run

The first run in Brightspace was recorded on video (2026-10-12) and is not in this file as results. What that recording showed: the package launched and worked, narration played with captions, the quiz and its feedback layers worked, the adaptive "Remote tip" note appeared, the flip cards, tabs, table, steps, accordion and glossary worked, and the embedded YouTube video played inside the lesson. It did not show what Brightspace recorded for the score and status, because an instructor cannot see a learner's record from there. Please add the real numbers from a test student here.

## Summary

Which LMSs have passed tests 1 to 4: ______

Faults found and where they were fixed: ______

## One question for the release gate

The release gate says "Course completion and assessment success are tracked as separate states". SCORM 1.2 has only one status, so it cannot keep them separate: a course that was finished but failed is reported as failed. SCORM 2004 can keep them apart. How should the gate read for SCORM 1.2? One wording that is true: "Completion and success are both reported as correctly as SCORM 1.2 can express them, and are fully separate in SCORM 2004 (later)." The gate has not been changed. It needs your decision.
