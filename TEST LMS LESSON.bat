@echo off
REM Double-click to try the 24-slide LMS test lesson in a stand-in SCORM 1.2 LMS, with its narration.
REM Run PUBLISH LMS TEST LESSON.bat first. Close this window when you are finished.
REM Note: this is a test aid. The real test is in Brightspace (see LMS-TEST-PLAN.md in the lesson folder).

setlocal
cd /d "%~dp0"

if not exist "dist\lms-test-lesson\_scorm-test.html" (
  echo Nothing published yet. Run PUBLISH LMS TEST LESSON.bat first.
  echo.
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install it from https://www.python.org/downloads/
  echo.
  pause
  exit /b 1
)

echo Starting a local web server on port 8766. Close this window to stop it.
echo (Publishing again will fail while this window is open, so close it first.)
start "" "http://127.0.0.1:8766/lms-test-lesson/_scorm-test.html"
cd dist
python -m http.server 8766 --bind 127.0.0.1
