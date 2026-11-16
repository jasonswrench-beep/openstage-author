@echo off
REM Double-click to try the published example against a stand-in cmi5 learning system (the kind of LMS that launches a course the cmi5 way).
REM Run PUBLISH EXAMPLE.bat first. Close this window when you are finished.
REM The course and the learning system run on two different ports on this computer, as they would on two different sites.
REM The page it opens lists every statement the course sends and says at once if one breaks a rule of cmi5.
REM Note: this is a test aid. The real test is a cmi5 course imported into a real LMS (see examples\lms-test-lesson.osproj\LMS-START-HERE.md, round 3b).

setlocal
cd /d "%~dp0"

if not exist "dist\minimal\index.html" (
  echo Nothing published yet. Run PUBLISH EXAMPLE.bat first.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the LTS version from https://nodejs.org
  echo.
  pause
  exit /b 1
)

echo Starting the stand-in cmi5 learning system: the course on port 8765, the learning system on port 8766. Close this window to stop them.
echo To try a launch that only browses or reviews the course, add --mode Browse or --mode Review to the last line of this file.
start "" "http://127.0.0.1:8765/_xapi-test.html"
cd player
node stand-in-xapi.ts ..\dist --course minimal --port 8765 --lrs-port 8766 --cmi5
