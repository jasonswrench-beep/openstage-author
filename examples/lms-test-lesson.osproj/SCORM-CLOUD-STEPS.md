# SCORM Cloud, click by click

Written 2026-11-01 from Rustici's own help pages (listed at the end). I have not seen the screens myself, so a menu may be worded a little differently. If something is not where this says, send me what you see.

## Why this route

A Brightspace instructor account cannot test what Brightspace **records**. D2L's "Preview your course" page says Role Switch creates no learner activity and that Impersonate should not be used to check reporting or completion. So a Brightspace run as the instructor shows that the lesson launches and plays, not what status, score or resume the LMS keeps.

SCORM Cloud is Rustici's own test service. You are both the author and the learner there, so you can run the four tests yourself and read the result. It also holds an LRS, so it is the way to see the xAPI statements.

One caution from Rustici's guide: SCORM Cloud is "probably the friendliest, most accepting player out there". A pass here is real evidence that the lesson reports correctly, but it does not prove Brightspace (or Moodle, or Canvas) will behave the same. Treat it as the second opinion it is.

## Cost

Nothing. The free **Trial** plan has no time limit. Its limits are 3 courses, 5 GB and 10 registrations that you can reset (Account tab, then **Clear Existing Registrations**). Paid plans exist; you never need one for this. Signing up is your own sign-in, not mine. If the sign-up asks for a card or payment details, stop and tell me.

## Which zips to put in (only 3 courses at a time)

Put in the three lesson packages first: `lms-test-lesson-scorm12.zip`, `lms-test-lesson-scorm2004.zip`, `lms-test-lesson-xapi.zip` (about 15 MB each). For the question-types course, delete one of them from the Library first, then import `question-types-scorm12.zip`. The xAPI zip has `tincan.xml` in it, which is the manifest SCORM Cloud looks for.

## Importing a package

1. In SCORM Cloud, click the green **Add Content** button.
2. Click **Import a SCORM, AICC, xAPI or cmi5 package**.
3. **Choose File**, pick the zip, then **Import Course**.

## Two ways to run it

* **The Sandbox** (on the course's page in the Library): launch it as often as you like, with no registration limit. Use it for test 1, to look at the lesson inside SCORM Cloud's frame, and to read the **debug log**.
* **A registration**, made by an **invitation** (the **Invitations** tab, or the course's **Share** menu; a public invitation gives a link). Opening the link makes a registration, and a registration is what Reportage and the LRS are filled from. Use this for tests 2, 3 and 4. Each test needs a fresh registration, so register a different learner name each time (three tests on three packages is nine registrations; the Trial allows ten). Keep the link to yourself and delete the invitation afterwards. Anyone who has a public link can use it.

## Running the tests

Follow tests 1 to 4 in `LMS-TEST-PLAN.md`, one registration each for 2, 3 and 4.

For test 4 (resume), go to Question 3, close the window, then open **the same invitation link as the same learner**. It should open on Question 3.

## Reading the result

* **Reportage**: open the course in the Library, then click **Reportage**. (For everything, open the **History** tab and click **go to Reportage for Full Report**. Reportage defaults to the last 90 days.) It shows completion, pass/fail, score and time for each registration. Write down the words it uses.
* **The debug log**: shows every value the lesson sent and every commit. It is the thing to read when a result is wrong. The page ends with a URL you can send me.
* **xAPI statements**: the **xAPI LRS** tab has an **LRS Viewer** that lists every statement and shows the raw one when you click it. Rustici says statements from the Sandbox are kept apart from the "live" ones, so use a registration (an invitation) for the xAPI test, not the Sandbox. SCORM Cloud only counts progress from a statement that has a result and is about the course's main activity, so look for the `passed` and `completed` statements and their scores.

## What a correct result looks like

| Test | SCORM 1.2 | SCORM 2004 | xAPI |
| --- | --- | --- | --- |
| 2 Failing | failed, 60 | completed, failed, 60% | `failed`, scaled 0.6 |
| 3 Edge | passed, 80 | completed, passed, 80% | `passed`, scaled 0.8 |
| 4 Resume | opens on Question 3, ends passed, 100 | the same | `suspended` then `resumed`, ends passed |

SCORM 1.2 has one status, so a learner who finishes but fails shows as **failed**, never completed. That is the standard, not a fault.

## What to send back

For each test, a screenshot of the Reportage line for that registration, and for xAPI a screenshot of the LRS Viewer. If a result is not what the table says, send the debug log URL as well. Record anything surprising in `LMS-RESULTS.md`, in the "SCORM Cloud" table.

## Where this came from

* Rustici, SCORM Cloud user guide, Getting Started (import, Sandbox, Reportage, LRS, Trial limits): https://cloud.scorm.com/docs/user-guide/getting-started/
* Rustici Knowledge Base, "xAPI Course Statements in SCORM Cloud" (Sandbox statements are separate from live ones): https://support.scorm.com/hc/en-us/articles/115000064934-xAPI-Course-Statements-in-SCORM-Cloud
* Rustici Knowledge Base, "Working with launched xAPI courses" (progress comes from statements with a result on the main activity): https://support.scorm.com/hc/en-us/articles/115000684933-Working-with-launched-xAPI-courses
* D2L, "Preview your course" (why a Brightspace instructor run records nothing): https://community.d2l.com/brightspace/kb/articles/35010-preview-your-course
