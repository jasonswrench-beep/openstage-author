# Start here

What to do with this folder, in order.

## 1. Put it somewhere permanent

Unzip it to a folder you will keep, for example `D:\Documents\OpenStage`. Not Downloads.

## 2. Open it in Claude Code

Open the Claude desktop app, go to the Code tab, choose Local mode, and point it at this
folder. No GitHub account and no terminal needed for this step.

Claude Code reads `CLAUDE.md` at the start of every session, so it will already know what
this project is, what is in scope, and what is permanently out of scope, without you
re-explaining.

## 3. Read two files yourself

`CLAUDE.md` and `docs/format-spec.md`. Everything else follows from them, and both are
written for you rather than for a programmer. If anything in either one is wrong, change
it now, before code exists that assumes it.

## 4. First session

Suggested opening prompt:

> Read CLAUDE.md, docs/format-spec.md and docs/validator-spec.md. Then write the JSON
> Schema for the format in schema/project.schema.json, schema/slide.schema.json and
> schema/object.schema.json. Validate the two example projects against it. The minimal
> project should pass. The broken project should fail, and every failure listed in
> examples/broken.osproj/EXPECTED-FAILURES.md that a schema can catch should be among
> them. Tell me which expected failures a schema cannot catch, because those become the
> semantic rules.

That gives you a real artifact at the end of one session, and it tests the format spec
against reality rather than leaving it as prose.

## 5. GitHub, when you want it

Not required to start. When there is something worth showing, install GitHub Desktop,
which is a normal Windows app with buttons rather than terminal commands. Create the
repository on github.com, add this folder to GitHub Desktop, and publish.

## Checking the examples

Double-click `VALIDATE EXAMPLES.bat`. It runs the validator's tests, then validates the
two example projects. The minimal one should report no errors and the broken one should
report many. It needs Python installed, and tells you where to get it if you do not have
it. The first run installs one small Python package (`jsonschema`) for your user account.

## Writing captions by listening to the voice

The captions window (**Write captions...** on a video or audio clip) can listen to the voice and write the captions with their times. It needs a program that listens, built once by double-clicking
`BUILD SPEECH RECOGNISER.bat`, and a speech model (148 MB or 488 MB) that the captions window downloads when you press its button and say yes. Everything runs on your computer. See `docs/speech-recognition.md`.

## Making an installer, and trying it

Double-click `BUILD INSTALLER.bat`. The first time it downloads Python, Node and the installer maker, which takes some minutes, and it needs the recorder (`OPEN EDITOR.bat` builds it) and the
speech recogniser (`BUILD SPEECH RECOGNISER.bat`) to be built already. It makes one file, `dist\installer\OpenStage Author_0.1.0_x64-setup.exe` (about 41 MB), with a `.sha256` file beside it.
Double-click that file to install OpenStage Author for your own Windows account (no administrator password). It has its own Python and Node, so nothing else has to be installed, and it appears in the Start menu;
Settings, Apps removes it. It is not signed yet, so Windows shows "Windows protected your PC": choose **More info**, then **Run anyway**. To try an installer without touching the real program (its own name, its own
settings), use `BUILD INSTALLER.bat trial`. The narration voice is not in the installer: open **Narration** in the editor and press **Install the narration voice**; it asks first, downloads about 670 MB and takes about 2.1 GB.
The plan and the reasons are in `docs/decisions/0004-packaging-and-narration.md`.

## Publishing a course

Open a project in the editor (`OPEN EDITOR.bat`). **Preview** shows the course in your browser as it is now, even
if you have not saved. **Publish** saves, checks the project for problems, and makes a SCORM 1.2 zip to upload
to your LMS, with the same course as web files beside it. Both need Node.js installed, and Publish needs Python.
`PUBLISH EXAMPLE.bat` does the same for the example project without opening the editor.

## Trying a course in a real LMS

`examples/lms-test-lesson.osproj` is a full 24 slide sample lesson made for this: narration (including a voice for every
item inside its flip cards, tabs, steps, accordion and glossary), interactions, surveys, a five question graded quiz, a slide that adapts to the learner's answers, an embedded YouTube video, a results page, a
printable certificate, two files to download and a slide whose steps appear as they are spoken. Double-click `PUBLISH LMS TEST LESSON.bat`
(or press Publish in the editor) to make `dist/lms-test-lesson-scorm12.zip`, upload it to your LMS as a SCORM package, and
follow `examples/lms-test-lesson.osproj/LMS-TEST-PLAN.md`, which has the answer key, the steps, and what each test should show.

## The name, and one thing to change

The project is called OpenStage Author, and its website will be openstageauthor.com. Inside the files, "OpenStage"
on its own is the short form. The project format, the `.osproj` folders and the program file
(`openstage-editor.exe`) keep the short name on purpose.

`NOTICE` has your name in the copyright line. Change it if you want the project to be
attributed differently.
