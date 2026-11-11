# From draft to live, and changing a course afterwards

How to take a course from a draft to "live" in your LMS with OpenStage Author, and what to do when it needs changing after learners have started. Written for authors; nothing here needs a programmer.

## While it is a draft

* Keep one project folder for the course and save as you go. **Preview** (Ctrl+P) shows it as a learner sees it, saved or not.
* Give the course a **version** and, if your institution uses them, a **course code**: with nothing selected, open **Properties > Content > Course details**. A first version is often 1.0. The version shows beside the course's title at the top of the editor, so you always know which one you are working on.
* Set your **publishing style** once (**File > Publishing style...**): the names of the published files (for example `{code}_{title}_v{version}`, which gives `CMM-360_Introduction-to-Communication_v1.0`), and how the Word review document heads its slides and which font it uses. It is kept on your computer and used for every course you publish there.
* Use the **Word review document** that **Publish** makes beside the packages to have colleagues and accessibility reviewers read the course and write on it.

## Going live

1. Fix every error in the **Problems** panel. Publish refuses a course with errors; warnings do not stop it.
2. **Publish** (Ctrl+Shift+P). Upload the package your LMS asks for: SCORM 1.2 is the safest choice for most systems, SCORM 2004 if your LMS asks for it, xAPI for a learning record store.
3. Keep the zip you uploaded. Publishing again with the same name replaces it, so if your file names do not carry the version or the date, copy the zip somewhere safe.

## Changing a live course

There are two kinds of change, and they are done differently.

**Small fixes**: a typo, a clearer sentence, a better picture, a corrected alt text, a narration that was mispronounced.

* Keep editing the **same project**, publish again, and replace the package in your LMS (most systems have a way to update a SCORM item in place).
* Learners keep their progress in most systems, because the course has the same slides and questions.
* You can leave the version as it is, or raise it a little (1.0 to 1.1) if you want the file names to show the change.

**A big revision**: slides or questions added or removed, scoring changed, sections reordered, a new module.

* Use **File > Save as new version...**. It saves your changes to the version you have (if you agree), asks for the new version number (it suggests the next one, such as 2.0), and copies the whole course into a new, empty folder that you choose, narration audio and all. Then it opens the copy. The version that is live stays exactly as it is, in its own folder.
* Work on the new version, then publish it and upload it as a **new item** in your LMS, beside the old one, rather than over it. Many systems mix up or reset learner records when a course's slides or questions change under learners who have already started.
* When everyone has moved to the new version, hide or retire the old item in your LMS. Keep the old project folder: it is the only exact copy of what those learners saw.

If you are not sure which kind a change is, ask: would a learner who is halfway through notice that slides or questions are different? If yes, it is a big revision.

## Large courses

* Group the slides into **sections** (Slide > **New section starting here...**): the list of slides then shows each section's name with how many slides it has, and you can close the ones you are not working on. Sections change nothing a learner sees.
* **Go to slide** (Ctrl+J) finds any slide by its name or number.
* A section's menu (right-click its name, or Shift+F10) can sort its slides **A to Z** or **in the order they were made**, once; the course then plays them in that order, and Ctrl+Z puts them back.

## Where things are kept

* The course: its project folder, and nothing else. Copy the folder to back it up or to give the course to a colleague.
* Your publishing style, recent projects and keys: the editor's own settings on your computer, never in a project.
* The narration audio: inside the project folder, made again whenever the words change.
