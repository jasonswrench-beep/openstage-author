@echo off
REM Settings that belong to this computer, not to the project.
REM
REM Copy this file to local-settings.bat (in this same folder) and take the REM off the lines that apply.
REM local-settings.bat is never uploaded to GitHub, and OPEN EDITOR.bat and the PUBLISH bat files read it when it is there.

REM The Python that has the Kokoro speech engine installed, for narration (see docs/narration-setup.md).
REM set "OPENSTAGE_KOKORO_PYTHON=C:\Users\YourName\narration\.venv\Scripts\python.exe"

REM A Python for checking courses and publishing, if it is not the first "python" on the PATH.
REM set "OPENSTAGE_PYTHON=C:\Python311\python.exe"

REM Node.js, if it is not the first "node" on the PATH.
REM set "OPENSTAGE_NODE=C:\Program Files\nodejs\node.exe"
