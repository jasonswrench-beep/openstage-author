# Brightspace, click by click

Written 2026-11-01 from D2L's own help pages (listed at the end). Your Brightspace may word a menu a little differently from these pages. If something is not where this says, send me what you see; that is not a failure of the test.

The lesson itself is described in `LMS-START-HERE.md`; the numbered tests are in `LMS-TEST-PLAN.md`. This page is only the Brightspace part: putting the package in, getting a fresh attempt, and finding the result.

## Three things that change the result

1. **Be a real test student.** Log in as a test student account. Do not use Preview, and do not use Impersonate as a stand-in. One answer on D2L's community site says SCORM attempts are not logged correctly under impersonation. If you have no test student (an administrator can make one, or use a colleague), try Preview or Impersonate once anyway. If **SCORM Reports** then shows no attempt at all, write that down: it is Brightspace not recording, not a fault in the lesson.
2. **Open the lesson from the Content page.** D2L warns that a learner who opens a topic by a pasted direct link in full-screen is not counted in the SCORM reports.
3. **SCORM statistics cannot be reset.** D2L says so. Tests 2, 3 and 4 each need a fresh attempt, so give each its own object. The simplest way: copy the zip three times under different names (`lms-test-lesson-scorm12-test2.zip`, `-test3.zip`, `-test4.zip`) and upload each one. Each upload should become its own object with its own record. I have not seen Brightspace do this, so if it treats the copies as one (the same content), use three test students instead and tell me. Test 4 (resume) must close and reopen the **same** object as the **same** student.

## Adding a package (the same for all six zips)

1. Open the course, then **Content**. Pick or create a module (call it "OpenStage LMS test").
2. In the module choose **Upload/Create**, then **New SCORM Object/xAPI Object**. (In the newer Content layout it is **Add Existing**, then **SCORM/xAPI Object**.)
3. In the **Add Course Package** dialog click **Upload**, choose the zip, then **Save**.
4. On the next screen, set these:
   * **Grade item: Yes.** Choose a calculation method that uses the learner's **score** (the names vary; if unsure, take the one that mentions score), out of 100. This is how the score reaches **Grades**.
   * **Link to the version:** *Display this version even if a new version is added.* What you upload is then what is tested.
   * **Player:** the embedded player for the first run. Try the new-window option later for test 6.
   * **Review/retake:** leave the default, *Do not add review/retake options*. The lesson has its own retry, and Brightspace's would muddy test 4. (If you change this for an object already imported, D2L says the object must be re-imported.)
   * Click **Add**, then **Save**.
5. Check the topic is visible to students: not hidden, not a draft, no start date in the future.

## Running a test

Log in as the test student, open the course, **Content**, the module, then the topic. Do the clicks from `LMS-TEST-PLAN.md`.

The lesson writes to Brightspace as you go (every answer and slide change) and again when its page closes, so there is no special Exit to press. For tests 2 and 3, go to slide 24 and then leave the topic.

**Test 4 is the one most likely to differ**, because the plan has you close the lesson window without finishing. A learner can also leave through Brightspace's own back or close control instead. One D2L community thread reports a package whose saved progress only survived when it quit through its own quit call. If test 4 fails the first way, repeat it on a fresh copy of the zip and leave by Brightspace's own control, then tell me which of the two worked.

## Reading the result (as the instructor)

* **Content**, then the **Course options** menu above the Table of Contents, then **View Reports**, then **SCORM Reports**.
  * **SCORM Objects** tab, **Summary** icon: complete or incomplete, status, score, number of attempts, time, last accessed.
  * **Objectives** icon: score, status, progress.
  * **Interactions** icon: for each question the type, the correct response, the learner's response, the result. This is the page that shows **how Brightspace received each answer**, so it matters most for the question-types course (Round 4).
  * **Users** tab: click a name, then the **Details** icon.
* **Grades**: the grade item and the score.

D2L says that in the new SCORM solution "the available data is limited at this time". If Interactions or Objectives are empty, that may be Brightspace's limit. Write down exactly what is and is not there.

Write down the words Brightspace uses (for example "Complete" or "Incomplete" next to "Passed" or "Failed"), not what you expect it to mean. `LMS-RESULTS.md` has the table.

## Round by round

* **Round 1, SCORM 1.2:** `lms-test-lesson-scorm12.zip`, tests 1 to 4 (one object each for 2, 3 and 4, as above). Expect failed 60, passed 80, Question 3 then passed 100.
* **Round 2, SCORM 2004:** `lms-test-lesson-scorm2004.zip`, the same. Expect completed and failed 60, completed and passed 80, and resume.
* **Round 3, xAPI:** `lms-test-lesson-xapi.zip`, same menu. D2L's pages say Brightspace can add xAPI objects, but nothing I found says it records xAPI statements, and SCORM Reports are called SCORM reports. Open it, do test 3, and look in Grades and in SCORM Reports. If nothing shows, that is an expected finding: use SCORM Cloud for the statements.
* **Round 4, question types:** `question-types-scorm12.zip`. After answering, read the **Interactions** icon.

## What to send back

For each test: a screenshot of the **Summary** (and **Interactions** for Round 4), a screenshot of the **Grades** line, and a sentence saying which account you used (a real test student, or Preview or Impersonate). Any wording that surprised you, in Brightspace's own words.

## Cost

Nothing. No plan, licence or account needs buying for this.

## Where this came from

* D2L, Track activity and user progress on SCORM objects (updated May 2026): https://community.d2l.com/brightspace/kb/articles/3620-track-activity-and-user-progress-on-scorm-objects
* D2L, Import and manage SCORM (updated October 2026): https://community.d2l.com/brightspace/kb/articles/4971-import-and-manage-scorm
* D2L community thread "SCORM suspend_data": a responder advises testing SCORM as a logged-in test student and says impersonation does not log the attempt correctly. This is a community reply, not D2L documentation, and the thread's own poster found that a learner login did not cure their package either (a later D2L reply blamed that package): https://community.d2l.com/brightspace/discussion/6441/scorm-suspend-data
